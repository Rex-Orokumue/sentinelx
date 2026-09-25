import { describe, expect, it, vi } from 'vitest'
import { fakeSupabase } from '@/lib/testing/fake-supabase'
import { HALL_OF_FAME_FIXTURE_TABLES } from '@/lib/testing/progress-fixtures'

const state = vi.hoisted(() => ({ fake: null as null | { client: unknown } }))
vi.mock('../anon-client', () => ({ createAnonClient: () => state.fake!.client }))
vi.mock('../auth', () => ({ authenticate: vi.fn(), optionalAuth: vi.fn().mockResolvedValue(null) }))
import { hallOfFameEndpoint } from './hall-of-fame'

async function call(qs = '') {
  state.fake = fakeSupabase(HALL_OF_FAME_FIXTURE_TABLES) as never
  return hallOfFameEndpoint.handler(new Request(`https://x.test/api/mobile/v1/hall-of-fame${qs}`))
}

describe('GET /hall-of-fame', () => {
  it('returns all sections with strict public cards and cache headers', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toContain('s-maxage=300')
    const { data } = await res.json()
    expect(data.awards.mvp).not.toBeNull()
    expect(data.champions.masters.length).toBeGreaterThan(0)
    expect(data.bronze.length).toBeGreaterThan(0)
    expect(Object.keys(data.awards.mvp).sort()).toEqual(['avatarUrl', 'country', 'displayName', 'frameUrl', 'id', 'isDeleted', 'kycVerified', 'membershipTier', 'sentinelTier', 'sxScore', 'username'])
    expect(Object.keys(data.champions).sort()).toEqual(['championsCup', 'communityClub', 'masters', 'open'])
  })

  it('unknown game slugs preserve web fallback-to-all behavior', async () => {
    const all = await (await call()).json()
    const unknown = await (await call('?game=nope')).json()
    expect(unknown.data.selectedGame).toBeNull()
    expect(unknown.data.champions).toEqual(all.data.champions)
  })
})
