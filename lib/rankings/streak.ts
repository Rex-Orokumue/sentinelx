import { matchWinnerId, type AdvanceMatch } from '@/lib/tournaments/advancement'

export type StreakMatch = AdvanceMatch & { completed_at: string | null }

// Longest run of consecutive wins per player, over completed matches in
// chronological order. Both a loss and a draw break a run — reuses
// matchWinnerId so "who won" has a single implementation, the same way
// lib/achievements/unlock.ts computes its win_streak achievements.
export function longestWinStreakByPlayer(matches: StreakMatch[]): Map<string, number> {
  const ordered = [...matches].sort((a, b) =>
    (a.completed_at ?? '').localeCompare(b.completed_at ?? ''),
  )

  const best = new Map<string, number>()
  const running = new Map<string, number>()

  for (const match of ordered) {
    const winner = matchWinnerId(match)
    for (const id of [match.player_a_id, match.player_b_id]) {
      if (!id) continue
      const next = id === winner ? (running.get(id) ?? 0) + 1 : 0
      running.set(id, next)
      if (next > (best.get(id) ?? 0)) best.set(id, next)
    }
  }

  return best
}
