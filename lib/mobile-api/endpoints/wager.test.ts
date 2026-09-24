import { describe, it, expect, vi } from 'vitest'

const { authenticate } = vi.hoisted(() => ({ authenticate: vi.fn() }))
vi.mock('../auth', () => ({ authenticate, optionalAuth: vi.fn() }))
const { runIdempotent } = vi.hoisted(() => ({ runIdempotent: vi.fn() }))
vi.mock('../idempotency', () => ({ runIdempotent }))
const { performPlaceWager } = vi.hoisted(() => ({ performPlaceWager: vi.fn() }))
vi.mock('@/lib/wagers/place-wager-service', () => ({ performPlaceWager }))

import { wagerEndpoint } from './wager'

const body = { pickPlayerId: '11111111-1111-4111-8111-111111111111', stakeCoins: 100 }
function postReq() {
  return new Request('https://x.test/api/mobile/v1/matches/m1/wager', {
    method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'k1' }, body: JSON.stringify(body),
  })
}

describe('wagerEndpoint', () => {
  it('returns {success: true} on success', async () => {
    authenticate.mockResolvedValue({ userId: 'u1', admin: 'admin', userClient: 'sb' })
    runIdempotent.mockImplementation(async (_admin, _args, run) => run())
    performPlaceWager.mockResolvedValue({ ok: true })
    const res = await wagerEndpoint.handler(postReq(), { params: { id: 'm1' } })
    expect(performPlaceWager).toHaveBeenCalledWith('sb', 'admin', 'u1', 'm1', body)
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ success: true })
  })

  it('maps insufficient_coins to a 400', async () => {
    authenticate.mockResolvedValue({ userId: 'u1', admin: 'admin', userClient: 'sb' })
    runIdempotent.mockImplementation(async (_admin, _args, run) => run())
    performPlaceWager.mockResolvedValue({ ok: false, errorCode: 'insufficient_coins' })
    const res = await wagerEndpoint.handler(postReq(), { params: { id: 'm1' } })
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('insufficient_coins')
  })
})
