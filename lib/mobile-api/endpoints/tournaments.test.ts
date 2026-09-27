import { describe, it, expect, vi, beforeEach } from 'vitest'

const { authenticate, optionalAuth } = vi.hoisted(() => ({ authenticate: vi.fn(), optionalAuth: vi.fn() }))
vi.mock('../auth', () => ({ authenticate, optionalAuth }))
const { buildRegistrationState } = vi.hoisted(() => ({ buildRegistrationState: vi.fn() }))
vi.mock('@/lib/tournaments/registration-state-service', () => ({ buildRegistrationState }))
const { performRegisterForTournament } = vi.hoisted(() => ({ performRegisterForTournament: vi.fn() }))
vi.mock('@/lib/tournaments/register-service', () => ({ performRegisterForTournament }))
const { runIdempotent } = vi.hoisted(() => ({ runIdempotent: vi.fn() }))
vi.mock('../idempotency', () => ({ runIdempotent }))
const { performJoinWaitlist } = vi.hoisted(() => ({ performJoinWaitlist: vi.fn() }))
vi.mock('@/lib/tournaments/waitlist-service', () => ({ performJoinWaitlist }))

import { registrationStateEndpoint, registerEndpoint, waitlistEndpoint } from './tournaments'

beforeEach(() => {
  vi.clearAllMocks()
})

function fakeUserClient(opts: { fields?: { field_key: string; label: string; placeholder: string | null; input_type: string; required: boolean; validation_pattern: string | null; validation_message: string | null; show_on_bracket: boolean }[]; tournamentExists?: boolean } = {}) {
  return {
    from: (table: string) => {
      if (table === 'tournaments') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.tournamentExists === false ? null : { game_id: 'g1' } }) }) }) }
      if (table === 'game_registration_fields') return { select: () => ({ eq: () => ({ eq: () => ({ order: async () => ({ data: opts.fields ?? [] }) }) }) }) }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

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
    authenticate.mockResolvedValue({ userId: 'u1', admin: {}, userClient: fakeUserClient() })
    runIdempotent.mockImplementation(async (_admin, _args, run) => run())
    const req = new Request('https://x.test/api/mobile/v1/tournaments/t1/register', {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'k1' },
      body: JSON.stringify({ displayName: 'Ada', whatsapp: '+2348012345678', registrationDetails: { club_name: 'FC' }, agreedToRules: true, coinsUsed: 0, squadId: 'sq1' }),
    })
    const res = await registerEndpoint.handler(req, { params: { id: 't1' } })
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('squads_not_available')
    expect(performRegisterForTournament).not.toHaveBeenCalled()
  })

  it('rejects a missing required dynamic field before calling the service', async () => {
    authenticate.mockResolvedValue({
      userId: 'u1', admin: {}, userClient: fakeUserClient({ fields: [
        { field_key: 'in_game_uid', label: 'In-game UID', placeholder: null, input_type: 'text', required: true, validation_pattern: null, validation_message: null, show_on_bracket: true },
      ] }),
    })
    runIdempotent.mockImplementation(async (_admin, _args, run) => run())
    const req = new Request('https://x.test/api/mobile/v1/tournaments/t1/register', {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'k1' },
      body: JSON.stringify({ displayName: 'Ada', whatsapp: '+2348012345678', registrationDetails: {}, agreedToRules: true, coinsUsed: 0 }),
    })
    const res = await registerEndpoint.handler(req, { params: { id: 't1' } })
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('validation_failed')
    expect(performRegisterForTournament).not.toHaveBeenCalled()
  })

  it('returns tournament_not_found (not the generic not_found) for an unknown tournament', async () => {
    authenticate.mockResolvedValue({ userId: 'u1', admin: {}, userClient: fakeUserClient({ tournamentExists: false }) })
    runIdempotent.mockImplementation(async (_admin, _args, run) => run())
    const req = new Request('https://x.test/api/mobile/v1/tournaments/missing/register', {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'k1' },
      body: JSON.stringify({ displayName: 'Ada', whatsapp: '+2348012345678', registrationDetails: {}, agreedToRules: true, coinsUsed: 0 }),
    })
    const res = await registerEndpoint.handler(req, { params: { id: 'missing' } })
    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('tournament_not_found')
    expect(performRegisterForTournament).not.toHaveBeenCalled()
  })

  it('passes the parsed registrationDetails through to performRegisterForTournament on a valid submission', async () => {
    authenticate.mockResolvedValue({
      userId: 'u1', admin: {}, userClient: fakeUserClient({ fields: [
        { field_key: 'in_game_uid', label: 'In-game UID', placeholder: null, input_type: 'text', required: true, validation_pattern: null, validation_message: null, show_on_bracket: true },
      ] }),
    })
    runIdempotent.mockImplementation(async (_admin, _args, run) => run())
    performRegisterForTournament.mockResolvedValue({ ok: true, status: 'confirmed' })
    const req = new Request('https://x.test/api/mobile/v1/tournaments/t1/register', {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'k1' },
      body: JSON.stringify({ displayName: 'Ada', whatsapp: '+2348012345678', registrationDetails: { in_game_uid: '778899' }, agreedToRules: true, coinsUsed: 0 }),
    })
    const res = await registerEndpoint.handler(req, { params: { id: 't1' } })
    expect(res.status).toBe(200)
    expect(performRegisterForTournament).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), 'u1', 't1',
      expect.objectContaining({ registrationDetails: { in_game_uid: '778899' } }),
    )
  })
})

describe('waitlistEndpoint', () => {
  it('maps waitlist_not_open to 409', async () => {
    authenticate.mockResolvedValue({ userId: 'u1', admin: {}, userClient: fakeUserClient() })
    performJoinWaitlist.mockResolvedValue({ ok: false, errorCode: 'waitlist_not_open' })
    const req = new Request('https://x.test/api/mobile/v1/tournaments/t1/waitlist', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'Ada', whatsapp: '+2348012345678', registrationDetails: { club_name: 'FC' }, agreedToRules: true }),
    })
    const res = await waitlistEndpoint.handler(req, { params: { id: 't1' } })
    expect(res.status).toBe(409)
  })

  it('returns tournament_not_found (not the generic not_found) for an unknown tournament', async () => {
    authenticate.mockResolvedValue({ userId: 'u1', admin: {}, userClient: fakeUserClient({ tournamentExists: false }) })
    const req = new Request('https://x.test/api/mobile/v1/tournaments/missing/waitlist', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'Ada', whatsapp: '+2348012345678', registrationDetails: {}, agreedToRules: true }),
    })
    const res = await waitlistEndpoint.handler(req, { params: { id: 'missing' } })
    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('tournament_not_found')
    expect(performJoinWaitlist).not.toHaveBeenCalled()
  })

  it('rejects a missing required dynamic field before calling the service', async () => {
    authenticate.mockResolvedValue({
      userId: 'u1', admin: {}, userClient: fakeUserClient({ fields: [
        { field_key: 'in_game_uid', label: 'In-game UID', placeholder: null, input_type: 'text', required: true, validation_pattern: null, validation_message: null, show_on_bracket: true },
      ] }),
    })
    const req = new Request('https://x.test/api/mobile/v1/tournaments/t1/waitlist', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'Ada', whatsapp: '+2348012345678', registrationDetails: {}, agreedToRules: true }),
    })
    const res = await waitlistEndpoint.handler(req, { params: { id: 't1' } })
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('validation_failed')
    expect(performJoinWaitlist).not.toHaveBeenCalled()
  })

  it('passes the parsed registrationDetails through to performJoinWaitlist on a valid submission', async () => {
    authenticate.mockResolvedValue({ userId: 'u1', admin: {}, userClient: fakeUserClient() })
    performJoinWaitlist.mockResolvedValue({ ok: true, tournamentSlug: 'cup' })
    const req = new Request('https://x.test/api/mobile/v1/tournaments/t1/waitlist', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'Ada', whatsapp: '+2348012345678', registrationDetails: {}, agreedToRules: true }),
    })
    const res = await waitlistEndpoint.handler(req, { params: { id: 't1' } })
    expect(res.status).toBe(200)
    expect(performJoinWaitlist).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), 'u1', 't1',
      expect.objectContaining({ registrationDetails: {} }),
    )
  })
})
