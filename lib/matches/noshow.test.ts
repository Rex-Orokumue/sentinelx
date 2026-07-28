import { describe, it, expect } from 'vitest'
import { noShowDeadlinePassed } from './noshow'

describe('noShowDeadlinePassed', () => {
  it('is false while still within the scheduled WAT day', () => {
    // 2026-07-10 15:00 WAT = 2026-07-10T14:00:00Z
    expect(noShowDeadlinePassed('2026-07-10T14:00:00Z', new Date('2026-07-10T20:00:00Z'))).toBe(false)
  })
  it('is false right before the WAT-day boundary (23:59:59 WAT)', () => {
    expect(noShowDeadlinePassed('2026-07-10T08:00:00Z', new Date('2026-07-10T22:59:59Z'))).toBe(false)
  })
  it('is true exactly at midnight WAT the next day', () => {
    // midnight WAT on 2026-07-11 = 2026-07-10T23:00:00Z
    expect(noShowDeadlinePassed('2026-07-10T08:00:00Z', new Date('2026-07-10T23:00:00Z'))).toBe(true)
  })
  it('is true well after the deadline', () => {
    expect(noShowDeadlinePassed('2026-07-10T08:00:00Z', new Date('2026-07-15T00:00:00Z'))).toBe(true)
  })
  it('is false for a missing scheduled time', () => {
    expect(noShowDeadlinePassed(null, new Date())).toBe(false)
  })
})
