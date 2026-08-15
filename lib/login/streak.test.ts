import { describe, it, expect } from 'vitest'
import { todayInWAT, nextLoginState } from './streak'

describe('todayInWAT', () => {
  it('rolls over at UTC+1 midnight, not UTC midnight', () => {
    // 23:30 UTC on Jan 1 is 00:30 WAT on Jan 2.
    expect(todayInWAT(new Date('2026-01-01T23:30:00Z'))).toBe('2026-01-02')
    expect(todayInWAT(new Date('2026-01-01T22:30:00Z'))).toBe('2026-01-01')
  })
})

describe('nextLoginState', () => {
  it('is a no-op the second time the same WAT day is recorded', () => {
    const state = nextLoginState({ lastLoginDate: '2026-01-02', loginStreak: 3, now: new Date('2026-01-01T23:30:00Z') })
    expect(state).toEqual({ alreadyLoggedToday: true, newStreak: 3, todayWAT: '2026-01-02' })
  })

  it('increments the streak on a consecutive day', () => {
    const state = nextLoginState({ lastLoginDate: '2026-01-01', loginStreak: 3, now: new Date('2026-01-02T10:00:00Z') })
    expect(state).toEqual({ alreadyLoggedToday: false, newStreak: 4, todayWAT: '2026-01-02' })
  })

  it('resets the streak to 1 after a gap', () => {
    const state = nextLoginState({ lastLoginDate: '2026-01-01', loginStreak: 5, now: new Date('2026-01-05T10:00:00Z') })
    expect(state).toEqual({ alreadyLoggedToday: false, newStreak: 1, todayWAT: '2026-01-05' })
  })

  it('starts a streak of 1 for a never-logged-in player', () => {
    const state = nextLoginState({ lastLoginDate: null, loginStreak: 0, now: new Date('2026-01-05T10:00:00Z') })
    expect(state).toEqual({ alreadyLoggedToday: false, newStreak: 1, todayWAT: '2026-01-05' })
  })
})
