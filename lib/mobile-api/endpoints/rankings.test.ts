import { describe, expect, it, vi } from 'vitest'
import { fakeSupabase } from '@/lib/testing/fake-supabase'
import { FIXTURE_TABLES, VIEWER_ID } from '@/lib/testing/progress-fixtures'

const state = vi.hoisted(() => ({ fake: null as null | { client: unknown; queries: string[] } }))
vi.mock('../anon-client', () => ({ createAnonClient: () => state.fake!.client }))
const { authenticate, optionalAuth } = vi.hoisted(() => ({ authenticate: vi.fn(), optionalAuth: vi.fn() }))
vi.mock('../auth', () => ({ authenticate, optionalAuth }))

import { Errors } from '../errors'
import { rankingsEndpoint, rankingsMeEndpoint } from './rankings'

const url = (path = '', qs = '') => `https://x.test/api/mobile/v1/rankings${path}${qs}`
function fresh() { state.fake = fakeSupabase(FIXTURE_TABLES) as never }

describe('GET /rankings literal parity', () => {
  it('defaults to Wins, exposes tabs, and returns page-local ranks', async () => {
    fresh(); optionalAuth.mockResolvedValue(null)
    const res = await rankingsEndpoint.handler(new Request(url()))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toContain('s-maxage=60')
    const { data } = await res.json()
    expect(data.scope).toMatchObject({ game: null, serverMetric: 'score', metric: 'wins', tabGame: null })
    expect(data.tabs.map((t: { key: string }) => t.key)).toEqual(['wins', 'score', 'football', 'shooter'])
    expect(data.rows.map((r: { rank: number }) => r.rank)).toEqual(data.rows.map((_: unknown, i: number) => i + 1))
    expect(data.rows.every((r: { winsByGame: unknown[] }) => Array.isArray(r.winsByGame))).toBe(true)
    expect(data.rows.some((r: { winsByGame: unknown[] }) => r.winsByGame.length > 0)).toBe(true)
  })

  it('re-sorts the same page slice and honors only valid multi-game subfilters', async () => {
    fresh(); optionalAuth.mockResolvedValue(null)
    const wins = (await (await rankingsEndpoint.handler(new Request(url('', '?metric=wins')))).json()).data
    fresh()
    const score = (await (await rankingsEndpoint.handler(new Request(url('', '?metric=score')))).json()).data
    expect(new Set(score.rows.map((r: { player: { id: string } }) => r.player.id))).toEqual(new Set(wins.rows.map((r: { player: { id: string } }) => r.player.id)))
    expect(score.rows.every((r: { winsByGame: unknown[] }) => r.winsByGame.length === 0)).toBe(true)

    fresh()
    const football = (await (await rankingsEndpoint.handler(new Request(url('', '?metric=football&tabGame=dls')))).json()).data
    expect(football.scope.tabGame).toBe('dls')
    expect(football.subGames.map((g: { slug: string }) => g.slug)).toEqual(['dls', 'ea-fc-mobile'])
    fresh()
    const ignored = (await (await rankingsEndpoint.handler(new Request(url('', '?metric=shooter&tabGame=free-fire')))).json()).data
    expect(ignored.scope.tabGame).toBeNull()
    expect(ignored.subGames).toEqual([])
  })

  it('is byte-identical with and without a bearer', async () => {
    fresh(); optionalAuth.mockResolvedValue(null)
    const a = await (await rankingsEndpoint.handler(new Request(url()))).text()
    fresh(); optionalAuth.mockResolvedValue({ userId: VIEWER_ID })
    const b = await (await rankingsEndpoint.handler(new Request(url(), { headers: { authorization: 'Bearer t' } }))).text()
    expect(b).toBe(a)
  })
})

describe('GET /rankings/me', () => {
  it('requires auth and returns a global rank with current metric value', async () => {
    fresh(); authenticate.mockRejectedValue(Errors.unauthorized())
    expect((await rankingsMeEndpoint.handler(new Request(url('/me')))).status).toBe(401)
    fresh(); authenticate.mockResolvedValue({ userId: VIEWER_ID, admin: {}, userClient: {} })
    const res = await rankingsMeEndpoint.handler(new Request(url('/me', '?metric=football&tabGame=dls')))
    expect(res.headers.get('cache-control')).toBe('no-store')
    const { data } = await res.json()
    expect(data.row.player.id).toBe(VIEWER_ID)
    expect(data.row.rank).toBeGreaterThan(0)
    expect(data.row.winsByGame).toEqual([])
  })
})
