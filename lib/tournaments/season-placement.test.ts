import { describe, it, expect } from 'vitest'
import {
  bandsForPlacements,
  pointsForBand,
  placementForBand,
  type PlacementMatch,
} from './season-placement'

function m(overrides: Partial<PlacementMatch> & Pick<PlacementMatch, 'round'>): PlacementMatch {
  return {
    status: 'completed',
    score_a: 1,
    score_b: 0,
    player_a_id: null,
    player_b_id: null,
    ...overrides,
  }
}

describe('bandsForPlacements', () => {
  it('gives the final winner champion and the loser runner_up', () => {
    const matches = [m({ round: 'final', player_a_id: 'a', player_b_id: 'b', score_a: 2, score_b: 1 })]
    const result = bandsForPlacements(matches, ['a', 'b'])
    expect(result).toEqual(
      expect.arrayContaining([
        { playerId: 'a', band: 'champion' },
        { playerId: 'b', band: 'runner_up' },
      ]),
    )
  })

  it('bands semi-final losers as semi_final', () => {
    const matches = [
      m({ round: 'semi_final', player_a_id: 'a', player_b_id: 'x', score_a: 2, score_b: 0 }),
      m({ round: 'semi_final', player_a_id: 'b', player_b_id: 'y', score_a: 3, score_b: 1 }),
      m({ round: 'final', player_a_id: 'a', player_b_id: 'b', score_a: 1, score_b: 0 }),
    ]
    const result = bandsForPlacements(matches, ['a', 'b', 'x', 'y'])
    expect(result.find((r) => r.playerId === 'x')?.band).toBe('semi_final')
    expect(result.find((r) => r.playerId === 'y')?.band).toBe('semi_final')
  })

  it('a bye advances silently — no band assigned at the bye round', () => {
    const matches = [
      m({ round: 'round_of_16', status: 'bye', player_a_id: 'a', player_b_id: null }),
      m({ round: 'quarter_final', player_a_id: 'a', player_b_id: 'z', score_a: 0, score_b: 1 }),
    ]
    const result = bandsForPlacements(matches, ['a', 'z'])
    expect(result.find((r) => r.playerId === 'a')?.band).toBe('quarter_final')
  })

  it('a forfeited (double no-show) round eliminates both players', () => {
    const matches = [
      m({ round: 'quarter_final', status: 'forfeited', score_a: null, score_b: null, player_a_id: 'a', player_b_id: 'b' }),
    ]
    const result = bandsForPlacements(matches, ['a', 'b'])
    expect(result.find((r) => r.playerId === 'a')?.band).toBe('quarter_final')
    expect(result.find((r) => r.playerId === 'b')?.band).toBe('quarter_final')
  })

  it('a forfeited grand final gives both finalists runner_up, nobody champion', () => {
    const matches = [
      m({ round: 'final', status: 'forfeited', score_a: null, score_b: null, player_a_id: 'a', player_b_id: 'b' }),
    ]
    const result = bandsForPlacements(matches, ['a', 'b'])
    expect(result.find((r) => r.playerId === 'a')?.band).toBe('runner_up')
    expect(result.find((r) => r.playerId === 'b')?.band).toBe('runner_up')
  })

  it('a player who never appears in a knockout match is non_advancer', () => {
    const matches = [m({ round: 'final', player_a_id: 'a', player_b_id: 'b', score_a: 1, score_b: 0 })]
    const result = bandsForPlacements(matches, ['a', 'b', 'group-only-player'])
    expect(result.find((r) => r.playerId === 'group-only-player')?.band).toBe('non_advancer')
  })

  it('ignores group-round matches entirely', () => {
    const matches = [
      m({ round: 'group', player_a_id: 'a', player_b_id: 'b', score_a: 5, score_b: 5 }),
      m({ round: 'final', player_a_id: 'a', player_b_id: 'c', score_a: 1, score_b: 0 }),
    ]
    const result = bandsForPlacements(matches, ['a', 'c'])
    expect(result.find((r) => r.playerId === 'a')?.band).toBe('champion')
  })
})

describe('pointsForBand', () => {
  it('community_club matches the spec table', () => {
    expect(pointsForBand('community_club', 'champion')).toBe(100)
    expect(pointsForBand('community_club', 'runner_up')).toBe(70)
    expect(pointsForBand('community_club', 'semi_final')).toBe(45)
    expect(pointsForBand('community_club', 'quarter_final')).toBe(25)
    expect(pointsForBand('community_club', 'round_of_16')).toBe(10)
    expect(pointsForBand('community_club', 'round_of_32')).toBe(5)
    expect(pointsForBand('community_club', 'non_advancer')).toBe(5)
  })

  it('masters matches the spec table, with non_advancer == round_of_16', () => {
    expect(pointsForBand('masters', 'champion')).toBe(300)
    expect(pointsForBand('masters', 'runner_up')).toBe(200)
    expect(pointsForBand('masters', 'semi_final')).toBe(150)
    expect(pointsForBand('masters', 'quarter_final')).toBe(100)
    expect(pointsForBand('masters', 'round_of_16')).toBe(50)
    expect(pointsForBand('masters', 'non_advancer')).toBe(50)
  })
})

describe('placementForBand', () => {
  it('returns a representative numeric placement per band', () => {
    expect(placementForBand('community_club', 'champion')).toBe(1)
    expect(placementForBand('community_club', 'runner_up')).toBe(2)
    expect(placementForBand('community_club', 'round_of_32')).toBe(17)
    expect(placementForBand('masters', 'round_of_16')).toBe(9)
  })
})
