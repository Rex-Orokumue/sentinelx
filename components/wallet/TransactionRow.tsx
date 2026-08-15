import { formatDateTime, formatNaira } from '@/lib/format'
import type { WalletTxnRow } from '@/lib/wallet/transactions'

const CATEGORY_ICON: Record<string, string> = {
  tournament_prize: '🏆',
  referral: '👥',
  community: '🎁',
  bonus: '💰',
  withdrawal: '⬆',
  entry_fee: '🎫',
  refund: '↩',
}
const CATEGORY_LABEL: Record<string, string> = {
  tournament_prize: 'Tournament Winnings',
  referral: 'Referral Reward',
  community: 'Community Reward',
  bonus: 'Bonus',
  withdrawal: 'Withdrawal',
  entry_fee: 'Entry Fee',
  refund: 'Refund',
}
const STATUS_ICON: Record<WalletTxnRow['status'], string> = { completed: '✅', pending: '⏳', failed: '❌' }

export function TransactionRow({ txn }: { txn: WalletTxnRow }) {
  const label = txn.type === 'deposit' ? 'Wallet Top-up' : CATEGORY_LABEL[txn.category ?? ''] ?? 'Transaction'
  const icon = txn.type === 'deposit' ? '⬇' : CATEGORY_ICON[txn.category ?? ''] ?? '💳'
  const isCredit = txn.amount > 0
  return (
    <div className="flex items-center gap-3 py-2.5 text-sm">
      <span className="text-lg">{icon}</span>
      <p className="min-w-0 flex-1 truncate text-white">{label}</p>
      <p className="shrink-0 text-xs text-sx-gray">{formatDateTime(txn.createdAt)}</p>
      <span className="shrink-0">{STATUS_ICON[txn.status]}</span>
      <p className={`shrink-0 font-bold ${isCredit ? 'text-emerald-400' : 'text-red-400'}`}>
        {isCredit ? '+' : ''}
        {formatNaira(txn.amount)}
      </p>
    </div>
  )
}
