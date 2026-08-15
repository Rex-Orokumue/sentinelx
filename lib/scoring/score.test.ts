import { describe, it, expect } from 'vitest'
import { computeScore, BASE_SCORE } from './score'

describe('computeScore', () => {
  it('returns the base score (700) for an empty log', () => {
    expect(BASE_SCORE).toBe(700)
    expect(computeScore([])).toBe(700)
  })

  it('adds stored deltas to the base', () => {
    expect(computeScore([{ points_delta: 20 }, { points_delta: 10 }])).toBe(730)
  })

  it('handles negative and mixed deltas', () => {
    expect(computeScore([{ points_delta: 20 }, { points_delta: -80 }, { points_delta: 10 }])).toBe(650)
  })

  it('has no upper cap', () => {
    expect(computeScore([{ points_delta: 5000 }])).toBe(5700)
  })

  it('clamps at 0', () => {
    expect(computeScore([{ points_delta: -1000 }])).toBe(0)
  })
})
