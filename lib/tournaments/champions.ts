import { getChampion, getRunnerUp, type BracketMatch } from './bracket'
import { sortStandings, type MembershipInput } from './standings'

export interface H2HMatch {
  playerAId: string
  playerBId: string
  scoreA: number | null
  scoreB: number | null
  status: string
}

// Fourth tiebreak for a round-robin title, applied only after points-per-game,
// goal difference and goals-for have all failed to separate two players.
// Standard football convention: head-to-head points, then head-to-head goal
// difference. Returns null when it genuinely cannot separate them — the caller
// must then report the title as undecided rather than guess.
export function headToHeadWinner(aId: string, bId: string, matches: H2HMatch[]): string | null {
  let pointsA = 0
  let pointsB = 0
  let goalsA = 0
  let goalsB = 0
  let met = false

  for (const m of matches) {
    if (m.status !== 'completed' || m.scoreA == null || m.scoreB == null) continue
    const isAB = m.playerAId === aId && m.playerBId === bId
    const isBA = m.playerAId === bId && m.playerBId === aId
    if (!isAB && !isBA) continue
    met = true

    const forA = isAB ? m.scoreA : m.scoreB
    const forB = isAB ? m.scoreB : m.scoreA
    goalsA += forA
    goalsB += forB
    if (forA > forB) pointsA += 3
    else if (forB > forA) pointsB += 3
    else {
      pointsA += 1
      pointsB += 1
    }
  }

  if (!met) return null
  if (pointsA !== pointsB) return pointsA > pointsB ? aId : bId
  const diffA = goalsA - goalsB
  if (diffA !== 0) return diffA > 0 ? aId : bId
  return null
}

export interface Placing {
  id: string
  name: string
}

export interface ChampionResult {
  champion: Placing
  runnerUp: Placing | null
}

export interface ResolveChampionInput {
  bracketMatches: BracketMatch[]
  standings?: MembershipInput[]
  h2hMatches?: H2HMatch[]
}

// Two branches, because the platform runs two formats:
//   group_knockout -> a `final` match decides it, reusing the bracket helpers
//                     the bracket page already renders from
//   round_robin    -> no final exists; the League Table decides it
//
// A tie the tiebreaks cannot separate returns null. sortStandings is a stable
// sort, so two genuinely level players come back in input order — crowning
// rank 1 there would silently pick an arbitrary winner with no visible symptom.
export function resolveChampion({
  bracketMatches,
  standings,
  h2hMatches = [],
}: ResolveChampionInput): ChampionResult | null {
  const fromFinal = getChampion(bracketMatches)
  if (fromFinal) {
    return { champion: fromFinal, runnerUp: getRunnerUp(bracketMatches) }
  }
  // A final exists but isn't decided yet — don't fall through to the group
  // table and crown the leader while the final is still to be played.
  if (bracketMatches.some((m) => m.round === 'final')) return null

  if (!standings || standings.length === 0) return null

  const table = sortStandings(standings)
  const first = table[0]
  if (!first) return null
  const second = table[1] ?? null
  if (!second) return { champion: { id: first.playerId, name: first.name }, runnerUp: null }

  const ppg = (r: { points: number; played: number }) => (r.played > 0 ? r.points / r.played : 0)
  const level =
    ppg(first) === ppg(second) &&
    first.goalDiff === second.goalDiff &&
    first.goalsFor === second.goalsFor

  if (level) {
    const decided = headToHeadWinner(first.playerId, second.playerId, h2hMatches)
    if (decided === null) return null
    const winner = decided === first.playerId ? first : second
    const loser = decided === first.playerId ? second : first
    return {
      champion: { id: winner.playerId, name: winner.name },
      runnerUp: { id: loser.playerId, name: loser.name },
    }
  }

  return {
    champion: { id: first.playerId, name: first.name },
    runnerUp: { id: second.playerId, name: second.name },
  }
}

export type TournamentType = 'champions_cup' | 'masters' | 'community_club' | 'open'

export const TOURNAMENT_TYPES: readonly TournamentType[] = [
  'champions_cup',
  'masters',
  'community_club',
  'open',
] as const

export interface ChampionEntry {
  tournamentId: string
  slug: string
  title: string
  tournamentType: TournamentType
  gameId: string
  gameName: string
  date: string | null
  prizePool: number | null
  champion: Placing
  runnerUp: Placing | null
  // Carried on the entry so the four surfaces don't each re-query profiles for
  // an avatar they already joined on the way to finding the champion.
  championAvatarUrl: string | null
  // The Champions Cup card labels its winner with the season they won in.
  seasonName: string | null
}

// Seeded with every type so a section can read `groups.masters.length` without
// an existence check, and a type added later can never render as undefined.
export function groupByType(entries: ChampionEntry[]): Record<TournamentType, ChampionEntry[]> {
  const out = Object.fromEntries(TOURNAMENT_TYPES.map((t) => [t, [] as ChampionEntry[]])) as Record<
    TournamentType,
    ChampionEntry[]
  >
  for (const e of entries) if (out[e.tournamentType]) out[e.tournamentType].push(e)
  return out
}

function time(e: ChampionEntry): number {
  return e.date ? new Date(e.date).getTime() : Number.NEGATIVE_INFINITY
}

// Undated entries sort to -Infinity, so any dated entry beats them; if every
// entry is undated the first one is returned rather than nothing.
export function latestChampion(entries: ChampionEntry[]): ChampionEntry | null {
  let best: ChampionEntry | null = null
  for (const e of entries) if (!best || time(e) > time(best)) best = e
  return best
}

export function reigningChampionByGame(entries: ChampionEntry[]): Map<string, ChampionEntry> {
  const map = new Map<string, ChampionEntry>()
  for (const e of entries) {
    const cur = map.get(e.gameId)
    if (!cur || time(e) > time(cur)) map.set(e.gameId, e)
  }
  return map
}

// ── Fetch ─────────────────────────────────────────────────────────────
// A thin Supabase read that turns completed tournaments into ChampionEntry[].
// Verified by the pages rendering rather than by mocking the query builder —
// the logic worth testing lives in resolveChampion above.

type ProfileRef = { id: string; username: string | null; display_name: string | null; avatar_url: string | null }

function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? v[0] ?? null : v
}

function nameOf(p: ProfileRef | null): string {
  return p?.display_name ?? p?.username ?? 'Unknown'
}

const MATCH_SELECT =
  'id, tournament_id, round, status, score_a, score_b, player_a_id, player_b_id, ' +
  'player_a:profiles!matches_player_a_id_fkey(id, username, display_name, avatar_url), ' +
  'player_b:profiles!matches_player_b_id_fkey(id, username, display_name, avatar_url)'

interface MatchRow {
  id: string
  tournament_id: string
  round: string
  status: string
  score_a: number | null
  score_b: number | null
  player_a_id: string | null
  player_b_id: string | null
  player_a: ProfileRef | ProfileRef[] | null
  player_b: ProfileRef | ProfileRef[] | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseLike = any

export async function fetchChampions(
  supabase: SupabaseLike,
  opts: { gameId?: string; tournamentId?: string } = {},
): Promise<ChampionEntry[]> {
  let tq = supabase
    .from('tournaments')
    .select(
      'id, slug, title, tournament_type, prize_pool, tournament_end, game_id, games(name), season:seasons(name)',
    )
    .eq('status', 'completed')
    .order('tournament_end', { ascending: false })
  if (opts.gameId) tq = tq.eq('game_id', opts.gameId)
  if (opts.tournamentId) tq = tq.eq('id', opts.tournamentId)

  const { data: tRows } = await tq
  const tournaments = (tRows ?? []) as unknown as {
    id: string
    slug: string
    title: string
    tournament_type: TournamentType
    prize_pool: number | null
    tournament_end: string | null
    game_id: string | null
    games: { name: string } | { name: string }[] | null
    season: { name: string } | { name: string }[] | null
  }[]
  if (tournaments.length === 0) return []

  const ids = tournaments.map((t) => t.id)
  const { data: mRows } = await supabase.from('matches').select(MATCH_SELECT).in('tournament_id', ids)
  const matches = (mRows ?? []) as unknown as MatchRow[]

  const byTournament = new Map<string, MatchRow[]>()
  const avatarById = new Map<string, string | null>()
  for (const m of matches) {
    const list = byTournament.get(m.tournament_id) ?? []
    list.push(m)
    byTournament.set(m.tournament_id, list)
    for (const p of [one(m.player_a), one(m.player_b)]) if (p) avatarById.set(p.id, p.avatar_url)
  }

  // Only tournaments with no final at all need a league table.
  const needStandings = tournaments.filter(
    (t) => !(byTournament.get(t.id) ?? []).some((m) => m.round === 'final'),
  )
  const standingsByTournament = new Map<string, MembershipInput[]>()

  if (needStandings.length > 0) {
    const { data: groupRows } = await supabase
      .from('groups')
      .select('id, tournament_id')
      .in('tournament_id', needStandings.map((t) => t.id))
    const groups = (groupRows ?? []) as unknown as { id: string; tournament_id: string }[]

    if (groups.length > 0) {
      const { data: memRows } = await supabase
        .from('group_memberships')
        .select('group_id, player_id, wins, draws, losses, goals_for, goals_against, points')
        .in('group_id', groups.map((g) => g.id))
      const mems = (memRows ?? []) as unknown as {
        group_id: string
        player_id: string
        wins: number
        draws: number
        losses: number
        goals_for: number
        goals_against: number
        points: number
      }[]

      // Names for players who may never appear in a match join.
      const memberIds = Array.from(new Set(mems.map((m) => m.player_id)))
      const { data: profRows } = memberIds.length
        ? await supabase.from('profiles').select('id, username, display_name, avatar_url').in('id', memberIds)
        : { data: [] }
      const profileById = new Map<string, ProfileRef>()
      for (const p of ((profRows ?? []) as unknown as ProfileRef[])) {
        profileById.set(p.id, p)
        avatarById.set(p.id, p.avatar_url)
      }

      const tournamentByGroup = new Map(groups.map((g) => [g.id, g.tournament_id]))
      for (const m of mems) {
        const tid = tournamentByGroup.get(m.group_id)
        if (!tid) continue
        const list = standingsByTournament.get(tid) ?? []
        list.push({
          playerId: m.player_id,
          name: nameOf(profileById.get(m.player_id) ?? null),
          wins: m.wins,
          draws: m.draws,
          losses: m.losses,
          goalsFor: m.goals_for,
          goalsAgainst: m.goals_against,
          points: m.points,
        })
        standingsByTournament.set(tid, list)
      }
    }
  }

  const entries: ChampionEntry[] = []
  for (const t of tournaments) {
    const rows = byTournament.get(t.id) ?? []
    const bracketMatches: BracketMatch[] = rows.map((m) => ({
      id: m.id,
      round: m.round,
      group_id: null,
      groupName: null,
      status: m.status,
      score_a: m.score_a,
      score_b: m.score_b,
      scheduled_at: null,
      is_full_day: false,
      playerA: { id: one(m.player_a)?.id ?? '', name: nameOf(one(m.player_a)) },
      playerB: { id: one(m.player_b)?.id ?? '', name: nameOf(one(m.player_b)) },
    }))

    const h2hMatches: H2HMatch[] = rows.map((m) => ({
      playerAId: m.player_a_id ?? '',
      playerBId: m.player_b_id ?? '',
      scoreA: m.score_a,
      scoreB: m.score_b,
      status: m.status,
    }))

    const result = resolveChampion({
      bracketMatches,
      standings: standingsByTournament.get(t.id),
      h2hMatches,
    })
    if (!result) continue

    entries.push({
      tournamentId: t.id,
      slug: t.slug,
      title: t.title,
      tournamentType: t.tournament_type,
      gameId: t.game_id ?? '',
      gameName: one(t.games)?.name ?? '',
      date: t.tournament_end,
      prizePool: t.prize_pool,
      champion: result.champion,
      runnerUp: result.runnerUp,
      championAvatarUrl: avatarById.get(result.champion.id) ?? null,
      seasonName: one(t.season)?.name ?? null,
    })
  }

  return entries
}
