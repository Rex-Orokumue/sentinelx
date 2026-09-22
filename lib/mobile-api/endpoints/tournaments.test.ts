import { describe, it, expect, vi, beforeEach } from 'vitest'

const { authenticate, optionalAuth } = vi.hoisted(() => ({ authenticate: vi.fn(), optionalAuth: vi.fn() }))
vi.mock('../auth', () => ({ authenticate, optionalAuth }))
const { buildRegistrationState } = vi.hoisted(() => ({ buildRegistrationState: vi.fn() }))
vi.mock('@/lib/tournaments/registration-state-service', () => ({ buildRegistrationState }))
const { performRegisterForTournament } = vi.hoisted(() => ({ performRegisterForTournament: vi.fn() }))
vi.mock('@/lib/tournaments/register-service', () => ({ performRegisterForTournament }))
const { runIdempotent } = vi.hoisted(() => ({ runIdempotent: vi.fn() }))
vi.mock('../idempotency', () => ({ runIdempotent }))

import { registrationStateEndpoint, registerEndpoint } from './tournaments'

describe('registrationStateEndpoint', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.test.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key-stub')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key-stub')
  })

  it('returns the built state for a known tournament', async () => {
    optionalAuth.mockResolvedValue(null)
    buildRegistrationState.mockResolvedValue({ view: 'guest', feeNaira: 500, hasWaiver: false, coinDiscountEligible: false, agreementRequired: true })
    const res = await registrationStateEndpoint.handler(
      new Request('https://x.test/api/mobile/v1/tournaments/t1/registration-state'),
      { params: { id: 't1' } },
    )
    expect(res.status).toBe(200)
    expect((await res.json()).data.view).toBe('guest')
  })

  it('returns 404 when buildRegistrationState reports no tournament', async () => {
    optionalAuth.mockResolvedValue(null)
    buildRegistrationState.mockResolvedValue(null)
    const res = await registrationStateEndpoint.handler(
      new Request('https://x.test/api/mobile/v1/tournaments/missing/registration-state'),
      { params: { id: 'missing' } },
    )
    expect(res.status).toBe(404)
  })
})

describe('registerEndpoint', () => {
  it('rejects a non-null squadId at the route level before calling the service', async () => {
    authenticate.mockResolvedValue({ userId: 'u1', admin: {}, userClient: {} })
    runIdempotent.mockImplementation(async (_admin, _args, run) => run())
    const req = new Request('https://x.test/api/mobile/v1/tournaments/t1/register', {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'k1' },
      body: JSON.stringify({ displayName: 'Ada', whatsapp: '+2348012345678', clubName: 'FC', agreedToRules: true, coinsUsed: 0, squadId: 'sq1' }),
    })
    const res = await registerEndpoint.handler(req, { params: { id: 't1' } })
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('squads_not_available')
    expect(performRegisterForTournament).not.toHaveBeenCalled()
  })
})
