import Link from 'next/link'
import { User, BarChart3, Medal, ListChecks, Wallet, Settings } from 'lucide-react'

// In-page section jumps for the sections that actually exist on this page;
// Wallet & Settings route to the real Dashboard panels that already own that
// functionality rather than duplicating them here.
const ITEMS = [
  { href: '#top', label: 'Profile Overview', Icon: User, active: true },
  { href: '#stats', label: 'Stats & Games', Icon: BarChart3, active: false },
  { href: '#achievements', label: 'Achievements', Icon: Medal, active: false },
  { href: '#match-history', label: 'Match History', Icon: ListChecks, active: false },
  { href: '/dashboard', label: 'Wallet & Rewards', Icon: Wallet, active: false },
  { href: '/dashboard', label: 'Settings', Icon: Settings, active: false },
]

export function ProfileSidebarNav() {
  return (
    <nav className="rounded-xl border border-sx-border bg-sx-surface p-2">
      {ITEMS.map((item) => (
        <Link
          key={item.label}
          href={item.href}
          className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
            item.active
              ? 'border-l-2 border-sx-purple bg-sx-purple/15 text-white'
              : 'text-sx-gray hover:bg-sx-purple/10 hover:text-white'
          }`}
        >
          <item.Icon className="h-4 w-4 shrink-0" />
          {item.label}
        </Link>
      ))}
    </nav>
  )
}

export function ProfileTournamentsPromo() {
  return (
    <div className="rounded-xl border border-sx-border bg-sx-surface p-5 text-center">
      <p className="mb-1 font-display text-base font-black uppercase text-white">Create. Compete. Conquer.</p>
      <p className="mb-4 text-xs text-sx-gray">This is Sentinel X.</p>
      <Link
        href="/tournaments"
        className="block rounded-lg bg-sx-purple px-4 py-2.5 text-center text-xs font-bold text-white transition-colors hover:bg-sx-purple-light"
      >
        Join a Tournament →
      </Link>
    </div>
  )
}
