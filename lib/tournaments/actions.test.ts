import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/paystack/server', () => ({ initializeTransaction: vi.fn(), buildReference: vi.fn() }))
vi.mock('@/lib/coins/service', () => ({ getCoinBalance: vi.fn(), recordCoinTransaction: vi.fn() }))
vi.mock('@/lib/referrals/credit', () => ({ settleReferralForPaidEntry: vi.fn() }))
vi.mock('@/lib/settings/restriction', () => ({ assertNotPendingDeletion: vi.fn().mockResolvedValue(null) }))
vi.mock('./squad-membership', () => ({ finalizeSquadJoin: vi.fn() }))
// Next's real redirect() throws a framework-internal signal to abort
// rendering — a successful registration always calls it, so a test that
// wants to inspect what happened *before* the redirect (the admin insert)
// needs it to be an inert no-op instead.
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))

function fd(obj: Record<string, string>) {
  const f = new FormData()
  for (const [k, v] of Object.entries(obj)) f.set(k, v)
  return f
}

function mockClient(opts: { username?: string | null; tournamentExists?: boolean; tournament?: Record<string, unknown>; fields?: { field_key: string; label: string; placeholder: string | null; input_type: string; required: boolean; validation_pattern: string | null; validation_message: string | null; show_on_bracket: boolean }[] } = {}) {
  const tournamentRow = opts.tournamentExists === false ? null : { game_id: 'g1', ...opts.tournament }
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'ada@test.example' } } }) },
    from: (table: string) => {
      if (table === 'tournaments') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: tournamentRow }) }) }) }
      if (table === 'game_registration_fields') return { select: () => ({ eq: () => ({ eq: () => ({ order: async () => ({ data: opts.fields ?? [] }) }) }) }) }
      if (table === 'profiles') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { username: opts.username ?? null } }) }) }) }
      if (table === 'tournament_registrations') {
        return {
          select: (_cols: string, meta?: { count?: string; head?: boolean }) => {
            if (meta?.count) return { eq: () => ({ eq: () => Promise.resolve({ count: 0 }) }) }
            return { eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }
          },
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

describe('registerForTournament — username gate', () => {
  it('refuses and returns needsUsername when the caller has no claimed username', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue(mockClient({ username: null }) as never)
    const { createAdminClient } = await import('@/lib/supabase/admin')
    vi.mocked(createAdminClient).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { deletion_requested_at: null, deleted_at: null } }),
          }),
        }),
      }),
    } as never)
    const { registerForTournament } = await import('./actions')
    const r = await registerForTournament(undefined, fd({ tournamentId: 't1', displayName: 'X', whatsapp: '+2340000000000' }))
    expect(r?.needsUsername).toBe(true)
  })
})

describe('registerForTournament — dynamic fields', () => {
  it('rejects when a required dynamic field is missing, before ever calling performRegisterForTournament', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue(mockClient({
      username: 'ada',
      fields: [{ field_key: 'in_game_uid', label: 'In-game UID', placeholder: null, input_type: 'text', required: true, validation_pattern: null, validation_message: null, show_on_bracket: true }],
    }) as never)
    const { registerForTournament } = await import('./actions')
    const r = await registerForTournament(undefined, fd({ tournamentId: 't1', displayName: 'X', whatsapp: '+2340000000000', in_game_uid: '' }))
    expect(r?.error).toBe('In-game UID is required')
  })

  it('returns "Tournament not found" when the game_id lookup finds nothing, without throwing', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue(mockClient({ tournamentExists: false }) as never)
    const { registerForTournament } = await import('./actions')
    const r = await registerForTournament(undefined, fd({ tournamentId: 'missing', displayName: 'X', whatsapp: '+2340000000000' }))
    expect(r?.error).toBe('Tournament not found.')
  })

  it('writes the dynamic field values into registration_details on a valid, zero-fee submission', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue(mockClient({
      username: 'ada',
      tournament: {
        id: 't1', slug: 'cup', status: 'registration_open', max_players: 8, rules: null,
        registration_fee: 0, invitation_only: false, entry_unit: 'solo', squad_size: null,
      },
      fields: [{ field_key: 'in_game_uid', label: 'In-game UID', placeholder: null, input_type: 'text', required: true, validation_pattern: null, validation_message: null, show_on_bracket: true }],
    }) as never)
    const insert = vi.fn(() => ({ select: () => ({ single: async () => ({ data: { id: 'reg1' }, error: null }) }) }))
    const { createAdminClient } = await import('@/lib/supabase/admin')
    vi.mocked(createAdminClient).mockReturnValue({
      from: (table: string) => {
        if (table === 'tournament_fee_waivers') return { select: () => ({ eq: () => ({ eq: () => ({ is: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }) }
        if (table === 'tournament_registrations') return { insert }
        throw new Error(`unexpected admin table ${table}`)
      },
    } as never)
    const { registerForTournament } = await import('./actions')
    await registerForTournament(undefined, fd({ tournamentId: 't1', displayName: 'X', whatsapp: '+2340000000000', in_game_uid: '778899', agreedToRules: 'true' }))
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ registration_details: { in_game_uid: '778899' } }))
  })
})
