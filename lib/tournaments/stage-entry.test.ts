import { describe, it, expect } from 'vitest'
import { seedOrderForRound, stageIntake } from './stage-entry'
import type { PointsStandingRow } from './points-standings'

function row(entrantId: string, rank: number, totalPoints: number): PointsStandingRow {
  return {
    entrantId,
    displayName: entrantId,
    played: 1,
    totalPoints,
    totalKills: 0,
    bestPlacement: rank,
    lastRoundPlacement: rank,
    rank,
    advancing: false,
    unresolvedTieWith: [],
  }
}

describe('stageIntake', () => {
  it('takes the whole active field for the first stage', () => {
    expect(stageIntake(null, ['a', 'b', 'c'], null)).toEqual(['a', 'b', 'c'])
  })

  it('takes the top N of the previous stage for a later stage', () => {
    const prev = [row('b', 1, 30), row('a', 2, 20), row('c', 3, 10)]
    expect(stageIntake(prev, ['a', 'b', 'c'], 2)).toEqual(['b', 'a'])
  })

  it('returns them in finishing order, strongest first', () => {
    const prev = [row('c', 1, 30), row('a', 2, 20)]
    expect(stageIntake(prev, ['a', 'c'], 2)).toEqual(['c', 'a'])
  })

  it('takes everyone when the previous stage advances more than it had', () => {
    // Guarded against elsewhere (validateStagePlan), but this must not produce
    // undefined entries if it slips through.
    const prev = [row('a', 1, 10)]
    expect(stageIntake(prev, ['a'], 5)).toEqual(['a'])
  })

  it('returns nothing when the previous stage has no standings yet', () => {
    expect(stageIntake([], ['a', 'b'], 2)).toEqual([])
  })
})

describe('seedOrderForRound', () => {
  it('shuffles round 1, keeping every entrant exactly once', () => {
    // No standings exist yet, so any seeding would be fictional.
    const intake = ['a', 'b', 'c', 'd', 'e']
    const out = seedOrderForRound(1, intake, [])
    expect([...out].sort()).toEqual([...intake].sort())
  })

  it('seeds later rounds strongest-first on the running standings', () => {
    const standing = [row('c', 1, 30), row('a', 2, 20), row('b', 3, 10)]
    expect(seedOrderForRound(2, ['a', 'b', 'c'], standing)).toEqual(['c', 'a', 'b'])
  })

  it('appends entrants missing from the standings rather than dropping them', () => {
    // Someone who has not played a scored round yet still has to be placed in
    // a lobby — dropping them would silently remove a paying entrant.
    const standing = [row('a', 1, 10)]
    const out = seedOrderForRound(2, ['a', 'b'], standing)
    expect(out).toHaveLength(2)
    expect(out[0]).toBe('a')
    expect(out).toContain('b')
  })

  it('ignores standings rows for entrants not in this stage', () => {
    const standing = [row('zzz', 1, 99), row('a', 2, 10)]
    expect(seedOrderForRound(2, ['a'], standing)).toEqual(['a'])
  })
})
