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
