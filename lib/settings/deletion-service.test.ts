import { describe, it, expect } from 'vitest'
import { toGuardInput } from './deletion-service'

describe('toGuardInput', () => {
  // Supabase count queries return null rather than 0 when a filter matches
  // nothing, and a null would read as "not a number" downstream rather than
  // "nothing outstanding".
  it('maps null counts to zero', () => {
    expect(
      toGuardInput({
        walletBalance: null,
        pendingWithdrawals: null,
        openEscrowOrders: null,
        activeListings: null,
        activeTournaments: null,
        unfinishedMatches: null,
        unfinishedFriendlies: null,
      }),
    ).toEqual({
      walletBalance: 0,
      pendingWithdrawals: 0,
      openEscrowOrders: 0,
      activeListings: 0,
      activeTournaments: 0,
      unfinishedMatches: 0,
      unfinishedFriendlies: 0,
    })
  })

  it('passes through real counts', () => {
    const result = toGuardInput({
      walletBalance: 4500,
      pendingWithdrawals: 1,
      openEscrowOrders: 0,
      activeListings: 2,
      activeTournaments: 1,
      unfinishedMatches: 3,
      unfinishedFriendlies: 0,
    })
    expect(result.walletBalance).toBe(4500)
    expect(result.activeListings).toBe(2)
    expect(result.unfinishedMatches).toBe(3)
  })

  it('preserves an explicit zero', () => {
    expect(toGuardInput({
      walletBalance: 0,
      pendingWithdrawals: 0,
      openEscrowOrders: 0,
      activeListings: 0,
      activeTournaments: 0,
      unfinishedMatches: 0,
      unfinishedFriendlies: 0,
    }).walletBalance).toBe(0)
  })
})
