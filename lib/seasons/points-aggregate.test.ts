import { describe, it, expect } from 'vitest'
import { sumPointsByPlayer } from './points-aggregate'

describe('sumPointsByPlayer', () => {
  it('sums multiple rows per player', () => {
    const totals = sumPointsByPlayer([
      { playerId: 'a', points: 100 },
      { playerId: 'a', points: -15 },
      { playerId: 'b', points: 70 },
    ])
    expect(totals.get('a')).toBe(85)
    expect(totals.get('b')).toBe(70)
  })

  it('returns an empty map for no rows', () => {
    expect(sumPointsByPlayer([]).size).toBe(0)
  })

  it('totals can go negative', () => {
    const totals = sumPointsByPlayer([{ playerId: 'a', points: -15 }])
    expect(totals.get('a')).toBe(-15)
  })
})
