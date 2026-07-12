export interface BracketMatch {
  id: string
  round: string
  group_id: string | null
  groupName: string | null
  status: string
  score_a: number | null
  score_b: number | null
  scheduled_at: string | null
  playerA: { id: string; name: string }
  playerB: { id: string; name: string }
}

// Canonical knockout order — the single source of truth for round sorting,
// independent of DB insertion/return order.
export const ROUND_ORDER = [
  'round_of_32',
  'round_of_16',
  'quarter_final',
  'semi_final',
  'final',
] as const

export const ROUND_LABELS: Record<string, string> = {
  group: 'Group Stage',
  round_of_32: 'Round of 32',
  round_of_16: 'Round of 16',
  quarter_final: 'Quarter-finals',
  semi_final: 'Semi-finals',
  final: 'Final',
}

// A match is only "live" when an admin has set status = 'live' in the DB. With
// realtime out of scope for v1.0, the pulsing "Live" indicator reflects
// admin-confirmed state, not the actual match state — it can lag.
export function splitFixturesByState(matches: BracketMatch[]): {
  live: BracketMatch[]
  upcoming: BracketMatch[]
  completed: BracketMatch[]
  disputedOrCancelled: BracketMatch[]
} {
  const live = matches.filter((m) => m.status === 'live')
  const completed = matches.filter((m) => m.status === 'completed')
  const disputedOrCancelled = matches.filter(
    (m) => m.status === 'disputed' || m.status === 'cancelled',
  )
  const upcoming = matches
    .filter((m) => m.status === 'scheduled')
    .sort((a, b) => {
      if (a.scheduled_at == null) return b.scheduled_at == null ? 0 : 1
      if (b.scheduled_at == null) return -1
      return a.scheduled_at.localeCompare(b.scheduled_at)
    })
  return { live, upcoming, completed, disputedOrCancelled }
}

export function orderKnockoutRounds(matches: BracketMatch[]): {
  round: string
  label: string
  matches: BracketMatch[]
}[] {
  return ROUND_ORDER.flatMap((round) => {
    const inRound = matches.filter((m) => m.round === round)
    if (inRound.length === 0) return []
    return [{ round, label: ROUND_LABELS[round] ?? round, matches: inRound }]
  })
}

export function getChampion(matches: BracketMatch[]): { id: string; name: string } | null {
  const final = matches.find((m) => m.round === 'final' && m.status === 'completed')
  if (!final || final.score_a == null || final.score_b == null) return null
  if (final.score_a === final.score_b) return null
  return final.score_a > final.score_b ? final.playerA : final.playerB
}
