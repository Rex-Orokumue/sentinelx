import { describe, it, expect } from 'vitest'
import { sortStandings, type MembershipInput } from './standings'

function m(over: Partial<MembershipInput> & { playerId: string; name: string }): MembershipInput {
  return { wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, points: 0, ...over }
}

describe('sortStandings', () => {
  it('orders by points, then goal difference, then goals for', () => {
    // Every row has played=3 (matching its points via wins/draws/losses), so
    // points-per-game ranks identically to raw points here.
    const rows = sortStandings([
      m({ playerId: 'a', name: 'A', wins: 2, draws: 0, losses: 1, points: 6, goalsFor: 5, goalsAgainst: 4 }), // GD +1
      m({ playerId: 'b', name: 'B', wins: 3, draws: 0, losses: 0, points: 9, goalsFor: 8, goalsAgainst: 1 }), // GD +7
      m({ playerId: 'c', name: 'C', wins: 2, draws: 0, losses: 1, points: 6, goalsFor: 9, goalsAgainst: 2 }), // GD +7, GF 9
      m({ playerId: 'd', name: 'D', wins: 2, draws: 0, losses: 1, points: 6, goalsFor: 6, goalsAgainst: 1 }), // GD +5
    ])
    expect(rows.map((r) => r.playerId)).toEqual(['b', 'c', 'd', 'a'])
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4])
  })

  it('derives played and goalDiff', () => {
    const [row] = sortStandings([
      m({ playerId: 'a', name: 'A', wins: 2, draws: 1, losses: 0, goalsFor: 7, goalsAgainst: 2, points: 7 }),
    ])
    expect(row.played).toBe(3)
    expect(row.goalDiff).toBe(5)
  })

  it('flags the top 2 as advancing by default', () => {
    const rows = sortStandings([
      m({ playerId: 'a', name: 'A', points: 9 }),
      m({ playerId: 'b', name: 'B', points: 6 }),
      m({ playerId: 'c', name: 'C', points: 3 }),
    ])
    expect(rows.map((r) => r.advancing)).toEqual([true, true, false])
  })

  it('honors a custom advancingCount', () => {
    const rows = sortStandings(
      [
        m({ playerId: 'a', name: 'A', points: 9 }),
        m({ playerId: 'b', name: 'B', points: 6 }),
        m({ playerId: 'c', name: 'C', points: 3 }),
      ],
      1,
    )
    expect(rows.map((r) => r.advancing)).toEqual([true, false, false])
  })

  it('passes clubName through unchanged when present', () => {
    const [row] = sortStandings([
      m({ playerId: 'a', name: 'A', clubName: 'Lagos Ronin', points: 3, goalsFor: 2, goalsAgainst: 0 }),
    ])
    expect(row.clubName).toBe('Lagos Ronin')
  })

  it('leaves clubName undefined when not provided', () => {
    const [row] = sortStandings([m({ playerId: 'a', name: 'A' })])
    expect(row.clubName).toBeUndefined()
  })

  it('ranks by points-per-game when match counts differ (substitute played fewer)', () => {
    const rows = sortStandings([
      // 3 games, 2W 1D = 7 points -> 2.33 ppg
      m({ playerId: 'regular', name: 'Regular', wins: 2, draws: 1, losses: 0, points: 7, goalsFor: 5, goalsAgainst: 2 }),
      // substitute: 2 games, 2W = 6 points -> 3.0 ppg (fewer raw points, better ppg)
      m({ playerId: 'sub', name: 'Sub', wins: 2, draws: 0, losses: 0, points: 6, goalsFor: 4, goalsAgainst: 1 }),
    ])
    expect(rows.map((r) => r.playerId)).toEqual(['sub', 'regular'])
  })

  it('is unaffected when every player has played the same number of games (existing behavior)', () => {
    const rows = sortStandings([
      m({ playerId: 'a', name: 'A', wins: 1, draws: 0, losses: 0, points: 3, goalsFor: 2, goalsAgainst: 1 }),
      m({ playerId: 'b', name: 'B', wins: 0, draws: 1, losses: 0, points: 1, goalsFor: 1, goalsAgainst: 1 }),
    ])
    expect(rows.map((r) => r.playerId)).toEqual(['a', 'b'])
  })
})
