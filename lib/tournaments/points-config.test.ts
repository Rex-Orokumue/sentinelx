import { describe, it, expect } from 'vitest'
import {
  DEFAULT_POINTS_CONFIG,
  parsePointsConfig,
  placementPointsFor,
  scoreLobbyResult,
  type PointsConfig,
} from './points-config'

const ff: PointsConfig = DEFAULT_POINTS_CONFIG['free-fire']

describe('DEFAULT_POINTS_CONFIG', () => {
  it('uses the real FFWS table for Free Fire', () => {
    expect(ff.placement).toEqual([12, 9, 8, 7, 6, 5, 4, 3, 2, 1])
    expect(ff.perKill).toBe(1)
  })

  it('uses the real PMGC table for PUBG Mobile', () => {
    expect(DEFAULT_POINTS_CONFIG['pubg-mobile'].placement).toEqual([10, 6, 5, 4, 3, 2, 1, 1])
  })
})

describe('placementPointsFor', () => {
  it('awards the table value for a placing inside the table', () => {
    expect(placementPointsFor(ff, 1)).toBe(12)
    expect(placementPointsFor(ff, 2)).toBe(9)
    expect(placementPointsFor(ff, 10)).toBe(1)
  })

  it('awards zero beyond the end of the table', () => {
    // A 48-player lobby with a 10-deep table: 11th and worse score nothing for
    // placement, but their kills still count.
    expect(placementPointsFor(ff, 11)).toBe(0)
    expect(placementPointsFor(ff, 48)).toBe(0)
  })

  it('awards zero for a nonsensical placing rather than crashing', () => {
    // The DB CHECK forbids placement < 1, but this is a pure function and a
    // caller may hand it unvalidated form input.
    expect(placementPointsFor(ff, 0)).toBe(0)
    expect(placementPointsFor(ff, -3)).toBe(0)
  })
})

describe('scoreLobbyResult', () => {
  it('adds placement and kill points', () => {
    // A Booyah with 7 kills: 12 + 7.
    expect(scoreLobbyResult(ff, { placement: 1, kills: 7 })).toEqual({
      placementPoints: 12,
      killPoints: 7,
      totalPoints: 19,
    })
  })

  it('scores kills for a player who placed outside the table', () => {
    expect(scoreLobbyResult(ff, { placement: 20, kills: 4 })).toEqual({
      placementPoints: 0,
      killPoints: 4,
      totalPoints: 4,
    })
  })

  it('honours a per-kill weight other than 1', () => {
    const doubled: PointsConfig = { placement: [10], perKill: 2 }
    expect(scoreLobbyResult(doubled, { placement: 1, kills: 3 })).toEqual({
      placementPoints: 10,
      killPoints: 6,
      totalPoints: 16,
    })
  })

  it('treats negative kills as zero', () => {
    expect(scoreLobbyResult(ff, { placement: 1, kills: -2 }).killPoints).toBe(0)
  })
})

describe('parsePointsConfig', () => {
  it('reads the jsonb shape stored on the stage', () => {
    expect(parsePointsConfig({ placement: [12, 9, 8], per_kill: 1 })).toEqual({
      placement: [12, 9, 8],
      perKill: 1,
    })
  })

  it('defaults per_kill to zero when absent', () => {
    // A placement-only ruleset is legitimate; a missing key must not become NaN.
    expect(parsePointsConfig({ placement: [10] })).toEqual({ placement: [10], perKill: 0 })
  })

  it('rejects malformed configs rather than half-reading them', () => {
    // Returning null lets the caller fall back to the game default. A partly
    // parsed config would score a real tournament wrongly and silently.
    expect(parsePointsConfig(null)).toBeNull()
    expect(parsePointsConfig({})).toBeNull()
    expect(parsePointsConfig({ placement: 'lots' })).toBeNull()
    expect(parsePointsConfig({ placement: [1, 'two'] })).toBeNull()
    expect(parsePointsConfig({ placement: [1], per_kill: 'one' })).toBeNull()
    expect(parsePointsConfig('{"placement":[1]}')).toBeNull()
  })

  it('rejects negative values anywhere', () => {
    expect(parsePointsConfig({ placement: [-1], per_kill: 1 })).toBeNull()
    expect(parsePointsConfig({ placement: [1], per_kill: -1 })).toBeNull()
  })
})
