import { describe, it, expect } from 'vitest'
import { computeAggregates, completedMatchesForSquadPlayer, teamTitlesWon, type TeamMatchRow } from './stats'

describe('computeAggregates', () => {
  it('counts a win from the player-A perspective', () => {
    const agg = computeAggregates('A', [{ player_a_id: 'A', player_b_id: 'B', score_a: 3, score_b: 1 }], 0)
    expect(agg).toEqual({
      total_matches: 1, wins: 1, losses: 0,
      goals_scored: 3, goals_conceded: 1, total_titles: 0,
    })
  })

  it('counts a loss from the player-B perspective', () => {
    const agg = computeAggregates('B', [{ player_a_id: 'A', player_b_id: 'B', score_a: 2, score_b: 0 }], 0)
    expect(agg).toMatchObject({ wins: 0, losses: 1, goals_scored: 0, goals_conceded: 2 })
  })

  it('counts a draw as neither win nor loss', () => {
    const agg = computeAggregates('A', [{ player_a_id: 'A', player_b_id: 'B', score_a: 1, score_b: 1 }], 0)
    expect(agg).toMatchObject({ total_matches: 1, wins: 0, losses: 0, goals_scored: 1, goals_conceded: 1 })
  })

  it('aggregates across multiple matches and passes titles through', () => {
    const agg = computeAggregates('A', [
      { player_a_id: 'A', player_b_id: 'B', score_a: 3, score_b: 1 },
      { player_a_id: 'C', player_b_id: 'A', score_a: 2, score_b: 5 },
    ], 2)
    expect(agg).toEqual({
      total_matches: 2, wins: 2, losses: 0,
      goals_scored: 8, goals_conceded: 3, total_titles: 2,
    })
  })

  it('is all-zero for a player with no matches', () => {
    expect(computeAggregates('A', [], 0)).toEqual({
      total_matches: 0, wins: 0, losses: 0,
      goals_scored: 0, goals_conceded: 0, total_titles: 0,
    })
  })
})

const tm = (over: Partial<TeamMatchRow>): TeamMatchRow => ({
  round: 'group',
  status: 'completed',
  score_a: 2,
  score_b: 1,
  team_a_id: 'sq1',
  team_b_id: 'sq2',
  ...over,
})

describe('completedMatchesForSquadPlayer', () => {
  it('attributes a match to the player when their squad was side A', () => {
    const result = completedMatchesForSquadPlayer('me', new Set(['sq1']), [tm({})])
    expect(result).toEqual([{ player_a_id: 'me', player_b_id: 'opponent', score_a: 2, score_b: 1 }])
  })

  it('attributes a match to the player when their squad was side B', () => {
    const result = completedMatchesForSquadPlayer('me', new Set(['sq2']), [tm({})])
    expect(result).toEqual([{ player_a_id: 'opponent', player_b_id: 'me', score_a: 2, score_b: 1 }])
  })

  it('skips a match where neither side is one of the player\'s squads', () => {
    expect(completedMatchesForSquadPlayer('me', new Set(['sq-other']), [tm({})])).toEqual([])
  })

  it('skips an incomplete or unscored match', () => {
    expect(completedMatchesForSquadPlayer('me', new Set(['sq1']), [tm({ status: 'scheduled', score_a: null, score_b: null })])).toEqual([])
  })
})

describe('teamTitlesWon', () => {
  it('counts a final the player\'s squad won', () => {
    expect(teamTitlesWon('me', new Set(['sq1']), [tm({ round: 'final' })])).toBe(1)
  })

  it('does not count a final the player\'s squad lost', () => {
    expect(teamTitlesWon('me', new Set(['sq2']), [tm({ round: 'final' })])).toBe(0)
  })

  it('does not count a non-final', () => {
    expect(teamTitlesWon('me', new Set(['sq1']), [tm({ round: 'semi_final' })])).toBe(0)
  })
})
