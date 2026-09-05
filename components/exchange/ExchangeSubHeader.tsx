'use client'
import Link from 'next/link'
import { usePathname } from '@/i18n/navigation'
import { Lock, Store } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { EXCHANGE_SUB_NAV, activeSubNavHref } from '@/lib/exchange/sub-nav'

// Section chrome for every /exchange/* route. The Exchange previously
// announced itself only in the landing hero, so a listing detail or the sell
// form looked like any other page on the site. This sits directly under the
// global header and is what makes the section read as its own destination.
//
// Deliberately not sticky: SiteHeader already occupies `sticky top-0`, and a
// second sticky bar would eat ~110px of a 375px phone screen and depend on a
// hardcoded header-height offset that breaks the moment that header wraps.
export function ExchangeSubHeader() {
  const pathname = usePathname()
  const t = useTranslations('exchangeNav')
  const active = activeSubNavHref(pathname)

  return (
    <div className="border-b border-sx-border bg-sx-surface">
      <div className="mx-auto max-w-7xl px-4 pt-4 sm:px-6 lg:px-8">
        {/* Wordmark — the identity anchor that the hero alone couldn't carry
            across the section's other three routes. */}
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-sx-purple/20 text-sx-purple-text">
            <Store className="h-4 w-4" />
          </span>
          <span className="flex min-w-0 flex-col leading-none">
            <span className="truncate font-display text-base font-bold uppercase tracking-wide text-white sm:text-lg">
              {t('title')}
            </span>
            <span className="mt-1 truncate font-display text-[10px] font-semibold uppercase tracking-[0.2em] text-sx-gray">
              {t('tagline')}
            </span>
          </span>
        </div>

        {/* Horizontal scroll rather than wrap: "How escrow works" pushes this
            row past 375px, and a wrapped second line reads as a broken layout
            where a scrolled row reads as more content. */}
        <nav className="scrollbar-hide -mx-4 mt-3 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <ul className="flex w-max items-center gap-1 sm:w-auto">
            {EXCHANGE_SUB_NAV.map((item) => {
              const isActive = active === item.href
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={isActive ? 'page' : undefined}
                    className={`block whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                      isActive
                        ? 'border-sx-purple text-white'
                        : 'border-transparent text-white/70 hover:text-white'
                    }`}
                  >
                    {t(item.labelKey)}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>
      </div>

      {/* Trust line. EscrowStrip on the landing page is a three-step
          explainer; this is the one-line version, and it earns its place by
          appearing on the detail and sell pages — where someone is actually
          about to hand over money. */}
      <div className="border-t border-sx-border bg-sx-bg/60">
        <p className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-2 text-[11px] text-sx-gray sm:px-6 lg:px-8">
          <Lock className="h-3.5 w-3.5 shrink-0 text-sx-green" />
          <span className="min-w-0">{t('trust')}</span>
        </p>
      </div>
    </div>
  )
}
