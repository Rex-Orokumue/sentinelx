import { describe, it, expect } from 'vitest'
import {
  pickMVP,
  pickGoldenBoot,
  pickCategoryAward,
  deriveChampions,
  deriveThirdPlaces,
  type ChampionInput,
  type ThirdPlaceInput,
} from './awards'
import type { PlayerStatsInput } from '@/lib/rankings/leaderboard'
import type { BracketMatch } from '@/lib/tournaments/bracket'

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
    categoryStats: [],
    winsByGame: [],
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
    expect(
      pickGoldenBoot([p({ id: 'a', totalMatches: 0, categoryStats: [{ category: 'football', scored: 50, conceded: 0 }] })]),
    ).toBeNull()
  })

  it('returns null when nobody has scored in that category', () => {
    expect(pickGoldenBoot([p({ id: 'a', totalMatches: 3, wins: 5, categoryStats: [] })])).toBeNull()
  })

  it('picks the highest football-scoped goals scored', () => {
    const r = pickGoldenBoot([
      p({ id: 'a', totalMatches: 3, categoryStats: [{ category: 'football', scored: 12, conceded: 0 }] }),
      p({ id: 'b', totalMatches: 3, categoryStats: [{ category: 'football', scored: 20, conceded: 0 }] }),
    ])
    expect(r?.id).toBe('b')
  })

  it('breaks a goals tie by wins', () => {
    const r = pickGoldenBoot([
      p({ id: 'a', totalMatches: 5, categoryStats: [{ category: 'football', scored: 15, conceded: 0 }], wins: 2 }),
      p({ id: 'b', totalMatches: 5, categoryStats: [{ category: 'football', scored: 15, conceded: 0 }], wins: 4 }),
    ])
    expect(r?.id).toBe('b')
  })
})

describe('pickCategoryAward', () => {
  it('works identically for a non-football category', () => {
    const r = pickCategoryAward(
      [
        p({ id: 'a', totalMatches: 3, categoryStats: [{ category: 'shooter', scored: 40, conceded: 0 }] }),
        p({ id: 'b', totalMatches: 3, categoryStats: [{ category: 'shooter', scored: 55, conceded: 0 }] }),
      ],
      'shooter',
    )
    expect(r?.id).toBe('b')
  })
})

function finalMatch(over: Partial<BracketMatch>): BracketMatch {
  return {
    id: 'm',
    round: 'final',
    group_id: null,
    groupName: null,
    status: 'completed',
    score_a: 2,
    score_b: 1,
    scheduled_at: null,
    is_full_day: false,
    playerA: { id: 'pa', name: 'Ada' },
    playerB: { id: 'pb', name: 'Bill' },
    ...over,
  }
}

function champInput(over: Partial<ChampionInput> & { tournamentId: string }): ChampionInput {
  return {
    slug: over.tournamentId,
    title: `Cup ${over.tournamentId}`,
    gameName: 'DLS',
    tournamentEnd: '2026-01-01',
    finalMatch: finalMatch({}),
    ...over,
  }
}

describe('deriveChampions', () => {
  it('returns [] for empty input', () => {
    expect(deriveChampions([])).toEqual([])
  })

  it('emits the final winner as the champion', () => {
    const r = deriveChampions([champInput({ tournamentId: 't1' })])
    expect(r).toHaveLength(1)
    expect(r[0].champion).toEqual({ id: 'pa', name: 'Ada' })
    expect(r[0].slug).toBe('t1')
  })

  it('skips a tournament whose final is not completed', () => {
    const r = deriveChampions([
      champInput({ tournamentId: 't1', finalMatch: finalMatch({ status: 'scheduled' }) }),
    ])
    expect(r).toEqual([])
  })

  it('skips a tournament with a null final match', () => {
    const r = deriveChampions([champInput({ tournamentId: 't1', finalMatch: null })])
    expect(r).toEqual([])
  })

  it('skips a drawn or null-score final', () => {
    const draw = deriveChampions([
      champInput({ tournamentId: 't1', finalMatch: finalMatch({ score_a: 1, score_b: 1 }) }),
    ])
    expect(draw).toEqual([])
    const nullScore = deriveChampions([
      champInput({ tournamentId: 't2', finalMatch: finalMatch({ score_a: null }) }),
    ])
    expect(nullScore).toEqual([])
  })

  it('orders most-recent-first with nulls last', () => {
    const r = deriveChampions([
      champInput({ tournamentId: 'old', tournamentEnd: '2025-01-01' }),
      champInput({ tournamentId: 'none', tournamentEnd: null }),
      champInput({ tournamentId: 'new', tournamentEnd: '2026-06-01' }),
    ])
    expect(r.map((c) => c.tournamentId)).toEqual(['new', 'old', 'none'])
  })
})

function thirdPlaceMatch(over: Partial<BracketMatch>): BracketMatch {
  return {
    id: 'tp',
    round: 'third_place',
    group_id: null,
    groupName: null,
    status: 'completed',
    score_a: 1,
    score_b: 2,
    scheduled_at: null,
    is_full_day: false,
    playerA: { id: 'pa', name: 'Ada' },
    playerB: { id: 'pb', name: 'Bill' },
    ...over,
  }
}

function thirdPlaceInput(over: Partial<ThirdPlaceInput> & { tournamentId: string }): ThirdPlaceInput {
  return {
    slug: over.tournamentId,
    title: `Cup ${over.tournamentId}`,
    gameName: 'DLS',
    tournamentEnd: '2026-01-01',
    thirdPlaceMatch: thirdPlaceMatch({}),
    ...over,
  }
}

describe('deriveThirdPlaces', () => {
  it('returns [] for empty input', () => {
    expect(deriveThirdPlaces([])).toEqual([])
  })

  it('emits the third_place winner', () => {
    const r = deriveThirdPlaces([thirdPlaceInput({ tournamentId: 't1' })])
    expect(r).toHaveLength(1)
    expect(r[0].player).toEqual({ id: 'pb', name: 'Bill' })
    expect(r[0].slug).toBe('t1')
  })

  it('emits the credited player for an admin bye', () => {
    const r = deriveThirdPlaces([
      thirdPlaceInput({
        tournamentId: 't1',
        thirdPlaceMatch: thirdPlaceMatch({ status: 'bye', score_a: null, score_b: null }),
      }),
    ])
    expect(r[0].player).toEqual({ id: 'pa', name: 'Ada' })
  })

  it('skips a tournament with no third_place match', () => {
    const r = deriveThirdPlaces([thirdPlaceInput({ tournamentId: 't1', thirdPlaceMatch: null })])
    expect(r).toEqual([])
  })

  it('skips a drawn or in-progress third_place match', () => {
    expect(
      deriveThirdPlaces([
        thirdPlaceInput({ tournamentId: 't1', thirdPlaceMatch: thirdPlaceMatch({ score_a: 1, score_b: 1 }) }),
      ]),
    ).toEqual([])
    expect(
      deriveThirdPlaces([
        thirdPlaceInput({ tournamentId: 't2', thirdPlaceMatch: thirdPlaceMatch({ status: 'scheduled' }) }),
      ]),
    ).toEqual([])
  })

  it('orders most-recent-first with nulls last', () => {
    const r = deriveThirdPlaces([
      thirdPlaceInput({ tournamentId: 'old', tournamentEnd: '2025-01-01' }),
      thirdPlaceInput({ tournamentId: 'none', tournamentEnd: null }),
      thirdPlaceInput({ tournamentId: 'new', tournamentEnd: '2026-06-01' }),
    ])
    expect(r.map((c) => c.tournamentId)).toEqual(['new', 'old', 'none'])
  })
})
