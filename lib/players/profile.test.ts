import { describe, it, expect } from 'vitest'
import { winPercent, goalDifference, matchOutcome } from './profile'

describe('winPercent', () => {
  it('rounds wins over total to a percent', () => {
    expect(winPercent(2, 3)).toBe('67%')
    expect(winPercent(1, 1)).toBe('100%')
  })
  it('is 0% with no matches', () => {
    expect(winPercent(0, 0)).toBe('0%')
  })
})

describe('goalDifference', () => {
  it('subtracts conceded from scored', () => {
    expect(goalDifference(9, 4)).toBe(5)
    expect(goalDifference(2, 6)).toBe(-4)
  })
})

describe('matchOutcome', () => {
  const m = { player_a_id: 'A', player_b_id: 'B', score_a: 3, score_b: 1 }
  it('reads from the player perspective (A)', () => {
    expect(matchOutcome('A', m)).toBe('win')
  })
  it('reads from the player perspective (B)', () => {
    expect(matchOutcome('B', m)).toBe('loss')
  })
  it('detects a draw', () => {
    expect(matchOutcome('A', { ...m, score_a: 2, score_b: 2 })).toBe('draw')
  })
})
