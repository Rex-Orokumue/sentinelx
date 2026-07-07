import { describe, it, expect } from 'vitest'
import { groupCountFor, snakeDistribute, roundRobinPairs, knockoutRound1 } from './draw'

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
})
