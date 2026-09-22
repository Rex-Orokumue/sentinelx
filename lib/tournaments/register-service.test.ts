import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/paystack/server', () => ({ initializeTransaction: vi.fn(), buildReference: vi.fn() }))
vi.mock('@/lib/coins/service', () => ({ getCoinBalance: vi.fn(), recordCoinTransaction: vi.fn() }))
vi.mock('@/lib/referrals/credit', () => ({ settleReferralForPaidEntry: vi.fn() }))
vi.mock('./squad-membership', () => ({ finalizeSquadJoin: vi.fn() }))
vi.mock('@/lib/settings/restriction', () => ({ assertNotPendingDeletion: vi.fn().mockResolvedValue(null) }))

import { performRegisterForTournament } from './register-service'

beforeEach(async () => {
  vi.clearAllMocks()
  const { assertNotPendingDeletion } = await import('@/lib/settings/restriction')
  vi.mocked(assertNotPendingDeletion).mockResolvedValue(null)
})

const baseInput = { displayName: 'Ada', whatsapp: '+2348012345678', clubName: 'FC Test', ignTag: null, agreedToRules: true, coinsUsed: 0, squadId: null }

function fakeSupabase(opts: {
  profile?: { username: string | null }
  tournament?: Record<string, unknown> | null
  paidCount?: number
  existing?: { id: string; payment_status: string } | null
  squad?: Record<string, unknown> | null
  squadMemberCount?: number
}) {
  return {
    auth: { getUser: async () => ({ data: { user: { email: 'ada@test.example' } } }) },
    from: (table: string) => {
      if (table === 'profiles') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.profile ?? { username: 'ada' } }) }) }) }
      if (table === 'tournaments') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.tournament === undefined ? defaultTournament : opts.tournament }) }) }) }
      if (table === 'tournament_registrations') {
        return {
          select: (_cols: string, meta?: { count?: string; head?: boolean }) => {
            if (meta?.count) return { eq: () => ({ eq: () => Promise.resolve({ count: opts.paidCount ?? 0 }) }) }
            return { eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.existing ?? null }) }) }) }
          },
        }
      }
      if (table === 'squads') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.squad ?? null }) }) }) }
      if (table === 'squad_members') return { select: () => ({ eq: () => Promise.resolve({ count: opts.squadMemberCount ?? 0 }) }) }
      throw new Error(`unexpected table ${table}`)
    },
  } as never
}

const defaultTournament = { id: 't1', slug: 'test-cup', status: 'registration_open', max_players: 8, rules: 'Be nice', registration_fee: 500, invitation_only: false, entry_unit: 'solo', squad_size: null }

function fakeAdmin(opts: {
  waiver?: { id: string } | null
  redeemedRows?: number
  insertError?: boolean
} = {}) {
  const insert = vi.fn(() => ({ select: () => ({ single: async () => opts.insertError ? { error: { message: 'boom' }, data: null } : { data: { id: 'reg1' }, error: null } }) }))
  const update = vi.fn(() => ({ eq: () => ({ is: () => ({ select: async () => ({ data: opts.redeemedRows === 0 ? [] : [{ id: opts.waiver?.id ?? 'w1' }] }) }) }) }))
  const plainUpdate = vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) }))
  return {
    from: (table: string) => {
      if (table === 'tournament_fee_waivers') return { select: () => ({ eq: () => ({ eq: () => ({ is: () => ({ maybeSingle: async () => ({ data: opts.waiver ?? null }) }) }) }) }), update }
      if (table === 'tournament_registrations') return { insert, update: plainUpdate }
      throw new Error(`unexpected admin table ${table}`)
    },
  } as never
}

describe('performRegisterForTournament', () => {
  it('needs_username when the caller has no claimed username', async () => {
    const result = await performRegisterForTournament(fakeSupabase({ profile: { username: null } }), fakeAdmin(), 'u1', 't1', baseInput)
    expect(result).toEqual({ ok: false, errorCode: 'needs_username' })
  })

  it('tournament_not_found for an unknown tournament', async () => {
    const result = await performRegisterForTournament(fakeSupabase({ tournament: null }), fakeAdmin(), 'u1', 't1', baseInput)
    expect(result).toEqual({ ok: false, errorCode: 'tournament_not_found' })
  })

  it('rules_agreement_required when rules exist and agreedToRules is false', async () => {
    const result = await performRegisterForTournament(fakeSupabase({}), fakeAdmin(), 'u1', 't1', { ...baseInput, agreedToRules: false })
    expect(result).toEqual({ ok: false, errorCode: 'rules_agreement_required' })
  })

  it('already_registered when a paid registration exists', async () => {
    const result = await performRegisterForTournament(fakeSupabase({ existing: { id: 'r1', payment_status: 'paid' } }), fakeAdmin(), 'u1', 't1', baseInput)
    expect(result).toEqual({ ok: false, errorCode: 'already_registered' })
  })

  it('tournament_full when paid count meets capacity', async () => {
    const result = await performRegisterForTournament(fakeSupabase({ paidCount: 8 }), fakeAdmin(), 'u1', 't1', baseInput)
    expect(result).toEqual({ ok: false, errorCode: 'tournament_full' })
  })

  it('invitation_only rejects the public form', async () => {
    const result = await performRegisterForTournament(fakeSupabase({ tournament: { ...defaultTournament, invitation_only: true } }), fakeAdmin(), 'u1', 't1', baseInput)
    expect(result).toEqual({ ok: false, errorCode: 'invitation_only' })
  })

  it('registration_closed when status is not registration_open', async () => {
    const result = await performRegisterForTournament(fakeSupabase({ tournament: { ...defaultTournament, status: 'registration_closed' } }), fakeAdmin(), 'u1', 't1', baseInput)
    expect(result).toEqual({ ok: false, errorCode: 'registration_closed' })
  })

  it('squads_not_available when a solo tournament receives a squadId', async () => {
    const result = await performRegisterForTournament(fakeSupabase({ tournament: defaultTournament }), fakeAdmin(), 'u1', 't1', { ...baseInput, squadId: 'sq1' })
    expect(result).toEqual({ ok: false, errorCode: 'squads_not_available' })
  })

  it('confirms immediately via a waiver, redeeming it exactly once', async () => {
    const admin = fakeAdmin({ waiver: { id: 'w1' } })
    const result = await performRegisterForTournament(fakeSupabase({}), admin, 'u1', 't1', baseInput)
    expect(result).toEqual({ ok: true, status: 'confirmed', tournamentSlug: 'test-cup' })
  })

  it('reports registration_failed when the waiver was already redeemed by a raced request', async () => {
    const admin = fakeAdmin({ waiver: { id: 'w1' }, redeemedRows: 0 })
    const result = await performRegisterForTournament(fakeSupabase({}), admin, 'u1', 't1', baseInput)
    expect(result).toEqual({ ok: false, errorCode: 'registration_failed' })
  })

  it('confirms immediately for a zero-fee tournament with no waiver', async () => {
    const result = await performRegisterForTournament(fakeSupabase({ tournament: { ...defaultTournament, registration_fee: 0 } }), fakeAdmin(), 'u1', 't1', baseInput)
    expect(result).toEqual({ ok: true, status: 'confirmed', tournamentSlug: 'test-cup' })
  })

  it('rejects a coin discount when the balance is insufficient', async () => {
    const { getCoinBalance } = await import('@/lib/coins/service')
    vi.mocked(getCoinBalance).mockResolvedValue(100)
    const result = await performRegisterForTournament(fakeSupabase({}), fakeAdmin(), 'u1', 't1', { ...baseInput, coinsUsed: 1000 })
    expect(result).toEqual({ ok: false, errorCode: 'insufficient_coins' })
  })

  it('confirms immediately when a full coin discount brings the fee to zero', async () => {
    const { getCoinBalance, recordCoinTransaction } = await import('@/lib/coins/service')
    vi.mocked(getCoinBalance).mockResolvedValue(2000)
    vi.mocked(recordCoinTransaction).mockResolvedValue(1000)
    const result = await performRegisterForTournament(fakeSupabase({}), fakeAdmin(), 'u1', 't1', { ...baseInput, coinsUsed: 1000 })
    expect(result).toEqual({ ok: true, status: 'confirmed', tournamentSlug: 'test-cup' })
    expect(recordCoinTransaction).toHaveBeenCalledWith(expect.anything(), 'u1', -1000, 'entry_discount', 't1', expect.any(String))
  })

  it('ignores an out-of-range coinsUsed on a sub-500 tournament rather than erroring', async () => {
    const { recordCoinTransaction } = await import('@/lib/coins/service')
    const result = await performRegisterForTournament(fakeSupabase({ tournament: { ...defaultTournament, registration_fee: 300 } }), fakeAdmin(), 'u1', 't1', { ...baseInput, coinsUsed: 500 })
    expect(recordCoinTransaction).not.toHaveBeenCalled()
    expect(result).toMatchObject({ ok: true, status: 'pending' })
  })

  it('initializes a Paystack transaction and returns pending for a full-price registration', async () => {
    const { initializeTransaction, buildReference } = await import('@/lib/paystack/server')
    vi.mocked(buildReference).mockReturnValue('ref-abc')
    vi.mocked(initializeTransaction).mockResolvedValue('https://paystack.test/pay/ref-abc')
    const result = await performRegisterForTournament(fakeSupabase({}), fakeAdmin(), 'u1', 't1', baseInput)
    expect(result).toEqual({ ok: true, status: 'pending', authorizationUrl: 'https://paystack.test/pay/ref-abc', reference: 'ref-abc', tournamentSlug: 'test-cup' })
  })

  it('reports payment_init_failed without leaking the Paystack error detail', async () => {
    const { initializeTransaction, buildReference } = await import('@/lib/paystack/server')
    vi.mocked(buildReference).mockReturnValue('ref-abc')
    vi.mocked(initializeTransaction).mockRejectedValue(new Error('paystack secret key invalid'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await performRegisterForTournament(fakeSupabase({}), fakeAdmin(), 'u1', 't1', baseInput)
    expect(result).toEqual({ ok: false, errorCode: 'payment_init_failed' })
    spy.mockRestore()
  })
})
