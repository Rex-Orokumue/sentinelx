import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/admin/auth', () => ({ requireStaff: vi.fn().mockResolvedValue({ userId: 'staff' }) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('./round-schedule', () => ({ nextRoundScheduledAt: vi.fn().mockResolvedValue(null) }))

const T1 = '00000000-0000-4000-8000-000000000001'
const GA = '00000000-0000-4000-8000-0000000000a1'
const GB = '00000000-0000-4000-8000-0000000000a2'
const ENTRANT = '00000000-0000-4000-8000-0000000000e1'

function fd(obj: Record<string, string>) {
  const f = new FormData()
  for (const [k, v] of Object.entries(obj)) f.set(k, v)
  return f
}

function fakeAdmin(opts: {
  tournament?: { status: string; entry_unit: string } | null
  groupIds?: string[]
  membership?: { id: string; group_id: string } | null
  membershipEq?: (col: string, val: string) => void
  countsByGroup?: Record<string, number>
  rosterByGroup?: Record<string, Array<{ player_id: string | null; team_id: string | null }>>
  onUpdate?: (row: Record<string, unknown>, id: string) => void
  onDelete?: () => void
  onInsert?: (rows: unknown) => void
}) {
  return {
    from(table: string) {
      if (table === 'tournaments')
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: opts.tournament ?? null }) }),
          }),
        }
      if (table === 'groups')
        return { select: () => ({ eq: async () => ({ data: (opts.groupIds ?? []).map((id) => ({ id })) }) }) }
      if (table === 'group_memberships') {
        return {
          select: (cols: string, countOpts?: unknown) => {
            if (cols === 'id, group_id') {
              return {
                in: () => ({
                  eq: (col: string, val: string) => {
                    opts.membershipEq?.(col, val)
                    return { maybeSingle: async () => ({ data: opts.membership ?? null }) }
                  },
                }),
              }
            }
            if (countOpts)
              return { eq: async (_c: string, groupId: string) => ({ count: opts.countsByGroup?.[groupId] ?? 0 }) }
            return { eq: async (_c: string, groupId: string) => ({ data: opts.rosterByGroup?.[groupId] ?? [] }) }
          },
          update: (row: Record<string, unknown>) => ({
            eq: async (_c: string, id: string) => {
              opts.onUpdate?.(row, id)
              return { error: null }
            },
          }),
        }
      }
      if (table === 'matches')
        return {
          delete: () => ({
            eq: () => ({
              eq: () => ({
                in: async () => {
                  opts.onDelete?.()
                  return { error: null }
                },
              }),
            }),
          }),
          insert: async (rows: unknown) => {
            opts.onInsert?.(rows)
            return { error: null }
          },
        }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

describe('movePlayerToGroup — solo tournament', () => {
  it('moves a player and regenerates matches with player_a_id/player_b_id', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    let membershipEqCol = ''
    let updateRow: Record<string, unknown> | undefined
    let insertedRows: unknown
    vi.mocked(createAdminClient).mockReturnValue(
      fakeAdmin({
        tournament: { status: 'registration_closed', entry_unit: 'solo' },
        groupIds: [GA, GB],
        membership: { id: 'm1', group_id: GA },
        membershipEq: (col) => (membershipEqCol = col),
        countsByGroup: { [GA]: 3, [GB]: 2 },
        rosterByGroup: {
          [GA]: [{ player_id: 'p2', team_id: null }, { player_id: 'p3', team_id: null }],
          [GB]: [{ player_id: 'p4', team_id: null }, { player_id: ENTRANT, team_id: null }],
        },
        onUpdate: (row) => (updateRow = row),
        onInsert: (rows) => (insertedRows = rows),
      }) as never,
    )
    const { movePlayerToGroup } = await import('./group-admin-actions')
    const r = await movePlayerToGroup(undefined, fd({ tournamentId: T1, playerId: ENTRANT, toGroupId: GB }))
    expect(r?.success).toBe(true)
    expect(membershipEqCol).toBe('player_id')
    expect(updateRow).toMatchObject({ group_id: GB, wins: 0, points: 0 })
    const rows = insertedRows as Array<Record<string, unknown>>
    expect(rows.every((row) => 'player_a_id' in row && !('team_a_id' in row))).toBe(true)
  })

  it('rejects a move that would leave the source group below 2 players', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    vi.mocked(createAdminClient).mockReturnValue(
      fakeAdmin({
        tournament: { status: 'registration_closed', entry_unit: 'solo' },
        groupIds: [GA, GB],
        membership: { id: 'm1', group_id: GA },
        countsByGroup: { [GA]: 2, [GB]: 2 },
      }) as never,
    )
    const { movePlayerToGroup } = await import('./group-admin-actions')
    const r = await movePlayerToGroup(undefined, fd({ tournamentId: T1, playerId: ENTRANT, toGroupId: GB }))
    expect(r?.error).toMatch(/fewer than 2 players/)
  })
})

describe('movePlayerToGroup — squad tournament', () => {
  it('looks up membership by team_id and regenerates matches with team_a_id/team_b_id', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    let membershipEqCol = ''
    let insertedRows: unknown
    vi.mocked(createAdminClient).mockReturnValue(
      fakeAdmin({
        tournament: { status: 'registration_closed', entry_unit: 'squad' },
        groupIds: [GA, GB],
        membership: { id: 'm1', group_id: GA },
        membershipEq: (col) => (membershipEqCol = col),
        countsByGroup: { [GA]: 3, [GB]: 2 },
        rosterByGroup: {
          [GA]: [{ player_id: null, team_id: 'sq2' }, { player_id: null, team_id: 'sq3' }],
          [GB]: [{ player_id: null, team_id: 'sq4' }, { player_id: null, team_id: ENTRANT }],
        },
        onInsert: (rows) => (insertedRows = rows),
      }) as never,
    )
    const { movePlayerToGroup } = await import('./group-admin-actions')
    const r = await movePlayerToGroup(undefined, fd({ tournamentId: T1, playerId: ENTRANT, toGroupId: GB }))
    expect(r?.success).toBe(true)
    expect(membershipEqCol).toBe('team_id')
    const rows = insertedRows as Array<Record<string, unknown>>
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((row) => 'team_a_id' in row && !('player_a_id' in row))).toBe(true)
  })

  it('rejects with squad-worded copy when the source group would drop below 2', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    vi.mocked(createAdminClient).mockReturnValue(
      fakeAdmin({
        tournament: { status: 'registration_closed', entry_unit: 'squad' },
        groupIds: [GA, GB],
        membership: { id: 'm1', group_id: GA },
        countsByGroup: { [GA]: 2, [GB]: 2 },
      }) as never,
    )
    const { movePlayerToGroup } = await import('./group-admin-actions')
    const r = await movePlayerToGroup(undefined, fd({ tournamentId: T1, playerId: ENTRANT, toGroupId: GB }))
    expect(r?.error).toMatch(/fewer than 2 squads/)
  })

  it('fails safely (not silently) when a squad id is submitted but not found in any group', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    vi.mocked(createAdminClient).mockReturnValue(
      fakeAdmin({
        tournament: { status: 'registration_closed', entry_unit: 'squad' },
        groupIds: [GA, GB],
        membership: null,
      }) as never,
    )
    const { movePlayerToGroup } = await import('./group-admin-actions')
    const r = await movePlayerToGroup(undefined, fd({ tournamentId: T1, playerId: ENTRANT, toGroupId: GB }))
    expect(r?.error).toMatch(/squad is not in a group/)
  })
})
