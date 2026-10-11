import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import { HISTORY_PAGE_SIZE, keysetFilter, pageOf } from '@/lib/mobile-api/history-cursor'
import { mapTransactionRows, type RawWalletTxnRow, type WalletTxnRow } from './transactions'

type Admin = SupabaseClient<Database>

export type WalletFilter = 'all' | 'winnings' | 'withdrawals' | 'deposits'

const FILTERS: readonly string[] = ['winnings', 'withdrawals', 'deposits']

// Unknown or missing input is 'all', matching the web page.
export function parseFilter(raw: string | null | undefined): WalletFilter {
  return FILTERS.includes(raw ?? '') ? (raw as WalletFilter) : 'all'
}

// The one place the filter predicates live; the web transactions page and the mobile endpoint both use it.
export function applyFilter<Q extends { eq: (column: string, value: string) => Q }>(query: Q, filter: WalletFilter): Q {
  if (filter === 'winnings') return query.eq('category', 'tournament_prize')
  if (filter === 'withdrawals') return query.eq('category', 'withdrawal')
  if (filter === 'deposits') return query.eq('type', 'deposit')
  return query
}

export type TransactionsPageResult =
  | { ok: true; items: WalletTxnRow[]; nextCursor: string | null }
  | { ok: false }

// Keyset-paged ledger for the mobile app (newest first). Scoped to `playerId`; a failed read is reported.
export async function loadTransactionsPage(
  admin: Admin,
  playerId: string,
  args: { filter: WalletFilter; cursor: { t: string; id: string } | null },
): Promise<TransactionsPageResult> {
  let query = applyFilter(
    admin
      .from('wallet_transactions')
      .select('id, type, category, amount, reference_id, note, created_at')
      .eq('player_id', playerId),
    args.filter,
  )
  if (args.cursor) query = query.or(keysetFilter(args.cursor))
  const { data, error } = await query
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(HISTORY_PAGE_SIZE + 1)
  if (error || !data) {
    console.error('[wallet] transactions read failed', { message: error?.message })
    return { ok: false }
  }

  const { items, nextCursor } = pageOf(data as RawWalletTxnRow[])
  const requestIds = items.flatMap((r) => (r.type === 'withdrawal_request' && r.reference_id ? [r.reference_id] : []))
  let statusById = new Map<string, string>()
  if (requestIds.length > 0) {
    const { data: requests, error: requestsError } = await admin
      .from('withdrawal_requests')
      .select('id, status')
      .eq('player_id', playerId)
      .in('id', requestIds)
    if (requestsError) {
      console.error('[wallet] withdrawal status read failed', { message: requestsError.message })
      return { ok: false }
    }
    statusById = new Map((requests ?? []).map((r) => [r.id, r.status]))
  }
  return { ok: true, items: mapTransactionRows(items, statusById), nextCursor }
}
