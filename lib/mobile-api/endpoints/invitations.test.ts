import { describe, it, expect, vi } from 'vitest'

const { authenticate, optionalAuth } = vi.hoisted(() => ({ authenticate: vi.fn(), optionalAuth: vi.fn() }))
vi.mock('../auth', () => ({ authenticate, optionalAuth }))
const { performAcceptInvitation, performDeclineInvitation } = vi.hoisted(() => ({ performAcceptInvitation: vi.fn(), performDeclineInvitation: vi.fn() }))
vi.mock('@/lib/seasons/invitation-response-service', () => ({ performAcceptInvitation, performDeclineInvitation }))
const { runIdempotent } = vi.hoisted(() => ({ runIdempotent: vi.fn() }))
vi.mock('../idempotency', () => ({ runIdempotent }))

import { acceptInvitationEndpoint, declineInvitationEndpoint } from './invitations'

describe('acceptInvitationEndpoint', () => {
  it('returns confirmed on a free-tournament accept', async () => {
    authenticate.mockResolvedValue({ userId: 'u1', email: 'ada@test.example', admin: {}, userClient: {} })
    runIdempotent.mockImplementation(async (_admin, _args, run) => run())
    performAcceptInvitation.mockResolvedValue({ ok: true, status: 'confirmed', tournamentSlug: 'masters' })
    const req = new Request('https://x.test/api/mobile/v1/invitations/inv1/accept', {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'k1' },
    })
    const res = await acceptInvitationEndpoint.handler(req, { params: { id: 'inv1' } })
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ status: 'confirmed' })
  })

  it('maps invitation_expired to 410', async () => {
    authenticate.mockResolvedValue({ userId: 'u1', email: 'ada@test.example', admin: {}, userClient: {} })
    runIdempotent.mockImplementation(async (_admin, _args, run) => run())
    performAcceptInvitation.mockResolvedValue({ ok: false, errorCode: 'invitation_expired' })
    const req = new Request('https://x.test/api/mobile/v1/invitations/inv1/accept', {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'k1' },
    })
    const res = await acceptInvitationEndpoint.handler(req, { params: { id: 'inv1' } })
    expect(res.status).toBe(410)
    expect((await res.json()).error.code).toBe('invitation_expired')
  })
})

describe('declineInvitationEndpoint', () => {
  it('returns declined on success', async () => {
    authenticate.mockResolvedValue({ userId: 'u1', admin: {}, userClient: {} })
    performDeclineInvitation.mockResolvedValue({ ok: true })
    const req = new Request('https://x.test/api/mobile/v1/invitations/inv1/decline', { method: 'POST' })
    const res = await declineInvitationEndpoint.handler(req, { params: { id: 'inv1' } })
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ status: 'declined' })
  })

  it('maps invitation_not_found to 404', async () => {
    authenticate.mockResolvedValue({ userId: 'u1', admin: {}, userClient: {} })
    performDeclineInvitation.mockResolvedValue({ ok: false, errorCode: 'invitation_not_found' })
    const req = new Request('https://x.test/api/mobile/v1/invitations/inv1/decline', { method: 'POST' })
    const res = await declineInvitationEndpoint.handler(req, { params: { id: 'inv1' } })
    expect(res.status).toBe(404)
  })
})
