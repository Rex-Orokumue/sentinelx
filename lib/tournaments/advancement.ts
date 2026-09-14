import { ROUND_ORDER } from './bracket'

export interface AdvanceMatch {
  status: string
  score_a: number | null
  score_b: number | null
  player_a_id: string | null
  player_b_id: string | null
  team_a_id?: string | null
  team_b_id?: string | null
}

// A match's two sides as opaque ids — a player id for a solo match, a squad
// id for a team match. Never both: matches_side_a_kind/matches_side_b_kind
// (Phase 1 schema) guarantee exactly one of the pair is set per populated
// side. Exported (not just used internally) because season placement needs
// the exact same resolution for its own bands.
export function sideAId(m: AdvanceMatch): string | null {
  return m.player_a_id ?? m.team_a_id ?? null
}
export function sideBId(m: AdvanceMatch): string | null {
  return m.player_b_id ?? m.team_b_id ?? null
}

export interface RosterAwareMatch extends AdvanceMatch {
  // A team match's full roster for each side — attached by the caller
  // (which already knows how to batch-resolve squad_members, e.g. via
  // rostersForSquads) rather than queried here. Absent/undefined for a
  // solo match, or for a team match whose caller didn't attach it (treated
  // as an empty roster, never as "fall back to the squad id itself" — a
  // squad id is never a real player id, so attributing to it would corrupt
  // a per-player stat rather than just under-count it).
  team_a_roster?: string[]
  team_b_roster?: string[]
}

// All ids on a match's side A: the roster for a team match, the single
// player for a solo match, or empty for an unpopulated side (a bye's open
// slot, or a team match whose roster wasn't attached).
export function sideAIds(m: RosterAwareMatch): string[] {
  if (m.team_a_id) return m.team_a_roster ?? []
  return m.player_a_id ? [m.player_a_id] : []
}
export function sideBIds(m: RosterAwareMatch): string[] {
  if (m.team_b_id) return m.team_b_roster ?? []
  return m.player_b_id ? [m.player_b_id] : []
}

// The advancing side (player or squad id), or null if the match is not yet decided.
export function matchWinnerId(m: AdvanceMatch): string | null {
  if (m.status === 'bye') return sideAId(m)
  if (m.status !== 'completed') return null
  if (m.score_a == null || m.score_b == null || m.score_a === m.score_b) return null
  return m.score_a > m.score_b ? sideAId(m) : sideBId(m)
}

// True only when every match in the round is completed, bye, or forfeited
// (a knockout double-no-show — resolved, but produces no advancer).
export function roundResolved(matches: AdvanceMatch[]): boolean {
  return (
    matches.length > 0 &&
    matches.every((m) => m.status === 'completed' || m.status === 'bye' || m.status === 'forfeited')
  )
}

// Interleave byes with match-winners (so a bye meets a played-match winner), then pair.
// A forfeited match contributes no winner, which can leave one advancer unpaired —
// that player is returned as `leftover` so the caller can give them a bye instead
// of silently dropping them.
export function pairWinners(
  byeWinnerIds: string[],
  matchWinnerIds: string[],
): { pairs: [string, string][]; leftover: string | null } {
  const merged: string[] = []
  const maxLen = Math.max(byeWinnerIds.length, matchWinnerIds.length)
  for (let i = 0; i < maxLen; i++) {
    if (i < byeWinnerIds.length) merged.push(byeWinnerIds[i])
    if (i < matchWinnerIds.length) merged.push(matchWinnerIds[i])
  }
  const pairs: [string, string][] = []
  let i = 0
  for (; i + 1 < merged.length; i += 2) pairs.push([merged[i], merged[i + 1]])
  return { pairs, leftover: i < merged.length ? merged[i] : null }
}

// The two semifinal losers, or null if the round isn't ready for a bronze
// match. Requires exactly two matches (structurally guaranteed whenever the
// semi_final round exists) and both must be a normally decided 'completed'
// result — a bye or forfeit leaves no legitimate loser on that side, so no
// 3rd place match is created for that tournament run (an admin can still
// credit one manually — see lib/matches/verify-actions.ts).
export function thirdPlacePair(semiFinalMatches: AdvanceMatch[]): [string, string] | null {
  if (semiFinalMatches.length !== 2) return null
  const losers = semiFinalMatches.map((m) => {
    if (m.status !== 'completed') return null
    const winnerId = matchWinnerId(m)
    if (!winnerId) return null
    return winnerId === sideAId(m) ? sideBId(m) : sideAId(m)
  })
  const [a, b] = losers
  if (!a || !b) return null
  return [a, b]
}

// The next knockout round, or null for the final / a non-knockout round.
export function nextRoundName(current: string): string | null {
  const i = ROUND_ORDER.indexOf(current as (typeof ROUND_ORDER)[number])
  if (i === -1 || i === ROUND_ORDER.length - 1) return null
  return ROUND_ORDER[i + 1]
}
