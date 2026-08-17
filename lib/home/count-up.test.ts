import { describe, it, expect } from 'vitest'
import { computeCountUpValue } from './count-up'

describe('computeCountUpValue', () => {
  it('returns 0 at the start', () => {
    expect(computeCountUpValue(0, 1000, 500)).toBe(0)
  })

  it('returns the target once elapsed reaches the duration', () => {
    expect(computeCountUpValue(1000, 1000, 500)).toBe(500)
  })

  it('clamps to the target when elapsed exceeds the duration', () => {
    expect(computeCountUpValue(5000, 1000, 500)).toBe(500)
  })

  it('returns the target immediately when duration is zero or negative', () => {
    expect(computeCountUpValue(0, 0, 500)).toBe(500)
    expect(computeCountUpValue(100, -50, 500)).toBe(500)
  })

  it('eases out — more than half the value is covered by the midpoint', () => {
    const halfway = computeCountUpValue(500, 1000, 1000)
    expect(halfway).toBeGreaterThan(500)
  })
})
