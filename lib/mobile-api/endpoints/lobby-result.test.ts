import { describe, it, expect, vi } from 'vitest'

const { authenticate } = vi.hoisted(() => ({ authenticate: vi.fn() }))
vi.mock('../auth', () => ({ authenticate, optionalAuth: vi.fn() }))
const { runIdempotent } = vi.hoisted(() => ({ runIdempotent: vi.fn() }))
vi.mock('../idempotency', () => ({ runIdempotent }))
const { performSubmitLobbyResult } = vi.hoisted(() => ({ performSubmitLobbyResult: vi.fn() }))
vi.mock('@/lib/tournaments/submit-lobby-result-service', () => ({ performSubmitLobbyResult }))

import { lobbyResultEndpoint } from './lobby-result'

const body = { placement: 3, kills: 5, screenshotPath: 'shots/1.png' }
function postReq() {
  return new Request('https://x.test/api/mobile/v1/lobbies/lob1/result', {
    method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'k1' }, body: JSON.stringify(body),
  })
}

describe('lobbyResultEndpoint', () => {
  it('returns {success: true} on success', async () => {
    authenticate.mockResolvedValue({ userId: 'u1', admin: 'admin', userClient: 'sb' })
    runIdempotent.mockImplementation(async (_admin, _args, run) => run())
    performSubmitLobbyResult.mockResolvedValue({ ok: true, tournamentId: 't1' })
    const res = await lobbyResultEndpoint.handler(postReq(), { params: { id: 'lob1' } })
    expect(performSubmitLobbyResult).toHaveBeenCalledWith('admin', 'u1', 'lob1', body)
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ success: true })
  })

  it('maps lobby_confirmed to a 409', async () => {
    authenticate.mockResolvedValue({ userId: 'u1', admin: 'admin', userClient: 'sb' })
    runIdempotent.mockImplementation(async (_admin, _args, run) => run())
    performSubmitLobbyResult.mockResolvedValue({ ok: false, errorCode: 'lobby_confirmed' })
    const res = await lobbyResultEndpoint.handler(postReq(), { params: { id: 'lob1' } })
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('lobby_confirmed')
  })
})
