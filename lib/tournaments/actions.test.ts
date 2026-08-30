import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/paystack/server', () => ({ initializeTransaction: vi.fn(), buildReference: vi.fn() }))
vi.mock('@/lib/coins/service', () => ({ getCoinBalance: vi.fn(), recordCoinTransaction: vi.fn() }))
vi.mock('@/lib/referrals/credit', () => ({ settleReferralForPaidEntry: vi.fn() }))

function fd(obj: Record<string, string>) {
  const f = new FormData()
  for (const [k, v] of Object.entries(obj)) f.set(k, v)
  return f
}

describe('registerForTournament — username gate', () => {
  it('refuses and returns needsUsername when the caller has no claimed username', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({
      auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
      from: (table: string) => {
        if (table === 'profiles')
          return {
            select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { username: null } }) }) }),
          }
        throw new Error(`unexpected table ${table}`)
      },
    } as never)
    const { registerForTournament } = await import('./actions')
    const r = await registerForTournament(
      undefined,
      fd({
        tournamentId: 't1',
        displayName: 'X',
        whatsapp: '+2340000000000',
        clubName: 'C',
        ignTag: '',
      }),
    )
    expect(r?.needsUsername).toBe(true)
  })
})
