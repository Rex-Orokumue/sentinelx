import type { SupabaseClient } from '@supabase/supabase-js'
import { frameUrlFor } from '@/lib/store/cosmetics'
import { CATEGORY_META } from '@/lib/games/categories'
import { rostersForSquads } from '@/lib/tournaments/squad-roster'
import {
  RANKING_MIN_MATCHES,
  rankPlayersBy,
  type PlayerStatsInput,
  type RankedPlayer,
} from './leaderboard'
import {
  winsByPlayerAndGame,
  scoreStatsByPlayerAndCategory,
  scoreStatsByPlayerAndGame,
  type GameScopedMatch,
} from './game-breakdown'
import { paginate, type PageInfo } from './pagination'
import { longestWinStreakByPlayer, type StreakMatch } from './streak'
import { previousRankFor, trendFor, type RankSnapshot, type Trend } from './trend'

type RawGameRef = { id: string; name: string; category: string } | { id: string; name: string; category: string }[] | null
type RawTournamentRef = { game: RawGameRef } | { game: RawGameRef }[] | null

function firstGameRef(g: RawGameRef): { id: string; name: string; category: string } | null {
  return Array.isArray(g) ? g[0] ?? null : g
}

function firstTournamentRef(t: RawTournamentRef): { game: RawGameRef } | null {
  return Array.isArray(t) ? t[0] ?? null : t
}

export interface RankingsParams {
  gameSlug: string | null
  region: string | null
  page: number
}

export interface RankingsGame {
  id: string
  name: string
  slug: string
  category: string
}

export type RankingsViewer = { mode: 'session' } | { mode: 'id'; id: string | null }

export interface RankingsResult {
  players: PlayerStatsInput[]
  scopedRanked: RankedPlayer[]
  pageInfo: PageInfo
  pagePlayers: RankedPlayer[]
  pinnedViewer: RankedPlayer | null
  viewerRanked: RankedPlayer | null
  viewer: PlayerStatsInput | null
  viewerId: string | null
  trendByPlayer: Record<string, Trend>
  streakByPlayer: Map<string, number>
  activeGame: RankingsGame | null
  gamesWithMatches: RankingsGame[]
  activeGames: RankingsGame[]
  regions: string[]
  seasons: { id: string; name: string }[]
  matchCount: number | null
  prizesAwarded: number
  highlights: {
    topScore: PlayerStatsInput | null
    topTitles: PlayerStatsInput | null
    topWinRate: PlayerStatsInput | null
    topStreak: PlayerStatsInput | null
    topStreakValue: number
  }
}

export async function getRankings(
  supabase: SupabaseClient,
  params: RankingsParams,
  viewer: RankingsViewer,
): Promise<RankingsResult> {
  const gameSlug = params.gameSlug
  const regionFilter = params.region
  const requestedPage = params.page
  const [
    { data: profiles },
    { data: matchRows },
    { data: activeGames },
    { count: matchCount },
    { data: prizeRows },
    {
      data: { user },
    },
  ] = await Promise.all([
    supabase
      .from('profiles')
      .select(
        'id, username, display_name, avatar_url, country, wins, losses, total_matches, goals_scored, goals_conceded, total_titles, sx_score, sentinel_tier, membership_tier, kyc_verified, deleted_at, equipped_avatar_border',
      )
      .gte('total_matches', RANKING_MIN_MATCHES)
      .order('wins', { ascending: false })
      .limit(200),
    supabase
      .from('matches')
      .select(
        'status, score_a, score_b, player_a_id, player_b_id, team_a_id, team_b_id, completed_at, tournament:tournaments(game:games(id, name, category))',
      )
      .eq('status', 'completed'),
    supabase.from('games').select('id, name, slug, category').eq('active', true),
    supabase.from('matches').select('id', { count: 'exact', head: true }).eq('status', 'completed'),
    supabase.from('tournaments').select('prize_pool').eq('status', 'completed'),
    viewer.mode === 'session'
      ? supabase.auth.getUser()
      : Promise.resolve({ data: { user: viewer.id ? { id: viewer.id } : null } }),
  ])

  const prizesAwarded = (prizeRows ?? []).reduce((sum, r) => sum + (r.prize_pool ?? 0), 0)
  const rawMatches = ((matchRows as unknown[] | null) ?? []) as {
    status: string
    score_a: number | null
    score_b: number | null
    player_a_id: string | null
    player_b_id: string | null
    team_a_id: string | null
    team_b_id: string | null
    completed_at: string | null
    tournament: RawTournamentRef
  }[]
  const squadIds = Array.from(
    new Set(rawMatches.flatMap((m) => [m.team_a_id, m.team_b_id]).filter((id): id is string => id != null)),
  )
  const rosterBySquad = await rostersForSquads(supabase, squadIds)
  const matches: (GameScopedMatch & { completed_at: string | null })[] = rawMatches.map((m) => {
    const t = firstTournamentRef(m.tournament)
    const g = firstGameRef(t?.game ?? null)
    return {
      status: m.status,
      score_a: m.score_a,
      score_b: m.score_b,
      player_a_id: m.player_a_id,
      player_b_id: m.player_b_id,
      team_a_id: m.team_a_id,
      team_b_id: m.team_b_id,
      team_a_roster: m.team_a_id ? rosterBySquad.get(m.team_a_id) ?? [] : undefined,
      team_b_roster: m.team_b_id ? rosterBySquad.get(m.team_b_id) ?? [] : undefined,
      completed_at: m.completed_at,
      game_id: g?.id ?? 'unknown',
      game_name: g?.name ?? 'Unknown',
      game_category: g?.category ?? 'other',
    }
  })
  const winsMap = winsByPlayerAndGame(matches)
  const categoryMaps = Object.keys(CATEGORY_META).map((category) => ({
    category,
    map: scoreStatsByPlayerAndCategory(matches, category),
  }))
  const gameMaps = (activeGames ?? []).map((g) => ({
    gameId: g.id,
    map: scoreStatsByPlayerAndGame(matches, g.id),
  }))

  const players: PlayerStatsInput[] = (profiles ?? []).map(
    (p): PlayerStatsInput => ({
      id: p.id,
      username: p.username,
      displayName: p.display_name,
      deletedAt: p.deleted_at,
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
      gameStats: gameMaps.map(({ gameId, map }) => ({
        gameId,
        scored: map.get(p.id)?.scored ?? 0,
        conceded: map.get(p.id)?.conceded ?? 0,
      })),
      winsByGame: winsMap.get(p.id) ?? [],
      totalTitles: p.total_titles,
      sxScore: p.sx_score,
      sentinelTier: p.sentinel_tier,
      membershipTier: p.membership_tier,
      kycVerified: p.kyc_verified,
      frameUrl: frameUrlFor(p.equipped_avatar_border),
    }),
  )

  const gamesWithMatches = (activeGames ?? []).filter((g) => matches.some((m) => m.game_id === g.id))
  const activeGame = gameSlug ? gamesWithMatches.find((g) => g.slug === gameSlug) ?? null : null
  const [{ data: snapshotRows }, { data: seasonRows }] = await Promise.all([
    supabase
      .from('player_rank_snapshots')
      .select('player_id, game_id, rank, captured_on')
      .order('captured_on', { ascending: false })
      .limit(2000),
    supabase.from('seasons').select('id, name').order('start_date', { ascending: false }),
  ])
  const snapshots: RankSnapshot[] = ((snapshotRows as unknown[] | null) ?? []).map((raw) => {
    const r = raw as { player_id: string; game_id: string | null; rank: number; captured_on: string }
    return { playerId: r.player_id, gameId: r.game_id, rank: r.rank, capturedOn: r.captured_on }
  })
  const today = new Date().toISOString().slice(0, 10)
  const regions = Array.from(new Set((players.map((p) => p.country).filter(Boolean) as string[]))).sort()
  const playersByGame = new Map<string, Set<string>>()
  for (const m of matches) {
    const set = playersByGame.get(m.game_id) ?? new Set<string>()
    if (m.player_a_id) set.add(m.player_a_id)
    if (m.player_b_id) set.add(m.player_b_id)
    playersByGame.set(m.game_id, set)
  }
  let filteredPlayers = regionFilter ? players.filter((p) => p.country === regionFilter) : players
  if (activeGame) {
    const competed = playersByGame.get(activeGame.id) ?? new Set<string>()
    filteredPlayers = filteredPlayers.filter((p) => competed.has(p.id))
  }
  const scopedRanked = rankPlayersBy(filteredPlayers, activeGame ? 'wins' : 'score', activeGame?.id)
  const trendByPlayer: Record<string, Trend> = {}
  for (const pl of scopedRanked) {
    trendByPlayer[pl.id] = trendFor(pl.rank, previousRankFor(snapshots, pl.id, activeGame?.id ?? null, today))
  }
  const pageInfo = paginate(scopedRanked.length, requestedPage)
  const pagePlayers = scopedRanked.slice(pageInfo.startIndex, pageInfo.endIndex)
  const viewerRanked = user ? scopedRanked.find((p) => p.id === user.id) ?? null : null
  const pinnedViewer = viewerRanked && !pagePlayers.some((p) => p.id === viewerRanked.id) ? viewerRanked : null
  const streakByPlayer = longestWinStreakByPlayer(matches as unknown as StreakMatch[])
  let topStreakId: string | null = null
  let topStreakBest = 0
  streakByPlayer.forEach((streak, playerId) => {
    if (streak > topStreakBest) {
      topStreakBest = streak
      topStreakId = playerId
    }
  })
  const topStreak = topStreakId ? players.find((p) => p.id === topStreakId) ?? null : null
  const topScore = [...players].sort((a, b) => b.sxScore - a.sxScore)[0] ?? null
  const topTitles = [...players].sort((a, b) => b.totalTitles - a.totalTitles)[0] ?? null
  const topWinRate =
    [...players]
      .filter((p) => p.totalMatches > 0)
      .sort((a, b) => b.wins / b.totalMatches - a.wins / a.totalMatches)[0] ?? null

  return {
    players,
    scopedRanked,
    pageInfo,
    pagePlayers,
    pinnedViewer,
    viewerRanked,
    viewer: user ? players.find((p) => p.id === user.id) ?? null : null,
    viewerId: user?.id ?? null,
    trendByPlayer,
    streakByPlayer,
    activeGame,
    gamesWithMatches,
    activeGames: activeGames ?? [],
    regions,
    seasons: (seasonRows ?? []) as { id: string; name: string }[],
    matchCount,
    prizesAwarded,
    highlights: { topScore, topTitles, topWinRate, topStreak, topStreakValue: topStreakBest },
  }
}
