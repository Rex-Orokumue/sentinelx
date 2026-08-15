import { describe, it, expect } from 'vitest'
import { currentWeekStart } from './challenges'

describe('currentWeekStart', () => {
  it('returns the same Monday for any day within that week (WAT)', () => {
    // Mon 10 Aug 2026 00:00 WAT .. Sun 16 Aug 2026 23:59 WAT all share
    // Monday 10 Aug as their week_start.
    const monday = new Date('2026-08-10T00:30:00+01:00')
    const wednesday = new Date('2026-08-12T12:00:00+01:00')
    const sunday = new Date('2026-08-16T22:30:00+01:00')
    expect(currentWeekStart(monday)).toBe('2026-08-10')
    expect(currentWeekStart(wednesday)).toBe('2026-08-10')
    expect(currentWeekStart(sunday)).toBe('2026-08-10')
  })

  it('rolls a Sunday back to the Monday that started its week, not forward', () => {
    const sunday = new Date('2026-08-16T10:00:00+01:00')
    expect(currentWeekStart(sunday)).toBe('2026-08-10')
  })

  it('crosses into the next week right at Monday 00:00 WAT', () => {
    const nextMonday = new Date('2026-08-17T00:00:01+01:00')
    expect(currentWeekStart(nextMonday)).toBe('2026-08-17')
  })
})
