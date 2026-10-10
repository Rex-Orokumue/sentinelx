import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'

type Admin = SupabaseClient<Database>

export const OTP_DAILY_LIMIT = { limit: 10, windowMs: 86_400_000 } as const
export const REAUTH_LIMIT = { limit: 5, windowMs: 900_000 } as const

export const otpKey = (userId: string) => `otp:${userId}`
export const reauthKey = (userId: string) => `reauth:${userId}`

export interface LimitResult {
  allowed: boolean
  retryAfterSeconds: number
  hitId?: string
}

export async function refundLimitHit(admin: Admin, hitId?: string): Promise<void> {
  if (!hitId) return
  await admin.from('account_rate_limit_events').delete().eq('id', hitId)
}

// Insert first, then count the window, so two concurrent requests cannot both read
// "one left" (the chat limiter counts then inserts and can be raced). A rejected
// attempt's row is removed again so a blocked user is not locked out for longer by
// retrying.
//
// Fails OPEN if the ledger is unreachable: the callers either cost a WhatsApp message
// (bounded by the 60 s cooldown and 5 attempts) or sit behind Supabase's own
// signInWithPassword rate limit, and a ledger outage must not stop players verifying.
export async function hitLimit(
  admin: Admin,
  args: { key: string; limit: number; windowMs: number; now?: Date },
): Promise<LimitResult> {
  const now = args.now ?? new Date()
  const { data: inserted, error: insertError } = await admin
    .from('account_rate_limit_events')
    .insert({ subject_key: args.key, created_at: now.toISOString() })
    .select('id')
    .single()
  if (insertError || !inserted) {
    console.error('[account-limiter] insert failed', { message: insertError?.message })
    return { allowed: true, retryAfterSeconds: 0 }
  }

  const since = new Date(now.getTime() - args.windowMs).toISOString()
  const { data: rows, error: readError } = await admin
    .from('account_rate_limit_events')
    .select('created_at')
    .eq('subject_key', args.key)
    .gte('created_at', since)
    .order('created_at', { ascending: true })
  if (readError || !rows) {
    console.error('[account-limiter] read failed', { message: readError?.message })
    return { allowed: true, retryAfterSeconds: 0, hitId: inserted.id }
  }

  if (rows.length <= args.limit) return { allowed: true, retryAfterSeconds: 0, hitId: inserted.id }

  await admin.from('account_rate_limit_events').delete().eq('id', inserted.id)
  const oldest = new Date(rows[0].created_at).getTime()
  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil((oldest + args.windowMs - now.getTime()) / 1000)),
  }
}
