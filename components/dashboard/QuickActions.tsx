import Link from 'next/link'
import { formatNaira } from '@/lib/format'

export function QuickActions({
  walletBalance,
  hasSubmittableMatch,
}: {
  walletBalance: number
  hasSubmittableMatch: boolean
}) {
  const tiles = [
    { href: '/tournaments', icon: '🎮', label: 'Enter a Tournament' },
    ...(hasSubmittableMatch ? [{ href: '/dashboard#matches', icon: '📤', label: 'Submit Result' }] : []),
    ...(walletBalance > 0 ? [{ href: '/dashboard/wallet', icon: '💰', label: 'Withdraw Prize', sub: formatNaira(walletBalance) }] : []),
    { href: '#profile', icon: '⚙', label: 'Account Settings' },
  ]

  return (
    <section>
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-white">Quick Actions</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((t) => (
          <Link
            key={t.label}
            href={t.href}
            className="flex flex-col items-center gap-1 rounded-xl bg-sx-surface px-3 py-4 text-center transition-colors hover:bg-sx-purple/20"
          >
            <span className="text-xl">{t.icon}</span>
            <span className="text-xs font-semibold text-white">{t.label}</span>
            {'sub' in t && t.sub && <span className="text-[11px] text-sx-gray">{t.sub}</span>}
          </Link>
        ))}
      </div>
    </section>
  )
}
