'use client'
import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu, X } from 'lucide-react'
import { AccountMenu } from '@/components/shared/AccountMenu'
import { NotificationBell } from '@/components/shared/NotificationBell'
import type { NavSession } from '@/lib/nav/session'
import { NAVBAR_LINKS } from '@/lib/nav/links'

export function SiteHeader({
  session,
  whatsappUrl,
}: {
  session: NavSession
  whatsappUrl: string
}) {
  const pathname = usePathname()
  const [drawerOpen, setDrawerOpen] = useState(false)

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-sx-border bg-sx-bg/95 backdrop-blur-md">
        <nav className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <Link href="/" className="flex shrink-0 items-center gap-2">
            <Image src="/logo-icon.png" alt="SentinelX Esports" width={32} height={32} priority />
            <span className="flex flex-col leading-none">
              <span className="whitespace-nowrap font-display text-lg font-bold uppercase tracking-wide text-white sm:text-xl">
                Sentinel<span className="text-sx-purple-text">X</span>
              </span>
              <span className="font-display text-[10px] font-semibold uppercase tracking-[0.25em] text-sx-gray">
                Esports
              </span>
            </span>
          </Link>

          {/* Desktop-only primary links */}
          <div className="hidden items-center gap-1 lg:flex">
            {NAVBAR_LINKS.map((item) => {
              const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`border-b-2 px-3 py-1.5 text-sm font-medium transition-colors ${
                    active
                      ? 'border-sx-purple text-white'
                      : 'border-transparent text-white/70 hover:text-white'
                  }`}
                >
                  {item.label}
                </Link>
              )
            })}
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            {/* WhatsApp community CTA — all breakpoints */}
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden items-center gap-1.5 rounded-full bg-sx-green px-4 py-2 text-xs font-bold text-white transition-opacity hover:opacity-90 sm:flex"
            >
              <WhatsAppIcon className="h-3.5 w-3.5" />
              <span>Community</span>
            </a>

            {/* Notifications — every breakpoint, never in the bottom tab bar */}
            {session.isLoggedIn && (
              <NotificationBell
                initialNotifications={session.recentNotifications}
                initialUnreadCount={session.unreadNotificationCount}
              />
            )}

            {/* Account — desktop only; mobile uses the bottom tab bar */}
            <div className="hidden sm:block">
              <AccountMenu session={session} />
            </div>

            {/* Hamburger — collapses the full link set into a drawer below lg */}
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
              aria-expanded={drawerOpen}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-white/80 transition hover:bg-white/5 lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
          </div>
        </nav>
      </header>

      {/* ── Mobile nav drawer — rendered OUTSIDE header to escape its
           backdrop-filter stacking context, which would otherwise trap
           fixed children and prevent them from overlaying page content. ── */}
      {drawerOpen && (
        <>
          {/* Backdrop overlay */}
          <div
            className="fixed inset-0 z-[60] lg:hidden"
            style={{ background: 'rgba(0,0,0,0.75)' }}
            onClick={() => setDrawerOpen(false)}
            aria-hidden
          />
          {/* Drawer panel */}
          <div
            className="fixed inset-y-0 right-0 z-[70] flex w-72 max-w-[85vw] flex-col p-5 lg:hidden"
            style={{ background: '#13131F', borderLeft: '1px solid #1E1E30' }}
          >
            <div className="mb-6 flex items-center justify-between">
              <span className="font-display text-lg font-bold uppercase tracking-wide text-white">
                Menu
              </span>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close menu"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-white/80 transition hover:bg-white/10"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex flex-1 flex-col gap-1">
              {NAVBAR_LINKS.map((item) => {
                const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setDrawerOpen(false)}
                    className={`rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors ${
                      active
                        ? 'text-white'
                        : 'text-white/70 hover:text-white'
                    }`}
                    style={active ? { background: 'rgba(124,58,237,0.15)' } : undefined}
                  >
                    {item.label}
                  </Link>
                )
              })}
            </div>
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 flex items-center justify-center gap-1.5 rounded-full px-4 py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90"
              style={{ background: '#10B981' }}
            >
              <WhatsAppIcon className="h-4 w-4" />
              <span>Community</span>
            </a>
            {!session.isLoggedIn && (
              <div className="mt-3 flex gap-2">
                <Link
                  href="/login"
                  onClick={() => setDrawerOpen(false)}
                  className="flex-1 rounded-lg py-2.5 text-center text-sm font-bold text-white transition-colors"
                  style={{ border: '1px solid #1E1E30' }}
                >
                  Login
                </Link>
                <Link
                  href="/signup"
                  onClick={() => setDrawerOpen(false)}
                  className="flex-1 rounded-lg py-2.5 text-center text-sm font-bold text-white transition-colors"
                  style={{ background: '#7C3AED' }}
                >
                  Register
                </Link>
              </div>
            )}
          </div>
        </>
      )}
    </>
  )
}

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  )
}
