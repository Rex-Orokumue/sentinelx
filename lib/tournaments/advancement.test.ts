import { describe, it, expect } from 'vitest'
import {
  matchWinnerId,
  roundResolved,
  pairWinners,
  nextRoundName,
  thirdPlacePair,
  sideAIds,
  sideBIds,
  type AdvanceMatch,
  type RosterAwareMatch,
} from './advancement'

function mk(over: Partial<AdvanceMatch>): AdvanceMatch {
  return { status: 'completed', score_a: 1, score_b: 0, player_a_id: 'a', player_b_id: 'b', ...over }
}

describe('matchWinnerId', () => {
  it('returns the higher-scoring player for a completed match', () => {
    expect(matchWinnerId(mk({ score_a: 2, score_b: 1 }))).toBe('a')
    expect(matchWinnerId(mk({ score_a: 0, score_b: 3 }))).toBe('b')
  })
  it('returns player_a for a bye', () => {
    expect(matchWinnerId(mk({ status: 'bye', player_b_id: null, score_a: null, score_b: null }))).toBe('a')
  })
  it('returns null for non-terminal, draw, or null-score matches', () => {
    expect(matchWinnerId(mk({ status: 'scheduled' }))).toBeNull()
    expect(matchWinnerId(mk({ status: 'disputed' }))).toBeNull()
    expect(matchWinnerId(mk({ score_a: 1, score_b: 1 }))).toBeNull()
    expect(matchWinnerId(mk({ score_a: null }))).toBeNull()
  })
})

describe('roundResolved', () => {
  it('is true only when every match is completed, bye, or forfeited', () => {
    expect(roundResolved([mk({}), mk({ status: 'bye' })])).toBe(true)
    expect(roundResolved([mk({}), mk({ status: 'forfeited' })])).toBe(true)
    expect(roundResolved([mk({}), mk({ status: 'disputed' })])).toBe(false)
    expect(roundResolved([mk({}), mk({ status: 'scheduled' })])).toBe(false)
    expect(roundResolved([])).toBe(false)
  })
})

describe('pairWinners', () => {
  it('interleaves byes with match-winners then pairs (n=6 case)', () => {
    expect(pairWinners(['bye1', 'bye2'], ['w1', 'w2'])).toEqual({
      pairs: [
        ['bye1', 'w1'],
        ['bye2', 'w2'],
      ],
      leftover: null,
    })
  })
  it('handles one bye + three winners (n=7)', () => {
    expect(pairWinners(['bye1'], ['w1', 'w2', 'w3'])).toEqual({
      pairs: [
        ['bye1', 'w1'],
        ['w2', 'w3'],
      ],
      leftover: null,
    })
  })
  it('handles no byes (later rounds)', () => {
    expect(pairWinners([], ['w1', 'w2', 'w3', 'w4'])).toEqual({
      pairs: [
        ['w1', 'w2'],
        ['w3', 'w4'],
      ],
      leftover: null,
    })
  })
  it('returns a leftover when a forfeit makes the winner count odd', () => {
    expect(pairWinners([], ['w1', 'w2', 'w3'])).toEqual({
      pairs: [['w1', 'w2']],
      leftover: 'w3',
    })
  })
  it('returns no pairs and the sole leftover when only one winner remains', () => {
    expect(pairWinners([], ['w1'])).toEqual({ pairs: [], leftover: 'w1' })
  })
  it('returns no pairs and no leftover when nobody advances', () => {
    expect(pairWinners([], [])).toEqual({ pairs: [], leftover: null })
  })
})

describe('thirdPlacePair', () => {
  it('returns the two semifinal losers', () => {
    const semis = [
      mk({ player_a_id: 'w1', player_b_id: 'l1', score_a: 3, score_b: 1 }),
      mk({ player_a_id: 'l2', player_b_id: 'w2', score_a: 0, score_b: 2 }),
    ]
    expect(thirdPlacePair(semis)).toEqual(['l1', 'l2'])
  })

  it('returns null when a semifinal was a bye (no real loser)', () => {
    const semis = [
      mk({ status: 'bye', player_a_id: 'w1', player_b_id: null, score_a: null, score_b: null }),
      mk({ player_a_id: 'l2', player_b_id: 'w2', score_a: 0, score_b: 2 }),
    ]
    expect(thirdPlacePair(semis)).toBeNull()
  })

  it('returns null when a semifinal was forfeited (double no-show)', () => {
    const semis = [
      mk({ status: 'forfeited', score_a: null, score_b: null }),
      mk({ player_a_id: 'l2', player_b_id: 'w2', score_a: 0, score_b: 2 }),
    ]
    expect(thirdPlacePair(semis)).toBeNull()
  })

  it('returns null when a semifinal is not yet decided', () => {
    const semis = [
      mk({ status: 'scheduled', score_a: null, score_b: null }),
      mk({ player_a_id: 'l2', player_b_id: 'w2', score_a: 0, score_b: 2 }),
    ]
    expect(thirdPlacePair(semis)).toBeNull()
  })

  it('returns null unless there are exactly two semifinal matches', () => {
    expect(thirdPlacePair([])).toBeNull()
    expect(thirdPlacePair([mk({})])).toBeNull()
  })
})

describe('matchWinnerId — team matches', () => {
  const tm = (over: Partial<AdvanceMatch>): AdvanceMatch => ({
    status: 'completed',
    score_a: 1,
    score_b: 0,
    player_a_id: null,
    player_b_id: null,
    team_a_id: 'sqA',
    team_b_id: 'sqB',
    ...over,
  })

  it('falls back to team ids when player ids are null', () => {
    expect(matchWinnerId(tm({ score_a: 3, score_b: 1 }))).toBe('sqA')
    expect(matchWinnerId(tm({ score_a: 0, score_b: 2 }))).toBe('sqB')
  })
  it('returns team_a_id for a team bye', () => {
    expect(matchWinnerId(tm({ status: 'bye', team_b_id: null, score_a: null, score_b: null }))).toBe('sqA')
  })
  it('still returns null for a draw or undecided team match', () => {
    expect(matchWinnerId(tm({ score_a: 1, score_b: 1 }))).toBeNull()
    expect(matchWinnerId(tm({ status: 'scheduled' }))).toBeNull()
  })
})

describe('thirdPlacePair — team matches', () => {
  it('returns the two semifinal-losing squads', () => {
    const semis: AdvanceMatch[] = [
      { status: 'completed', score_a: 3, score_b: 1, player_a_id: null, player_b_id: null, team_a_id: 'w1', team_b_id: 'l1' },
      { status: 'completed', score_a: 0, score_b: 2, player_a_id: null, player_b_id: null, team_a_id: 'l2', team_b_id: 'w2' },
    ]
    expect(thirdPlacePair(semis)).toEqual(['l1', 'l2'])
  })
})

describe('nextRoundName', () => {
  it('advances through the canonical order', () => {
    expect(nextRoundName('quarter_final')).toBe('semi_final')
    expect(nextRoundName('semi_final')).toBe('final')
  })
  it('returns null for the final or a non-knockout round', () => {
    expect(nextRoundName('final')).toBeNull()
    expect(nextRoundName('group')).toBeNull()
  })
})

describe('sideAIds / sideBIds', () => {
  it('returns the single player id for a solo match', () => {
    const m: RosterAwareMatch = { status: 'completed', score_a: 1, score_b: 0, player_a_id: 'a', player_b_id: 'b' }
    expect(sideAIds(m)).toEqual(['a'])
    expect(sideBIds(m)).toEqual(['b'])
  })

  it('returns the roster for a team match', () => {
    const m: RosterAwareMatch = {
      status: 'completed', score_a: 1, score_b: 0,
      player_a_id: null, player_b_id: null,
      team_a_id: 'sq1', team_b_id: 'sq2',
      team_a_roster: ['p1', 'p2'], team_b_roster: ['p3', 'p4'],
    }
    expect(sideAIds(m)).toEqual(['p1', 'p2'])
    expect(sideBIds(m)).toEqual(['p3', 'p4'])
  })

  it('returns an empty roster for a team match whose roster was never attached', () => {
    const m: RosterAwareMatch = { status: 'completed', score_a: 1, score_b: null, player_a_id: null, player_b_id: null, team_a_id: 'sq1', team_b_id: null }
    expect(sideAIds(m)).toEqual([])
  })

  it('returns an empty array for an unpopulated side (an open bye slot)', () => {
    const m: RosterAwareMatch = { status: 'bye', score_a: null, score_b: null, player_a_id: 'a', player_b_id: null }
    expect(sideBIds(m)).toEqual([])
  })
})
