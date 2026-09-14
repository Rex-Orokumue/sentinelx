import { matchWinnerId, sideAId, sideAIds, sideBIds, type RosterAwareMatch } from '@/lib/tournaments/advancement'

export type StreakMatch = RosterAwareMatch & { completed_at: string | null }

// Longest run of consecutive wins per player, over completed matches in
// chronological order. Both a loss and a draw break a run — reuses
// matchWinnerId so "who won" has a single implementation. A team match's
// win/loss applies identically to every roster member.
export function longestWinStreakByPlayer(matches: StreakMatch[]): Map<string, number> {
  const ordered = [...matches].sort((a, b) =>
    (a.completed_at ?? '').localeCompare(b.completed_at ?? ''),
  )

  const best = new Map<string, number>()
  const running = new Map<string, number>()

  for (const match of ordered) {
    const winner = matchWinnerId(match)
    const winnerIds = new Set(winner == null ? [] : winner === sideAId(match) ? sideAIds(match) : sideBIds(match))
    for (const id of [...sideAIds(match), ...sideBIds(match)]) {
      const next = winnerIds.has(id) ? (running.get(id) ?? 0) + 1 : 0
      running.set(id, next)
      if (next > (best.get(id) ?? 0)) best.set(id, next)
    }
  }

  return best
}
