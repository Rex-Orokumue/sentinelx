import { describe, it, expect } from 'vitest'
import { performLookupSquad } from './lookup-squad-service'

function fakeSupabase(opts: {
  tournament?: { squad_size: number } | null
  squad?: { id: string; name: string; tournament_id: string; status: string } | null
  memberCount?: number
}) {
  return {
    from: (table: string) => {
      if (table === 'tournaments') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.tournament ?? null }) }) }) }
      if (table === 'squads') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.squad ?? null }) }) }) }
      if (table === 'squad_members') return { select: () => ({ eq: () => Promise.resolve({ count: opts.memberCount ?? 0 }) }) }
      throw new Error(`unexpected table ${table}`)
    },
  } as never
}

describe('performLookupSquad', () => {
  it('reports tournament_not_found when the tournament has no squad_size', async () => {
    const result = await performLookupSquad(fakeSupabase({ tournament: null }), { tournamentId: 't1', code: 'ABCD1234' })
    expect(result).toEqual({ ok: false, errorCode: 'tournament_not_found' })
  })

  it('reports squad_not_found when no squad matches the code for this tournament', async () => {
    const result = await performLookupSquad(
      fakeSupabase({ tournament: { squad_size: 4 }, squad: { id: 's1', name: 'X', tournament_id: 't2', status: 'forming' } }),
      { tournamentId: 't1', code: 'ABCD1234' },
    )
    expect(result).toEqual({ ok: false, errorCode: 'squad_not_found' })
  })

  it('reports not_accepting_members when the squad is not forming', async () => {
    const result = await performLookupSquad(
      fakeSupabase({ tournament: { squad_size: 4 }, squad: { id: 's1', name: 'X', tournament_id: 't1', status: 'complete' } }),
      { tournamentId: 't1', code: 'ABCD1234' },
    )
    expect(result).toEqual({ ok: false, errorCode: 'not_accepting_members' })
  })

  it('reports squad_full when member count has reached squad_size', async () => {
    const result = await performLookupSquad(
      fakeSupabase({ tournament: { squad_size: 4 }, squad: { id: 's1', name: 'X', tournament_id: 't1', status: 'forming' }, memberCount: 4 }),
      { tournamentId: 't1', code: 'ABCD1234' },
    )
    expect(result).toEqual({ ok: false, errorCode: 'squad_full' })
  })

  it('returns the squad preview when everything checks out', async () => {
    const result = await performLookupSquad(
      fakeSupabase({ tournament: { squad_size: 4 }, squad: { id: 's1', name: 'X', tournament_id: 't1', status: 'forming' }, memberCount: 2 }),
      { tournamentId: 't1', code: 'ABCD1234' },
    )
    expect(result).toEqual({ ok: true, squad: { id: 's1', name: 'X', memberCount: 2, teamSize: 4 } })
  })
})
