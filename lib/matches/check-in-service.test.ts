import { describe, it, expect, vi } from 'vitest'
import { performCheckIn } from './check-in-service'

function fakeSupabase(opts: { match?: Record<string, unknown> | null; existing?: { id: string } | null }) {
  return {
    from: (table: string) => {
      if (table === 'matches') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.match ?? null }) }) }) }
      if (table === 'match_check_ins') return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.existing ?? null }) }) }) }) }
      throw new Error(`unexpected table ${table}`)
    },
  } as never
}
function fakeAdmin(opts: { insertError?: { code?: string } | null } = {}) {
  const insert = vi.fn().mockResolvedValue({ error: opts.insertError ?? null })
  return { from: (table: string) => { if (table !== 'match_check_ins') throw new Error(`unexpected table ${table}`); return { insert } }, __insert: insert } as never
}

const past = new Date(Date.now() - 3_600_000).toISOString()
const future = new Date(Date.now() + 3_600_000).toISOString()

describe('performCheckIn', () => {
  it('reports match_not_found', async () => {
    const result = await performCheckIn(fakeSupabase({ match: null }), fakeAdmin(), 'p1', 'm1')
    expect(result).toEqual({ ok: false, errorCode: 'match_not_found' })
  })

  it('reports not_participant for a non-participant', async () => {
    const match = { id: 'm1', status: 'scheduled', scheduled_at: past, player_a_id: 'p1', player_b_id: 'p2', team_a_id: null, team_b_id: null }
    const result = await performCheckIn(fakeSupabase({ match }), fakeAdmin(), 'stranger', 'm1')
    expect(result).toEqual({ ok: false, errorCode: 'not_participant' })
  })

  it('reports not_match_day before scheduled_at has passed', async () => {
    const match = { id: 'm1', status: 'scheduled', scheduled_at: future, player_a_id: 'p1', player_b_id: 'p2', team_a_id: null, team_b_id: null }
    const result = await performCheckIn(fakeSupabase({ match }), fakeAdmin(), 'p1', 'm1')
    expect(result).toEqual({ ok: false, errorCode: 'not_match_day' })
  })

  it('treats an already-checked-in participant as a benign success', async () => {
    const match = { id: 'm1', status: 'scheduled', scheduled_at: past, player_a_id: 'p1', player_b_id: 'p2', team_a_id: null, team_b_id: null }
    const result = await performCheckIn(fakeSupabase({ match, existing: { id: 'ci1' } }), fakeAdmin(), 'p1', 'm1')
    expect(result).toEqual({ ok: true })
  })

  it('inserts a check-in for a participant on match day', async () => {
    const match = { id: 'm1', status: 'scheduled', scheduled_at: past, player_a_id: 'p1', player_b_id: 'p2', team_a_id: null, team_b_id: null }
    const admin = fakeAdmin()
    const result = await performCheckIn(fakeSupabase({ match }), admin, 'p1', 'm1')
    expect(result).toEqual({ ok: true })
    expect((admin as unknown as { __insert: ReturnType<typeof vi.fn> }).__insert).toHaveBeenCalledWith({ match_id: 'm1', player_id: 'p1' })
  })

  it('treats a 23505 unique-violation as a benign success (race with itself)', async () => {
    const match = { id: 'm1', status: 'scheduled', scheduled_at: past, player_a_id: 'p1', player_b_id: 'p2', team_a_id: null, team_b_id: null }
    const result = await performCheckIn(fakeSupabase({ match }), fakeAdmin({ insertError: { code: '23505' } }), 'p1', 'm1')
    expect(result).toEqual({ ok: true })
  })
})
