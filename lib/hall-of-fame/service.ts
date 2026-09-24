import type { SupabaseClient } from '@supabase/supabase-js'
import { frameUrlFor } from '@/lib/store/cosmetics'
import { RANKING_MIN_MATCHES, type PlayerStatsInput } from '@/lib/rankings/leaderboard'
import {
  pickMVP,
  pickCategoryAward,
  pickGameAward,
  deriveThirdPlaces,
  type ThirdPlaceInput,
  type ThirdPlaceEntry,
} from './awards'
import {
  scoreStatsByPlayerAndCategory,
  scoreStatsByPlayerAndGame,
  categoryStat,
  gameStat,
  type GameScopedMatch,
} from '@/lib/rankings/game-breakdown'
import { CATEGORY_META } from '@/lib/games/categories'
import type { BracketMatch } from '@/lib/tournaments/bracket'
import { fetchChampions, groupByType, type ChampionEntry, type TournamentType } from '@/lib/tournaments/champions'
import { rostersForSquads } from '@/lib/tournaments/squad-roster'

type ProfileRef = { id?: string; username: string | null; display_name: string | null } | null
type SquadRef = { id: string; name: string } | { id: string; name: string }[] | null
type RawGameRef = { id: string; name: string; category: string } | { id: string; name: string; category: string }[] | null
type RawTournamentRef = { game: RawGameRef } | { game: RawGameRef }[] | null

function nameOf(p: ProfileRef): string {
  return p?.display_name ?? p?.username ?? 'TBD'
}
function firstSquad(s: SquadRef): { id: string; name: string } | null {
  return Array.isArray(s) ? s[0] ?? null : s
}
function sideRef(player: ProfileRef, team: SquadRef): { id: string; name: string } {
  const t = firstSquad(team)
  if (t) return t
  return { id: player?.id ?? '', name: nameOf(player) }
}
function firstGameName(games: unknown): string | null {
  if (Array.isArray(games)) return (games[0] as { name?: string } | undefined)?.name ?? null
  return (games as { name?: string } | null)?.name ?? null
}
function firstGameRef(g: RawGameRef): { id: string; name: string; category: string } | null {
  return Array.isArray(g) ? g[0] ?? null : g
}
function firstTournamentRef(t: RawTournamentRef): { game: RawGameRef } | null {
  return Array.isArray(t) ? t[0] ?? null : t
}

export interface AwardOption {
  gameId: string | null
  gameLabel: string
  winner: PlayerStatsInput | null
  metricValue: number
}

export interface HallOfFameResult {
  activeGameList: { id: string; name: string; slug: string; category: string }[]
  selectedGame: { id: string; name: string; slug: string; category: string } | null
  mvp: PlayerStatsInput | null
  goldenBootOptions: AwardOption[]
  categoryAwards: { category: string; meta: (typeof CATEGORY_META)[string]; options: AwardOption[] }[]
  champions: ChampionEntry[]
  championGroups: Record<TournamentType, ChampionEntry[]>
  championProfileById: Map<string, { avatar_url: string | null; membership_tier: string | null; sentinel_tier: string | null; equipped_avatar_border: string | null }>
  cupEntry: ChampionEntry | null
  cupChampionSlugs: string[]
  thirdPlaces: ThirdPlaceEntry[]
  hasAwards: boolean
  hasBronze: boolean
}

export async function getHallOfFame(
  supabase: SupabaseClient,
  params: { gameSlug: string | null },
): Promise<HallOfFameResult> {
  const gameSlug = params.gameSlug
  const [{ data: profileRows }, { data: tournamentRows }, { data: matchRows }, { data: activeGames }] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, username, display_name, avatar_url, country, wins, losses, total_matches, goals_scored, goals_conceded, total_titles, sx_score, sentinel_tier, membership_tier, kyc_verified, equipped_avatar_border')
      .gte('total_matches', RANKING_MIN_MATCHES),
    supabase.from('tournaments').select('id, slug, title, tournament_end, games(name)').eq('status', 'completed'),
    supabase
      .from('matches')
      .select('status, score_a, score_b, player_a_id, player_b_id, team_a_id, team_b_id, tournament:tournaments(game:games(id, name, category))')
      .eq('status', 'completed'),
    supabase.from('games').select('id, name, slug, category').eq('active', true),
  ])
  const activeCategories = Array.from(new Set((activeGames ?? []).map((g) => g.category)))
  const rawMatches = ((matchRows as unknown[] | null) ?? []) as {
    status: string; score_a: number | null; score_b: number | null
    player_a_id: string | null; player_b_id: string | null; team_a_id: string | null; team_b_id: string | null
    tournament: RawTournamentRef
  }[]
  const squadIds = Array.from(new Set(rawMatches.flatMap((m) => [m.team_a_id, m.team_b_id]).filter((id): id is string => id != null)))
  const rosterBySquad = await rostersForSquads(supabase, squadIds)
  const matches: GameScopedMatch[] = rawMatches.map((m) => {
    const t = firstTournamentRef(m.tournament)
    const g = firstGameRef(t?.game ?? null)
    return {
      status: m.status, score_a: m.score_a, score_b: m.score_b,
      player_a_id: m.player_a_id, player_b_id: m.player_b_id, team_a_id: m.team_a_id, team_b_id: m.team_b_id,
      team_a_roster: m.team_a_id ? rosterBySquad.get(m.team_a_id) ?? [] : undefined,
      team_b_roster: m.team_b_id ? rosterBySquad.get(m.team_b_id) ?? [] : undefined,
      game_id: g?.id ?? 'unknown', game_name: g?.name ?? 'Unknown', game_category: g?.category ?? 'other',
    }
  })
  const categoryMaps = Object.keys(CATEGORY_META).map((category) => ({ category, map: scoreStatsByPlayerAndCategory(matches, category) }))
  const gameMaps = (activeGames ?? []).map((g) => ({ gameId: g.id, map: scoreStatsByPlayerAndGame(matches, g.id) }))
  const players: PlayerStatsInput[] = (profileRows ?? []).map((p) => ({
    id: p.id, kycVerified: p.kyc_verified, username: p.username, displayName: p.display_name, avatarUrl: p.avatar_url,
    country: p.country, wins: p.wins, losses: p.losses, totalMatches: p.total_matches,
    goalsScored: p.goals_scored, goalsConceded: p.goals_conceded,
    categoryStats: categoryMaps.map(({ category, map }) => ({ category, scored: map.get(p.id)?.scored ?? 0, conceded: map.get(p.id)?.conceded ?? 0 })),
    gameStats: gameMaps.map(({ gameId, map }) => ({ gameId, scored: map.get(p.id)?.scored ?? 0, conceded: map.get(p.id)?.conceded ?? 0 })),
    winsByGame: [], totalTitles: p.total_titles, sxScore: p.sx_score, sentinelTier: p.sentinel_tier,
    membershipTier: p.membership_tier, frameUrl: frameUrlFor(p.equipped_avatar_border),
  }))
  function awardOptionsFor(category: string): AwardOption[] {
    const allWinner = pickCategoryAward(players, category)
    const options: AwardOption[] = [{
      gameId: null,
      gameLabel: `All ${CATEGORY_META[category]?.statLabel ?? category}`,
      winner: allWinner,
      metricValue: allWinner ? categoryStat(allWinner.categoryStats, category).scored : 0,
    }]
    const gamesInCategory = (activeGames ?? []).filter((g) => g.category === category)
    if (gamesInCategory.length > 1) {
      for (const g of gamesInCategory) {
        const winner = pickGameAward(players, g.id)
        options.push({ gameId: g.id, gameLabel: g.name, winner, metricValue: winner ? gameStat(winner.gameStats, g.id).scored : 0 })
      }
    }
    return options
  }
  const mvp = pickMVP(players)
  const goldenBootOptions = awardOptionsFor('football')
  const goldenBoot = goldenBootOptions[0]?.winner ?? null
  const categoryAwards = activeCategories
    .filter((c) => c !== 'football' && CATEGORY_META[c] != null)
    .map((c) => ({ category: c, meta: CATEGORY_META[c], options: awardOptionsFor(c) }))
    .filter((a) => a.options[0]?.winner != null)
  const tournaments = (tournamentRows ?? []) as unknown as { id: string; slug: string; title: string; tournament_end: string | null; games: unknown }[]
  const tournamentIds = tournaments.map((t) => t.id)
  const { data: thirdPlaceRows } = tournamentIds.length > 0
    ? await supabase
        .from('matches')
        .select('id, tournament_id, round, status, score_a, score_b, player_a:profiles!matches_player_a_id_fkey(id, username, display_name), player_b:profiles!matches_player_b_id_fkey(id, username, display_name), team_a:squads!matches_team_a_id_fkey(id, name), team_b:squads!matches_team_b_id_fkey(id, name)')
        .in('tournament_id', tournamentIds).eq('round', 'third_place').in('status', ['completed', 'bye'])
    : { data: [] as unknown[] }
  const thirdPlaceByTournament = new Map<string, BracketMatch>()
  for (const raw of (thirdPlaceRows as unknown[] | null) ?? []) {
    const m = raw as { id: string; tournament_id: string; round: string; status: string; score_a: number | null; score_b: number | null; player_a: ProfileRef; player_b: ProfileRef; team_a: SquadRef; team_b: SquadRef }
    thirdPlaceByTournament.set(m.tournament_id, {
      id: m.id, round: m.round, group_id: null, groupName: null, status: m.status, score_a: m.score_a, score_b: m.score_b,
      scheduled_at: null, is_full_day: false, playerA: sideRef(m.player_a, m.team_a), playerB: sideRef(m.player_b, m.team_b),
    })
  }
  const thirdPlaces = deriveThirdPlaces(tournaments.map((t): ThirdPlaceInput => ({
    tournamentId: t.id, slug: t.slug, title: t.title, gameName: firstGameName(t.games),
    tournamentEnd: t.tournament_end, thirdPlaceMatch: thirdPlaceByTournament.get(t.id) ?? null,
  })))
  const activeGameList = (activeGames ?? []) as { id: string; name: string; slug: string; category: string }[]
  const selectedGame = gameSlug ? activeGameList.find((g) => g.slug === gameSlug) ?? null : null
  const champions = await fetchChampions(supabase, selectedGame ? { gameId: selectedGame.id } : {})
  const championGroups = groupByType(champions)
  const championIds = Array.from(new Set(champions.map((c) => c.champion.id)))
  const { data: championProfileRows } = championIds.length
    ? await supabase.from('profiles').select('id, avatar_url, membership_tier, sentinel_tier, equipped_avatar_border').in('id', championIds)
    : { data: [] as unknown[] }
  const championProfileById = new Map<string, { avatar_url: string | null; membership_tier: string | null; sentinel_tier: string | null; equipped_avatar_border: string | null }>()
  for (const raw of (championProfileRows as unknown[] | null) ?? []) {
    const r = raw as { id: string; avatar_url: string | null; membership_tier: string | null; sentinel_tier: string | null; equipped_avatar_border: string | null }
    championProfileById.set(r.id, r)
  }
  const cupEntry = championGroups.champions_cup[0] ?? null
  const { data: cupChampAchievements } = cupEntry
    ? await supabase.from('player_achievements').select('achievements(slug)').eq('player_id', cupEntry.champion.id)
    : { data: [] as unknown[] }
  const cupChampionSlugs = ((cupChampAchievements as unknown[] | null) ?? []).flatMap((raw) => {
    const r = raw as { achievements: { slug: string } | { slug: string }[] | null }
    const ref = Array.isArray(r.achievements) ? r.achievements[0] : r.achievements
    return ref?.slug ? [ref.slug] : []
  })
  return {
    activeGameList, selectedGame, mvp, goldenBootOptions, categoryAwards, champions, championGroups,
    championProfileById, cupEntry, cupChampionSlugs, thirdPlaces,
    hasAwards: mvp != null || goldenBoot != null || categoryAwards.length > 0,
    hasBronze: thirdPlaces.length > 0,
  }
}
