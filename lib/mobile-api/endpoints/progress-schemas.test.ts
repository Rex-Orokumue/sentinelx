import { describe, expect, it } from 'vitest'
import type { RankedPlayer } from '@/lib/rankings/leaderboard'
import { mapPlayerCard, mapRankingRow, playerCardSchema, rankingRowSchema } from './progress-schemas'

const base: RankedPlayer = {
  id: 'p1', username: 'ada', displayName: 'Ada', deletedAt: null, avatarUrl: 'https://x/a.png', country: 'NG',
  wins: 5, losses: 2, totalMatches: 7, goalsScored: 20, goalsConceded: 8,
  categoryStats: [{ category: 'football', scored: 20, conceded: 8 }],
  gameStats: [{ gameId: 'g-dls', scored: 12, conceded: 4 }],
  winsByGame: [{ game: 'Dream League Soccer', wins: 5 }],
  totalTitles: 1, sxScore: 980, sentinelTier: 'trusted', membershipTier: 'bronze',
  kycVerified: true, frameUrl: '/frames/gold.webp', winRate: 5 / 7, goalDiff: 12, rank: 1,
}

describe('progress schema mappers', () => {
  it('maps only public player-card fields and tombstones deleted identities', () => {
    const card = mapPlayerCard({ ...base, whatsapp_number: '+234' } as never)
    expect(Object.keys(card).sort()).toEqual(['avatarUrl', 'country', 'displayName', 'frameUrl', 'id', 'isDeleted', 'kycVerified', 'membershipTier', 'sentinelTier', 'sxScore', 'username'])
    expect(playerCardSchema.parse(card)).toEqual(card)
    expect(mapPlayerCard({ ...base, deletedAt: '2026-09-01' })).toMatchObject({
      isDeleted: true, username: null, displayName: null, avatarUrl: null, frameUrl: null,
    })
  })

  it('maps the literal-parity ranking row shape', () => {
    const row = mapRankingRow(base, {
      trend: { direction: 'up', delta: 2 }, streak: 3, metricValue: 12, includeWinsByGame: true,
      gameIdByName: new Map([['Dream League Soccer', 'g-dls']]),
    })
    expect(row).toMatchObject({ rank: 1, metricValue: 12, streak: 3 })
    expect(row.winsByGame).toEqual([{ gameId: 'g-dls', gameName: 'Dream League Soccer', wins: 5 }])
    expect(rankingRowSchema.parse(row)).toEqual(row)
    expect(() => rankingRowSchema.parse({ ...row, whatsapp: 'x' })).toThrow()
  })
})
