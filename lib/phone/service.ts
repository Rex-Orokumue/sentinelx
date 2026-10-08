import { randomInt } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import { toWhatsAppNumber } from './number'
import { phoneCodeSchema } from './schema'
import { hashCode, codeMatches } from './hash'
import { sendWhatsAppOtp, isWhatsAppOtpConfigured } from '@/lib/notifications/whatsapp-cloud-api'
import { checkAndUnlockAchievements } from '@/lib/achievements/unlock'
import { hitLimit, otpKey, OTP_DAILY_LIMIT } from '@/lib/rate-limit/account-limiter'

type Admin = SupabaseClient<Database>

export const CODE_TTL_MS = 10 * 60 * 1000
export const RESEND_COOLDOWN_MS = 60 * 1000
export const MAX_ATTEMPTS = 5

export type RequestPhoneCodeOutcome =
  | { ok: true; expiresAt: string; resendAt: string }
  | { ok: false; reason: 'invalid_phone' | 'unavailable' | 'send_failed' | 'save_failed' }
  | { ok: false; reason: 'cooldown' | 'daily_limit'; retryAfterSeconds: number }

// Extracted from lib/phone/actions.ts requestPhoneCode(); the action and POST /me/phone/code
// both call it.
//
// strictDelivery is the one deliberate difference. The web action has always treated an
// unconfigured WhatsApp sender as success (the form says "code sent" and nothing arrives). The
// API must not: with enforce_phone_verification on, that strands every player at a code that
// never comes. Strict mode refuses BEFORE writing a row or spending a rate-limit hit.
export async function performRequestPhoneCode(args: {
  admin: Admin
  userId: string
  rawPhone: string
  strictDelivery: boolean
  now?: Date
}): Promise<RequestPhoneCodeOutcome> {
  const { admin, userId } = args
  const now = args.now ?? new Date()

  if (args.strictDelivery && !isWhatsAppOtpConfigured()) return { ok: false, reason: 'unavailable' }

  // Parse against the player's own country: a South African or Kenyan national number is 10
  // digits starting '0' just like a truncated Nigerian one, and guessing Nigeria would send
  // their code to a stranger's WhatsApp.
  const { data: countryRow } = await admin.from('profiles').select('country').eq('id', userId).maybeSingle()
  const phone = toWhatsAppNumber(args.rawPhone, { country: countryRow?.country })
  if (!phone) return { ok: false, reason: 'invalid_phone' }

  const { data: existing } = await admin.from('phone_verifications').select('created_at').eq('user_id', userId).maybeSingle()
  if (existing) {
    const elapsed = now.getTime() - new Date(existing.created_at).getTime()
    if (elapsed < RESEND_COOLDOWN_MS) {
      return { ok: false, reason: 'cooldown', retryAfterSeconds: Math.max(1, Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000)) }
    }
  }

  const limit = await hitLimit(admin, { key: otpKey(userId), ...OTP_DAILY_LIMIT, now })
  if (!limit.allowed) return { ok: false, reason: 'daily_limit', retryAfterSeconds: limit.retryAfterSeconds }

  const code = randomInt(0, 1_000_000).toString().padStart(6, '0')
  const expiresAt = new Date(now.getTime() + CODE_TTL_MS)
  const { error } = await admin.from('phone_verifications').upsert(
    {
      user_id: userId,
      phone,
      code_hash: hashCode(code),
      attempts: 0,
      expires_at: expiresAt.toISOString(),
      created_at: now.toISOString(),
    },
    { onConflict: 'user_id' },
  )
  if (error) return { ok: false, reason: 'save_failed' }

  const sent = await sendWhatsAppOtp({ to: phone, code })
  if (!sent.ok && !sent.skipped) return { ok: false, reason: 'send_failed' }

  return { ok: true, expiresAt: expiresAt.toISOString(), resendAt: new Date(now.getTime() + RESEND_COOLDOWN_MS).toISOString() }
}

export type ConfirmPhoneCodeOutcome =
  | { ok: true; verifiedAt: string }
  | { ok: false; reason: 'invalid_code' | 'missing' | 'expired' | 'attempts_exceeded' | 'wrong' }

export async function performConfirmPhoneCode(args: {
  admin: Admin
  userId: string
  code: string
  now?: Date
}): Promise<ConfirmPhoneCodeOutcome> {
  const { admin, userId } = args
  const now = args.now ?? new Date()

  const parsed = phoneCodeSchema.safeParse(args.code)
  if (!parsed.success) return { ok: false, reason: 'invalid_code' }

  const { data: pending } = await admin
    .from('phone_verifications')
    .select('phone, code_hash, attempts, expires_at')
    .eq('user_id', userId)
    .maybeSingle()
  if (!pending) return { ok: false, reason: 'missing' }
  if (new Date(pending.expires_at).getTime() < now.getTime()) return { ok: false, reason: 'expired' }
  if (pending.attempts >= MAX_ATTEMPTS) return { ok: false, reason: 'attempts_exceeded' }

  if (!codeMatches(parsed.data, pending.code_hash)) {
    await admin.from('phone_verifications').update({ attempts: pending.attempts + 1 }).eq('user_id', userId)
    return { ok: false, reason: 'wrong' }
  }

  // Single update: both columns together, per the design spec.
  const verifiedAt = now.toISOString()
  await admin.from('profiles').update({ phone: pending.phone, phone_verified_at: verifiedAt }).eq('id', userId)
  await checkAndUnlockAchievements(admin, userId, { type: 'profile_updated' })
  await admin.from('phone_verifications').delete().eq('user_id', userId)
  return { ok: true, verifiedAt }
}
