import { describe, it, expect } from 'vitest'
import { winsByPlayerAndGame, footballGoalsByPlayer, type GameScopedMatch } from './game-breakdown'

function m(over: Partial<GameScopedMatch>): GameScopedMatch {
  return {
    status: 'completed',
    score_a: 2,
    score_b: 1,
    player_a_id: 'a',
    player_b_id: 'b',
    game_name: 'DLS',
    game_category: 'football',
    ...over,
  }
}

describe('winsByPlayerAndGame', () => {
  it('counts a decisive completed match for the winner only', () => {
    const r = winsByPlayerAndGame([m({ score_a: 2, score_b: 1 })])
    expect(r.get('a')).toEqual([{ game: 'DLS', wins: 1 }])
    expect(r.get('b')).toBeUndefined()
  })

  it('groups multiple wins in the same game into one count', () => {
    const r = winsByPlayerAndGame([
      m({ score_a: 2, score_b: 0 }),
      m({ score_a: 3, score_b: 1 }),
    ])
    expect(r.get('a')).toEqual([{ game: 'DLS', wins: 2 }])
  })

  it('splits wins across different games into separate entries', () => {
    const r = winsByPlayerAndGame([
      m({ score_a: 2, score_b: 0, game_name: 'DLS' }),
      m({ score_a: 2, score_b: 0, game_name: 'EA FC Mobile' }),
    ])
    expect(r.get('a')).toEqual(
      expect.arrayContaining([
        { game: 'DLS', wins: 1 },
        { game: 'EA FC Mobile', wins: 1 },
      ]),
    )
  })

  it('skips a draw without crashing', () => {
    const r = winsByPlayerAndGame([m({ score_a: 1, score_b: 1 })])
    expect(r.size).toBe(0)
  })

  it('skips a non-completed match', () => {
    const r = winsByPlayerAndGame([m({ status: 'scheduled' })])
    expect(r.size).toBe(0)
  })

  it('returns an empty map for no matches', () => {
    expect(winsByPlayerAndGame([]).size).toBe(0)
  })
})

describe('footballGoalsByPlayer', () => {
  it('sums scored and conceded for both players of a football match', () => {
    const r = footballGoalsByPlayer([m({ score_a: 3, score_b: 1, game_category: 'football' })])
    expect(r.get('a')).toEqual({ scored: 3, conceded: 1 })
    expect(r.get('b')).toEqual({ scored: 1, conceded: 3 })
  })

  it('accumulates across multiple matches', () => {
    const r = footballGoalsByPlayer([
      m({ score_a: 3, score_b: 1 }),
      m({ score_a: 0, score_b: 2 }),
    ])
    expect(r.get('a')).toEqual({ scored: 3, conceded: 3 })
    expect(r.get('b')).toEqual({ scored: 3, conceded: 3 })
  })

  it('excludes matches from non-football games', () => {
    const r = footballGoalsByPlayer([m({ game_category: 'other', score_a: 5, score_b: 5 })])
    expect(r.size).toBe(0)
  })

  it('excludes non-completed matches', () => {
    const r = footballGoalsByPlayer([m({ status: 'scheduled' })])
    expect(r.size).toBe(0)
  })

  it('returns an empty map for no matches', () => {
    expect(footballGoalsByPlayer([]).size).toBe(0)
  })
})
