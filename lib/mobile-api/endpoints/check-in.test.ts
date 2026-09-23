import { describe, it, expect, vi } from 'vitest'

const { authenticate } = vi.hoisted(() => ({ authenticate: vi.fn() }))
vi.mock('../auth', () => ({ authenticate, optionalAuth: vi.fn() }))
const { performCheckIn } = vi.hoisted(() => ({ performCheckIn: vi.fn() }))
vi.mock('@/lib/matches/check-in-service', () => ({ performCheckIn }))

import { checkInEndpoint } from './check-in'

function postReq() {
  return new Request('https://x.test/api/mobile/v1/matches/m1/check-in', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
}

describe('checkInEndpoint', () => {
  it('returns {success: true} and calls performCheckIn with ctx pieces + params.id', async () => {
    authenticate.mockResolvedValue({ userId: 'u1', admin: 'admin', userClient: 'sb' })
    performCheckIn.mockResolvedValue({ ok: true })
    const res = await checkInEndpoint.handler(postReq(), { params: { id: 'm1' } })
    expect(performCheckIn).toHaveBeenCalledWith('sb', 'admin', 'u1', 'm1')
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ success: true })
  })

  it('maps not_match_day to a 400', async () => {
    authenticate.mockResolvedValue({ userId: 'u1', admin: 'admin', userClient: 'sb' })
    performCheckIn.mockResolvedValue({ ok: false, errorCode: 'not_match_day' })
    const res = await checkInEndpoint.handler(postReq(), { params: { id: 'm1' } })
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('not_match_day')
  })
})
