'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { WALLET_NAV_ITEMS } from '@/lib/wallet/nav'
import { WalletSidebarInfoCards } from '@/components/wallet/WalletSidebarInfoCards'

// Needs 'use client' for usePathname to highlight the active tab — the only
// client component in the wallet section besides BalanceHeroCard's toggle.
//
// min-w-0 on the root is load-bearing: without it, this flex item's
// automatic minimum width defaults to its content's min-content size, which
// includes the nav's full unwrapped pill list — that forced the whole page
// to scroll horizontally on any viewport narrower than the pill list's
// total width, not just the nav's own overflow-x-auto strip.
export function WalletSidebar() {
  const pathname = usePathname()
  return (
    <div className="min-w-0 sm:w-48 sm:shrink-0">
      <p className="mb-2 hidden text-[11px] font-bold uppercase tracking-widest text-sx-purple-text sm:block">Wallet</p>
      <nav className="flex gap-2 overflow-x-auto scrollbar-hide sm:flex-col sm:gap-1">
        {WALLET_NAV_ITEMS.map((item) => {
          const active = pathname === item.href
          if (item.locked) {
            return (
              <span
                key={item.href}
                aria-disabled
                title="Coming in a future update"
                className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm text-sx-gray opacity-50"
              >
                <span aria-hidden>🔒</span> {item.label}
              </span>
            )
          }
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                active ? 'bg-sx-purple/20 text-sx-purple-text' : 'text-sx-gray hover:text-white'
              }`}
            >
              <span aria-hidden>{item.icon}</span> {item.label}
            </Link>
          )
        })}
        <Link
          href="/dashboard#profile"
          className="shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-sm text-sx-gray hover:text-white"
        >
          Settings
        </Link>
      </nav>
      {/* Desktop only — on mobile these render at the bottom of the page
          instead (layout.tsx), not squeezed between the nav and the actual
          wallet content. */}
      <div className="hidden sm:block">
        <WalletSidebarInfoCards />
      </div>
    </div>
  )
}
