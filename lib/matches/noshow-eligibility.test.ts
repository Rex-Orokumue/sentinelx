import { describe, it, expect } from 'vitest'
import { canMarkBothNoShow } from './noshow-eligibility'

describe('canMarkBothNoShow', () => {
  it('is true for a flagged scheduled match with no submissions', () => {
    expect(
      canMarkBothNoShow({ status: 'scheduled', noshowFlaggedAt: '2026-07-29T00:00:00Z', submissionCount: 0 }),
    ).toBe(true)
  })
  it('is true for a flagged live match with no submissions', () => {
    expect(
      canMarkBothNoShow({ status: 'live', noshowFlaggedAt: '2026-07-29T00:00:00Z', submissionCount: 0 }),
    ).toBe(true)
  })
  it('is false when the match has not been flagged yet', () => {
    expect(canMarkBothNoShow({ status: 'scheduled', noshowFlaggedAt: null, submissionCount: 0 })).toBe(false)
  })
  it('is false when a result has been submitted, even if flagged', () => {
    expect(
      canMarkBothNoShow({ status: 'scheduled', noshowFlaggedAt: '2026-07-29T00:00:00Z', submissionCount: 1 }),
    ).toBe(false)
  })
  it('is false once the match is no longer scheduled/live', () => {
    expect(
      canMarkBothNoShow({ status: 'completed', noshowFlaggedAt: '2026-07-29T00:00:00Z', submissionCount: 0 }),
    ).toBe(false)
  })
})
