import { describe, expect, it, vi } from 'vitest'
import { fakeSupabase } from '@/lib/testing/fake-supabase'
import { SEASON_FIXTURE_TABLES } from '@/lib/testing/progress-fixtures'

const state = vi.hoisted(() => ({ fake: null as null | { client: unknown } }))
vi.mock('../anon-client', () => ({ createAnonClient: () => state.fake!.client }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => state.fake!.client }))
vi.mock('../auth', () => ({ authenticate: vi.fn(), optionalAuth: vi.fn().mockResolvedValue(null) }))

import { seasonDetailEndpoint, seasonsListEndpoint } from './seasons'

describe('season endpoints exact exposed fields', () => {
  it('lists seasons with only public summary fields', async () => {
    state.fake = fakeSupabase(SEASON_FIXTURE_TABLES) as never
    const { data } = await (await seasonsListEndpoint.handler(new Request('https://x.test/api/mobile/v1/seasons'))).json()
    expect(Object.keys(data.seasons[0]).sort()).toEqual(['endDate', 'id', 'name', 'slug', 'startDate'])
  })

  it('maps every service-role object explicitly and drops poison fields', async () => {
    state.fake = fakeSupabase({
      ...SEASON_FIXTURE_TABLES,
      seasons: [{ ...SEASON_FIXTURE_TABLES.seasons[0], internal_note: 'SECRET' }],
      profiles: SEASON_FIXTURE_TABLES.profiles.map((p) => ({ ...p, whatsapp_number: '+234' })),
    }) as never
    const res = await seasonDetailEndpoint.handler(new Request('https://x.test/api/mobile/v1/seasons/season-1'))
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).not.toContain('SECRET')
    expect(body).not.toContain('whatsapp')
    const { data } = JSON.parse(body)
    expect(Object.keys(data.season).sort()).toEqual(['endDate', 'id', 'name', 'slug', 'startDate'])
    expect(data.games.some((g: { leaderboard: unknown[] }) => g.leaderboard.length > 0)).toBe(true)
    for (const game of data.games) {
      expect(Object.keys(game).sort()).toEqual(['gameId', 'gameName', 'gameSlug', 'leaderboard', 'tierLabels', 'tournaments'])
      for (const row of game.leaderboard) expect(Object.keys(row).sort()).toEqual(['avatarUrl', 'displayName', 'isProvisional', 'playerId', 'points', 'sxScore', 'username'])
      for (const tournament of game.tournaments) expect(Object.keys(tournament).sort()).toEqual(['id', 'invitationOnly', 'slug', 'status', 'title', 'tournamentStart', 'tournamentType'])
    }
  })

  it('404s unknown slugs and sets public cache headers', async () => {
    state.fake = fakeSupabase(SEASON_FIXTURE_TABLES) as never
    expect((await seasonDetailEndpoint.handler(new Request('https://x.test/api/mobile/v1/seasons/nope'))).status).toBe(404)
    state.fake = fakeSupabase(SEASON_FIXTURE_TABLES) as never
    expect((await seasonsListEndpoint.handler(new Request('https://x.test/api/mobile/v1/seasons'))).headers.get('cache-control')).toContain('s-maxage=300')
  })
})
