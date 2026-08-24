import Link from 'next/link'
import { Sparkles } from 'lucide-react'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params
  return buildMetadata({
    title: 'Coming Soon — SentinelX Esports',
    description: 'This page is on its way. Check back soon.',
    path: '/coming-soon',
    locale,
  })
}

// A handful of footer links (Terms, Privacy, Help Center, Rules, …) don't have
// dedicated pages yet in Phase 1 — this is an honest placeholder rather than a
// dead 404 or a link that goes nowhere. `feature` is display text only.
export default function ComingSoonPage({
  searchParams,
}: {
  searchParams: { feature?: string }
}) {
  const feature = searchParams.feature?.trim() || 'This page'

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-24 text-center">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-sx-purple/15 text-sx-purple-text">
        <Sparkles className="h-7 w-7" />
      </div>
      <h1 className="font-display text-3xl font-black uppercase text-white">{feature}</h1>
      <p className="mt-3 text-sm text-sx-gray">
        We&apos;re still building this one out. Check back soon — or head to the WhatsApp community if you
        need something in the meantime.
      </p>
      <Link
        href="/"
        className="mt-8 rounded-lg bg-sx-purple px-6 py-3 text-sm font-bold text-white transition-colors hover:bg-sx-purple-light"
      >
        Back to Home
      </Link>
    </div>
  )
}
