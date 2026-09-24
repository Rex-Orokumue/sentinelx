import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase } from '@/lib/testing/fake-supabase'
import { PROFILE_TABLES, PROFILE_RPC, TARGET_USERNAME, DELETED_USERNAME, LOCKED_ONLY_ACHIEVEMENT_NAMES } from '@/lib/testing/profile-fixtures'

const { authenticate, optionalAuth } = vi.hoisted(() => ({ authenticate: vi.fn(), optionalAuth: vi.fn() }))
vi.mock('../auth', () => ({ authenticate, optionalAuth }))
const anon = vi.hoisted(() => ({ client: null as unknown }))
vi.mock('../anon-client', () => ({ createAnonClient: () => anon.client }))
const admin = vi.hoisted(() => ({ client: null as unknown }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => admin.client }))

import { playersSearchEndpoint, playerProfileEndpoint, playerFollowersEndpoint, playerFollowingEndpoint } from './players'

const req = (path: string, headers: Record<string, string> = {}) =>
  new Request(`https://x.test/api/mobile/v1${path}`, { headers })
const profile = (u: string, headers?: Record<string, string>) =>
  playerProfileEndpoint.handler(req(`/players/${u}`, headers), { params: { username: u } })

beforeEach(() => {
  anon.client = fakeSupabase(PROFILE_TABLES, { rpc: PROFILE_RPC }).client
  admin.client = fakeSupabase(PROFILE_TABLES).client
  optionalAuth.mockReset()
  optionalAuth.mockResolvedValue(null)
})

describe('GET /players/{username}', () => {
  it('returns the profile with a 60s public cache', async () => {
    const res = await profile(TARGET_USERNAME)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toContain('s-maxage=60')
    expect((await res.json()).data.player.username).toBe(TARGET_USERNAME)
  })

  it('404s for an unknown username', async () => {
    expect((await profile('nobody')).status).toBe(404)
  })

  it('404s for a deleted account', async () => {
    expect((await profile(DELETED_USERNAME)).status).toBe(404)
  })

  it('body is byte-identical with and without an Authorization header, even when auth resolves a user', async () => {
    const a = await (await profile(TARGET_USERNAME)).text()
    optionalAuth.mockResolvedValue({ userId: 'p1', userClient: {}, admin: {} })
    const b = await (await profile(TARGET_USERNAME, { authorization: 'Bearer x' })).text()
    expect(b).toBe(a)
  })

  it('contains no private-column names and no locked achievement text', async () => {
    const body = await (await profile(TARGET_USERNAME)).text()
    expect(body).not.toMatch(/whatsapp|phone|notification_prefs|referred|deletion/i)
    for (const name of LOCKED_ONLY_ACHIEVEMENT_NAMES) expect(body).not.toContain(name)
    expect(body).not.toContain('Hidden alpha description')
  })

  it("reads through the anon client, never the caller's", async () => {
    const trap = new Proxy({}, { get() { throw new Error('the caller client must not be used on a public endpoint') } })
    optionalAuth.mockResolvedValue({ userId: 'p1', userClient: trap, admin: trap })
    expect((await profile(TARGET_USERNAME, { authorization: 'Bearer x' })).status).toBe(200)
  })
})

describe('GET /players?q=', () => {
  it('returns list items in the strict shape, cached', async () => {
    const res = await playersSearchEndpoint.handler(req('/players?q=play'), { params: {} })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toContain('s-maxage=60')
    const items = (await res.json()).data
    expect(items.length).toBeGreaterThan(0)
    expect(Object.keys(items[0]).sort()).toEqual([
      'avatarUrl', 'displayName', 'equippedAvatarBorder', 'membershipTier', 'sentinelTier', 'sxScore', 'username',
    ])
  })

  it('works without a q param', async () => {
    expect((await playersSearchEndpoint.handler(req('/players'), { params: {} })).status).toBe(200)
  })
})

describe('followers / following', () => {
  it('404 for unknown and deleted users', async () => {
    for (const u of ['nobody', DELETED_USERNAME]) {
      expect((await playerFollowersEndpoint.handler(req(`/players/${u}/followers`), { params: { username: u } })).status).toBe(404)
      expect((await playerFollowingEndpoint.handler(req(`/players/${u}/following`), { params: { username: u } })).status).toBe(404)
    }
  })

  it('entries are strict; followers follow the target, following are who the target follows', async () => {
    const f = await playerFollowersEndpoint.handler(req(`/players/${TARGET_USERNAME}/followers`), { params: { username: TARGET_USERNAME } })
    const followers = (await f.json()).data
    expect(Object.keys(followers[0]).sort()).toEqual(['avatarUrl', 'displayName', 'id', 'membershipTier', 'username'])
    expect(followers.map((e: { id: string }) => e.id).sort()).toEqual(['p1', 'p3'])
    expect(f.headers.get('cache-control')).toContain('s-maxage=60')

    const g = await playerFollowingEndpoint.handler(req(`/players/${TARGET_USERNAME}/following`), { params: { username: TARGET_USERNAME } })
    expect((await g.json()).data.map((e: { id: string }) => e.id)).toEqual(['p3'])
  })
})
