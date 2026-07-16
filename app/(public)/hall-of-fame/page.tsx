import { createClient } from '@/lib/supabase/server'
import { RANKING_MIN_MATCHES, type PlayerStatsInput } from '@/lib/rankings/leaderboard'
import {
  pickMVP,
  pickGoldenBoot,
  pickCategoryAward,
  deriveChampions,
  type ChampionInput,
} from '@/lib/hall-of-fame/awards'
import { scoreStatsByPlayerAndCategory, categoryStat, type GameScopedMatch } from '@/lib/rankings/game-breakdown'
import { CATEGORY_META } from '@/lib/games/categories'
import type { BracketMatch } from '@/lib/tournaments/bracket'
import { AwardCard } from '@/components/hall-of-fame/AwardCard'
import { ChampionCard } from '@/components/hall-of-fame/ChampionCard'
import { EmptyState } from '@/components/shared/EmptyState'
import { buildMetadata } from '@/lib/seo/metadata'

export const metadata = buildMetadata({
  title: 'Hall of Fame — Sentinel X',
  description: "Sentinel X champions, MVP, and Golden Boot — the all-time honors of Nigeria's home of mobile esports.",
  path: '/hall-of-fame',
})

type ProfileRef = { id?: string; username: string | null; display_name: string | null } | null

function nameOf(p: ProfileRef): string {
  return p?.display_name ?? p?.username ?? 'TBD'
}

// Supabase to-one embeds can arrive as an object or a single-element array; normalize.
function firstGameName(games: unknown): string | null {
  if (Array.isArray(games)) return (games[0] as { name?: string } | undefined)?.name ?? null
  return (games as { name?: string } | null)?.name ?? null
}

type RawGameRef = { name: string; category: string } | { name: string; category: string }[] | null
type RawTournamentRef = { game: RawGameRef } | { game: RawGameRef }[] | null

function firstGameRef(g: RawGameRef): { name: string; category: string } | null {
  return Array.isArray(g) ? g[0] ?? null : g
}
function firstTournamentRef(t: RawTournamentRef): { game: RawGameRef } | null {
  return Array.isArray(t) ? t[0] ?? null : t
}

export default async function HallOfFamePage() {
  const supabase = createClient()

  // Awards: eligible profiles. Champions: completed tournaments + their completed finals.
  const [{ data: profileRows }, { data: tournamentRows }, { data: matchRows }, { data: activeGames }] = await Promise.all([
    supabase
      .from('profiles')
      .select(
        'id, username, display_name, avatar_url, country, wins, losses, total_matches, goals_scored, goals_conceded, total_titles, sentinel_score, sentinel_tier',
      )
      .gte('total_matches', RANKING_MIN_MATCHES),
    supabase
      .from('tournaments')
      .select('id, slug, title, tournament_end, games(name)')
      .eq('status', 'completed'),
    supabase
      .from('matches')
      .select(
        'status, score_a, score_b, player_a_id, player_b_id, tournament:tournaments(game:games(name, category))',
      )
      .eq('status', 'completed'),
    // Independent of match data — a category can be "active" even with zero
    // completed matches played in it yet.
    supabase.from('games').select('category').eq('active', true),
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
  const categoryMaps = Object.keys(CATEGORY_META).map((category) => ({
    category,
    map: scoreStatsByPlayerAndCategory(matches, category),
  }))

  const players: PlayerStatsInput[] = (profileRows ?? []).map((p) => ({
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
    winsByGame: [],
    totalTitles: p.total_titles,
    sentinelScore: p.sentinel_score,
    sentinelTier: p.sentinel_tier,
  }))

  const mvp = pickMVP(players)
  const goldenBoot = pickGoldenBoot(players)
  const categoryAwards = activeCategories
    .filter((c) => c !== 'football' && CATEGORY_META[c] != null)
    .map((c) => ({ category: c, meta: CATEGORY_META[c], winner: pickCategoryAward(players, c) }))
    .filter((a) => a.winner != null)

  // Fetch completed final matches for the completed tournaments, then attach to each.
  const tournaments = (tournamentRows ?? []) as unknown as {
    id: string
    slug: string
    title: string
    tournament_end: string | null
    games: unknown
  }[]
  const tournamentIds = tournaments.map((t) => t.id)

  const { data: finalRows } =
    tournamentIds.length > 0
      ? await supabase
          .from('matches')
          .select(
            'id, tournament_id, round, status, score_a, score_b, ' +
              'player_a:profiles!matches_player_a_id_fkey(id, username, display_name), ' +
              'player_b:profiles!matches_player_b_id_fkey(id, username, display_name)',
          )
          .in('tournament_id', tournamentIds)
          .eq('round', 'final')
          .eq('status', 'completed')
      : { data: [] as unknown[] }

  // Map tournament_id -> its completed final as a BracketMatch.
  const finalByTournament = new Map<string, BracketMatch>()
  for (const raw of (finalRows as unknown[] | null) ?? []) {
    const m = raw as {
      id: string
      tournament_id: string
      round: string
      status: string
      score_a: number | null
      score_b: number | null
      player_a: ProfileRef
      player_b: ProfileRef
    }
    finalByTournament.set(m.tournament_id, {
      id: m.id,
      round: m.round,
      group_id: null,
      groupName: null,
      status: m.status,
      score_a: m.score_a,
      score_b: m.score_b,
      scheduled_at: null,
      playerA: { id: m.player_a?.id ?? '', name: nameOf(m.player_a) },
      playerB: { id: m.player_b?.id ?? '', name: nameOf(m.player_b) },
    })
  }

  const championInputs: ChampionInput[] = tournaments.map((t) => ({
    tournamentId: t.id,
    slug: t.slug,
    title: t.title,
    gameName: firstGameName(t.games),
    tournamentEnd: t.tournament_end,
    finalMatch: finalByTournament.get(t.id) ?? null,
  }))
  const champions = deriveChampions(championInputs)

  const hasAwards = mvp != null || goldenBoot != null || categoryAwards.length > 0
  const hasChampions = champions.length > 0

  return (
    <div className="mx-auto max-w-3xl px-4 pb-20">
      <div className="py-8">
        <h1 className="text-2xl font-black text-white">Hall of Fame</h1>
        <p className="mt-1 text-sm text-slate-400">
          Champions, MVP, and the Golden Boot — Sentinel X&apos;s all-time honors.
        </p>
      </div>

      {!hasAwards && !hasChampions ? (
        <EmptyState
          icon="🏆"
          title="The Hall of Fame awaits its first legends"
          body="Champions and awards appear here once tournaments are played and won."
        />
      ) : (
        <>
          <section className="mb-10">
            <h2 className="mb-4 text-base font-bold text-white">🏅 Awards</h2>
            {hasAwards ? (
              <div className="flex flex-col gap-4 sm:flex-row">
                {mvp && (
                  <AwardCard
                    label="MVP"
                    icon="⭐"
                    name={mvp.displayName ?? mvp.username ?? 'Anonymous'}
                    metricLabel="Sentinel Score"
                    metricValue={mvp.sentinelScore}
                    tier={mvp.sentinelTier}
                  />
                )}
                {goldenBoot && (
                  <AwardCard
                    label="Golden Boot"
                    icon="👟"
                    name={goldenBoot.displayName ?? goldenBoot.username ?? 'Anonymous'}
                    metricLabel="goals scored"
                    metricValue={categoryStat(goldenBoot.categoryStats, 'football').scored}
                  />
                )}
                {categoryAwards.map(({ category, meta, winner }) => (
                  <AwardCard
                    key={category}
                    label={meta.awardName}
                    icon={meta.awardEmoji}
                    name={winner!.displayName ?? winner!.username ?? 'Anonymous'}
                    metricLabel={meta.statLabel.toLowerCase()}
                    metricValue={categoryStat(winner!.categoryStats, category).scored}
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                icon="🏅"
                title="Awards unlock once matches are played"
                body="MVP and the Golden Boot are decided from completed matches."
              />
            )}
          </section>

          <section className="mb-10">
            <h2 className="mb-4 text-base font-bold text-white">🏆 Champions</h2>
            {hasChampions ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {champions.map((c) => (
                  <ChampionCard key={c.tournamentId} entry={c} />
                ))}
              </div>
            ) : (
              <EmptyState
                icon="🏆"
                title="No champions crowned yet"
                body="Winners appear here when tournaments finish and finals are confirmed."
              />
            )}
          </section>
        </>
      )}
    </div>
  )
}
