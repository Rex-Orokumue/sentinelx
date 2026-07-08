import { describe, it, expect } from 'vitest'
import { computeGroupStats, collectAdvancers, type GroupMatchResult } from './results'

describe('computeGroupStats', () => {
  it('awards 3 for a win, 1 each for a draw, and tallies goals', () => {
    const matches: GroupMatchResult[] = [
      { playerAId: 'a', playerBId: 'b', scoreA: 2, scoreB: 1 }, // a wins
      { playerAId: 'a', playerBId: 'c', scoreA: 1, scoreB: 1 }, // draw
    ]
    const stats = computeGroupStats(['a', 'b', 'c'], matches)
    const a = stats.find((s) => s.playerId === 'a')!
    const b = stats.find((s) => s.playerId === 'b')!
    const c = stats.find((s) => s.playerId === 'c')!
    expect(a).toMatchObject({ points: 4, wins: 1, draws: 1, losses: 0, goalsFor: 3, goalsAgainst: 2 })
    expect(b).toMatchObject({ points: 0, wins: 0, draws: 0, losses: 1, goalsFor: 1, goalsAgainst: 2 })
    expect(c).toMatchObject({ points: 1, wins: 0, draws: 1, losses: 0, goalsFor: 1, goalsAgainst: 1 })
  })
  it('returns a zeroed row for a player with no matches', () => {
    const stats = computeGroupStats(['a', 'b'], [])
    expect(stats).toHaveLength(2)
    expect(stats[0]).toMatchObject({ points: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 })
  })
  it('is idempotent (deterministic for the same input)', () => {
    const m: GroupMatchResult[] = [{ playerAId: 'a', playerBId: 'b', scoreA: 3, scoreB: 0 }]
    expect(computeGroupStats(['a', 'b'], m)).toEqual(computeGroupStats(['a', 'b'], m))
  })
})

describe('collectAdvancers', () => {
  it('lists all group winners, then all runners-up', () => {
    const r = collectAdvancers([
      [
        { playerId: 'a1', advancing: true },
        { playerId: 'a2', advancing: true },
        { playerId: 'a3', advancing: false },
      ],
      [
        { playerId: 'b1', advancing: true },
        { playerId: 'b2', advancing: true },
      ],
    ])
    expect(r).toEqual(['a1', 'b1', 'a2', 'b2'])
  })
})
