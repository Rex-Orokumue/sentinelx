import { describe, it, expect } from 'vitest'
import { buildLobbyGrid } from './lobby-grid'

const entrants = [
  { entrantId: 'a', displayName: 'ShadowX' },
  { entrantId: 'b', displayName: 'Kelvin_G' },
  { entrantId: 'c', displayName: 'ZAYN' },
]

describe('buildLobbyGrid', () => {
  it('gives every entrant a row, submitted or not', () => {
    // The grid IS the lobby. An entrant missing from it cannot be scored, and
    // the admin would have no way to notice.
    const rows = buildLobbyGrid(entrants, [
      { entrantId: 'a', placement: 1, kills: 5, screenshotUrl: 's1', status: 'pending' },
    ])

    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.entrantId).sort()).toEqual(['a', 'b', 'c'])
  })

  it('pre-fills a submitted row', () => {
    const rows = buildLobbyGrid(entrants, [
      { entrantId: 'b', placement: 2, kills: 3, screenshotUrl: 's2', status: 'pending' },
    ])
    const row = rows.find((r) => r.entrantId === 'b')!

    expect(row).toMatchObject({
      placement: 2,
      kills: 3,
      screenshotUrl: 's2',
      submitted: true,
      status: 'pending',
    })
  })

  it('leaves an unsubmitted row blank rather than zeroed', () => {
    // Zeros would look like a real claim of 0 kills and be silently confirmed.
    // Null is the admin's cue that nobody reported.
    const rows = buildLobbyGrid(entrants, [])

    for (const row of rows) {
      expect(row.placement).toBeNull()
      expect(row.kills).toBeNull()
      expect(row.submitted).toBe(false)
    }
  })

  it('keeps entrant order stable', () => {
    // Rows must not jump around between renders as submissions arrive.
    const rows = buildLobbyGrid(entrants, [
      { entrantId: 'c', placement: 1, kills: 0, screenshotUrl: null, status: 'pending' },
    ])
    expect(rows.map((r) => r.entrantId)).toEqual(['a', 'b', 'c'])
  })

  it('ignores a submission from an entrant not in this lobby', () => {
    // Defensive: a stale row from a moved entrant must not add a phantom.
    const rows = buildLobbyGrid(entrants, [
      { entrantId: 'zzz', placement: 1, kills: 9, screenshotUrl: null, status: 'pending' },
    ])
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => !r.submitted)).toBe(true)
  })

  it('carries a disputed status through', () => {
    const rows = buildLobbyGrid(entrants, [
      { entrantId: 'a', placement: 1, kills: 2, screenshotUrl: null, status: 'disputed' },
    ])
    expect(rows.find((r) => r.entrantId === 'a')!.status).toBe('disputed')
  })

  it('reports no rows for an empty lobby', () => {
    expect(buildLobbyGrid([], [])).toEqual([])
  })
})
