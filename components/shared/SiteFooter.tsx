'use client'
import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'

// Routes that use the expanded footer (spec §2.2 Variant B).
const EXPANDED_ROUTES = ['/games', '/about', '/community', '/exchange']

const SOCIALS = [
  { name: 'Discord', href: process.env.NEXT_PUBLIC_DISCORD_URL ?? '#', Icon: DiscordIcon },
  { name: 'Instagram', href: process.env.NEXT_PUBLIC_INSTAGRAM_URL ?? '#', Icon: InstagramIcon },
  { name: 'TikTok', href: process.env.NEXT_PUBLIC_TIKTOK_URL ?? '#', Icon: TikTokIcon },
  { name: 'YouTube', href: process.env.NEXT_PUBLIC_YOUTUBE_URL ?? '#', Icon: YouTubeIcon },
  { name: 'X', href: process.env.NEXT_PUBLIC_X_URL ?? '#', Icon: XIcon },
]

const LEGAL_LINKS: { href: string; labelKey: string }[] = [
  { href: '/terms', labelKey: 'terms' },
  { href: '/privacy', labelKey: 'privacy' },
  { href: '/help', labelKey: 'help' },
  { href: '/contact', labelKey: 'contact' },
]

const EXPANDED_SECTIONS: { headingKey: string; links: { href: string; labelKey: string }[] }[] = [
  {
    headingKey: 'sectionPlatform',
    links: [
      { href: '/tournaments', labelKey: 'tournaments' },
      { href: '/games', labelKey: 'games' },
      { href: '/rankings', labelKey: 'rankings' },
      { href: '/seasons/season-1', labelKey: 'seasons' },
      { href: '/exchange', labelKey: 'exchange' },
      { href: '/community', labelKey: 'community' },
      { href: '/tv', labelKey: 'tv' },
      { href: '/hall-of-fame', labelKey: 'hallOfFame' },
      { href: '/players', labelKey: 'players' },
    ],
  },
  {
    headingKey: 'sectionSupport',
    links: [
      { href: '/help', labelKey: 'help' },
      { href: '/safety', labelKey: 'safety' },
      { href: '/how-it-works', labelKey: 'howItWorks' },
      { href: '/contact', labelKey: 'contact' },
      { href: '/rules', labelKey: 'rules' },
    ],
  },
  {
    headingKey: 'sectionCompany',
    links: [
      { href: '/about', labelKey: 'about' },
      { href: '/terms', labelKey: 'terms' },
      { href: '/privacy', labelKey: 'privacy' },
      { href: '/refund-policy', labelKey: 'refundPolicy' },
    ],
  },
]

// Two variants (spec §2.2). `simple` — Home, Tournaments, Leaderboards; `expanded`
// — Games, About Us, Community, Store. Every real destination not shown in the
// tightened Navbar (TV, Seasons, Hall of Fame, Players) still lives here so
// nothing on the site becomes unreachable. Variant is derived from the route
// rather than passed down, so it stays correct through client-side navigation
// without every page having to know about it.
export function SiteFooter() {
  const pathname = usePathname()
  const t = useTranslations('footer')
  const variant: 'simple' | 'expanded' = EXPANDED_ROUTES.some(
    (r) => pathname === r || pathname.startsWith(`${r}/`),
  )
    ? 'expanded'
    : 'simple'
  const year = new Date().getFullYear()

  return (
    <footer className="mt-auto border-t border-sx-border bg-sx-bg">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        {variant === 'simple' ? (
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <Logo />
              <p className="mt-3 text-sm font-semibold text-white">{t('tagline1')}</p>
              <p className="text-sm text-sx-gray">
                <span className="text-sx-purple-text">{t('taglineHighlight')}</span> {t('taglineRest')}
              </p>
            </div>
            <SocialRow />
          </div>
        ) : (
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-5">
            <div className="lg:col-span-1">
              <Logo />
              <p className="mt-3 text-sm font-semibold text-white">{t('tagline1')}</p>
            </div>
            {EXPANDED_SECTIONS.map((section) => (
              <div key={section.headingKey}>
                <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-sx-purple-text">
                  {t(section.headingKey)}
                </h2>
                <ul className="space-y-2">
                  {section.links.map((link) => (
                    <li key={link.labelKey}>
                      <Link href={link.href} className="text-sm text-sx-gray transition-colors hover:text-white">
                        {t(`links.${link.labelKey}`)}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <div>
              <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-sx-purple-text">
                {t('stayConnected')}
              </h2>
              <NewsletterForm t={t} />
              <div className="mt-5">
                <SocialRow />
              </div>
            </div>
          </div>
        )}

        <div
          className={`mt-8 flex flex-col gap-3 border-t border-sx-border pt-5 text-xs text-sx-gray sm:flex-row sm:items-center ${
            variant === 'simple' ? 'sm:justify-between' : 'sm:justify-between'
          }`}
        >
          {variant === 'simple' ? (
            <>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {LEGAL_LINKS.map((l) => (
                  <Link key={l.labelKey} href={l.href} className="transition-colors hover:text-white">
                    {t(`links.${l.labelKey}`)}
                  </Link>
                ))}
              </div>
              <p>{t('copyright', { year })}</p>
            </>
          ) : (
            <>
              <p>{t('copyright', { year })}</p>
              <p>
                {t('poweredBy')} <span className="font-bold text-white">ZOLARUX</span>
              </p>
            </>
          )}
        </div>
      </div>
    </footer>
  )
}

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2">
      <Image src="/logo-icon.png" alt="SentinelX Esports" width={28} height={28} />
      <span className="flex flex-col leading-none">
        <span className="whitespace-nowrap font-display text-base font-bold uppercase tracking-wide text-white">
          Sentinel<span className="text-sx-purple-text">X</span>
        </span>
        <span className="font-display text-[9px] font-semibold uppercase tracking-[0.25em] text-sx-gray">
          Esports
        </span>
      </span>
    </Link>
  )
}

function SocialRow() {
  return (
    <div className="flex items-center gap-3">
      {SOCIALS.map(({ name, href, Icon }) => (
        <a
          key={name}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={name}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-sx-border text-white/70 transition-colors hover:border-sx-purple/40 hover:text-white"
        >
          <Icon className="h-4 w-4" />
        </a>
      ))}
    </div>
  )
}

function NewsletterForm({ t }: { t: ReturnType<typeof useTranslations> }) {
  const [sent, setSent] = useState(false)
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        setSent(true)
      }}
      className="flex gap-2"
    >
      <label htmlFor="footer-email" className="sr-only">
        {t('emailAddressLabel')}
      </label>
      <input
        id="footer-email"
        type="email"
        required
        placeholder={t('emailPlaceholder')}
        disabled={sent}
        className="w-full min-w-0 rounded-lg border border-sx-border bg-sx-surface px-3 py-2 text-sm text-white placeholder:text-sx-gray focus:border-sx-purple/50 focus:outline-none disabled:opacity-60"
      />
      <button
        type="submit"
        disabled={sent}
        className="shrink-0 rounded-lg bg-sx-purple px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-sx-purple-light disabled:opacity-60"
      >
        {sent ? t('subscribed') : t('subscribe')}
      </button>
    </form>
  )
}

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.058a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.2 14.2 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.061 0a.073.073 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.076.076 0 0 0-.04.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.029 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.055c.5-5.177-.838-9.674-3.549-13.66a.06.06 0 0 0-.031-.028ZM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.418 2.157-2.418 1.21 0 2.176 1.094 2.157 2.418 0 1.334-.955 2.42-2.157 2.42Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.418 2.157-2.418 1.21 0 2.176 1.094 2.157 2.418 0 1.334-.946 2.42-2.157 2.42Z" />
    </svg>
  )
}
function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069ZM12 0C8.74 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.74 0 12s.014 3.668.072 4.948c.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.74 24 12 24s3.668-.014 4.948-.072c4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.687.073-4.948s-.014-3.667-.072-4.947c-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0Zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324ZM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881Z" />
    </svg>
  )
}
function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M16.6 5.82c-1.03-.98-1.65-2.35-1.65-3.82h-3.42v14.4c0 1.68-1.36 3.04-3.04 3.04a3.04 3.04 0 0 1-3.04-3.04 3.04 3.04 0 0 1 3.04-3.04c.31 0 .61.05.9.13v-3.5a6.5 6.5 0 0 0-.9-.06 6.54 6.54 0 0 0-6.54 6.54A6.54 6.54 0 0 0 8.49 22.5a6.54 6.54 0 0 0 6.54-6.54V9.4a8.16 8.16 0 0 0 4.77 1.53V7.5a4.85 4.85 0 0 1-3.2-1.68Z" />
    </svg>
  )
}
function YouTubeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.5 12 3.5 12 3.5s-7.505 0-9.377.55A3.017 3.017 0 0 0 .502 6.186 31.5 31.5 0 0 0 0 12a31.5 31.5 0 0 0 .502 5.814 3.016 3.016 0 0 0 2.122 2.136C4.495 20.5 12 20.5 12 20.5s7.505 0 9.377-.55a3.015 3.015 0 0 0 2.122-2.136A31.5 31.5 0 0 0 24 12a31.5 31.5 0 0 0-.502-5.814ZM9.545 15.568V8.432L15.818 12l-6.273 3.568Z" />
    </svg>
  )
}
function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231ZM17.083 19.77h1.833L7.084 4.126H5.117Z" />
    </svg>
  )
}
