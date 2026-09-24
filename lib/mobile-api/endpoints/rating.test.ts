import { describe, it, expect, vi } from 'vitest'

const { authenticate } = vi.hoisted(() => ({ authenticate: vi.fn() }))
vi.mock('../auth', () => ({ authenticate, optionalAuth: vi.fn() }))
const { runIdempotent } = vi.hoisted(() => ({ runIdempotent: vi.fn() }))
vi.mock('../idempotency', () => ({ runIdempotent }))
const { submitOpponentRating } = vi.hoisted(() => ({ submitOpponentRating: vi.fn() }))
vi.mock('@/lib/scoring/opponent-rating-service', () => ({ submitOpponentRating }))

import { ratingEndpoint } from './rating'

function postReq() {
  return new Request('https://x.test/api/mobile/v1/matches/m1/rating', {
    method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'k1' }, body: JSON.stringify({ stars: 5 }),
  })
}

describe('ratingEndpoint', () => {
  it('returns {success: true} on success', async () => {
    authenticate.mockResolvedValue({ userId: 'u1', admin: 'admin', userClient: 'sb' })
    runIdempotent.mockImplementation(async (_admin, _args, run) => run())
    submitOpponentRating.mockResolvedValue({ ok: true })
    const res = await ratingEndpoint.handler(postReq(), { params: { id: 'm1' } })
    expect(submitOpponentRating).toHaveBeenCalledWith('admin', { matchId: 'm1', raterId: 'u1', stars: 5 })
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ success: true })
  })

  it('maps already_rated to a 409', async () => {
    authenticate.mockResolvedValue({ userId: 'u1', admin: 'admin', userClient: 'sb' })
    runIdempotent.mockImplementation(async (_admin, _args, run) => run())
    submitOpponentRating.mockResolvedValue({ ok: false, errorCode: 'already_rated' })
    const res = await ratingEndpoint.handler(postReq(), { params: { id: 'm1' } })
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('already_rated')
  })
})
