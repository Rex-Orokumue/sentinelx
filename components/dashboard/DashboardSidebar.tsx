'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from '@/lib/auth/actions'
import { DASHBOARD_NAV_ITEMS, isDashboardNavActive } from '@/lib/dashboard/nav'

// 'use client' for usePathname to highlight the active tab — same pattern as
// components/wallet/WalletSidebar.tsx.
export function DashboardSidebar() {
  const pathname = usePathname()
  return (
    <nav className="flex gap-2 overflow-x-auto scrollbar-hide sm:w-48 sm:shrink-0 sm:flex-col sm:gap-1">
      {DASHBOARD_NAV_ITEMS.map((item) => {
        const active = isDashboardNavActive(item, pathname)
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
              active ? 'bg-sx-purple/20 text-sx-purple-text' : 'text-sx-gray hover:text-white'
            }`}
          >
            {item.label}
          </Link>
        )
      })}
      <form action={signOut}>
        <button
          type="submit"
          className="w-full shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm font-semibold text-sx-gray transition-colors hover:text-white"
        >
          Sign out
        </button>
      </form>
    </nav>
  )
}
