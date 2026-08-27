import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { JsonLd } from '@/components/seo/JsonLd'
import { buildBreadcrumbJsonLd } from '@/lib/seo/schema/breadcrumb'
import { getSeasonLeaderboard } from '@/lib/seasons/data'
import { seasonTierLabelsFor } from '@/lib/games/season-tier-labels'
import { SeasonGameTabs, type SeasonGameSection } from '@/components/seasons/SeasonGameTabs'

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
    description: `Follow ${season.name}'s tournaments across every game, and the road to the top of each leaderboard.`,
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
  const [
    { data: activeGamesRaw },
    {
      data: { user },
    },
  ] = await Promise.all([supabase.from('games').select('id, name, slug').eq('active', true), supabase.auth.getUser()])

  // DLS first (existing users' expectation — it's the game this page was
  // originally built for), then every other active game alphabetically.
  const activeGames = (activeGamesRaw ?? []).sort((a, b) =>
    a.slug === 'dls' ? -1 : b.slug === 'dls' ? 1 : a.name.localeCompare(b.name),
  )

  const sections: SeasonGameSection[] = await Promise.all(
    activeGames.map(async (game) => {
      const [{ data: tournaments }, leaderboard] = await Promise.all([
        supabase
          .from('tournaments')
          .select('id, title, slug, tournament_type, status, tournament_start, invitation_only')
          .eq('season_id', season.id)
          .eq('game_id', game.id)
          .neq('tournament_type', 'open')
          .order('tournament_start'),
        getSeasonLeaderboard(admin, season.id, game.id),
      ])
      return {
        gameId: game.id,
        gameName: game.name,
        tournaments: tournaments ?? [],
        leaderboard,
        tierLabels: seasonTierLabelsFor(game.slug),
      }
    }),
  )

  return (
    <div className="mx-auto max-w-4xl px-4 pb-20 pt-8 sm:px-6">
      <JsonLd
        data={buildBreadcrumbJsonLd([
          { name: 'Home', path: '/' },
          { name: season.name, path: `/seasons/${season.slug}` },
        ])}
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
