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
  it('is true only when every match is completed or bye', () => {
    expect(roundResolved([mk({}), mk({ status: 'bye' })])).toBe(true)
    expect(roundResolved([mk({}), mk({ status: 'disputed' })])).toBe(false)
    expect(roundResolved([mk({}), mk({ status: 'scheduled' })])).toBe(false)
    expect(roundResolved([])).toBe(false)
  })
})

describe('pairWinners', () => {
  it('interleaves byes with match-winners then pairs (n=6 case)', () => {
    expect(pairWinners(['bye1', 'bye2'], ['w1', 'w2'])).toEqual([
      ['bye1', 'w1'],
      ['bye2', 'w2'],
    ])
  })
  it('handles one bye + three winners (n=7)', () => {
    expect(pairWinners(['bye1'], ['w1', 'w2', 'w3'])).toEqual([
      ['bye1', 'w1'],
      ['w2', 'w3'],
    ])
  })
  it('handles no byes (later rounds)', () => {
    expect(pairWinners([], ['w1', 'w2', 'w3', 'w4'])).toEqual([
      ['w1', 'w2'],
      ['w3', 'w4'],
    ])
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
