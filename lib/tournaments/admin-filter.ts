// Status filter for the admin tournament list. Keys map 1:1 to
// tournaments.status values (see migration 032_tournament_cancellation.sql),
// plus 'all' which applies no status constraint.
export type AdminTournamentStatusFilter =
  | 'all'
  | 'active'
  | 'registration_open'
  | 'registration_closed'
  | 'completed'
  | 'draft'
  | 'cancelled'

export const ADMIN_TOURNAMENT_STATUS_FILTERS: { key: AdminTournamentStatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'registration_open', label: 'Reg. open' },
  { key: 'registration_closed', label: 'Reg. closed' },
  { key: 'completed', label: 'Completed' },
  { key: 'draft', label: 'Draft' },
  { key: 'cancelled', label: 'Cancelled' },
]

const KEYS = ADMIN_TOURNAMENT_STATUS_FILTERS.map((f) => f.key)

export function isAdminTournamentStatusFilter(
  value: string | undefined | null,
): value is AdminTournamentStatusFilter {
  return value != null && (KEYS as string[]).includes(value)
}

/**
 * The concrete `tournaments.status` values a filter selects, or `null` for
 * the 'all' filter (no constraint). Kept as a helper so the query builder
 * and its tests share one definition.
 */
export function filterStatusValues(filter: AdminTournamentStatusFilter): string[] | null {
  if (filter === 'all') return null
  return [filter]
}
