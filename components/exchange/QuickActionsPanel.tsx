import Link from 'next/link'
import { LayoutList, Package, Upload } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

const ACTIONS: { icon: LucideIcon; title: string; sub: string; href: string }[] = [
  { icon: Upload, title: 'Sell an Item', sub: 'List your item in minutes', href: '/exchange/new' },
  { icon: LayoutList, title: 'My Listings', sub: 'Manage your items', href: '/dashboard/marketplace' },
  { icon: Package, title: 'My Orders', sub: 'Track your orders', href: '/dashboard/marketplace' },
]

export function QuickActionsPanel({ signedIn }: { signedIn: boolean }) {
  // Signed-out visitors get the sign-up ask instead of three links that would
  // only bounce them through /login — a deliberate departure from the mockup.
  if (!signedIn) {
    return (
      <section className="rounded-2xl border border-sx-border bg-sx-surface p-5">
        <h2 className="text-xs font-black uppercase tracking-wider text-white">
          Start trading on Sentinel X
        </h2>
        <p className="mt-2 text-xs text-sx-gray">Create an account to buy and sell safely.</p>
        <Link
          href="/signup"
          className="mt-4 block rounded-xl bg-sx-purple px-4 py-2.5 text-center text-xs font-bold text-white transition-colors hover:bg-sx-purple-light"
        >
          Create Account
        </Link>
        <Link
          href="/login?next=/exchange"
          className="mt-2 block text-center text-[11px] font-semibold text-sx-gray hover:text-white"
        >
          Log in
        </Link>
      </section>
    )
  }

  return (
    <section className="rounded-2xl border border-sx-border bg-sx-surface p-5">
      <h2 className="text-xs font-black uppercase tracking-wider text-white">Quick Actions</h2>
      <ul className="mt-4 space-y-2">
        {ACTIONS.map(({ icon: Icon, title, sub, href }) => (
          <li key={title}>
            <Link
              href={href}
              className="flex items-center gap-3 rounded-xl border border-sx-border bg-sx-bg px-3 py-2.5 transition-colors hover:border-sx-purple/50"
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-sx-purple/20 text-sx-purple-text">
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-xs font-bold text-white">{title}</span>
                <span className="block truncate text-[10px] text-sx-gray">{sub}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
