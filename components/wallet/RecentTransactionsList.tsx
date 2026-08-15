import Link from 'next/link'
import { TransactionRow } from './TransactionRow'
import type { WalletTxnRow } from '@/lib/wallet/transactions'

export function RecentTransactionsList({ transactions }: { transactions: WalletTxnRow[] }) {
  return (
    <section className="rounded-2xl border border-sx-border bg-sx-surface p-5">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wide text-white">Recent Transactions</h2>
        <Link href="/dashboard/wallet/transactions" className="text-xs font-semibold text-sx-purple-text hover:text-sx-purple-light">
          View All →
        </Link>
      </div>
      {transactions.length === 0 ? (
        <p className="text-sm text-sx-gray">No transactions yet — your history will appear here.</p>
      ) : (
        <div className="divide-y divide-sx-border">
          {transactions.map((t) => (
            <TransactionRow key={t.id} txn={t} />
          ))}
        </div>
      )}
    </section>
  )
}
