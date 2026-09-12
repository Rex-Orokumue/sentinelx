import { describe, it, expect } from 'vitest'
import { frozenResultRows, stageIsComplete } from './lobby-confirm'
import type { PointsConfig } from './points-config'

const ff: PointsConfig = { placement: [12, 9, 8, 7, 6, 5, 4, 3, 2, 1], perKill: 1 }

describe('frozenResultRows', () => {
  it('freezes points from the config at confirm time', () => {
    const rows = frozenResultRows(ff, 'lob1', [
      { entrantId: 'a', placement: 1, kills: 7 },
      { entrantId: 'b', placement: 11, kills: 2 },
    ])

    expect(rows[0]).toEqual({
      lobby_id: 'lob1',
      entrant_id: 'a',
      placement: 1,
      kills: 7,
      placement_points: 12,
      kill_points: 7,
      status: 'confirmed',
    })
    // Outside the table: no placement points, kills still count.
    expect(rows[1].placement_points).toBe(0)
    expect(rows[1].kill_points).toBe(2)
  })

  it('does not depend on the config after the fact', () => {
    // The whole reason points are stored rather than derived: editing a stage's
    // table must not rewrite rounds already played.
    const before = frozenResultRows(ff, 'lob1', [{ entrantId: 'a', placement: 1, kills: 0 }])
    const edited: PointsConfig = { placement: [99], perKill: 5 }
    const after = frozenResultRows(edited, 'lob1', [{ entrantId: 'a', placement: 1, kills: 0 }])

    expect(before[0].placement_points).toBe(12)
    expect(after[0].placement_points).toBe(99)
  })

  it('returns nothing for no rows', () => {
    expect(frozenResultRows(ff, 'lob1', [])).toEqual([])
  })
})

describe('stageIsComplete', () => {
  it('is complete when every round has been played and confirmed', () => {
    expect(
      stageIsComplete(2, [
        { roundNo: 1, status: 'confirmed' },
        { roundNo: 2, status: 'confirmed' },
      ]),
    ).toBe(true)
  })

  it('is not complete while a lobby is unconfirmed', () => {
    expect(
      stageIsComplete(2, [
        { roundNo: 1, status: 'confirmed' },
        { roundNo: 2, status: 'awaiting_results' },
      ]),
    ).toBe(false)
  })

  it('is not complete while rounds remain undrawn', () => {
    // Every drawn round is confirmed, but the stage is a 3-rounder and only 2
    // exist. Completing here would advance players a round early.
    expect(
      stageIsComplete(3, [
        { roundNo: 1, status: 'confirmed' },
        { roundNo: 2, status: 'confirmed' },
      ]),
    ).toBe(false)
  })

  it('counts distinct rounds, not lobbies', () => {
    expect(
      stageIsComplete(1, [
        { roundNo: 1, status: 'confirmed' },
        { roundNo: 1, status: 'confirmed' },
        { roundNo: 1, status: 'confirmed' },
      ]),
    ).toBe(true)
  })

  it('is not complete with no lobbies at all', () => {
    expect(stageIsComplete(1, [])).toBe(false)
  })
})
