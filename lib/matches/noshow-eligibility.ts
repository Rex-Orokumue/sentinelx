export interface NoShowMatchState {
  status: string
  noshowFlaggedAt: string | null
  submissionCount: number
}

// "Mark both no-show" may only run on a match the sweep has already flagged
// as stale, still scheduled/live, and with zero result submissions from
// either player. If anyone submitted anything, writing a mutual no-show
// would silently discard real evidence — use "Declare no-show winner" or
// the normal confirm-result flow instead.
export function canMarkBothNoShow(m: NoShowMatchState): boolean {
  return (
    (m.status === 'scheduled' || m.status === 'live') &&
    m.noshowFlaggedAt !== null &&
    m.submissionCount === 0
  )
}

// Persistent confirmation for a match an admin has already closed as a mutual
// no-show. The "Mark both no-show" form's own success message can never show:
// the action revalidates the page, the match is no longer scheduled/live, and
// the form unmounts with its message. The closed state itself is the record, so
// the review page renders this instead. Only that action writes `forfeited` or
// the `no_show_draw` resolution.
export function mutualNoShowNotice(m: {
  status: string
  resolution: string | null
  adminNote: string | null
}): string | null {
  const closedAsMutualNoShow = m.status === 'forfeited' || (m.status === 'completed' && m.resolution === 'no_show_draw')
  if (!closedAsMutualNoShow) return null
  const base = 'Marked as a mutual no-show — both sides take the no-show penalty.'
  return m.adminNote ? `${base} Note: ${m.adminNote}` : base
}
