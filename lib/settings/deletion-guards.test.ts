import { describe, it, expect } from 'vitest'
import { checkCanDelete, type DeletionGuardInput } from './deletion-guards'

const clear: DeletionGuardInput = {
  walletBalance: 0,
  pendingWithdrawals: 0,
  openEscrowOrders: 0,
  activeListings: 0,
  activeTournaments: 0,
  unfinishedMatches: 0,
  unfinishedFriendlies: 0,
}

describe('checkCanDelete', () => {
  it('allows deletion when nothing is outstanding', () => {
    expect(checkCanDelete(clear)).toEqual([])
  })

  it('blocks on a wallet balance', () => {
    expect(checkCanDelete({ ...clear, walletBalance: 4500 })).toEqual([
      { code: 'wallet_balance', amount: 4500 },
    ])
  })

  it('blocks on a pending withdrawal', () => {
    expect(checkCanDelete({ ...clear, pendingWithdrawals: 1 })).toEqual([
      { code: 'pending_withdrawal', count: 1 },
    ])
  })

  it('blocks on an open escrow order', () => {
    expect(checkCanDelete({ ...clear, openEscrowOrders: 2 })).toEqual([
      { code: 'open_escrow_order', count: 2 },
    ])
  })

  it('blocks on a live listing', () => {
    expect(checkCanDelete({ ...clear, activeListings: 1 })).toEqual([
      { code: 'active_listing', count: 1 },
    ])
  })

  it('blocks on an active tournament', () => {
    expect(checkCanDelete({ ...clear, activeTournaments: 1 })).toEqual([
      { code: 'active_tournament', count: 1 },
    ])
  })

  it('blocks on an unfinished match', () => {
    expect(checkCanDelete({ ...clear, unfinishedMatches: 3 })).toEqual([
      { code: 'unfinished_match', count: 3 },
    ])
  })

  it('blocks on an unfinished friendly', () => {
    expect(checkCanDelete({ ...clear, unfinishedFriendlies: 1 })).toEqual([
      { code: 'unfinished_friendly', count: 1 },
    ])
  })

  // The UI renders one remedy per blocker, so they accumulate rather than
  // short-circuiting on the first.
  it('accumulates every blocker, in a stable order', () => {
    const result = checkCanDelete({
      ...clear,
      walletBalance: 500,
      activeTournaments: 1,
      openEscrowOrders: 1,
    })
    expect(result.map((b) => b.code)).toEqual([
      'wallet_balance',
      'open_escrow_order',
      'active_tournament',
    ])
  })

  // A negative balance would be a bug elsewhere, but it must not read as
  // "has money" and trap the user in an undeletable account.
  it('does not block on a zero or negative balance', () => {
    expect(checkCanDelete({ ...clear, walletBalance: 0 })).toEqual([])
    expect(checkCanDelete({ ...clear, walletBalance: -100 })).toEqual([])
  })
})
