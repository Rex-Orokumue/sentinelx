import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import { initializeTransaction, buildWalletDepositReference } from '@/lib/paystack/server'
import { computePaystackFee } from '@/lib/paystack/fees'
import { SITE_URL } from '@/lib/seo/site'
import { assertNotPendingDeletion } from '@/lib/settings/restriction'

type Admin = SupabaseClient<Database>

export type StartDepositResult =
  | { ok: true; reference: string; authorizationUrl: string; amount: number; fee: number; total: number }
  | { ok: false; reason: 'email_required' | 'pending_deletion' | 'insert_failed' | 'paystack_failed' }

// Starts a Paystack wallet top-up for `playerId`. The fee is computed here, never taken from the
// caller. The wallet is credited only later, by confirmWalletDeposit, once Paystack confirms.
export async function startDeposit(
  admin: Admin,
  args: { playerId: string; email: string | null; amount: number },
): Promise<StartDepositResult> {
  // An account pending deletion must not take on new obligations.
  if (await assertNotPendingDeletion(admin, args.playerId)) return { ok: false, reason: 'pending_deletion' }
  if (!args.email) return { ok: false, reason: 'email_required' }

  const fee = computePaystackFee(args.amount)
  const reference = buildWalletDepositReference(args.playerId)

  const { error: insertErr } = await admin.from('wallet_deposits').insert({
    player_id: args.playerId,
    amount: args.amount,
    fee,
    paystack_reference: reference,
    status: 'pending',
  })
  if (insertErr) return { ok: false, reason: 'insert_failed' }

  try {
    const authorizationUrl = await initializeTransaction({
      email: args.email,
      amountKobo: (args.amount + fee) * 100,
      reference,
      callbackUrl: `${SITE_URL}/api/paystack/callback`,
      metadata: { player_id: args.playerId, amount: args.amount, fee },
    })
    return { ok: true, reference, authorizationUrl, amount: args.amount, fee, total: args.amount + fee }
  } catch (err) {
    console.error('[startDeposit] Paystack initialize failed', {
      reference,
      message: err instanceof Error ? err.message : String(err),
    })
    return { ok: false, reason: 'paystack_failed' }
  }
}
