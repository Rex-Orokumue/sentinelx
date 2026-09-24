import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { JsonLd } from '@/components/seo/JsonLd'
import { buildBreadcrumbJsonLd } from '@/lib/seo/schema/breadcrumb'
import { buildSeasonJsonLd } from '@/lib/seo/schema/season'
import { SeasonGameTabs } from '@/components/seasons/SeasonGameTabs'
import { getSeasonBySlug, getSeasonSections } from '@/lib/seasons/service'

export async function generateMetadata({ params }: { params: { slug: string; locale: Locale } }): Promise<Metadata> {
  const season = await getSeasonBySlug(createClient(), params.slug)
  if (!season) return { title: 'Season — Sentinel X' }
  return buildMetadata({
    title: `${season.name} — Sentinel X`,
    description: `Follow ${season.name}'s tournaments across every game, and the road to the top of each leaderboard.`,
    path: `/seasons/${season.slug}`,
    locale: params.locale,
  })
}

function formatMonthYear(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

export default async function SeasonPage({ params }: { params: { slug: string } }) {
  const supabase = createClient()
  const season = await getSeasonBySlug(supabase, params.slug)
  if (!season) notFound()

  const admin = createAdminClient()
  const [
    {
      data: { user },
    },
    sections,
  ] = await Promise.all([supabase.auth.getUser(), getSeasonSections(supabase, admin, season.id)])

  return (
    <div className="mx-auto max-w-4xl px-4 pb-20 pt-8 sm:px-6">
      <JsonLd
        data={buildBreadcrumbJsonLd([
          { name: 'Home', path: '/' },
          { name: season.name, path: `/seasons/${season.slug}` },
        ])}
      />
      <JsonLd
        data={buildSeasonJsonLd({
          name: season.name,
          slug: season.slug,
          startDate: season.start_date,
          endDate: season.end_date,
        })}
      />
      <SeasonGameTabs
        sections={sections}
        season={season}
        currentUserId={user?.id ?? null}
        seasonEndLabel={formatMonthYear(season.end_date)}
      />
    </div>
  )
}
