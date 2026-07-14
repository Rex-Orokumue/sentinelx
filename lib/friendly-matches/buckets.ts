export interface FriendlyMatchRow {
  id: string
  status: string
  challengerId: string
  opponentId: string
}

const ACTIVE_STATUSES = new Set(['awaiting_payment', 'active', 'awaiting_admin_confirmation'])
const DONE_STATUSES = new Set(['completed', 'declined', 'disputed'])

export function bucketFriendlies<T extends FriendlyMatchRow>(
  rows: T[],
  // Kept for API symmetry with callers (list page + dashboard panel both pass the viewer id);
  // status alone determines the bucket today, but this is the natural seam if per-viewer
  // bucketing is ever needed.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _viewerId: string,
): { pending: T[]; active: T[]; completed: T[] } {
  return {
    pending: rows.filter((r) => r.status === 'pending'),
    active: rows.filter((r) => ACTIVE_STATUSES.has(r.status)),
    completed: rows.filter((r) => DONE_STATUSES.has(r.status)),
  }
}
