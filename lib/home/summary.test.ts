import { describe, it, expect, vi } from 'vitest'
import { sortFeaturedFirst, sumPrizePool, mapBanner, mapLeaderboardRow, mapTournamentCard, buildHomeSummary } from './summary'

vi.mock('@/lib/tournaments/champions', () => ({
  fetchChampions: vi.fn().mockResolvedValue([]),
  latestChampion: vi.fn(() => null),
}))

describe('sortFeaturedFirst', () => {
  it('moves the active tournament to the front', () => {
    const t = (id: string, status: string) => ({ id, status }) as never
    const sorted = sortFeaturedFirst([t('a', 'registration_open'), t('b', 'active'), t('c', 'registration_open')])
    expect(sorted.map((x: { id: string }) => x.id)).toEqual(['b', 'a', 'c'])
  })

  it('leaves order unchanged when nothing is active', () => {
    const t = (id: string) => ({ id, status: 'registration_open' }) as never
    expect(sortFeaturedFirst([t('a'), t('b')]).map((x: { id: string }) => x.id)).toEqual(['a', 'b'])
  })
})

describe('sumPrizePool', () => {
  it('sums prize_pool across completed tournaments, treating null as 0', () => {
    expect(sumPrizePool([{ prize_pool: 5000 }, { prize_pool: null }, { prize_pool: 3000 }])).toBe(8000)
  })
  it('returns 0 for an empty or null list', () => {
    expect(sumPrizePool([])).toBe(0)
    expect(sumPrizePool(null)).toBe(0)
  })
})

describe('mapBanner', () => {
  it('maps a banner row to camelCase', () => {
    expect(mapBanner({ title: 'Hero', image_url: '/a.png', link_url: '/tournaments' })).toEqual({
      title: 'Hero', imageUrl: '/a.png', linkUrl: '/tournaments',
    })
  })
  it('returns null for no active banner', () => {
    expect(mapBanner(null)).toBeNull()
  })
})

describe('mapLeaderboardRow', () => {
  it('maps a profile row to camelCase', () => {
    expect(mapLeaderboardRow({
      id: 'p1', username: 'ada', display_name: 'Ada', avatar_url: null, wins: 10, total_matches: 15,
      sx_score: 900, sentinel_tier: 'elite', membership_tier: 'guardian', equipped_avatar_border: 'gold',
    })).toEqual({
      id: 'p1', username: 'ada', displayName: 'Ada', avatarUrl: null, wins: 10, totalMatches: 15,
      sxScore: 900, sentinelTier: 'elite', membershipTier: 'guardian', equippedAvatarBorder: 'gold',
    })
  })
})

describe('mapTournamentCard', () => {
  it('maps a TournamentCardData row to camelCase for the wire response (buildHomeSummary itself stays snake_case for the web page’s <TournamentCard> component)', () => {
    expect(mapTournamentCard({
      id: 't1', title: 'FC Mobile Cup', slug: 'fc-mobile-cup', prize_pool: 8000, registration_fee: 500,
      status: 'active', tournament_start: '2026-09-25T18:00:00Z', registration_end: '2026-09-24T18:00:00Z',
      tournament_end: null, max_players: 16, format: 'knockout', tournament_type: 'masters', card_image_url: null,
      games: { name: 'EA FC Mobile', icon_url: '/icons/fc.png', slug: 'ea-fc-mobile', category: 'football' },
    })).toEqual({
      id: 't1', title: 'FC Mobile Cup', slug: 'fc-mobile-cup', prizePool: 8000, registrationFee: 500,
      status: 'active', tournamentStart: '2026-09-25T18:00:00Z', registrationEnd: '2026-09-24T18:00:00Z',
      tournamentEnd: null, maxPlayers: 16, format: 'knockout', tournamentType: 'masters', cardImageUrl: null,
      game: { name: 'EA FC Mobile', iconUrl: '/icons/fc.png', slug: 'ea-fc-mobile', category: 'football' },
    })
  })

  it('maps a null games relation to a null game', () => {
    expect(mapTournamentCard({
      id: 't2', title: 'x', slug: 'x', prize_pool: 0, registration_fee: 0, status: 'draft',
      tournament_start: null, registration_end: null, tournament_end: null, max_players: null, games: null,
    }).game).toBeNull()
  })
})

describe('buildHomeSummary', () => {
  it('composes all six queries plus the champions teaser into one summary', async () => {
    const tournamentsSelect = { in: () => ({ order: () => ({ limit: async () => ({ data: [{ id: 't1', status: 'active' }] }) }) }) }
    const completedSelect = { eq: async () => ({ data: [{ prize_pool: 1000 }] }) }
    const profilesCount = async () => ({ count: 42 })
    const tournamentsCount = { neq: async () => ({ count: 7 }) }
    const from = vi.fn((table: string) => {
      if (table === 'tournaments') {
        return {
          select: (cols: string) => (cols.includes('*') ? tournamentsCount : cols === 'prize_pool' ? completedSelect : tournamentsSelect),
        }
      }
      if (table === 'profiles') {
        return {
          select: (cols: string, opts?: { count?: string; head?: boolean }) =>
            opts?.count
              ? profilesCount()
              : { order: () => ({ gt: () => ({ limit: async () => ({ data: [{ id: 'p1', username: 'ada', display_name: 'Ada', avatar_url: null, wins: 10, total_matches: 15, sx_score: 900, sentinel_tier: 'elite', membership_tier: 'guardian', equipped_avatar_border: null }] }) }) }) },
        }
      }
      if (table === 'homepage_banners') {
        return { select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }) }
      }
      throw new Error(`unexpected table ${table}`)
    })
    const supabase = { from } as never

    const summary = await buildHomeSummary(supabase)
    expect(summary.featuredTournament).toEqual({ id: 't1', status: 'active' })
    expect(summary.upcomingTournaments).toEqual([])
    expect(summary.leaderboardTeaser).toHaveLength(1)
    expect(summary.leaderboardTeaser[0].username).toBe('ada')
    expect(summary.banner).toBeNull()
    expect(summary.hallOfFame).toBeNull()
    expect(summary.stats).toEqual({ playerCount: 42, tournamentCount: 7, prizesPaidOut: 1000 })
  })
})
