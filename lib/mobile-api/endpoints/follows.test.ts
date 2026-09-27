import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase } from '@/lib/testing/fake-supabase'
import { PROFILE_TABLES, OWNER_ID, TARGET_ID, TARGET_USERNAME, OWNER_USERNAME, DELETED_USERNAME } from '@/lib/testing/profile-fixtures'

const { authenticate, optionalAuth } = vi.hoisted(() => ({ authenticate: vi.fn(), optionalAuth: vi.fn() }))
vi.mock('../auth', () => ({ authenticate, optionalAuth }))
const { runIdempotent } = vi.hoisted(() => ({ runIdempotent: vi.fn() }))
vi.mock('../idempotency', () => ({ runIdempotent }))
const { notifyBoth } = vi.hoisted(() => ({ notifyBoth: vi.fn() }))
vi.mock('@/lib/notifications/send', () => ({ notifyBoth }))

import { myFollowsEndpoint, followEndpoint, unfollowEndpoint } from './follows'

interface Writes {
  upserted?: { follower_id: string }[] | null
  upsertError?: { code: string } | null
  deleteError?: { code: string } | null
}

// Reads come from the fixture DB; the two writes are hand-rolled so a test can dictate what the DB "did".
function userClient(w: Writes = {}) {
  const fake = fakeSupabase(PROFILE_TABLES)
  const upsert = vi.fn(() => ({ select: async () => ({ data: w.upserted ?? [], error: w.upsertError ?? null }) }))
  const del = vi.fn(() => ({ eq: () => ({ eq: async () => ({ error: w.deleteError ?? null }) }) }))
  const client = {
    from: (t: string) => (t === 'player_follows' ? { ...(fake.client.from(t) as object), upsert, delete: del } : fake.client.from(t)),
  }
  return { client, upsert, del }
}

const trap = new Proxy({}, { get() { throw new Error('the service-role client must not be touched by this endpoint') } })
const ctxFor = (client: unknown, userId = OWNER_ID) => ({ userId, userClient: client, admin: trap })

const put = (username: string, headers: Record<string, string> = { 'idempotency-key': 'k1' }) =>
  followEndpoint.handler(new Request(`https://x.test/api/mobile/v1/players/${username}/follow`, { method: 'PUT', headers }), { params: { username } })
const del = (username: string) =>
  unfollowEndpoint.handler(new Request(`https://x.test/api/mobile/v1/players/${username}/follow`, { method: 'DELETE' }), { params: { username } })

beforeEach(() => {
  authenticate.mockReset()
  runIdempotent.mockReset()
  notifyBoth.mockReset()
  runIdempotent.mockImplementation(async (_a: unknown, _args: unknown, run: () => unknown) => run())
})

describe('PUT /players/{username}/follow', () => {
  it('creates a follow: created:true, one notification, awaited before the response returns', async () => {
    let delivered = false
    notifyBoth.mockImplementation(() => new Promise<void>((r) => setTimeout(() => { delivered = true; r() }, 0)))
    const { client, upsert } = userClient({ upserted: [{ follower_id: OWNER_ID }] })
    authenticate.mockResolvedValue(ctxFor(client))
    const res = await put(TARGET_USERNAME)
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ following: true, created: true })
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(upsert).toHaveBeenCalledWith({ follower_id: OWNER_ID, following_id: TARGET_ID }, expect.anything())
    expect(notifyBoth).toHaveBeenCalledTimes(1)
    expect(notifyBoth.mock.calls[0][0]).toBe(TARGET_ID)
    expect(notifyBoth.mock.calls[0][1]).toMatchObject({ type: 'new_follower' })
    expect(delivered).toBe(true)
  })

  it('a notification failure never fails the follow', async () => {
    notifyBoth.mockRejectedValue(new Error('push down'))
    authenticate.mockResolvedValue(ctxFor(userClient({ upserted: [{ follower_id: OWNER_ID }] }).client))
    const res = await put(TARGET_USERNAME)
    expect(res.status).toBe(200)
    expect((await res.json()).data.created).toBe(true)
  })

  it('an existing follow reports created:false and does NOT notify', async () => {
    authenticate.mockResolvedValue(ctxFor(userClient({ upserted: [] }).client))
    const res = await put(TARGET_USERNAME)
    expect((await res.json()).data).toEqual({ following: true, created: false })
    expect(notifyBoth).not.toHaveBeenCalled()
  })

  it('self-follow is a 400 cannot_follow_self', async () => {
    authenticate.mockResolvedValue(ctxFor(userClient().client))
    const res = await put(OWNER_USERNAME)
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('cannot_follow_self')
    expect(notifyBoth).not.toHaveBeenCalled()
  })

  it('an RLS block (42501, dm_blocks) is a 403 follow_blocked', async () => {
    authenticate.mockResolvedValue(ctxFor(userClient({ upsertError: { code: '42501' } }).client))
    const res = await put(TARGET_USERNAME)
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('follow_blocked')
  })

  it('any other DB error is a 500 follow_failed', async () => {
    authenticate.mockResolvedValue(ctxFor(userClient({ upsertError: { code: 'XX000' } }).client))
    const res = await put(TARGET_USERNAME)
    expect(res.status).toBe(500)
    expect((await res.json()).error.code).toBe('follow_failed')
  })

  it('unknown and deleted usernames are 404', async () => {
    authenticate.mockResolvedValue(ctxFor(userClient().client))
    expect((await put('nobody')).status).toBe(404)
    expect((await put(DELETED_USERNAME)).status).toBe(404)
  })

  it('requires an Idempotency-Key header', async () => {
    authenticate.mockResolvedValue(ctxFor(userClient().client))
    const res = await put(TARGET_USERNAME, {})
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('idempotency_key_required')
  })

  it('a replayed request returns the stored response and fires NOTHING', async () => {
    const { client, upsert } = userClient({ upserted: [{ follower_id: OWNER_ID }] })
    authenticate.mockResolvedValue(ctxFor(client))
    runIdempotent.mockResolvedValue({ status: 200, body: { data: { following: true, created: true } } })
    const res = await put(TARGET_USERNAME)
    expect(await res.json()).toEqual({ data: { following: true, created: true } })
    expect(upsert).not.toHaveBeenCalled()
    expect(notifyBoth).not.toHaveBeenCalled()
  })

  it('runs on the caller RLS client — the service-role client is never touched', async () => {
    authenticate.mockResolvedValue(ctxFor(userClient({ upserted: [{ follower_id: OWNER_ID }] }).client))
    notifyBoth.mockResolvedValue(undefined)
    expect((await put(TARGET_USERNAME)).status).toBe(200) // `trap` would have thrown a 500 if admin were read
  })
})

describe('DELETE /players/{username}/follow', () => {
  it('unfollows', async () => {
    const { client, del: delSpy } = userClient()
    authenticate.mockResolvedValue(ctxFor(client))
    const res = await del(TARGET_USERNAME)
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ following: false })
    expect(delSpy).toHaveBeenCalled()
  })

  it('404 for unknown, 500 on a DB error', async () => {
    authenticate.mockResolvedValue(ctxFor(userClient().client))
    expect((await del('nobody')).status).toBe(404)
    authenticate.mockResolvedValue(ctxFor(userClient({ deleteError: { code: 'x' } }).client))
    const res = await del(TARGET_USERNAME)
    expect(res.status).toBe(500)
    expect((await res.json()).error.code).toBe('unfollow_failed')
  })
})

describe('GET /me/follows', () => {
  it("returns exactly the caller's two id sets, no-store", async () => {
    authenticate.mockResolvedValue(ctxFor(userClient().client, TARGET_ID))
    const res = await myFollowsEndpoint.handler(new Request('https://x.test/api/mobile/v1/me/follows'))
    expect(res.headers.get('cache-control')).toBe('no-store')
    const data = (await res.json()).data
    expect(Object.keys(data).sort()).toEqual(['followerIds', 'followingIds'])
    expect(data.followingIds).toEqual(['p3']) // p2 follows p3
    expect(data.followerIds.sort()).toEqual(['p1', 'p3']) // p1 and p3 follow p2
  })
})
