import { describe, it, expect } from 'vitest'
import { pointsForRoundRobinRank, coinsForRoundRobinRank, xpForRoundRobinRank } from './round-robin-placement'

describe('pointsForRoundRobinRank', () => {
  it('awards the documented tiers', () => {
    expect(pointsForRoundRobinRank(1)).toBe(100)
    expect(pointsForRoundRobinRank(2)).toBe(70)
    expect(pointsForRoundRobinRank(3)).toBe(45)
    expect(pointsForRoundRobinRank(4)).toBe(45)
    expect(pointsForRoundRobinRank(5)).toBe(25)
    expect(pointsForRoundRobinRank(8)).toBe(25)
    expect(pointsForRoundRobinRank(9)).toBe(5)
    expect(pointsForRoundRobinRank(50)).toBe(5)
  })
})

describe('coinsForRoundRobinRank', () => {
  it('mirrors the bracket PLACEMENT_COINS anchors', () => {
    expect(coinsForRoundRobinRank(1)).toBe(500)
    expect(coinsForRoundRobinRank(2)).toBe(300)
    expect(coinsForRoundRobinRank(3)).toBe(150)
    expect(coinsForRoundRobinRank(4)).toBe(150)
    expect(coinsForRoundRobinRank(8)).toBe(75)
    expect(coinsForRoundRobinRank(9)).toBe(30)
    expect(coinsForRoundRobinRank(50)).toBe(10)
  })
})

describe('xpForRoundRobinRank', () => {
  it('mirrors the bracket PLACEMENT_XP anchors, zero beyond rank 8', () => {
    expect(xpForRoundRobinRank(1)).toBe(500)
    expect(xpForRoundRobinRank(2)).toBe(300)
    expect(xpForRoundRobinRank(3)).toBe(200)
    expect(xpForRoundRobinRank(4)).toBe(200)
    expect(xpForRoundRobinRank(8)).toBe(100)
    expect(xpForRoundRobinRank(9)).toBe(0)
  })
})
