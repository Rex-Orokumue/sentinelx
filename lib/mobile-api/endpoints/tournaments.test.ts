import { describe, it, expect, vi, beforeEach } from 'vitest'

const { authenticate, optionalAuth } = vi.hoisted(() => ({ authenticate: vi.fn(), optionalAuth: vi.fn() }))
vi.mock('../auth', () => ({ authenticate, optionalAuth }))
const { buildRegistrationState } = vi.hoisted(() => ({ buildRegistrationState: vi.fn() }))
vi.mock('@/lib/tournaments/registration-state-service', () => ({ buildRegistrationState }))

import { registrationStateEndpoint } from './tournaments'

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
