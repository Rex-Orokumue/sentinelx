import { describe, it, expect } from 'vitest'
import { buildAccountSnapshot } from './account-snapshot'

const PLAYER_ID = 'p1'

describe('buildAccountSnapshot', () => {
  it('resolves the opponent as player_b when the requester is player_a', () => {
    const snapshot = buildAccountSnapshot({
      playerId: PLAYER_ID,
      matches: [
        {
          status: 'scheduled',
          scheduled_at: '2026-09-01T10:00:00Z',
          player_a_id: PLAYER_ID,
          player_b_id: 'p2',
          player_a: { username: 'me', display_name: null },
          player_b: { username: 'rival', display_name: 'Rival Player' },
          tournament: { title: 'DLS Cup' },
        },
      ],
      registrations: [],
      walletBalance: 0,
      sxCoinBalance: 0,
      profile: null,
      kycStatus: 'not_started',
      withdrawals: [],
      friendlyMatches: [],
      unreadNotificationCount: 0,
    })
    expect(snapshot.upcomingMatches).toEqual([
      { opponentName: 'Rival Player', scheduledAt: '2026-09-01T10:00:00Z', tournamentName: 'DLS Cup', status: 'scheduled' },
    ])
  })

  it('resolves the opponent as player_a when the requester is player_b', () => {
    const snapshot = buildAccountSnapshot({
      playerId: PLAYER_ID,
      matches: [
        {
          status: 'live',
          scheduled_at: null,
          player_a_id: 'p2',
          player_b_id: PLAYER_ID,
          player_a: { username: 'rival', display_name: null },
          player_b: { username: 'me', display_name: null },
          tournament: [{ title: 'DLS Cup' }], // Supabase sometimes returns a single-embed as an array
        },
      ],
      registrations: [],
      walletBalance: 0,
      sxCoinBalance: 0,
      profile: null,
      kycStatus: 'not_started',
      withdrawals: [],
      friendlyMatches: [],
      unreadNotificationCount: 0,
    })
    expect(snapshot.upcomingMatches[0].opponentName).toBe('rival')
    expect(snapshot.upcomingMatches[0].tournamentName).toBe('DLS Cup')
  })

  it('falls back to "Opponent"/"Tournament" when the embed is null', () => {
    const snapshot = buildAccountSnapshot({
      playerId: PLAYER_ID,
      matches: [
        {
          status: 'scheduled',
          scheduled_at: null,
          player_a_id: PLAYER_ID,
          player_b_id: 'p2',
          player_a: null,
          player_b: null,
          tournament: null,
        },
      ],
      registrations: [],
      walletBalance: 0,
      sxCoinBalance: 0,
      profile: null,
      kycStatus: 'not_started',
      withdrawals: [],
      friendlyMatches: [],
      unreadNotificationCount: 0,
    })
    expect(snapshot.upcomingMatches[0].opponentName).toBe('Opponent')
    expect(snapshot.upcomingMatches[0].tournamentName).toBe('Tournament')
  })

  it('defaults sx_score/tier/membership_tier when profile is null', () => {
    const snapshot = buildAccountSnapshot({
      playerId: PLAYER_ID,
      matches: [],
      registrations: [],
      walletBalance: 0,
      sxCoinBalance: 0,
      profile: null,
      kycStatus: 'not_started',
      withdrawals: [],
      friendlyMatches: [],
      unreadNotificationCount: 0,
    })
    expect(snapshot.sxScore).toBe(700)
    expect(snapshot.sxTier).toBeNull()
    expect(snapshot.membershipTier).toBe('rookie')
  })

  it('formats wallet balance and withdrawal amounts as naira', () => {
    const snapshot = buildAccountSnapshot({
      playerId: PLAYER_ID,
      matches: [],
      registrations: [],
      walletBalance: 12500,
      sxCoinBalance: 300,
      profile: { sx_score: 820, sentinel_tier: 'trusted', membership_tier: 'pro' },
      kycStatus: 'verified',
      withdrawals: [{ amount: 5000, status: 'paid', requested_at: '2026-08-01T00:00:00Z' }],
      friendlyMatches: [],
      unreadNotificationCount: 2,
    })
    expect(snapshot.walletBalanceNaira).toBe('₦12,500')
    expect(snapshot.recentWithdrawals).toEqual([{ amountNaira: '₦5,000', status: 'paid', requestedAt: '2026-08-01T00:00:00Z' }])
    expect(snapshot.sxCoinBalance).toBe(300)
    expect(snapshot.sxTier).toBe('trusted')
    expect(snapshot.membershipTier).toBe('pro')
    expect(snapshot.unreadNotificationCount).toBe(2)
  })

  it('resolves friendly-match opponent from either side and formats a null stake as null', () => {
    const snapshot = buildAccountSnapshot({
      playerId: PLAYER_ID,
      matches: [],
      registrations: [],
      walletBalance: 0,
      sxCoinBalance: 0,
      profile: null,
      kycStatus: 'not_started',
      withdrawals: [],
      friendlyMatches: [
        {
          challenger_id: PLAYER_ID,
          opponent_id: 'p3',
          status: 'active',
          stake_amount: null,
          challenger: { username: 'me', display_name: null },
          opponent: { username: 'buddy', display_name: null },
        },
      ],
      unreadNotificationCount: 0,
    })
    expect(snapshot.friendlyMatches).toEqual([{ opponentName: 'buddy', status: 'active', stakeAmountNaira: null }])
  })
})
