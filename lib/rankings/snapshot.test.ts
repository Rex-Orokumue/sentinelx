import { describe, it, expect } from 'vitest'
import { buildGlobalSnapshotRows, buildGameSnapshotRows, type GameWinEntry } from './snapshot'
import type { PlayerStatsInput } from './leaderboard'

const player = (over: Partial<PlayerStatsInput> & { id: string }): PlayerStatsInput => ({
  username: over.id,
  displayName: null,
  avatarUrl: null,
  country: null,
  wins: 0,
  losses: 0,
  totalMatches: 1,
  goalsScored: 0,
  goalsConceded: 0,
  categoryStats: [],
  gameStats: [],
  winsByGame: [],
  totalTitles: 0,
  sxScore: 700,
  sentinelTier: null,
  membershipTier: 'recruit',
  ...over,
})

const DAY = '2026-09-06'

describe('buildGlobalSnapshotRows', () => {
  it('ranks by SX Score, best first, and stamps the day', () => {
    const rows = buildGlobalSnapshotRows(
      [player({ id: 'low', sxScore: 700 }), player({ id: 'high', sxScore: 900 })],
      DAY,
    )
    expect(rows[0]).toMatchObject({
      player_id: 'high',
      rank: 1,
      metric_value: 900,
      game_id: null,
      captured_on: DAY,
    })
    expect(rows[1]).toMatchObject({ player_id: 'low', rank: 2, metric_value: 700 })
  })

  it('excludes players below the eligibility gate', () => {
    const rows = buildGlobalSnapshotRows(
      [player({ id: 'played', totalMatches: 1 }), player({ id: 'never', totalMatches: 0 })],
      DAY,
    )
    expect(rows.map((r) => r.player_id)).toEqual(['played'])
  })

  it('returns nothing when nobody is eligible', () => {
    expect(buildGlobalSnapshotRows([player({ id: 'x', totalMatches: 0 })], DAY)).toEqual([])
  })
})

describe('buildGameSnapshotRows', () => {
  const e = (playerId: string, wins: number, sxScore = 700): GameWinEntry => ({
    playerId,
    wins,
    sxScore,
  })

  it('ranks by wins in that game and carries the game id', () => {
    const rows = buildGameSnapshotRows([e('a', 2), e('b', 5)], 'g1', DAY)
    expect(rows[0]).toMatchObject({
      player_id: 'b',
      rank: 1,
      metric_value: 5,
      game_id: 'g1',
      captured_on: DAY,
    })
    expect(rows[1]).toMatchObject({ player_id: 'a', rank: 2, metric_value: 2 })
  })

  it('breaks a wins tie on SX Score so the order is deterministic', () => {
    const rows = buildGameSnapshotRows([e('lower', 3, 700), e('higher', 3, 950)], 'g1', DAY)
    expect(rows.map((r) => r.player_id)).toEqual(['higher', 'lower'])
  })

  it('omits players with no wins in that game', () => {
    expect(buildGameSnapshotRows([e('a', 2), e('b', 0)], 'g1', DAY).map((r) => r.player_id)).toEqual([
      'a',
    ])
  })

  it('returns nothing for an empty game', () => {
    expect(buildGameSnapshotRows([], 'g1', DAY)).toEqual([])
  })
})
