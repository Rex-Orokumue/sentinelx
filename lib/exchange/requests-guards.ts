// Status-transition guards for buy_requests, mirroring the shape of
// lib/exchange/admin-guards.ts. Used both to gate the admin actions
// (lib/exchange/requests-admin-actions.ts) and to disable UI buttons for
// transitions that would be rejected server-side anyway.

export type BuyRequestStatus = 'open' | 'in_progress' | 'fulfilled' | 'closed'

const TERMINAL: ReadonlySet<BuyRequestStatus> = new Set<BuyRequestStatus>(['fulfilled', 'closed'])

/** What an admin may set NEXT, given the CURRENT status. */
export function canAdminSetStatus(current: BuyRequestStatus, next: BuyRequestStatus): boolean {
  if (TERMINAL.has(current)) return false
  if (current === next) return false
  if (next === 'in_progress') return current === 'open'
  if (next === 'fulfilled') return current === 'open' || current === 'in_progress'
  if (next === 'closed') return current === 'open' || current === 'in_progress'
  return false
}

/** The buyer may only cancel (open -> closed) while still open. */
export function canBuyerCancel(current: BuyRequestStatus): boolean {
  return current === 'open'
}
