import { describe, it, expect } from 'vitest'
import { computeScore, BASE_SCORE } from './score'

describe('computeScore', () => {
  it('returns the base score (70) for an empty log', () => {
    expect(BASE_SCORE).toBe(70)
    expect(computeScore([])).toBe(70)
  })

  it('adds stored deltas to the base', () => {
    expect(computeScore([{ points_delta: 2 }, { points_delta: 1 }])).toBe(73)
  })

  it('handles negative and mixed deltas', () => {
    expect(computeScore([{ points_delta: 2 }, { points_delta: -8 }, { points_delta: 1 }])).toBe(65)
  })

  it('clamps at 100', () => {
    expect(computeScore([{ points_delta: 40 }])).toBe(100)
  })

  it('clamps at 0', () => {
    expect(computeScore([{ points_delta: -100 }])).toBe(0)
  })
})
