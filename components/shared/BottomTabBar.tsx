'use client'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { Trophy, Play, Users, ShoppingBag, User } from 'lucide-react'
import { PILLAR_TABS, isTabActive } from '@/lib/nav/tabs'
import { Avatar } from '@/components/shared/Avatar'
import type { NavSession } from '@/lib/nav/session'

const ICONS: Record<string, typeof Trophy> = {
  compete: Trophy,
  watch: Play,
  community: Users,
  trade: ShoppingBag,
}

export function BottomTabBar({ session }: { session: NavSession }) {
  const pathname = usePathname()
  const feature = useSearchParams().get('feature')

  // The admin sidebar/drawer owns navigation on admin pages — one surface there.
  if (pathname.startsWith('/admin')) return null

  const accountHref = session.isLoggedIn ? '/dashboard' : '/login'
  const accountActive = pathname.startsWith('/dashboard')
  const cls = (active: boolean) =>
    `flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium ${
      active ? 'text-violet-400' : 'text-slate-400'
    }`

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-800 bg-slate-950/95 backdrop-blur-sm sm:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="mx-auto flex max-w-md items-stretch">
        {PILLAR_TABS.map((tab) => {
          const Icon = ICONS[tab.key]
          return (
            <Link key={tab.key} href={tab.href} className={cls(isTabActive(tab, pathname, feature))}>
              <Icon className="h-5 w-5" />
              {tab.label}
            </Link>
          )
        })}
        <Link href={accountHref} className={cls(accountActive)}>
          {session.isLoggedIn ? (
            <Avatar
              avatarUrl={session.avatarUrl}
              displayName={session.displayName}
              username={session.username}
              size={20}
              className={accountActive ? 'ring-2 ring-violet-400' : ''}
            />
          ) : (
            <User className="h-5 w-5" />
          )}
          Account
        </Link>
      </div>
    </nav>
  )
}
