import { describe, it, expect } from 'vitest'
import {
  rankPlayers,
  rankPlayersBy,
  isRankingEligible,
  RANKING_MIN_MATCHES,
  type PlayerStatsInput,
} from './leaderboard'

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

describe('rankPlayersBy', () => {
  it('sorts by wins when metric is "wins" (matches rankPlayers)', () => {
    const players = [p({ id: 'a', wins: 3 }), p({ id: 'b', wins: 7 })]
    expect(rankPlayersBy(players, 'wins').map((x) => x.id)).toEqual(
      rankPlayers(players).map((x) => x.id),
    )
  })

  it('sorts by Sentinel Score when metric is "score"', () => {
    const r = rankPlayersBy(
      [p({ id: 'a', sentinelScore: 60, wins: 9 }), p({ id: 'b', sentinelScore: 92, wins: 1 })],
      'score',
    )
    expect(r.map((x) => x.id)).toEqual(['b', 'a'])
  })

  it('sorts by goals scored when metric is "goals"', () => {
    const r = rankPlayersBy(
      [
        p({ id: 'a', goalsScored: 4, wins: 9 }),
        p({ id: 'b', goalsScored: 20, wins: 1 }),
      ],
      'goals',
    )
    expect(r.map((x) => x.id)).toEqual(['b', 'a'])
  })

  it('assigns sequential ranks for the chosen metric', () => {
    const r = rankPlayersBy(
      [p({ id: 'a', sentinelScore: 70 }), p({ id: 'b', sentinelScore: 95 }), p({ id: 'c', sentinelScore: 80 })],
      'score',
    )
    expect(r.map((x) => x.rank)).toEqual([1, 2, 3])
  })
})

describe('isRankingEligible', () => {
  it('excludes players with zero matches', () => {
    expect(isRankingEligible({ totalMatches: 0 })).toBe(false)
  })

  it('includes players at the minimum and above', () => {
    expect(isRankingEligible({ totalMatches: RANKING_MIN_MATCHES })).toBe(true)
    expect(isRankingEligible({ totalMatches: 5 })).toBe(true)
  })

  it('RANKING_MIN_MATCHES is 1 (at least one match)', () => {
    expect(RANKING_MIN_MATCHES).toBe(1)
  })
})
