export const GRACE_DAYS = 15
const DAY_MS = 86_400_000

export function deletionDueAt(requestedAt: Date): Date {
  return new Date(requestedAt.getTime() + GRACE_DAYS * DAY_MS)
}

export function isGraceElapsed(requestedAt: Date, now: Date): boolean {
  return now.getTime() >= deletionDueAt(requestedAt).getTime()
}

// Rounded up, so a request with 2h left still reads "1 day left" rather than
// "0" — a countdown showing zero while the account still exists reads as
// broken. Reaches zero only once the deletion is genuinely due.
export function daysRemaining(requestedAt: Date, now: Date): number {
  const ms = deletionDueAt(requestedAt).getTime() - now.getTime()
  if (ms <= 0) return 0
  return Math.ceil(ms / DAY_MS)
}

// In grace = requested but not yet executed. A tombstone has deleted_at set
// and is no longer pending: there is nobody left to restrict.
export function isPendingDeletion(p: {
  deletion_requested_at: string | null
  deleted_at: string | null
}): boolean {
  return p.deletion_requested_at !== null && p.deleted_at === null
}
