import type { createAdminClient } from '@/lib/supabase/admin'
import { creditWallet } from '@/lib/wallet/service'
import { notifyInApp } from '@/lib/notifications/inbox'
import { REFERRAL_CREDIT_NGN } from './constants'

type Admin = ReturnType<typeof createAdminClient>

// A referral is earned by bringing in a player who actually pays to compete —
// not by bringing in an email address. Crediting on signup alone made a
// throwaway inbox worth ₦100, and paid out on free tournaments where the
// platform earns nothing.
//
// A comped entry (fee_waived) doesn't qualify either: no money changed hands,
// so there's nothing for the referral to be a share of.
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
// Idempotent via referrals.referred_id's UNIQUE constraint — a player can only
// ever earn their referrer one credit, no matter how many tournaments they
// later pay for. A 23505 means they were already counted and is ignored.
export async function creditReferralForPaidEntry(
  admin: Admin,
  playerId: string,
  args: { registrationFee: number; feeWaived: boolean },
): Promise<void> {
  try {
    if (!qualifiesForReferralCredit(args)) return

    const { data: profile } = await admin
      .from('profiles')
      .select('referred_by')
      .eq('id', playerId)
      .maybeSingle()
    if (!profile?.referred_by) return

    const { data: referral, error } = await admin
      .from('referrals')
      .insert({ referrer_id: profile.referred_by, referred_id: playerId })
      .select('id')
      .single()
    if (error || !referral) {
      if ((error as { code?: string })?.code !== '23505') {
        console.error('[referrals] credit failed', {
          playerId,
          code: (error as { code?: string })?.code,
          message: error?.message,
        })
      }
      return
    }

    await creditWallet(admin, profile.referred_by, REFERRAL_CREDIT_NGN, 'referral', referral.id)

    await notifyInApp({
      playerId: profile.referred_by,
      type: 'referral_credited',
      title: 'Referral credited',
      body: `Someone you referred just paid to enter a tournament — ₦${REFERRAL_CREDIT_NGN} added to your wallet.`,
      link: '/dashboard#referrals',
    })
  } catch (err) {
    console.error('[referrals] credit threw', {
      playerId,
      message: err instanceof Error ? err.message : String(err),
    })
  }
}
