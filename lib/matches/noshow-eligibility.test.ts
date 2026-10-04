import { describe, it, expect } from 'vitest'
import { canMarkBothNoShow, mutualNoShowNotice } from './noshow-eligibility'

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

describe('mutualNoShowNotice', () => {
  it('confirms a knockout mutual no-show (forfeited) and quotes the admin note', () => {
    expect(mutualNoShowNotice({ status: 'forfeited', resolution: null, adminNote: 'Neither squad replied.' })).toBe(
      'Marked as a mutual no-show — both sides take the no-show penalty. Note: Neither squad replied.',
    )
  })
  it('confirms a group mutual no-show (0-0 no_show_draw)', () => {
    expect(mutualNoShowNotice({ status: 'completed', resolution: 'no_show_draw', adminNote: null })).toBe(
      'Marked as a mutual no-show — both sides take the no-show penalty.',
    )
  })
  it('says nothing for an ordinary completed or live match', () => {
    expect(mutualNoShowNotice({ status: 'completed', resolution: 'walkover', adminNote: 'x' })).toBeNull()
    expect(mutualNoShowNotice({ status: 'completed', resolution: null, adminNote: null })).toBeNull()
    expect(mutualNoShowNotice({ status: 'scheduled', resolution: null, adminNote: null })).toBeNull()
  })
})
