import { createClient } from '@/lib/supabase/server'
import { RANKING_MIN_MATCHES, type PlayerStatsInput } from '@/lib/rankings/leaderboard'
import { winsByPlayerAndGame, scoreStatsByPlayerAndCategory, type GameScopedMatch } from '@/lib/rankings/game-breakdown'
import { CATEGORY_META } from '@/lib/games/categories'
import { LeaderboardTabs } from '@/components/rankings/LeaderboardTabs'
import { EmptyState } from '@/components/shared/EmptyState'
import { buildMetadata } from '@/lib/seo/metadata'
import { DEFAULT_OG_IMAGE } from '@/lib/seo/site'

export const metadata = buildMetadata({
  title: 'Rankings — Sentinel X',
  description: "Nigeria's top mobile esports players on Sentinel X, ranked by wins.",
  path: '/rankings',
  image: DEFAULT_OG_IMAGE,
})

type RawGameRef = { name: string; category: string } | { name: string; category: string }[] | null
type RawTournamentRef = { game: RawGameRef } | { game: RawGameRef }[] | null

function firstGameRef(g: RawGameRef): { name: string; category: string } | null {
  return Array.isArray(g) ? g[0] ?? null : g
}
function firstTournamentRef(t: RawTournamentRef): { game: RawGameRef } | null {
  return Array.isArray(t) ? t[0] ?? null : t
}

export default async function RankingsPage() {
  const supabase = createClient()
  const [{ data: profiles }, { data: matchRows }, { data: activeGames }, { data: { user } }] = await Promise.all([
    supabase
      .from('profiles')
      .select(
        'id, username, display_name, avatar_url, country, wins, losses, total_matches, goals_scored, goals_conceded, total_titles, sentinel_score, sentinel_tier',
      )
      .gte('total_matches', RANKING_MIN_MATCHES)
      .order('wins', { ascending: false })
      .limit(200),
    // Fetched once and shared by both winsByPlayerAndGame and the per-category
    // aggregates below — never fetch completed matches twice.
    supabase
      .from('matches')
      .select(
        'status, score_a, score_b, player_a_id, player_b_id, tournament:tournaments(game:games(name, category))',
      )
      .eq('status', 'completed'),
    // Independent of match data — a category can be "active" (a tab should
    // show) even with zero completed matches played in it yet.
    supabase.from('games').select('category').eq('active', true),
    supabase.auth.getUser(),
  ])

  const activeCategories = Array.from(new Set((activeGames ?? []).map((g) => g.category)))

  const rawMatches = ((matchRows as unknown[] | null) ?? []) as {
    status: string
    score_a: number | null
    score_b: number | null
    player_a_id: string | null
    player_b_id: string | null
    tournament: RawTournamentRef
  }[]
  const matches: GameScopedMatch[] = rawMatches.map((m) => {
    const t = firstTournamentRef(m.tournament)
    const g = firstGameRef(t?.game ?? null)
    return {
      status: m.status,
      score_a: m.score_a,
      score_b: m.score_b,
      player_a_id: m.player_a_id,
      player_b_id: m.player_b_id,
      game_name: g?.name ?? 'Unknown',
      game_category: g?.category ?? 'other',
    }
  })
  const winsMap = winsByPlayerAndGame(matches)
  const categoryMaps = Object.keys(CATEGORY_META).map((category) => ({
    category,
    map: scoreStatsByPlayerAndCategory(matches, category),
  }))

  const players: PlayerStatsInput[] = (profiles ?? []).map(
    (p): PlayerStatsInput => ({
      id: p.id,
      username: p.username,
      displayName: p.display_name,
      avatarUrl: p.avatar_url,
      country: p.country,
      wins: p.wins,
      losses: p.losses,
      totalMatches: p.total_matches,
      goalsScored: p.goals_scored,
      goalsConceded: p.goals_conceded,
      categoryStats: categoryMaps.map(({ category, map }) => ({
        category,
        scored: map.get(p.id)?.scored ?? 0,
        conceded: map.get(p.id)?.conceded ?? 0,
      })),
      winsByGame: winsMap.get(p.id) ?? [],
      totalTitles: p.total_titles,
      sentinelScore: p.sentinel_score,
      sentinelTier: p.sentinel_tier,
    }),
  )

  return (
    <div className="mx-auto max-w-3xl px-4 pb-20">
      <div className="py-8">
        <h1 className="text-2xl font-black text-white">Rankings</h1>
        <p className="mt-1 text-sm text-slate-400">
          Nigeria&apos;s top mobile esports players, ranked by wins.
        </p>
      </div>

      {players.length === 0 ? (
        <EmptyState
          icon="🏅"
          title="Rankings coming soon"
          body="Be the first to compete and claim the top spot."
        />
      ) : (
        <LeaderboardTabs players={players} currentUserId={user?.id ?? null} activeCategories={activeCategories} />
      )}
    </div>
  )
}
