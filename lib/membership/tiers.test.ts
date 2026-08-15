import { describe, it, expect } from 'vitest'
import { computeTier, TIER_XP_THRESHOLDS } from './tiers'

describe('computeTier', () => {
  it('is recruit below 1,000 xp', () => {
    expect(computeTier(0)).toBe('recruit')
    expect(computeTier(999)).toBe('recruit')
  })
  it('is guardian from 1,000 xp', () => {
    expect(computeTier(1000)).toBe('guardian')
    expect(computeTier(4999)).toBe('guardian')
  })
  it('is elite from 5,000 xp', () => {
    expect(computeTier(5000)).toBe('elite')
    expect(computeTier(14999)).toBe('elite')
  })
  it('is sentinel from 15,000 xp', () => {
    expect(computeTier(15000)).toBe('sentinel')
    expect(computeTier(49999)).toBe('sentinel')
  })
  it('is legend from 50,000 xp', () => {
    expect(computeTier(50000)).toBe('legend')
    expect(computeTier(1_000_000)).toBe('legend')
  })
  it('exposes the thresholds used', () => {
    expect(TIER_XP_THRESHOLDS.legend).toBe(50_000)
  })
})
