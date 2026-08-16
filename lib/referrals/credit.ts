import type { createAdminClient } from '@/lib/supabase/admin'
import { settleReferral } from './actions'

type Admin = ReturnType<typeof createAdminClient>

// A referral is earned by bringing in a player who actually pays to compete —
// not by bringing in an email address. A comped entry (fee_waived) doesn't
// qualify either: no money changed hands, so there's nothing for the
// referral to be a share of.
export function qualifiesForReferralCredit(args: {
  registrationFee: number
  feeWaived: boolean
}): boolean {
  return args.registrationFee > 0 && !args.feeWaived
}

// Best-effort: NEVER throws into the caller. This runs inside payment
// confirmation, and a referral bookkeeping failure must not fail a
// registration the player has already been charged for.
//
// Converts the referred player's existing 'pending' referrals row (created
// at signup by handle_new_user()) to 'converted'. Falls back to inserting a
// fresh 'converted' row for players who signed up before this pending-row
// migration landed (profiles.referred_by set, no referrals row yet) —
// mirrors the pre-redesign insert-at-conversion behaviour for that legacy
// population. Idempotent either way: the pending->converted UPDATE only
// ever affects a 'pending' row (0 rows the second time), and the fallback
// INSERT relies on referrals.referred_id's UNIQUE constraint (a 23505 means
// this player already converted, and is silently ignored).
export async function settleReferralForPaidEntry(
  admin: Admin,
  playerId: string,
  args: { registrationFee: number; feeWaived: boolean },
): Promise<void> {
  try {
    if (!qualifiesForReferralCredit(args)) return

    const { data: converted } = await admin
      .from('referrals')
      .update({ status: 'converted', converted_at: new Date().toISOString() })
      .eq('referred_id', playerId)
      .eq('status', 'pending')
      .select('id, referrer_id')

    let referral = converted?.[0] ?? null

    if (!referral) {
      const { data: profile } = await admin
        .from('profiles')
        .select('referred_by')
        .eq('id', playerId)
        .maybeSingle()
      if (!profile?.referred_by) return

      const { data: inserted, error } = await admin
        .from('referrals')
        .insert({
          referrer_id: profile.referred_by,
          referred_id: playerId,
          status: 'converted',
          converted_at: new Date().toISOString(),
        })
        .select('id, referrer_id')
        .single()
      if (error || !inserted) {
        if ((error as { code?: string })?.code !== '23505') {
          console.error('[referrals] legacy conversion insert failed', {
            playerId,
            code: (error as { code?: string })?.code,
            message: error?.message,
          })
        }
        return
      }
      referral = inserted
    }

    await settleReferral(admin, referral.id, referral.referrer_id, playerId)
  } catch (err) {
    console.error('[referrals] settleReferralForPaidEntry threw', {
      playerId,
      message: err instanceof Error ? err.message : String(err),
    })
  }
}
