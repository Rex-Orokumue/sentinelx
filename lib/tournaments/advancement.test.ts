import { describe, it, expect } from 'vitest'
import {
  matchWinnerId,
  roundResolved,
  pairWinners,
  nextRoundName,
  type AdvanceMatch,
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
