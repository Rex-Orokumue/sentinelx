import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { JsonLd } from '@/components/seo/JsonLd'
import { buildBreadcrumbJsonLd } from '@/lib/seo/schema/breadcrumb'
import { getSeasonLeaderboard } from '@/lib/seasons/data'
import { SeasonHero } from '@/components/seasons/SeasonHero'
import { SeasonSchedule } from '@/components/seasons/SeasonSchedule'
import { SeasonLeaderboardTable } from '@/components/seasons/SeasonLeaderboardTable'
import { ChampionsCupSpotlight } from '@/components/seasons/ChampionsCupSpotlight'

async function getSeason(slug: string) {
  const supabase = createClient()
  const { data } = await supabase.from('seasons').select('*').eq('slug', slug).maybeSingle()
  return data
}

export async function generateMetadata({ params }: { params: { slug: string; locale: Locale } }): Promise<Metadata> {
  const season = await getSeason(params.slug)
  if (!season) return { title: 'Season — Sentinel X' }
  return buildMetadata({
    title: `${season.name} — Sentinel X`,
    description: `Follow ${season.name}'s Community Clubs, SentinelX Masters, and the road to the Champions Cup.`,
    path: `/seasons/${season.slug}`,
    locale: params.locale,
  })
}

function formatMonthYear(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

export default async function SeasonPage({ params }: { params: { slug: string } }) {
  const season = await getSeason(params.slug)
  if (!season) notFound()

  const admin = createAdminClient()
  const supabase = createClient()
  // This page is DLS-only today (built before any second game existed) —
  // scoping explicitly to DLS's game_id keeps that exact behavior now that
  // getSeasonLeaderboard requires a game and a second game (FC Mobile)
  // shares this same season. Becoming genuinely multi-game (tabs/sections
  // per game) is a separate follow-up.
  const { data: dlsGame } = await supabase.from('games').select('id').eq('slug', 'dls').maybeSingle()
  const [
    { data: tournaments },
    leaderboard,
    {
      data: { user },
    },
  ] = await Promise.all([
    supabase
      .from('tournaments')
      .select('id, title, slug, tournament_type, status, tournament_start, invitation_only')
      .eq('season_id', season.id)
      .eq('game_id', dlsGame?.id ?? '')
      .neq('tournament_type', 'open')
      .order('tournament_start'),
    getSeasonLeaderboard(admin, season.id, dlsGame?.id ?? ''),
    supabase.auth.getUser(),
  ])

  return (
    <div className="mx-auto max-w-4xl px-4 pb-20 pt-8 sm:px-6">
      <JsonLd
        data={buildBreadcrumbJsonLd([
          { name: 'Home', path: '/' },
          { name: season.name, path: `/seasons/${season.slug}` },
        ])}
      />
      <SeasonHero season={season} tournaments={tournaments ?? []} playersCompeting={leaderboard.length} />
      <SeasonSchedule tournaments={tournaments ?? []} />
      <SeasonLeaderboardTable rows={leaderboard} currentUserId={user?.id ?? null} />
      <ChampionsCupSpotlight seasonEndLabel={formatMonthYear(season.end_date)} />
    </div>
  )
}
