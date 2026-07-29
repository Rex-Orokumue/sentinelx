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
