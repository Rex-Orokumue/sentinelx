import { describe, it, expect } from 'vitest'
import { formatNaira, formatNairaCompact, formatCompactNumber, fromDateLocal, todayDateLocal, formatFixtureDate, dayKeyWAT, formatDateDivider } from './format'

describe('formatNaira', () => {
  it('prepends ₦ and groups thousands', () => {
    expect(formatNaira(1000)).toBe('₦1,000')
    expect(formatNaira(50000)).toBe('₦50,000')
    expect(formatNaira(0)).toBe('₦0')
  })
})

describe('formatCompactNumber', () => {
  it('leaves sub-1000 values as plain digits', () => {
    expect(formatCompactNumber(0)).toBe('0')
    expect(formatCompactNumber(999)).toBe('999')
  })

  it('abbreviates thousands and millions to one decimal place', () => {
    expect(formatCompactNumber(1000)).toBe('1K')
    expect(formatCompactNumber(1450)).toBe('1.5K')
    expect(formatCompactNumber(24500)).toBe('24.5K')
    expect(formatCompactNumber(1000000)).toBe('1M')
  })
})

describe('formatNairaCompact', () => {
  it('prepends ₦ to the compact form — for the header balance chip on mobile, where a full ₦24,500 pill would overflow', () => {
    expect(formatNairaCompact(24500)).toBe('₦24.5K')
    expect(formatNairaCompact(0)).toBe('₦0')
  })
})

describe('fromDateLocal', () => {
  it('converts a WAT calendar date to its UTC midnight instant', () => {
    // Midnight WAT (UTC+1) on 2026-07-14 is 23:00 UTC on 2026-07-13.
    expect(fromDateLocal('2026-07-14')).toBe('2026-07-13T23:00:00.000Z')
  })

  it('returns null for empty input', () => {
    expect(fromDateLocal('')).toBeNull()
    expect(fromDateLocal(null)).toBeNull()
    expect(fromDateLocal(undefined)).toBeNull()
  })

  it('returns null for invalid input', () => {
    expect(fromDateLocal('not-a-date')).toBeNull()
  })
})

describe('todayDateLocal', () => {
  it('returns a YYYY-MM-DD string', () => {
    expect(todayDateLocal()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('formatFixtureDate', () => {
  it('returns date-only for a full-day match', () => {
    expect(formatFixtureDate('2026-07-27T23:00:00.000Z', true)).toBe('28 Jul 2026')
  })

  it('returns date + time for a timed match', () => {
    expect(formatFixtureDate('2026-07-08T19:00:00.000Z', false)).toBe('8 Jul, 20:00')
  })

  it('returns null for missing input regardless of isFullDay', () => {
    expect(formatFixtureDate(null, true)).toBeNull()
    expect(formatFixtureDate(null, false)).toBeNull()
    expect(formatFixtureDate(undefined, true)).toBeNull()
  })
})

describe('dayKeyWAT', () => {
  it('keys by the WAT calendar day, not the UTC one', () => {
    // 23:30 UTC on the 13th is 00:30 WAT on the 14th.
    expect(dayKeyWAT('2026-07-13T23:30:00.000Z')).toBe('2026-07-14')
  })

  it('returns null for missing/invalid input', () => {
    expect(dayKeyWAT(null)).toBeNull()
    expect(dayKeyWAT(undefined)).toBeNull()
    expect(dayKeyWAT('not-a-date')).toBeNull()
  })
})

describe('formatDateDivider', () => {
  const now = '2026-07-14T12:00:00.000Z' // midday WAT on the 14th

  it('labels the same WAT day as "Today"', () => {
    expect(formatDateDivider('2026-07-14T06:00:00.000Z', now)).toBe('Today')
  })

  it('labels the previous WAT day as "Yesterday"', () => {
    expect(formatDateDivider('2026-07-13T22:00:00.000Z', now)).toBe('Yesterday')
  })

  it('falls back to a full date further back', () => {
    expect(formatDateDivider('2026-07-01T12:00:00.000Z', now)).toBe('1 Jul 2026')
  })

  it('returns null for missing/invalid input', () => {
    expect(formatDateDivider(null, now)).toBeNull()
    expect(formatDateDivider(undefined, now)).toBeNull()
  })
})
