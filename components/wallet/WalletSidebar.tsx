'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { WALLET_NAV_ITEMS } from '@/lib/wallet/nav'

// Needs 'use client' for usePathname to highlight the active tab — the only
// client component in the wallet section besides BalanceHeroCard's toggle.
export function WalletSidebar() {
  const pathname = usePathname()
  return (
    <div className="sm:w-48 sm:shrink-0">
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
    </div>
  )
}
