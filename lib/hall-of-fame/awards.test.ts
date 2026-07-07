import { describe, it, expect } from 'vitest'
import { pickMVP, pickGoldenBoot } from './awards'
import type { PlayerStatsInput } from '@/lib/rankings/leaderboard'

function p(over: Partial<PlayerStatsInput> & { id: string }): PlayerStatsInput {
  return {
    username: over.id,
    displayName: null,
    avatarUrl: null,
    country: null,
    wins: 0,
    losses: 0,
    totalMatches: 0,
    goalsScored: 0,
    goalsConceded: 0,
    totalTitles: 0,
    sentinelScore: 70,
    sentinelTier: null,
    ...over,
  }
}

describe('pickMVP', () => {
  it('returns null when no eligible players', () => {
    expect(pickMVP([])).toBeNull()
    expect(pickMVP([p({ id: 'a', totalMatches: 0, sentinelScore: 99 })])).toBeNull()
  })

  it('picks the highest sentinel score', () => {
    const r = pickMVP([
      p({ id: 'a', totalMatches: 3, sentinelScore: 80 }),
      p({ id: 'b', totalMatches: 3, sentinelScore: 92 }),
    ])
    expect(r?.id).toBe('b')
  })

  it('at launch (flat 70 scores) resolves to most wins', () => {
    const r = pickMVP([
      p({ id: 'a', totalMatches: 5, wins: 2, sentinelScore: 70 }),
      p({ id: 'b', totalMatches: 5, wins: 4, sentinelScore: 70 }),
    ])
    expect(r?.id).toBe('b')
  })

  it('breaks a score+wins tie by win rate', () => {
    const r = pickMVP([
      p({ id: 'a', totalMatches: 10, wins: 6, sentinelScore: 70 }), // 60%
      p({ id: 'b', totalMatches: 8, wins: 6, sentinelScore: 70 }), // 75%
    ])
    expect(r?.id).toBe('b')
  })

  it('excludes ineligible players from selection', () => {
    const r = pickMVP([
      p({ id: 'a', totalMatches: 0, sentinelScore: 100 }),
      p({ id: 'b', totalMatches: 1, sentinelScore: 71 }),
    ])
    expect(r?.id).toBe('b')
  })
})

describe('pickGoldenBoot', () => {
  it('returns null when no eligible players', () => {
    expect(pickGoldenBoot([])).toBeNull()
    expect(pickGoldenBoot([p({ id: 'a', totalMatches: 0, goalsScored: 50 })])).toBeNull()
  })

  it('picks the highest goals scored', () => {
    const r = pickGoldenBoot([
      p({ id: 'a', totalMatches: 3, goalsScored: 12 }),
      p({ id: 'b', totalMatches: 3, goalsScored: 20 }),
    ])
    expect(r?.id).toBe('b')
  })

  it('breaks a goals tie by wins', () => {
    const r = pickGoldenBoot([
      p({ id: 'a', totalMatches: 5, goalsScored: 15, wins: 2 }),
      p({ id: 'b', totalMatches: 5, goalsScored: 15, wins: 4 }),
    ])
    expect(r?.id).toBe('b')
  })
})
