import { describe, it, expect } from 'vitest'
import { bettingOpen, impliedPayoutMultiplier, RAKE_RATE } from './market'

describe('bettingOpen', () => {
  const base = { status: 'scheduled', scheduled_at: '2026-08-10T18:00:00Z', betting_locked: false, is_full_day: false }

  it('is open before scheduled_at', () => {
    expect(bettingOpen(base, new Date('2026-08-10T17:00:00Z'))).toBe(true)
  })

  it('is closed at or after scheduled_at', () => {
    expect(bettingOpen(base, new Date('2026-08-10T18:00:00Z'))).toBe(false)
    expect(bettingOpen(base, new Date('2026-08-10T19:00:00Z'))).toBe(false)
  })

  it('is closed when betting_locked is true, even before scheduled_at', () => {
    expect(bettingOpen({ ...base, betting_locked: true }, new Date('2026-08-10T17:00:00Z'))).toBe(false)
  })

  it('is closed when match status is not scheduled', () => {
    expect(bettingOpen({ ...base, status: 'live' }, new Date('2026-08-10T17:00:00Z'))).toBe(false)
    expect(bettingOpen({ ...base, status: 'completed' }, new Date('2026-08-10T17:00:00Z'))).toBe(false)
  })

  it('is open when scheduled_at is not yet set', () => {
    expect(bettingOpen({ ...base, scheduled_at: null }, new Date())).toBe(true)
  })

  // scheduled_at for a full-day match is midnight WAT (the START of the
  // match day, per lib/tournaments/round-schedule.ts), not a kickoff
  // instant — players can play any time during that day. Locking at
  // scheduled_at itself would close betting before the day's play window
  // has even begun.
  describe('full-day matches', () => {
    const fullDay = { ...base, is_full_day: true }

    it('stays open through the scheduled day, past scheduled_at itself', () => {
      // scheduled_at is 2026-08-10T18:00:00Z (midnight WAT going into Aug 10
      // in this fixture) — an hour after that instant, the match's actual
      // play window has barely started.
      expect(bettingOpen(fullDay, new Date('2026-08-10T19:00:00Z'))).toBe(true)
    })

    it('closes at the end of the scheduled day (scheduled_at + 24h)', () => {
      expect(bettingOpen(fullDay, new Date('2026-08-11T18:00:00Z'))).toBe(false)
    })

    it('is still open one minute before the day ends', () => {
      expect(bettingOpen(fullDay, new Date('2026-08-11T17:59:00Z'))).toBe(true)
    })
  })
})

describe('impliedPayoutMultiplier', () => {
  it('returns null when this side has no pool yet', () => {
    expect(impliedPayoutMultiplier({ playerA: 0, playerB: 500 }, 'player_a')).toBeNull()
  })

  it('returns 1 (stake-back only) when the other side has no pool', () => {
    expect(impliedPayoutMultiplier({ playerA: 500, playerB: 0 }, 'player_a')).toBe(1)
  })

  it('computes the rake-adjusted multiplier for an even pool split', () => {
    // otherPool 1000, thisPool 1000: 1 + (1000 * 0.9) / 1000 = 1.9
    expect(impliedPayoutMultiplier({ playerA: 1000, playerB: 1000 }, 'player_a')).toBeCloseTo(1.9)
  })

  it('gives the smaller side a higher multiplier (underdog pays more)', () => {
    const pools = { playerA: 200, playerB: 800 }
    const underdog = impliedPayoutMultiplier(pools, 'player_a')!
    const favorite = impliedPayoutMultiplier(pools, 'player_b')!
    expect(underdog).toBeGreaterThan(favorite)
  })
})

describe('RAKE_RATE', () => {
  it('is 10%', () => {
    expect(RAKE_RATE).toBe(0.10)
  })
})
