import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase } from '@/lib/testing/fake-supabase'
import { PROFILE_TABLES, PROFILE_RPC, OWNER_ID } from '@/lib/testing/profile-fixtures'
import { Errors } from '../errors'

const { authenticate, optionalAuth } = vi.hoisted(() => ({ authenticate: vi.fn(), optionalAuth: vi.fn() }))
vi.mock('../auth', () => ({ authenticate, optionalAuth }))

import { myProgressEndpoint } from './progress'

const call = () => myProgressEndpoint.handler(new Request('https://x.test/api/mobile/v1/me/progress'))

beforeEach(() => {
  authenticate.mockReset()
})

describe('GET /me/progress', () => {
  it('returns the owner-only progress payload, no-store, with exactly the documented keys', async () => {
    const user = fakeSupabase(PROFILE_TABLES, { rpc: PROFILE_RPC })
    const admin = fakeSupabase(PROFILE_TABLES)
    authenticate.mockResolvedValue({ userId: OWNER_ID, userClient: user.client, admin: admin.client })
    const res = await call()
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const data = (await res.json()).data
    expect(Object.keys(data).sort()).toEqual([
      'coinBalance', 'membershipTier', 'seasonStanding', 'sentinelTier', 'sxScore', 'tierProgress', 'xp',
    ])
    expect(Object.keys(data.tierProgress).sort()).toEqual(['current', 'next', 'xpForNextTier', 'xpIntoTier'])
    expect(Object.keys(data.seasonStanding).sort()).toEqual([
      'monthlyPoints', 'monthlyRank', 'points', 'pointsAtRankSixteen', 'rank', 'seasonName',
    ])
    expect(data.coinBalance).toBe(1234)
  })

  it('only ever asks the admin client about the authenticated user', async () => {
    const admin = fakeSupabase(PROFILE_TABLES)
    authenticate.mockResolvedValue({ userId: OWNER_ID, userClient: fakeSupabase(PROFILE_TABLES).client, admin: admin.client })
    await call()
    // the coin read is the only per-player admin read; the season reads are season/game scoped, not player-keyed
    expect(admin.queries.filter((q) => q.startsWith('sx_coins'))).toEqual(['sx_coins:select|eq(player_id)'])
  })

  it('is a 401 without a signed-in user', async () => {
    authenticate.mockImplementation(async () => {
      throw Errors.unauthorized()
    })
    expect((await call()).status).toBe(401)
  })

  it('is a 404 when the profile row does not exist', async () => {
    authenticate.mockResolvedValue({ userId: 'ghost-id', userClient: fakeSupabase(PROFILE_TABLES).client, admin: fakeSupabase(PROFILE_TABLES).client })
    expect((await call()).status).toBe(404)
  })
})
