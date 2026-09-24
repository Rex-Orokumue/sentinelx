import { describe, it, expect, vi } from 'vitest'

const { authenticate, optionalAuth } = vi.hoisted(() => ({ authenticate: vi.fn(), optionalAuth: vi.fn() }))
vi.mock('../auth', () => ({ authenticate, optionalAuth }))
const { runIdempotent } = vi.hoisted(() => ({ runIdempotent: vi.fn() }))
vi.mock('../idempotency', () => ({ runIdempotent }))
const { performCreateSquad } = vi.hoisted(() => ({ performCreateSquad: vi.fn() }))
vi.mock('@/lib/tournaments/create-squad-service', () => ({ performCreateSquad }))
const { performLookupSquad } = vi.hoisted(() => ({ performLookupSquad: vi.fn() }))
vi.mock('@/lib/tournaments/lookup-squad-service', () => ({ performLookupSquad }))

import { createSquadEndpoint, lookupSquadEndpoint } from './squads'

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

describe('lookupSquadEndpoint', () => {
  it('returns the squad preview on success', async () => {
    optionalAuth.mockResolvedValue({ userClient: {}, userId: null })
    performLookupSquad.mockResolvedValue({ ok: true, squad: { id: 's1', name: 'X', memberCount: 2, teamSize: 4 } })
    const res = await lookupSquadEndpoint.handler(
      new Request('https://x.test/api/mobile/v1/squads/lookup?tournamentId=t1&code=ABCD1234'),
      { params: {} },
    )
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ squad: { id: 's1', name: 'X', memberCount: 2, teamSize: 4 } })
  })

  it('maps squad_full to a 409', async () => {
    optionalAuth.mockResolvedValue({ userClient: {}, userId: null })
    performLookupSquad.mockResolvedValue({ ok: false, errorCode: 'squad_full' })
    const res = await lookupSquadEndpoint.handler(
      new Request('https://x.test/api/mobile/v1/squads/lookup?tournamentId=t1&code=ABCD1234'),
      { params: {} },
    )
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('squad_full')
  })
})
