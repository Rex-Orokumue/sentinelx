import Link from 'next/link'

// Deposit is live (see plan Global Constraints) — only Transfer and Rewards
// have no backing feature yet.
const ACTIONS = [
  { label: 'Deposit', icon: '⬇', href: '/dashboard/wallet/deposit', locked: false },
  { label: 'Withdraw', icon: '⬆', href: '/dashboard/wallet/withdraw', locked: false },
  { label: 'Transfer', icon: '↔', href: '/dashboard/wallet/transfer', locked: true },
  { label: 'Rewards', icon: '🎁', href: '/dashboard/wallet/rewards', locked: true },
]

export function QuickActionsRow() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {ACTIONS.map((a) =>
        a.locked ? (
          <span
            key={a.label}
            aria-disabled
            title="Coming in a future update"
            className="flex cursor-not-allowed flex-col items-center gap-1 rounded-xl bg-sx-surface px-3 py-4 text-center opacity-60"
          >
            <span className="text-xl">🔒</span>
            <span className="text-xs font-semibold text-white">{a.label}</span>
          </span>
        ) : (
          <Link
            key={a.label}
            href={a.href}
            className="flex flex-col items-center gap-1 rounded-xl bg-sx-surface px-3 py-4 text-center transition-colors hover:bg-sx-purple/20"
          >
            <span className="text-xl text-sx-purple-text">{a.icon}</span>
            <span className="text-xs font-semibold text-white">{a.label}</span>
          </Link>
        ),
      )}
    </div>
  )
}
