// Guards for the admin "delete listing" / "mark listing sold" actions
// (lib/exchange/admin-actions.ts). Kept separate from admin-actions.ts
// because that file has a 'use server' directive, which only allows async
// server-action exports — these are plain synchronous helpers so they can
// be unit tested directly.

type GuardOrderStatus = 'initiated' | 'payment_held' | 'completed' | 'refunded'
const IN_PROGRESS_STATUSES: ReadonlySet<GuardOrderStatus> = new Set(['initiated', 'payment_held'])

/** True if the listing has any order at all — blocks permanent delete. */
export function hasAnyOrder(orderStatuses: string[]): boolean {
  return orderStatuses.length > 0
}

/** True if any order hasn't reached a terminal state — blocks manual mark-as-sold. */
export function hasInProgressOrder(orderStatuses: string[]): boolean {
  return orderStatuses.some((s) => IN_PROGRESS_STATUSES.has(s as GuardOrderStatus))
}
