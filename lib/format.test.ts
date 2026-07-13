import { describe, it, expect } from 'vitest'
import { formatNaira, fromDateLocal } from './format'

describe('formatNaira', () => {
  it('prepends ₦ and groups thousands', () => {
    expect(formatNaira(1000)).toBe('₦1,000')
    expect(formatNaira(50000)).toBe('₦50,000')
    expect(formatNaira(0)).toBe('₦0')
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
