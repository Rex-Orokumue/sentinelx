import { describe, it, expect, vi } from 'vitest'

const { authenticate } = vi.hoisted(() => ({ authenticate: vi.fn() }))
vi.mock('../auth', () => ({ authenticate, optionalAuth: vi.fn() }))
const { runIdempotent } = vi.hoisted(() => ({ runIdempotent: vi.fn() }))
vi.mock('../idempotency', () => ({ runIdempotent }))
const { performSubmitMatchResult } = vi.hoisted(() => ({ performSubmitMatchResult: vi.fn() }))
vi.mock('@/lib/matches/submit-result-service', () => ({ performSubmitMatchResult }))

import { matchResultEndpoint } from './match-result'

const body = { scoreA: 3, scoreB: 1, recordingUrl: '', screenshotPath: 'shots/1.png' }
function postReq() {
  return new Request('https://x.test/api/mobile/v1/matches/m1/result', {
    method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'k1' }, body: JSON.stringify(body),
  })
}

describe('matchResultEndpoint', () => {
  it('returns {success: true} on success', async () => {
    authenticate.mockResolvedValue({ userId: 'u1', admin: 'admin', userClient: 'sb' })
    runIdempotent.mockImplementation(async (_admin, _args, run) => run())
    performSubmitMatchResult.mockResolvedValue({ ok: true })
    const res = await matchResultEndpoint.handler(postReq(), { params: { id: 'm1' } })
    expect(performSubmitMatchResult).toHaveBeenCalledWith('sb', 'admin', 'u1', 'm1', body)
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ success: true })
  })

  it('maps already_confirmed to a 409', async () => {
    authenticate.mockResolvedValue({ userId: 'u1', admin: 'admin', userClient: 'sb' })
    runIdempotent.mockImplementation(async (_admin, _args, run) => run())
    performSubmitMatchResult.mockResolvedValue({ ok: false, errorCode: 'already_confirmed' })
    const res = await matchResultEndpoint.handler(postReq(), { params: { id: 'm1' } })
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('already_confirmed')
  })
})
