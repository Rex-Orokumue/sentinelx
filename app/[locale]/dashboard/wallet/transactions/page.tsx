import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { TransactionRow } from '@/components/wallet/TransactionRow'
import { mapTransactionRows, type RawWalletTxnRow } from '@/lib/wallet/transactions'

export const metadata: Metadata = { title: 'Transactions · Wallet · SentinelX Esports', robots: { index: false, follow: false } }

const PAGE_SIZE = 20
type Filter = 'all' | 'winnings' | 'withdrawals' | 'deposits'
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'winnings', label: 'Winnings' },
  { key: 'withdrawals', label: 'Withdrawals' },
  { key: 'deposits', label: 'Deposits' },
]

export default async function WalletTransactionsPage({
  searchParams,
}: {
  searchParams: { filter?: string; page?: string }
}) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/dashboard/wallet/transactions')

  const validFilters: readonly string[] = ['winnings', 'withdrawals', 'deposits']
  const filter: Filter = validFilters.includes(searchParams.filter ?? '') ? (searchParams.filter as Filter) : 'all'
  const page = Math.max(1, Number.parseInt(searchParams.page ?? '1', 10) || 1)
  const offset = (page - 1) * PAGE_SIZE

  const admin = createAdminClient()
  let query = admin
    .from('wallet_transactions')
    .select('id, type, category, amount, reference_id, note, created_at', { count: 'exact' })
    .eq('player_id', user.id)
  if (filter === 'winnings') query = query.eq('category', 'tournament_prize')
  else if (filter === 'withdrawals') query = query.eq('category', 'withdrawal')
  else if (filter === 'deposits') query = query.eq('type', 'deposit')

  const { data, count } = await query.order('created_at', { ascending: false }).range(offset, offset + PAGE_SIZE - 1)
  const rows = (data ?? []) as RawWalletTxnRow[]
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE))

  const withdrawalRequestIds = rows.flatMap((r) => (r.type === 'withdrawal_request' && r.reference_id ? [r.reference_id] : []))
  const { data: wrRows } =
    withdrawalRequestIds.length > 0
      ? await admin.from('withdrawal_requests').select('id, status').in('id', withdrawalRequestIds)
      : { data: [] as { id: string; status: string }[] }
  const transactions = mapTransactionRows(rows, new Map((wrRows ?? []).map((r) => [r.id, r.status])))

  function hrefFor(next: { filter?: string; page?: string }) {
    const sp = new URLSearchParams()
    const f = next.filter ?? filter
    if (f !== 'all') sp.set('filter', f)
    const p = next.page ?? String(page)
    if (p !== '1') sp.set('page', p)
    const qs = sp.toString()
    return `/dashboard/wallet/transactions${qs ? `?${qs}` : ''}`
  }

  return (
    <section className="rounded-2xl border border-sx-border bg-sx-surface p-5">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-white">All Transactions</h2>
      <div className="mb-4 flex gap-2 overflow-x-auto scrollbar-hide">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={hrefFor({ filter: f.key, page: '1' })}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold ${
              filter === f.key ? 'bg-sx-purple text-white' : 'border border-sx-border text-sx-gray hover:text-white'
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>
      {transactions.length === 0 ? (
        <p className="text-sm text-sx-gray">No transactions match this filter.</p>
      ) : (
        <div className="divide-y divide-sx-border">
          {transactions.map((t) => (
            <TransactionRow key={t.id} txn={t} />
          ))}
        </div>
      )}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2 text-sm">
          <Link
            href={hrefFor({ page: String(Math.max(1, page - 1)) })}
            aria-disabled={page === 1}
            className={page === 1 ? 'pointer-events-none opacity-30' : 'text-white hover:text-sx-purple-text'}
          >
            ← Prev
          </Link>
          <span className="text-sx-gray">
            Page {page} of {totalPages}
          </span>
          <Link
            href={hrefFor({ page: String(Math.min(totalPages, page + 1)) })}
            aria-disabled={page === totalPages}
            className={page === totalPages ? 'pointer-events-none opacity-30' : 'text-white hover:text-sx-purple-text'}
          >
            Next →
          </Link>
        </div>
      )}
    </section>
  )
}
