import { describe, it, expect } from 'vitest'
import { prefillScore } from './verify'

describe('prefillScore', () => {
  it('pre-fills when both submissions agree', () => {
    expect(prefillScore({ scoreA: 2, scoreB: 1 }, { scoreA: 2, scoreB: 1 })).toEqual({ scoreA: 2, scoreB: 1 })
  })
  it('returns null when submissions disagree (no anchoring)', () => {
    expect(prefillScore({ scoreA: 2, scoreB: 1 }, { scoreA: 1, scoreB: 1 })).toBeNull()
  })
  it('pre-fills from the only submission', () => {
    expect(prefillScore({ scoreA: 3, scoreB: 0 }, null)).toEqual({ scoreA: 3, scoreB: 0 })
    expect(prefillScore(null, { scoreA: 0, scoreB: 4 })).toEqual({ scoreA: 0, scoreB: 4 })
  })
  it('returns null when there are no submissions', () => {
    expect(prefillScore(null, null)).toBeNull()
  })
})
