import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'

export type WalletTxnType =
  | 'prize'
  | 'referral'
  | 'friendly_stake'
  | 'admin_credit'
  | 'withdrawal_request'
  | 'withdrawal_reversal'
  | 'deposit'

const DEFAULT_CATEGORY_BY_TYPE: Record<WalletTxnType, string> = {
  prize: 'tournament_prize',
  referral: 'referral',
  friendly_stake: 'bonus',
  admin_credit: 'bonus',
  withdrawal_request: 'withdrawal',
  withdrawal_reversal: 'withdrawal',
  deposit: 'bonus',
}

export async function getWalletBalance(
  admin: SupabaseClient<Database>,
  playerId: string,
): Promise<number> {
  const { data } = await admin.from('wallets').select('balance').eq('player_id', playerId).maybeSingle()
  return data?.balance ?? 0
}

export const categoryFor = (type: WalletTxnType): string => DEFAULT_CATEGORY_BY_TYPE[type]

// Every balance change goes through the wallet_apply Postgres function, which updates the
// balance with `balance = balance + delta` and appends the ledger row in ONE transaction, so
// concurrent writers can never overwrite each other. It never throws: callers such as the
// prize-distribution loop must not be aborted half-way by one failed credit; they (and
// confirmWalletDeposit) read the result instead.
export async function creditWallet(
  admin: SupabaseClient<Database>,
  playerId: string,
  amount: number,
  type: WalletTxnType,
  referenceId: string | null,
  note?: string,
): Promise<{ ok: true; balance: number } | { ok: false }> {
  try {
    const { data, error } = await admin.rpc('wallet_apply', {
      p_player: playerId,
      p_delta: amount,
      p_type: type,
      p_reference: referenceId,
      p_note: note ?? null,
      p_category: categoryFor(type),
    })
    if (error || data == null) {
      console.error('[wallet] credit failed', { type, referenceId, message: error?.message })
      return { ok: false }
    }
    return { ok: true, balance: data }
  } catch (err) {
    console.error('[wallet] credit threw', { type, referenceId, message: err instanceof Error ? err.message : String(err) })
    return { ok: false }
  }
}

// A null balance from wallet_apply means the debit would have taken the balance below zero and
// nothing was written; an rpc error is reported separately so it is never mistaken for
// "insufficient balance".
export async function debitWallet(
  admin: SupabaseClient<Database>,
  playerId: string,
  amount: number,
  type: WalletTxnType,
  referenceId: string | null,
  note?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { data, error } = await admin.rpc('wallet_apply', {
      p_player: playerId,
      p_delta: -amount,
      p_type: type,
      p_reference: referenceId,
      p_note: note ?? null,
      p_category: categoryFor(type),
    })
    if (error) {
      console.error('[wallet] debit failed', { type, referenceId, message: error.message })
      return { ok: false, error: 'Wallet is unavailable right now.' }
    }
    if (data == null) return { ok: false, error: 'Insufficient wallet balance.' }
    return { ok: true }
  } catch (err) {
    console.error('[wallet] debit threw', { type, referenceId, message: err instanceof Error ? err.message : String(err) })
    return { ok: false, error: 'Wallet is unavailable right now.' }
  }
}
