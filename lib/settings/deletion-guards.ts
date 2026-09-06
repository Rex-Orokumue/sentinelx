// Pure guard over already-fetched counts, in the style of
// lib/tournaments/guard.ts checkCanRegister. Returns every blocker rather than
// the first, so the UI can render a remedy per item instead of making the user
// discover them one deletion attempt at a time.
export type DeletionBlocker =
  | { code: 'wallet_balance'; amount: number }
  | { code: 'pending_withdrawal'; count: number }
  | { code: 'open_escrow_order'; count: number }
  | { code: 'active_listing'; count: number }
  | { code: 'active_tournament'; count: number }
  | { code: 'unfinished_match'; count: number }
  | { code: 'unfinished_friendly'; count: number }

export interface DeletionGuardInput {
  walletBalance: number
  pendingWithdrawals: number
  openEscrowOrders: number
  activeListings: number
  activeTournaments: number
  unfinishedMatches: number
  unfinishedFriendlies: number
}

// SX Coins are deliberately absent: they are non-cashable, so they are
// forfeited on deletion rather than blocking it.
export function checkCanDelete(input: DeletionGuardInput): DeletionBlocker[] {
  const blockers: DeletionBlocker[] = []
  if (input.walletBalance > 0) {
    blockers.push({ code: 'wallet_balance', amount: input.walletBalance })
  }
  if (input.pendingWithdrawals > 0) {
    blockers.push({ code: 'pending_withdrawal', count: input.pendingWithdrawals })
  }
  if (input.openEscrowOrders > 0) {
    blockers.push({ code: 'open_escrow_order', count: input.openEscrowOrders })
  }
  if (input.activeListings > 0) {
    blockers.push({ code: 'active_listing', count: input.activeListings })
  }
  if (input.activeTournaments > 0) {
    blockers.push({ code: 'active_tournament', count: input.activeTournaments })
  }
  if (input.unfinishedMatches > 0) {
    blockers.push({ code: 'unfinished_match', count: input.unfinishedMatches })
  }
  if (input.unfinishedFriendlies > 0) {
    blockers.push({ code: 'unfinished_friendly', count: input.unfinishedFriendlies })
  }
  return blockers
}
