import { describe, it, expect } from 'vitest'
import { formatCountdown } from './countdown'

// now = 2026-08-15T10:00:00Z = 11:00 WAT
const NOW = new Date('2026-08-15T10:00:00Z')

describe('formatCountdown', () => {
  it('shows minutes under an hour away', () => {
    expect(formatCountdown('2026-08-15T10:30:00Z', NOW)).toBe('In 30m')
  })
  it('shows hours and minutes under 6h away', () => {
    expect(formatCountdown('2026-08-15T11:30:00Z', NOW)).toBe('In 1h 30m')
  })
  it('drops the minutes when exactly on the hour', () => {
    expect(formatCountdown('2026-08-15T12:00:00Z', NOW)).toBe('In 2h')
  })
  it('shows "Today <time>" for later today (WAT), 6h+ away', () => {
    // 2026-08-15T21:00:00Z = 22:00 WAT, still 15 Aug in WAT
    expect(formatCountdown('2026-08-15T21:00:00Z', NOW)).toBe('Today 10:00 PM')
  })
  it('shows "Tomorrow <time>" for the next WAT calendar day', () => {
    // 2026-08-16T19:00:00Z = 20:00 WAT on 16 Aug
    expect(formatCountdown('2026-08-16T19:00:00Z', NOW)).toBe('Tomorrow 8:00 PM')
  })
  it('falls back to a plain date further out', () => {
    expect(formatCountdown('2026-08-20T19:00:00Z', NOW)).toBe('20 Aug 2026')
  })
  it('shows "Starting soon" once the scheduled time has passed', () => {
    expect(formatCountdown('2026-08-15T09:00:00Z', NOW)).toBe('Starting soon')
  })
})
