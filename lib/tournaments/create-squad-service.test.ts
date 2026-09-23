import { describe, it, expect, vi } from 'vitest'

vi.mock('./squad-membership', () => ({ uniqueInviteCode: vi.fn().mockResolvedValue('ABCD1234') }))

import { performCreateSquad } from './create-squad-service'

function fakeSupabase(opts: {
  profile?: { username: string | null } | null
  tournament?: { id: string; status: string; entry_unit: string } | null
  existingMembership?: { id: string } | null
}) {
  return {
    from: (table: string) => {
      if (table === 'profiles') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.profile ?? null }) }) }) }
      if (table === 'tournaments') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.tournament ?? null }) }) }) }
      if (table === 'squad_members') return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.existingMembership ?? null }) }) }) }) }
      throw new Error(`unexpected table ${table}`)
    },
  } as never
}

function fakeAdmin(opts: { insertError?: { code?: string } | null } = {}) {
  return {
    from: (table: string) => {
      if (table !== 'squads') throw new Error(`unexpected table ${table}`)
      return {
        insert: () => ({
          select: () => ({
            single: async () =>
              opts.insertError
                ? { data: null, error: opts.insertError }
                : { data: { id: 'sq1', invite_code: 'ABCD1234' }, error: null },
          }),
        }),
      }
    },
  } as never
}

const openSquadTournament = { id: 't1', status: 'registration_open', entry_unit: 'squad' }

describe('performCreateSquad', () => {
  it('rejects when the caller has no username', async () => {
    const result = await performCreateSquad(fakeSupabase({ profile: { username: null } }), fakeAdmin(), 'u1', { tournamentId: 't1', name: 'Squad A' })
    expect(result).toEqual({ ok: false, errorCode: 'no_username' })
  })

  it('rejects a non-squad tournament', async () => {
    const result = await performCreateSquad(
      fakeSupabase({ profile: { username: 'x' }, tournament: { id: 't1', status: 'registration_open', entry_unit: 'solo' } }),
      fakeAdmin(), 'u1', { tournamentId: 't1', name: 'Squad A' },
    )
    expect(result).toEqual({ ok: false, errorCode: 'not_squad_tournament' })
  })

  it('rejects when the caller is already in a squad for this tournament', async () => {
    const result = await performCreateSquad(
      fakeSupabase({ profile: { username: 'x' }, tournament: openSquadTournament, existingMembership: { id: 'm1' } }),
      fakeAdmin(), 'u1', { tournamentId: 't1', name: 'Squad A' },
    )
    expect(result).toEqual({ ok: false, errorCode: 'already_in_squad' })
  })

  it('creates the squad and returns its id and invite code', async () => {
    const result = await performCreateSquad(
      fakeSupabase({ profile: { username: 'x' }, tournament: openSquadTournament }),
      fakeAdmin(), 'u1', { tournamentId: 't1', name: 'Squad A' },
    )
    expect(result).toEqual({ ok: true, squadId: 'sq1', inviteCode: 'ABCD1234' })
  })

  it('maps a unique-name collision to name_taken', async () => {
    const result = await performCreateSquad(
      fakeSupabase({ profile: { username: 'x' }, tournament: openSquadTournament }),
      fakeAdmin({ insertError: { code: '23505' } }), 'u1', { tournamentId: 't1', name: 'Squad A' },
    )
    expect(result).toEqual({ ok: false, errorCode: 'name_taken' })
  })
})
