import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import { HISTORY_PAGE_SIZE, keysetFilterOn, pageOf } from '@/lib/mobile-api/history-cursor'
import { maskAccountNumber, type PayoutAccountMasked } from '@/lib/kyc/logic'

type Admin = SupabaseClient<Database>

// admin_note is deliberately NOT selected: staff remarks are never shown to the player (the web never does).
export const WITHDRAWAL_COLUMNS = 'id, amount, status, requested_at, resolved_at, bank_name, account_name, account_number'

export interface WithdrawalItem {
  id: string
  amount: number
  status: string
  requestedAt: string
  resolvedAt: string | null
  payoutAccount: PayoutAccountMasked
}

export type WithdrawalsPageResult = { ok: true; items: WithdrawalItem[]; nextCursor: string | null } | { ok: false }

interface Row {
  id: string
  amount: number
  status: string
  requested_at: string
  resolved_at: string | null
  bank_name: string
  account_name: string
  account_number: string
}

// The caller's own withdrawal requests, newest first, keyset-paged on requested_at. The bank details are
// the snapshot taken when the request was filed, returned masked.
export async function loadWithdrawalsPage(
  admin: Admin,
  playerId: string,
  args: { cursor: { t: string; id: string } | null },
): Promise<WithdrawalsPageResult> {
  let query = admin.from('withdrawal_requests').select(WITHDRAWAL_COLUMNS).eq('player_id', playerId)
  if (args.cursor) query = query.or(keysetFilterOn('requested_at', args.cursor))
  const { data, error } = await query
    .order('requested_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(HISTORY_PAGE_SIZE + 1)
  if (error || !data) {
    console.error('[wallet] withdrawals read failed', { message: error?.message })
    return { ok: false }
  }

  // pageOf keys on created_at; the cursor carries requested_at under that name.
  const rows = (data as unknown as Row[]).map((r) => ({ ...r, created_at: r.requested_at }))
  const { items, nextCursor } = pageOf(rows)
  return {
    ok: true,
    nextCursor,
    items: items.map((r) => ({
      id: r.id,
      amount: r.amount,
      status: r.status,
      requestedAt: r.requested_at,
      resolvedAt: r.resolved_at,
      payoutAccount: { bankName: r.bank_name, accountName: r.account_name, accountNumberMasked: maskAccountNumber(r.account_number) },
    })),
  }
}
