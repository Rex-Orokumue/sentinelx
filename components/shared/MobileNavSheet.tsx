'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { ChevronRight, X } from 'lucide-react'
import { signOut } from '@/lib/auth/actions'
import { SHEET_SITE_LINKS } from '@/lib/nav/links'
import { isAdminNavActive, type AdminSheetData } from '@/lib/admin/nav'
import { countByHref } from '@/lib/admin/notification-copy'
import type { NavSession } from '@/lib/nav/session'

const activeLinkStyle = { background: 'rgba(124,58,237,0.15)' }

function sectionOpenKey(id: string) {
  return `sx-nav-sheet-open:${id}`
}

// Each menu section is its own <details> — the sheet stacks up to ~28 links
// for a staff account (13 admin + 10 site + 5 account) and scrolling through
// all of them open at once was the complaint this fixes. `<summary>` gives
// keyboard toggling (Enter/Space) and a11y semantics for free; the chevron
// rotates via the `[open]` attribute selector.
//
// Open/closed state persists per section in localStorage, read synchronously
// in the initializer — safe because MobileNavSheet only ever mounts after
// the hamburger is tapped (SiteHeader renders it as `{drawerOpen && <MobileNavSheet />}`),
// never during SSR/initial hydration, so there's no server/client mismatch
// to guard against here (unlike SentinelBubble's dismiss flag, which does
// need the "hidden until an effect resolves" dance since it renders on
// first paint). A first-time visitor has no stored value yet — falls back
// to closed, matching the default every section already starts at.
function NavSection({
  id,
  label,
  badge,
  children,
}: {
  id: string
  label: string
  badge?: React.ReactNode
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(() => localStorage.getItem(sectionOpenKey(id)) === '1')

  return (
    <details
      className="group mb-4"
      open={open}
      onToggle={(e) => {
        const next = e.currentTarget.open
        setOpen(next)
        localStorage.setItem(sectionOpenKey(id), next ? '1' : '0')
      }}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between py-1 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2">
          <ChevronRight className="h-3.5 w-3.5 text-sx-gray transition-transform group-open:rotate-90" />
          <span className="text-xs font-bold uppercase tracking-widest text-sx-gray">{label}</span>
        </span>
        {badge}
      </summary>
      <div className="mt-2 flex flex-col gap-1">{children}</div>
    </details>
  )
}

function SheetLink({
  href,
  active,
  onClose,
  children,
}: {
  href: string
  active: boolean
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      onClick={onClose}
      className={`rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors ${
        active ? 'text-white' : 'text-white/70 hover:text-white'
      }`}
      style={active ? activeLinkStyle : undefined}
    >
      {children}
    </Link>
  )
}

export function MobileNavSheet({
  session,
  whatsappUrl,
  adminNav,
  onClose,
}: {
  session: NavSession
  whatsappUrl: string
  adminNav: AdminSheetData | null
  onClose: () => void
}) {
  const pathname = usePathname()
  const tNav = useTranslations('nav')
  const tAccount = useTranslations('account')
  const tCommon = useTranslations('common')

  // Same lifecycle as components/tv/VideoModal.tsx: Escape closes, body
  // scroll locks while the sheet is mounted.
  useEffect(() => {
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onEsc)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onEsc)
      document.body.style.overflow = prev
    }
  }, [onClose])

  const badgeCounts = adminNav ? countByHref(adminNav.notifications) : {}

  return (
    <div role="dialog" aria-modal="true" aria-label="Menu" className="fixed inset-0 z-[70] flex items-end justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} aria-hidden />
      <div
        className="relative flex max-h-[85vh] w-full flex-col overflow-y-auto rounded-t-2xl border-t border-sx-border bg-sx-surface p-5"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1.25rem)' }}
      >
        <div className="mb-4 flex items-center justify-between">
          <span className="font-display text-lg font-bold uppercase tracking-wide text-white">{tCommon('menu')}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label={tCommon('closeMenu')}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-white/80 transition hover:bg-white/10"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {adminNav && (
          <>
            <NavSection
              id="admin"
              label="Admin"
              badge={
                <span className="rounded-full border border-sx-border px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest text-sx-gray">
                  {adminNav.isAdmin ? tCommon('admin') : tCommon('moderator')}
                </span>
              }
            >
              {adminNav.items.map((item) => {
                const active = isAdminNavActive(item.href, pathname)
                const count = badgeCounts[item.href] ?? 0
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onClose}
                    className={`flex items-center justify-between rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors ${
                      active ? 'text-white' : 'text-white/70 hover:text-white'
                    }`}
                    style={active ? activeLinkStyle : undefined}
                  >
                    <span>{item.label}</span>
                    {count > 0 && (
                      <span className="ml-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
                        {count > 9 ? '9+' : count}
                      </span>
                    )}
                  </Link>
                )
              })}
            </NavSection>
            <div className="mb-4 h-px bg-sx-border" />
          </>
        )}

        <NavSection id="site" label="Site">
          {SHEET_SITE_LINKS.map((item) => {
            const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
            return (
              <SheetLink key={item.href} href={item.href} active={active} onClose={onClose}>
                {tNav(item.labelKey)}
              </SheetLink>
            )
          })}
        </NavSection>

        <div className="mb-4 h-px bg-sx-border" />

        <NavSection id="account" label="Account">
          {session.isLoggedIn ? (
            <>
              <SheetLink
                href={session.username ? `/players/${session.username}` : '/dashboard'}
                active={false}
                onClose={onClose}
              >
                {tAccount('myProfile')}
              </SheetLink>
              <SheetLink
                href="/dashboard"
                active={pathname === '/dashboard'}
                onClose={onClose}
              >
                {tAccount('dashboard')}
              </SheetLink>
              <SheetLink href="/dashboard/wallet" active={pathname.startsWith('/dashboard/wallet')} onClose={onClose}>
                {tAccount('wallet')}
              </SheetLink>
              <SheetLink href="/dashboard/friendlies" active={pathname.startsWith('/dashboard/friendlies')} onClose={onClose}>
                {tAccount('friendlies')}
              </SheetLink>
              <form action={signOut}>
                <button
                  type="submit"
                  className="block w-full rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-white/70 transition-colors hover:text-white"
                >
                  {tAccount('signOut')}
                </button>
              </form>
            </>
          ) : (
            <div className="flex gap-2">
              <Link
                href="/login"
                onClick={onClose}
                className="flex-1 rounded-lg border border-sx-border py-2.5 text-center text-sm font-bold text-white transition-colors"
              >
                {tAccount('login')}
              </Link>
              <Link
                href="/signup"
                onClick={onClose}
                className="flex-1 rounded-lg bg-sx-purple py-2.5 text-center text-sm font-bold text-white transition-colors"
              >
                {tAccount('register')}
              </Link>
            </div>
          )}
        </NavSection>

        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onClose}
          className="flex items-center justify-center gap-1.5 rounded-full bg-sx-green px-4 py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90"
        >
          <WhatsAppIcon className="h-4 w-4" />
          <span>{tCommon('joinWhatsapp')}</span>
        </a>
      </div>
    </div>
  )
}

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  )
}
