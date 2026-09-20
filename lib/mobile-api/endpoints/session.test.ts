import { describe, it, expect } from 'vitest'
import { toSessionStartResponse } from './session'

describe('toSessionStartResponse', () => {
  it('splits deletionRequestedAt out of the daily-login result', () => {
    expect(toSessionStartResponse({
      awardedToday: true, coinsAwarded: 55, xpAwarded: 120, streak: 7, milestone: 'week',
      deletionRequestedAt: '2026-09-10T00:00:00Z',
    })).toEqual({
      dailyLogin: { awardedToday: true, coinsAwarded: 55, xpAwarded: 120, streak: 7, milestone: 'week' },
      deletionRequestedAt: '2026-09-10T00:00:00Z',
    })
  })

  it('reports awardedToday:false with a null deletionRequestedAt untouched', () => {
    expect(toSessionStartResponse({
      awardedToday: false, coinsAwarded: 0, xpAwarded: 0, streak: 3, milestone: null, deletionRequestedAt: null,
    })).toEqual({
      dailyLogin: { awardedToday: false, coinsAwarded: 0, xpAwarded: 0, streak: 3, milestone: null },
      deletionRequestedAt: null,
    })
  })
})
