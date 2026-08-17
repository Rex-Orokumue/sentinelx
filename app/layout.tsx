import type { Metadata, Viewport } from 'next'
import { Suspense } from 'react'
import localFont from 'next/font/local'
import { Barlow_Condensed, Inter } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { SiteHeader } from '@/components/shared/SiteHeader'
import { SiteFooter } from '@/components/shared/SiteFooter'
import { NavTransitionProvider } from '@/components/transitions/NavTransitionProvider'
import { ServiceWorkerRegistration } from '@/components/pwa/ServiceWorkerRegistration'
import { getNavSession } from '@/lib/nav/session'
import { ADMIN_NAV, visibleNav, type AdminSheetData } from '@/lib/admin/nav'
import { getAdminNotificationQueue } from '@/lib/admin/notification-queue'
import { JsonLd } from '@/components/seo/JsonLd'
import { buildOrganizationJsonLd, buildWebsiteJsonLd } from '@/lib/seo/schema/site'
import { SITE_URL, SITE_NAME, SITE_SHORT_NAME, SITE_DESCRIPTION, DEFAULT_OG_IMAGE } from '@/lib/seo/site'
import './globals.css'

const geistSans = localFont({
  src: './fonts/GeistVF.woff',
  variable: '--font-geist-sans',
  weight: '100 900',
})
const geistMono = localFont({
  src: './fonts/GeistMonoVF.woff',
  variable: '--font-geist-mono',
  weight: '100 900',
})

// Display font for headlines/wordmark (Phase 1 visual overhaul design system) —
// condensed, heavy weights for the all-caps hero treatment.
const barlowCondensed = Barlow_Condensed({
  weight: ['700', '800', '900'],
  subsets: ['latin'],
  variable: '--font-display',
})
// Body font — replaces Geist sitewide per the Phase 1 design system.
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-body',
})

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_SHORT_NAME} Esports — Nigeria's Home of Mobile Esports`,
    template: `%s — ${SITE_SHORT_NAME}`,
  },
  description: SITE_DESCRIPTION,
  openGraph: {
    title: `${SITE_SHORT_NAME} Esports`,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    siteName: SITE_NAME,
    type: 'website',
    images: [DEFAULT_OG_IMAGE],
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE_SHORT_NAME} Esports`,
    description: SITE_DESCRIPTION,
    images: [DEFAULT_OG_IMAGE],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: SITE_SHORT_NAME,
  },
}

// Next.js 14 moved themeColor out of the metadata export into its own
// viewport export — setting it inside metadata is deprecated and silently
// ignored.
export const viewport: Viewport = {
  themeColor: '#0B0B0F',
}

const WHATSAPP_COMMUNITY = process.env.NEXT_PUBLIC_WHATSAPP_COMMUNITY_URL ?? '#'

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const navSession = await getNavSession()
  const adminNav: AdminSheetData | null = navSession.isStaff
    ? {
        items: visibleNav(ADMIN_NAV, navSession.isAdmin),
        isAdmin: navSession.isAdmin,
        notifications: await getAdminNotificationQueue(navSession.isAdmin ? 'admin' : 'moderator'),
      }
    : null

  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${barlowCondensed.variable} ${inter.variable} bg-sx-bg font-sans text-white antialiased`}
      >
        <Suspense fallback={null}>
          <NavTransitionProvider />
        </Suspense>
        <ServiceWorkerRegistration />
        <div className="flex min-h-screen flex-col">
          <SiteHeader session={navSession} whatsappUrl={WHATSAPP_COMMUNITY} adminNav={adminNav} />

          <main className="flex-1">{children}</main>

          <SiteFooter />
        </div>

        <Analytics />
        <JsonLd data={buildOrganizationJsonLd()} />
        <JsonLd data={buildWebsiteJsonLd()} />
      </body>
    </html>
  )
}
