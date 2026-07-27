import { describe, it, expect } from 'vitest'
import { addRoundGapDays, computeNextRoundDate } from './round-schedule'

describe('addRoundGapDays', () => {
  it('returns the same instant for 0 days', () => {
    expect(addRoundGapDays('2026-07-13T23:00:00.000Z', 0)).toBe('2026-07-13T23:00:00.000Z')
  })

  it('adds whole calendar days to a midnight-WAT instant', () => {
    // 2026-07-13T23:00:00Z is midnight WAT on 2026-07-14; +1 day lands on
    // midnight WAT 2026-07-15, i.e. 2026-07-14T23:00:00Z.
    expect(addRoundGapDays('2026-07-13T23:00:00.000Z', 1)).toBe('2026-07-14T23:00:00.000Z')
    expect(addRoundGapDays('2026-07-13T23:00:00.000Z', 3)).toBe('2026-07-16T23:00:00.000Z')
  })
})

describe('computeNextRoundDate', () => {
  it('returns round_start_date unmodified when no rounds exist yet', () => {
    expect(computeNextRoundDate('2026-07-14', 1, 0)).toBe('2026-07-13T23:00:00.000Z')
  })

  it('adds gap_days once per already-generated round', () => {
    expect(computeNextRoundDate('2026-07-14', 2, 1)).toBe('2026-07-15T23:00:00.000Z')
    expect(computeNextRoundDate('2026-07-14', 2, 3)).toBe('2026-07-19T23:00:00.000Z')
  })

  it('throws for an invalid round_start_date', () => {
    expect(() => computeNextRoundDate('not-a-date', 1, 0)).toThrow()
  })
})
