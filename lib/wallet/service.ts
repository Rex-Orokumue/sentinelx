import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'

export type WalletTxnType =
  | 'prize'
  | 'referral'
  | 'friendly_stake'
  | 'admin_credit'
  | 'withdrawal_request'
  | 'withdrawal_reversal'

export async function getWalletBalance(
  admin: SupabaseClient<Database>,
  playerId: string,
): Promise<number> {
  const { data } = await admin.from('wallets').select('balance').eq('player_id', playerId).maybeSingle()
  return data?.balance ?? 0
}

// Upserts the wallet row (created lazily on first credit) and appends the
// ledger row. Credits only ever increase the balance — no floor to check.
export async function creditWallet(
  admin: SupabaseClient<Database>,
  playerId: string,
  amount: number,
  type: WalletTxnType,
  referenceId: string | null,
  note?: string,
): Promise<void> {
  const { data: existing } = await admin
    .from('wallets')
    .select('balance')
    .eq('player_id', playerId)
    .maybeSingle()

  if (existing) {
    await admin
      .from('wallets')
      .update({ balance: existing.balance + amount, updated_at: new Date().toISOString() })
      .eq('player_id', playerId)
  } else {
    await admin.from('wallets').insert({ player_id: playerId, balance: amount })
  }

  await admin.from('wallet_transactions').insert({
    player_id: playerId,
    amount,
    type,
    reference_id: referenceId,
    note: note ?? null,
  })
}

// Conditional UPDATE ... WHERE balance >= amount (via .gte()) is the atomic
// safety net: PostgREST translates it to WHERE player_id = $1 AND
// balance >= $2 on the actual UPDATE statement, so even if the caller's own
// pre-check (lib/wallet/actions.ts) read a stale balance, only one
// concurrent debit can succeed once the first has already lowered it below
// the second's amount. Zero rows updated -> insufficient balance, returned
// as a typed error — never a thrown Postgres constraint violation.
export async function debitWallet(
  admin: SupabaseClient<Database>,
  playerId: string,
  amount: number,
  type: WalletTxnType,
  referenceId: string | null,
  note?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: wallet } = await admin
    .from('wallets')
    .select('balance')
    .eq('player_id', playerId)
    .maybeSingle()
  const currentBalance = wallet?.balance ?? 0
  if (currentBalance < amount) {
    return { ok: false, error: 'Insufficient wallet balance.' }
  }

  const { data: updated } = await admin
    .from('wallets')
    .update({ balance: currentBalance - amount, updated_at: new Date().toISOString() })
    .eq('player_id', playerId)
    .gte('balance', amount)
    .select('balance')
  if (!updated || updated.length === 0) {
    return { ok: false, error: 'Insufficient wallet balance.' }
  }

  await admin.from('wallet_transactions').insert({
    player_id: playerId,
    amount: -amount,
    type,
    reference_id: referenceId,
    note: note ?? null,
  })
  return { ok: true }
}
