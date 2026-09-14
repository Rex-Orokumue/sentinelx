import { describe, it, expect } from 'vitest'
import { splitPrizeAcrossRoster } from './prize-split'

describe('splitPrizeAcrossRoster', () => {
  it('splits evenly when the prize divides exactly', () => {
    expect(splitPrizeAcrossRoster(4000, ['a', 'b', 'c', 'd'])).toEqual([
      { playerId: 'a', amountNaira: 1000 },
      { playerId: 'b', amountNaira: 1000 },
      { playerId: 'c', amountNaira: 1000 },
      { playerId: 'd', amountNaira: 1000 },
    ])
  })

  it('gives the remainder, one Naira at a time, to the earliest roster members', () => {
    expect(splitPrizeAcrossRoster(1000, ['a', 'b', 'c'])).toEqual([
      { playerId: 'a', amountNaira: 334 },
      { playerId: 'b', amountNaira: 333 },
      { playerId: 'c', amountNaira: 333 },
    ])
  })

  it('returns an empty list for a zero or negative prize', () => {
    expect(splitPrizeAcrossRoster(0, ['a', 'b'])).toEqual([])
    expect(splitPrizeAcrossRoster(-500, ['a', 'b'])).toEqual([])
  })

  it('returns an empty list for an empty roster', () => {
    expect(splitPrizeAcrossRoster(5000, [])).toEqual([])
  })
})
