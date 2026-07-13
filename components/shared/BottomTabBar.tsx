'use client'
import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { Trophy, Play, Users, ShoppingBag, User, ChevronUp } from 'lucide-react'
import { PILLAR_TABS, isTabActive } from '@/lib/nav/tabs'
import { Avatar } from '@/components/shared/Avatar'
import { signOut } from '@/lib/auth/actions'
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
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    function onDoc(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onEsc)
    }
  }, [menuOpen])

  // The admin sidebar/drawer owns navigation on admin pages — one surface there.
  if (pathname.startsWith('/admin')) return null

  const accountHref = session.isLoggedIn ? '/dashboard' : '/login'
  const accountActive = pathname.startsWith('/dashboard') || pathname.startsWith('/admin')
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
        {session.isLoggedIn && session.isStaff ? (
          <div ref={menuRef} className="relative flex-1">
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-label="Account menu"
              aria-expanded={menuOpen}
              className={cls(accountActive) + ' w-full'}
            >
              <Avatar
                avatarUrl={session.avatarUrl}
                displayName={session.displayName}
                username={session.username}
                size={20}
                className={accountActive ? 'ring-2 ring-violet-400' : ''}
              />
              <span className="flex items-center gap-0.5">
                Account
                <ChevronUp
                  className={`h-2.5 w-2.5 transition-transform ${menuOpen ? 'rotate-180' : ''}`}
                />
              </span>
            </button>
            {menuOpen && (
              <div className="absolute bottom-full right-0 mb-2 w-40 rounded-xl border border-slate-800 bg-slate-900 py-1 shadow-xl">
                <MenuLink href="/dashboard" onNavigate={() => setMenuOpen(false)}>Dashboard</MenuLink>
                <MenuLink href="/admin" onNavigate={() => setMenuOpen(false)}>Admin</MenuLink>
                <form action={signOut}>
                  <button
                    type="submit"
                    className="block w-full px-4 py-2 text-left text-sm text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
                  >
                    Sign out
                  </button>
                </form>
              </div>
            )}
          </div>
        ) : (
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
        )}
      </div>
    </nav>
  )
}

function MenuLink({
  href,
  onNavigate,
  children,
}: {
  href: string
  onNavigate: () => void
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className="block px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
    >
      {children}
    </Link>
  )
}
