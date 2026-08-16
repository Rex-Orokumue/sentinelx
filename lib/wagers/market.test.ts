import { describe, it, expect } from 'vitest'
import { wagerWindowOpen, estimateWagerPayout, WAGER_FEE_RATE } from './market'

describe('wagerWindowOpen', () => {
  const base = { status: 'scheduled', scheduled_at: '2026-08-10T18:00:00Z', player_a_id: 'a', player_b_id: 'b', is_full_day: false }

  it('is open more than 15 minutes before scheduled_at', () => {
    expect(wagerWindowOpen(base, new Date('2026-08-10T17:00:00Z'))).toBe(true)
  })

  it('closes exactly 15 minutes before scheduled_at', () => {
    expect(wagerWindowOpen(base, new Date('2026-08-10T17:45:00Z'))).toBe(false)
    expect(wagerWindowOpen(base, new Date('2026-08-10T17:44:00Z'))).toBe(true)
  })

  it('is closed once the match is no longer scheduled', () => {
    expect(wagerWindowOpen({ ...base, status: 'live' }, new Date('2026-08-10T17:00:00Z'))).toBe(false)
  })

  it('is closed when either player slot is unassigned (bye/TBD)', () => {
    expect(wagerWindowOpen({ ...base, player_b_id: null }, new Date('2026-08-10T17:00:00Z'))).toBe(false)
  })

  it('is closed when no scheduled_at is set yet', () => {
    expect(wagerWindowOpen({ ...base, scheduled_at: null }, new Date())).toBe(false)
  })

  it('stays open through the full play day for a full-day match, closing at day end', () => {
    const match = {
      status: 'scheduled',
      player_a_id: 'a',
      player_b_id: 'b',
      scheduled_at: '2026-08-16T00:00:00Z', // midnight WAT start-of-day, is_full_day
      is_full_day: true,
    }
    // Mid-afternoon on the play day — a naive "scheduled_at - 15min" check
    // would already read this as closed; the full-day carve-out must not.
    expect(wagerWindowOpen(match, new Date('2026-08-16T14:00:00Z'))).toBe(true)
    // After the day ends, it's closed.
    expect(wagerWindowOpen(match, new Date('2026-08-17T00:00:01Z'))).toBe(false)
  })

  it('still applies the 15-minute pre-kickoff close for a non-full-day match', () => {
    const match = {
      status: 'scheduled',
      player_a_id: 'a',
      player_b_id: 'b',
      scheduled_at: '2026-08-16T18:00:00Z',
      is_full_day: false,
    }
    expect(wagerWindowOpen(match, new Date('2026-08-16T17:44:00Z'))).toBe(true)
    expect(wagerWindowOpen(match, new Date('2026-08-16T17:46:00Z'))).toBe(false)
  })
})

describe('estimateWagerPayout', () => {
  it('returns stake-back only when the other side has no pool', () => {
    expect(estimateWagerPayout({ playerA: 0, playerB: 0 }, 'player_a', 100)).toBe(100)
  })

  it('estimates a fee-adjusted payout against the current opposing pool', () => {
    // otherPool 200, thisPool after adding stake = 0 + 100 = 100
    // 100 + floor(200 * 0.95 * (100/100)) = 100 + 190 = 290
    expect(estimateWagerPayout({ playerA: 0, playerB: 200 }, 'player_a', 100)).toBe(290)
  })
})

describe('WAGER_FEE_RATE', () => {
  it('is 5%', () => {
    expect(WAGER_FEE_RATE).toBe(0.05)
  })
})
