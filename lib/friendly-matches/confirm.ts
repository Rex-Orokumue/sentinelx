import { verifyTransaction } from '@/lib/paystack/server'
import { createAdminClient } from '@/lib/supabase/admin'

export type FriendlyConfirmResult = 'confirmed' | 'already_paid' | 'not_found' | 'not_successful'

export function decideFriendlyConfirmation(args: {
  alreadyPaid: boolean
  stakeAmount: number | null
  verify: { status: string; amountKobo: number } | null
}): FriendlyConfirmResult {
  if (args.alreadyPaid) return 'already_paid'
  if (!args.stakeAmount) return 'not_found'
  if (!args.verify) return 'not_successful'
  if (args.verify.status !== 'success') return 'not_successful'
  if (args.verify.amountKobo < args.stakeAmount * 100) return 'not_successful'
  return 'confirmed'
}

// Idempotent source of truth, called by BOTH the callback and the webhook —
// same pattern as confirmRegistration. Returns 'not_found' (never throws)
// when the reference matches neither side of any friendly match, which is
// what lets the Paystack webhook/callback safely try this AFTER
// confirmRegistration returns 'not_found' for a tournament-registration
// lookup, without risking a real error being silently reinterpreted.
export async function confirmFriendlyStake(reference: string): Promise<FriendlyConfirmResult> {
  const db = createAdminClient()

  const { data: byChallenger } = await db
    .from('friendly_matches')
    .select('id, challenger_id, opponent_id, stake_amount, challenger_paid, opponent_paid, status')
    .eq('challenger_paystack_reference', reference)
    .maybeSingle()
  const { data: byOpponent } = byChallenger
    ? { data: null }
    : await db
        .from('friendly_matches')
        .select('id, challenger_id, opponent_id, stake_amount, challenger_paid, opponent_paid, status')
        .eq('opponent_paystack_reference', reference)
        .maybeSingle()

  const match = byChallenger ?? byOpponent
  if (!match) return 'not_found'
  const side: 'challenger' | 'opponent' = byChallenger ? 'challenger' : 'opponent'
  const alreadyPaid = side === 'challenger' ? match.challenger_paid : match.opponent_paid

  let verify: { status: string; amountKobo: number } | null = null
  try {
    verify = await verifyTransaction(reference)
  } catch (err) {
    console.error('[confirmFriendlyStake] Paystack verify failed', {
      reference,
      message: err instanceof Error ? err.message : String(err),
    })
    verify = null
  }

  const decision = decideFriendlyConfirmation({ alreadyPaid, stakeAmount: match.stake_amount, verify })
  if (decision !== 'confirmed') return decision

  const otherPaid = side === 'challenger' ? match.opponent_paid : match.challenger_paid
  // Both sides paid -> unlock the Match Room. Otherwise stay awaiting_payment.
  const nextStatus = otherPaid ? 'active' : 'awaiting_payment'
  if (side === 'challenger') {
    await db
      .from('friendly_matches')
      .update({ challenger_paid: true, status: nextStatus })
      .eq('id', match.id)
  } else {
    await db
      .from('friendly_matches')
      .update({ opponent_paid: true, status: nextStatus })
      .eq('id', match.id)
  }

  return 'confirmed'
}
