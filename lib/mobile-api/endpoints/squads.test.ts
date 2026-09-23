import { describe, it, expect, vi } from 'vitest'

const { authenticate, optionalAuth } = vi.hoisted(() => ({ authenticate: vi.fn(), optionalAuth: vi.fn() }))
vi.mock('../auth', () => ({ authenticate, optionalAuth }))
const { runIdempotent } = vi.hoisted(() => ({ runIdempotent: vi.fn() }))
vi.mock('../idempotency', () => ({ runIdempotent }))
const { performCreateSquad } = vi.hoisted(() => ({ performCreateSquad: vi.fn() }))
vi.mock('@/lib/tournaments/create-squad-service', () => ({ performCreateSquad }))

import { createSquadEndpoint } from './squads'

function postReq(body: unknown) {
  return new Request('https://x.test/api/mobile/v1/squads', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'k1' },
    body: JSON.stringify(body),
  })
}

describe('createSquadEndpoint', () => {
  it('returns squadId/inviteCode on success', async () => {
    authenticate.mockResolvedValue({ userId: 'u1', admin: {}, userClient: {} })
    runIdempotent.mockImplementation(async (_admin, _args, run) => run())
    performCreateSquad.mockResolvedValue({ ok: true, squadId: 'sq1', inviteCode: 'ABCD1234' })
    const res = await createSquadEndpoint.handler(postReq({ tournamentId: 't1', name: 'Squad A' }), { params: {} })
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ squadId: 'sq1', inviteCode: 'ABCD1234' })
  })

  it('maps already_in_squad to a 409', async () => {
    authenticate.mockResolvedValue({ userId: 'u1', admin: {}, userClient: {} })
    runIdempotent.mockImplementation(async (_admin, _args, run) => run())
    performCreateSquad.mockResolvedValue({ ok: false, errorCode: 'already_in_squad' })
    const res = await createSquadEndpoint.handler(postReq({ tournamentId: 't1', name: 'Squad A' }), { params: {} })
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('already_in_squad')
  })
})
