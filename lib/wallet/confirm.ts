import { verifyTransaction } from '@/lib/paystack/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { creditWallet } from './service'
import { notifyInApp } from '@/lib/notifications/inbox'
import { formatNaira } from '@/lib/format'

export type WalletDepositConfirmResult = 'confirmed' | 'already_paid' | 'not_found' | 'not_successful'

// Pure decision: given the current row status and Paystack's verify result,
// decide the outcome. No IO — unit tested directly. Mirrors
// lib/tournaments/confirm.ts's decideConfirmation exactly.
export function decideDepositConfirmation(args: {
  existing: { status: string } | null
  verify: { status: string; amountKobo: number } | null
  expectedKobo: number
}): WalletDepositConfirmResult {
  if (!args.existing) return 'not_found'
  if (args.existing.status === 'paid') return 'already_paid'
  if (!args.verify) return 'not_successful'
  if (args.verify.status !== 'success') return 'not_successful'
  if (args.verify.amountKobo < args.expectedKobo) return 'not_successful'
  return 'confirmed'
}

// Idempotent source of truth, called by BOTH the callback and the webhook —
// same pattern as confirmRegistration/confirmFriendlyStake. Returns
// 'not_found' (never throws) when the reference matches no deposit row,
// which is what lets the Paystack webhook/callback safely try this AFTER
// the tournament and friendly-match confirm attempts both return 'not_found'.
export async function confirmWalletDeposit(reference: string): Promise<WalletDepositConfirmResult> {
  const db = createAdminClient()

  const { data: existing } = await db
    .from('wallet_deposits')
    .select('id, player_id, amount, fee, status')
    .eq('paystack_reference', reference)
    .maybeSingle()

  if (!existing) return 'not_found'
  if (existing.status === 'paid') return 'already_paid'

  const expectedKobo = (existing.amount + existing.fee) * 100

  let verify: { status: string; amountKobo: number } | null = null
  try {
    verify = await verifyTransaction(reference)
  } catch (err) {
    console.error('[confirmWalletDeposit] Paystack verify failed', {
      reference,
      message: err instanceof Error ? err.message : String(err),
    })
    verify = null
  }

  const decision = decideDepositConfirmation({ existing, verify, expectedKobo })
  if (decision === 'not_successful') {
    console.error('[confirmWalletDeposit] Paystack verify did not confirm the payment', {
      reference,
      verify,
    })
  }
  if (decision !== 'confirmed') return decision

  // Guard against races: only the pending -> paid transition credits the wallet.
  const { data: claimed } = await db
    .from('wallet_deposits')
    .update({ status: 'paid' })
    .eq('id', existing.id)
    .eq('status', 'pending')
    .select('id')

  if (claimed && claimed.length > 0) {
    await creditWallet(db, existing.player_id, existing.amount, 'deposit', existing.id, 'Wallet top-up via Paystack')
    await notifyInApp({
      playerId: existing.player_id,
      type: 'wallet_credited',
      title: 'Wallet credited',
      body: `${formatNaira(existing.amount)} was added to your wallet.`,
      link: '/dashboard',
    })
  }

  return 'confirmed'
}
