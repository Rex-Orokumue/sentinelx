'use server'
import { randomInt } from 'crypto'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { toWhatsAppNumber } from './number'
import { sendWhatsAppOtp } from '@/lib/notifications/whatsapp-cloud-api'
import { phoneCodeSchema } from './schema'
import { hashCode, codeMatches } from './hash'
import { checkAndUnlockAchievements } from '@/lib/achievements/unlock'

export type PhoneActionState = { error?: string; success?: boolean } | undefined

const CODE_TTL_MS = 10 * 60 * 1000
const RESEND_COOLDOWN_MS = 60 * 1000
const MAX_ATTEMPTS = 5

export async function requestPhoneCode(
  _prev: PhoneActionState,
  formData: FormData,
): Promise<PhoneActionState> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }

  const admin = createAdminClient()
  // Parse against the player's own country: a South African or Kenyan national
  // number is 10 digits starting '0' just like a truncated Nigerian one, and
  // guessing Nigeria would send their code to a stranger's WhatsApp.
  const { data: countryRow } = await admin
    .from('profiles')
    .select('country')
    .eq('id', user.id)
    .maybeSingle()
  const phone = toWhatsAppNumber(String(formData.get('phone') ?? ''), {
    country: countryRow?.country,
  })
  if (!phone) return { error: 'Enter a valid phone number, including your country code if you are outside Nigeria.' }
  const { data: existing } = await admin
    .from('phone_verifications')
    .select('created_at')
    .eq('user_id', user.id)
    .maybeSingle()
  if (existing && new Date(existing.created_at).getTime() > Date.now() - RESEND_COOLDOWN_MS) {
    return { error: 'Please wait a minute before requesting another code.' }
  }

  const code = randomInt(0, 1_000_000).toString().padStart(6, '0')
  const { error } = await admin.from('phone_verifications').upsert(
    {
      user_id: user.id,
      phone,
      code_hash: hashCode(code),
      attempts: 0,
      expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
    },
    { onConflict: 'user_id' },
  )
  if (error) return { error: 'Could not send a code. Please try again.' }

  const sent = await sendWhatsAppOtp({ to: phone, code })
  if (!sent.ok && !sent.skipped) return { error: 'Could not send the WhatsApp message. Please try again.' }

  return { success: true }
}

export async function confirmPhoneCode(
  _prev: PhoneActionState,
  formData: FormData,
): Promise<PhoneActionState> {
  const parsed = phoneCodeSchema.safeParse(formData.get('code'))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }

  const admin = createAdminClient()
  const { data: pending } = await admin
    .from('phone_verifications')
    .select('phone, code_hash, attempts, expires_at')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!pending) return { error: 'Request a new code first.' }
  if (new Date(pending.expires_at).getTime() < Date.now()) {
    return { error: 'That code expired. Request a new one.' }
  }
  if (pending.attempts >= MAX_ATTEMPTS) {
    return { error: 'Too many incorrect attempts. Request a new code.' }
  }

  if (!codeMatches(parsed.data, pending.code_hash)) {
    await admin
      .from('phone_verifications')
      .update({ attempts: pending.attempts + 1 })
      .eq('user_id', user.id)
    return { error: 'Incorrect code.' }
  }

  // Single update — both columns together, per the design spec.
  await admin
    .from('profiles')
    .update({ phone: pending.phone, phone_verified_at: new Date().toISOString() })
    .eq('id', user.id)
  await checkAndUnlockAchievements(admin, user.id, { type: 'profile_updated' })
  await admin.from('phone_verifications').delete().eq('user_id', user.id)

  revalidatePath('/dashboard')
  return { success: true }
}
