import { describe, it, expect } from 'vitest'
import { rankPlayers, type PlayerStatsInput } from './leaderboard'

function p(over: Partial<PlayerStatsInput> & { id: string }): PlayerStatsInput {
  return {
    username: over.id,
    displayName: null,
    avatarUrl: null,
    country: null,
    wins: 0,
    losses: 0,
    totalMatches: 0,
    goalsScored: 0,
    goalsConceded: 0,
    totalTitles: 0,
    sentinelScore: 70,
    sentinelTier: null,
    ...over,
  }
}

describe('rankPlayers', () => {
  it('sorts by wins desc and assigns sequential ranks', () => {
    const r = rankPlayers([
      p({ id: 'a', wins: 5, totalMatches: 10 }),
      p({ id: 'b', wins: 9, totalMatches: 10 }),
    ])
    expect(r.map((x) => x.id)).toEqual(['b', 'a'])
    expect(r.map((x) => x.rank)).toEqual([1, 2])
  })

  it('breaks a wins tie by win rate', () => {
    const r = rankPlayers([
      p({ id: 'a', wins: 6, totalMatches: 12 }), // 50%
      p({ id: 'b', wins: 6, totalMatches: 8 }), // 75%
    ])
    expect(r.map((x) => x.id)).toEqual(['b', 'a'])
  })

  it('breaks a wins+winRate tie by titles', () => {
    const r = rankPlayers([
      p({ id: 'a', wins: 6, totalMatches: 10, totalTitles: 1 }),
      p({ id: 'b', wins: 6, totalMatches: 10, totalTitles: 3 }),
    ])
    expect(r.map((x) => x.id)).toEqual(['b', 'a'])
  })

  it('breaks a wins+winRate+titles tie by goal difference', () => {
    const r = rankPlayers([
      p({ id: 'a', wins: 6, totalMatches: 10, totalTitles: 2, goalsScored: 20, goalsConceded: 10 }), // +10
      p({ id: 'b', wins: 6, totalMatches: 10, totalTitles: 2, goalsScored: 25, goalsConceded: 10 }), // +15
    ])
    expect(r.map((x) => x.id)).toEqual(['b', 'a'])
  })

  it('derives winRate and goalDiff', () => {
    const [row] = rankPlayers([
      p({ id: 'a', wins: 6, totalMatches: 12, goalsScored: 20, goalsConceded: 8 }),
    ])
    expect(row.winRate).toBeCloseTo(0.5)
    expect(row.goalDiff).toBe(12)
  })
})
