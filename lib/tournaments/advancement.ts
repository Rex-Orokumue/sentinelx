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

// True only when every match in the round is completed or bye.
export function roundResolved(matches: AdvanceMatch[]): boolean {
  return matches.length > 0 && matches.every((m) => m.status === 'completed' || m.status === 'bye')
}

// Interleave byes with match-winners (so a bye meets a played-match winner), then pair.
export function pairWinners(byeWinnerIds: string[], matchWinnerIds: string[]): [string, string][] {
  const merged: string[] = []
  const maxLen = Math.max(byeWinnerIds.length, matchWinnerIds.length)
  for (let i = 0; i < maxLen; i++) {
    if (i < byeWinnerIds.length) merged.push(byeWinnerIds[i])
    if (i < matchWinnerIds.length) merged.push(matchWinnerIds[i])
  }
  const pairs: [string, string][] = []
  for (let i = 0; i + 1 < merged.length; i += 2) pairs.push([merged[i], merged[i + 1]])
  return pairs
}

// The next knockout round, or null for the final / a non-knockout round.
export function nextRoundName(current: string): string | null {
  const i = ROUND_ORDER.indexOf(current as (typeof ROUND_ORDER)[number])
  if (i === -1 || i === ROUND_ORDER.length - 1) return null
  return ROUND_ORDER[i + 1]
}
