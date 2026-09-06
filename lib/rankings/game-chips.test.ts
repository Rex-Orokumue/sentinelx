import { describe, it, expect } from 'vitest'
import { gameChipsFor, MAX_CHIPS } from './game-chips'

describe('gameChipsFor', () => {
  it('is empty for a player with no games', () => {
    expect(gameChipsFor([])).toEqual({ chips: [], overflow: 0, total: 0 })
  })

  it('orders by wins descending', () => {
    const r = gameChipsFor([
      { game: 'DLS', wins: 2 },
      { game: 'CODM', wins: 9 },
    ])
    expect(r.chips).toEqual(['CODM', 'DLS'])
    expect(r.total).toBe(2)
  })

  it('caps the chips and reports the overflow', () => {
    const r = gameChipsFor([
      { game: 'A', wins: 5 },
      { game: 'B', wins: 4 },
      { game: 'C', wins: 3 },
      { game: 'D', wins: 2 },
      { game: 'E', wins: 1 },
      { game: 'F', wins: 1 },
    ])
    expect(r.chips).toHaveLength(MAX_CHIPS)
    expect(r.overflow).toBe(2)
    expect(r.total).toBe(6)
  })

  it('reports no overflow at exactly the cap', () => {
    const r = gameChipsFor([
      { game: 'A', wins: 1 },
      { game: 'B', wins: 1 },
      { game: 'C', wins: 1 },
      { game: 'D', wins: 1 },
    ])
    expect(r.overflow).toBe(0)
  })

  it('breaks ties on name so the order is stable', () => {
    const r = gameChipsFor([
      { game: 'Zed', wins: 3 },
      { game: 'Alpha', wins: 3 },
    ])
    expect(r.chips).toEqual(['Alpha', 'Zed'])
  })
})
