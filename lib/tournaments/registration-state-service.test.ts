import { describe, it, expect } from 'vitest'
import { buildRegistrationState } from './registration-state-service'

function fakeSupabase(opts: {
  tournament: { id: string; status: string; registration_fee: number; max_players: number | null; invitation_only: boolean; rules: string | null } | null
  paidCount?: number
  existing?: { id: string; payment_status: string; status: string } | null
}) {
  return {
    from: (table: string) => {
      if (table === 'tournaments') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.tournament }) }) }) }
      }
      if (table === 'tournament_registrations') {
        return {
          select: (_cols: string, meta?: { count?: string; head?: boolean }) => {
            if (meta?.count) return { eq: () => ({ eq: () => Promise.resolve({ count: opts.paidCount ?? 0 }) }) }
            return { eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.existing ?? null }) }) }) }
          },
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  } as never
}

function fakeAdmin(opts: { waiver?: { id: string } | null } = {}) {
  return {
    from: (table: string) => {
      if (table !== 'tournament_fee_waivers') throw new Error(`unexpected table ${table}`)
      return { select: () => ({ eq: () => ({ eq: () => ({ is: () => ({ maybeSingle: async () => ({ data: opts.waiver ?? null }) }) }) }) }) }
    },
  } as never
}

const openTournament = { id: 't1', status: 'registration_open', registration_fee: 500, max_players: 8, invitation_only: false, rules: 'Be nice' }

describe('buildRegistrationState', () => {
  it('returns null when the tournament does not exist', async () => {
    const result = await buildRegistrationState(fakeSupabase({ tournament: null }), fakeAdmin(), 't1', 'u1')
    expect(result).toBeNull()
  })

  it('reports guest with no waiver/coin-discount detail for a logged-out visitor', async () => {
    const result = await buildRegistrationState(fakeSupabase({ tournament: openTournament }), fakeAdmin(), 't1', null)
    expect(result).toEqual({ view: 'guest', feeNaira: 500, hasWaiver: false, coinDiscountEligible: false, agreementRequired: true })
  })

  it('reports can_register with coin-discount eligible when fee >= 500 and no waiver', async () => {
    const result = await buildRegistrationState(fakeSupabase({ tournament: openTournament }), fakeAdmin(), 't1', 'u1')
    expect(result).toEqual({ view: 'can_register', feeNaira: 500, hasWaiver: false, coinDiscountEligible: true, agreementRequired: true })
  })

  it('reports hasWaiver:true and coinDiscountEligible:false when an unredeemed waiver exists', async () => {
    const result = await buildRegistrationState(fakeSupabase({ tournament: openTournament }), fakeAdmin({ waiver: { id: 'w1' } }), 't1', 'u1')
    expect(result).toEqual({ view: 'can_register', feeNaira: 500, hasWaiver: true, coinDiscountEligible: false, agreementRequired: true })
  })

  it('is not coin-discount eligible under the 500-naira floor', async () => {
    const cheap = { ...openTournament, registration_fee: 300 }
    const result = await buildRegistrationState(fakeSupabase({ tournament: cheap }), fakeAdmin(), 't1', 'u1')
    expect(result?.coinDiscountEligible).toBe(false)
  })

  it('reports registered for an existing paid registration', async () => {
    const result = await buildRegistrationState(
      fakeSupabase({ tournament: openTournament, existing: { id: 'r1', payment_status: 'paid', status: 'active' } }),
      fakeAdmin(), 't1', 'u1',
    )
    expect(result?.view).toBe('registered')
  })

  it('reports closed once registration has closed, distinct from full', async () => {
    const closed = { ...openTournament, status: 'registration_closed' }
    const result = await buildRegistrationState(fakeSupabase({ tournament: closed }), fakeAdmin(), 't1', 'u1')
    expect(result?.view).toBe('closed')
  })

  it('reports full (not closed) when capacity is reached while registration is still open', async () => {
    const result = await buildRegistrationState(fakeSupabase({ tournament: openTournament, paidCount: 8 }), fakeAdmin(), 't1', 'u1')
    expect(result?.view).toBe('full')
  })

  it('sets agreementRequired false when the tournament has no rules text', async () => {
    const noRules = { ...openTournament, rules: null }
    const result = await buildRegistrationState(fakeSupabase({ tournament: noRules }), fakeAdmin(), 't1', 'u1')
    expect(result?.agreementRequired).toBe(false)
  })
})
