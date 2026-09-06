import { describe, it, expect } from 'vitest'
import { trendFor, previousRankFor, type RankSnapshot } from './trend'

describe('trendFor', () => {
  it('reports a player with no history as new, not risen', () => {
    expect(trendFor(5, null)).toEqual({ direction: 'new', delta: 0 })
  })

  it('treats a smaller rank number as an improvement', () => {
    // rank 1 is better than rank 12 — moving 12 -> 1 is up by 11
    expect(trendFor(1, 12)).toEqual({ direction: 'up', delta: 11 })
  })

  it('reports a larger rank number as a drop', () => {
    expect(trendFor(9, 7)).toEqual({ direction: 'down', delta: 2 })
  })

  it('reports no movement as flat', () => {
    expect(trendFor(4, 4)).toEqual({ direction: 'flat', delta: 0 })
  })

  it('never returns a negative delta', () => {
    for (const [cur, prev] of [
      [1, 12],
      [9, 7],
      [4, 4],
    ] as const) {
      expect(trendFor(cur, prev).delta).toBeGreaterThanOrEqual(0)
    }
  })
})

const snap = (over: Partial<RankSnapshot>): RankSnapshot => ({
  playerId: 'p1',
  gameId: null,
  rank: 10,
  capturedOn: '2026-09-01',
  ...over,
})

describe('previousRankFor', () => {
  const today = '2026-09-06'

  it('picks the most recent snapshot older than today', () => {
    const rows = [
      snap({ rank: 20, capturedOn: '2026-09-01' }),
      snap({ rank: 15, capturedOn: '2026-09-05' }),
    ]
    expect(previousRankFor(rows, 'p1', null, today)).toBe(15)
  })

  it("ignores today's own row so a second run doesn't compare against itself", () => {
    const rows = [
      snap({ rank: 15, capturedOn: '2026-09-05' }),
      snap({ rank: 3, capturedOn: today }),
    ]
    expect(previousRankFor(rows, 'p1', null, today)).toBe(15)
  })

  it('ignores other players', () => {
    const rows = [snap({ playerId: 'other', rank: 2, capturedOn: '2026-09-05' })]
    expect(previousRankFor(rows, 'p1', null, today)).toBeNull()
  })

  it('keeps scopes separate', () => {
    const rows = [
      snap({ gameId: 'g1', rank: 2, capturedOn: '2026-09-05' }),
      snap({ gameId: null, rank: 8, capturedOn: '2026-09-05' }),
    ]
    expect(previousRankFor(rows, 'p1', 'g1', today)).toBe(2)
    expect(previousRankFor(rows, 'p1', null, today)).toBe(8)
  })

  it('returns null with no history at all', () => {
    expect(previousRankFor([], 'p1', null, today)).toBeNull()
  })
})
