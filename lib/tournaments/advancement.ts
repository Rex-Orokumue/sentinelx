import { ROUND_ORDER } from './bracket'

export interface AdvanceMatch {
  status: string
  score_a: number | null
  score_b: number | null
  player_a_id: string | null
  player_b_id: string | null
}

// The advancing player, or null if the match is not yet decided.
export function matchWinnerId(m: AdvanceMatch): string | null {
  if (m.status === 'bye') return m.player_a_id
  if (m.status !== 'completed') return null
  if (m.score_a == null || m.score_b == null || m.score_a === m.score_b) return null
  return m.score_a > m.score_b ? m.player_a_id : m.player_b_id
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

// The next knockout round, or null for the final / a non-knockout round.
export function nextRoundName(current: string): string | null {
  const i = ROUND_ORDER.indexOf(current as (typeof ROUND_ORDER)[number])
  if (i === -1 || i === ROUND_ORDER.length - 1) return null
  return ROUND_ORDER[i + 1]
}
