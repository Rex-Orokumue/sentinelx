import { describe, it, expect } from 'vitest'
import {
  groupCountFor,
  validGroupCounts,
  resolveGroupCount,
  snakeDistribute,
  roundRobinPairs,
  knockoutRound1,
  canMoveOutOfGroup,
  canReceiveIntoGroup,
} from './draw'
import { nextRoundName } from './advancement'

describe('groupCountFor', () => {
  it('maps registered count to group count per the table', () => {
    expect(groupCountFor(2)).toBe(0)
    expect(groupCountFor(8)).toBe(0)
    expect(groupCountFor(9)).toBe(2)
    expect(groupCountFor(16)).toBe(2)
    expect(groupCountFor(17)).toBe(4)
    expect(groupCountFor(32)).toBe(4)
    expect(groupCountFor(33)).toBe(8)
    expect(groupCountFor(64)).toBe(8)
  })
})

describe('validGroupCounts', () => {
  it('returns every group count that keeps groups within 2-8 players', () => {
    expect(validGroupCounts(8)).toEqual([0])
    expect(validGroupCounts(9)).toEqual([2, 3, 4])
    expect(validGroupCounts(16)).toEqual([2, 3, 4, 5, 6, 7, 8])
    expect(validGroupCounts(17)).toEqual([3, 4, 5, 6, 7, 8])
    expect(validGroupCounts(32)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])
    expect(validGroupCounts(33)).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])
    expect(validGroupCounts(64)).toEqual(Array.from({ length: 25 }, (_, i) => i + 8))
  })

  it('offers 6 groups of 3 for 18 players', () => {
    expect(validGroupCounts(18)).toEqual([3, 4, 5, 6, 7, 8, 9])
  })
})

describe('resolveGroupCount', () => {
  it('uses a valid submitted override', () => {
    expect(resolveGroupCount(8, 32)).toBe(8)
    expect(resolveGroupCount(5, 32)).toBe(5)
  })
  it('falls back to the default tier when the override is out of range', () => {
    expect(resolveGroupCount(3, 32)).toBe(4)
    expect(resolveGroupCount(100, 32)).toBe(4)
  })
  it('falls back to the default tier when no override is submitted', () => {
    expect(resolveGroupCount(undefined, 32)).toBe(4)
    expect(resolveGroupCount(null, 32)).toBe(4)
  })
})

describe('canMoveOutOfGroup', () => {
  it('blocks the move when it would leave the source group with fewer than 2 players', () => {
    expect(canMoveOutOfGroup(2)).toBe(false)
    expect(canMoveOutOfGroup(1)).toBe(false)
  })
  it('allows the move when the source group keeps at least 2 players', () => {
    expect(canMoveOutOfGroup(3)).toBe(true)
    expect(canMoveOutOfGroup(8)).toBe(true)
  })
})

describe('canReceiveIntoGroup', () => {
  it('blocks the move when the target group is already at the 8-player cap', () => {
    expect(canReceiveIntoGroup(8)).toBe(false)
    expect(canReceiveIntoGroup(9)).toBe(false)
  })
  it('allows the move when the target group has room', () => {
    expect(canReceiveIntoGroup(7)).toBe(true)
    expect(canReceiveIntoGroup(0)).toBe(true)
  })
})

describe('snakeDistribute', () => {
  it('snakes players across groups and places each once', () => {
    const g = snakeDistribute(['a', 'b', 'c', 'd', 'e', 'f'], 2)
    expect(g).toEqual([
      ['a', 'd', 'e'],
      ['b', 'c', 'f'],
    ])
    expect(g.flat().sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
  })
})

describe('roundRobinPairs', () => {
  it('yields every unordered pair once', () => {
    expect(roundRobinPairs(['a', 'b', 'c'])).toEqual([
      ['a', 'b'],
      ['a', 'c'],
      ['b', 'c'],
    ])
  })
  it('produces s*(s-1)/2 pairs', () => {
    expect(roundRobinPairs(['a', 'b', 'c', 'd']).length).toBe(6)
  })
})

describe('knockoutRound1', () => {
  it('pairs a full power-of-two bracket with no byes', () => {
    const r = knockoutRound1(['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'])
    expect(r.round).toBe('quarter_final')
    expect(r.byePlayerIds).toEqual([])
    expect(r.matches.length).toBe(4)
  })
  it('gives byes to the top seeds when not a power of two', () => {
    const r = knockoutRound1(['s1', 's2', 's3', 's4', 's5', 's6'])
    expect(r.round).toBe('quarter_final')
    expect(r.byePlayerIds).toEqual(['s1', 's2'])
    expect(r.matches).toEqual([
      ['s3', 's6'],
      ['s4', 's5'],
    ])
  })
  it('handles a 3-player semifinal with one bye', () => {
    const r = knockoutRound1(['s1', 's2', 's3'])
    expect(r.round).toBe('semi_final')
    expect(r.byePlayerIds).toEqual(['s1'])
    expect(r.matches).toEqual([['s2', 's3']])
  })
  it('handles a 2-player final', () => {
    const r = knockoutRound1(['s1', 's2'])
    expect(r.round).toBe('final')
    expect(r.byePlayerIds).toEqual([])
    expect(r.matches).toEqual([['s1', 's2']])
  })
  it('handles 5 and 7 players', () => {
    expect(knockoutRound1(['a', 'b', 'c', 'd', 'e']).byePlayerIds).toEqual(['a', 'b', 'c'])
    expect(knockoutRound1(['a', 'b', 'c', 'd', 'e']).matches).toEqual([['d', 'e']])
    expect(knockoutRound1(['a', 'b', 'c', 'd', 'e', 'f', 'g']).byePlayerIds).toEqual(['a'])
    expect(knockoutRound1(['a', 'b', 'c', 'd', 'e', 'f', 'g']).matches.length).toBe(3)
  })

  // A 16-qualifier bracket (8 groups x top 2) is the standard shape for a
  // 32-player tournament. Naming it 'quarter_final' put 4 survivors into a
  // round called 'final', so confirmResult saw two "final" matches and paid
  // the full prize pool on each.
  it('names a 16-player bracket round_of_16, not quarter_final', () => {
    const seeds = Array.from({ length: 16 }, (_, i) => `s${i + 1}`)
    const r = knockoutRound1(seeds)
    expect(r.round).toBe('round_of_16')
    expect(r.byePlayerIds).toEqual([])
    expect(r.matches.length).toBe(8)
  })

  it('names a 32-player bracket round_of_32', () => {
    const seeds = Array.from({ length: 32 }, (_, i) => `s${i + 1}`)
    const r = knockoutRound1(seeds)
    expect(r.round).toBe('round_of_32')
    expect(r.matches.length).toBe(16)
  })

  it('rounds a 9-16 player field up into round_of_16 with byes', () => {
    const seeds = Array.from({ length: 12 }, (_, i) => `s${i + 1}`)
    const r = knockoutRound1(seeds)
    expect(r.round).toBe('round_of_16')
    expect(r.byePlayerIds).toHaveLength(4)
    expect(r.matches).toHaveLength(4)
  })

  // Walking ROUND_ORDER forward from the first round must land exactly one
  // match in 'final' for every supported bracket size.
  it('halves cleanly to a single final for every bracket size', () => {
    for (const n of [2, 4, 8, 16, 32]) {
      const seeds = Array.from({ length: n }, (_, i) => `s${i + 1}`)
      const { round, matches } = knockoutRound1(seeds)
      let count = matches.length
      let current: string | null = round
      while (current && current !== 'final') {
        current = nextRoundName(current)
        count = count / 2
      }
      expect({ n, current, count }).toEqual({ n, current: 'final', count: 1 })
    }
  })
})
