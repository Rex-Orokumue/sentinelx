export type WalletTxnDisplayStatus = 'completed' | 'pending' | 'failed'

export interface RawWalletTxnRow {
  id: string
  type: string
  category: string | null
  amount: number
  reference_id: string | null
  note: string | null
  created_at: string
}

export interface WalletTxnRow {
  id: string
  type: string
  category: string | null
  amount: number
  createdAt: string
  status: WalletTxnDisplayStatus
}

const WITHDRAWAL_REQUEST_STATUS_TO_DISPLAY: Record<string, WalletTxnDisplayStatus> = {
  pending: 'pending',
  paid: 'completed',
  rejected: 'failed',
}

// wallet_transactions is an append-only ledger with no status column of its
// own (see plan Global Constraints) — every row is "completed" except a
// 'withdrawal_request' row, whose real status lives on the withdrawal_requests
// row it references. A 'withdrawal_reversal' row represents money already
// credited back, so it's always completed regardless of the original
// request's final status.
export function mapTransactionRows(
  rows: RawWalletTxnRow[],
  withdrawalRequestStatusById: Map<string, string>,
): WalletTxnRow[] {
  return rows.map((r) => {
    let status: WalletTxnDisplayStatus = 'completed'
    if (r.type === 'withdrawal_request' && r.reference_id) {
      const wrStatus = withdrawalRequestStatusById.get(r.reference_id)
      status = wrStatus ? WITHDRAWAL_REQUEST_STATUS_TO_DISPLAY[wrStatus] ?? 'completed' : 'completed'
    }
    return {
      id: r.id, type: r.type, category: r.category, amount: r.amount,
      createdAt: r.created_at, status,
    }
  })
}
