import { toDateTimeLocal, formatDate } from '@/lib/format'

export interface BracketMatch {
  id: string
  round: string
  group_id: string | null
  groupName: string | null
  status: string
  score_a: number | null
  score_b: number | null
  scheduled_at: string | null
  is_full_day: boolean
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

export interface FixtureDateGroup {
  dateLabel: string
  matches: BracketMatch[]
}

// Groups by WAT calendar date, ascending; a "Date TBD" group (unscheduled
// matches) always sorts last regardless of input order.
export function groupFixturesByDate(matches: BracketMatch[]): FixtureDateGroup[] {
  const byKey = new Map<string, BracketMatch[]>()
  for (const m of matches) {
    const key = m.scheduled_at ? toDateTimeLocal(m.scheduled_at).slice(0, 10) : ''
    const group = byKey.get(key)
    if (group) group.push(m)
    else byKey.set(key, [m])
  }
  const keys = Array.from(byKey.keys()).sort((a, b) => {
    if (a === '') return b === '' ? 0 : 1
    if (b === '') return -1
    return a.localeCompare(b)
  })
  return keys.map((key) => ({
    dateLabel: key === '' ? 'Date TBD' : (formatDate(byKey.get(key)![0].scheduled_at) as string),
    matches: byKey.get(key)!,
  }))
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
