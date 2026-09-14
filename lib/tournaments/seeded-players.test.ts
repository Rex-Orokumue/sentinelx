import { describe, it, expect, vi } from 'vitest'

function chainable(resolvedData: unknown) {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'in']) {
    builder[method] = vi.fn(() => builder)
  }
  ;(builder as { then: (resolve: (v: { data: unknown }) => void) => void }).then = (resolve) =>
    resolve({ data: resolvedData })
  return builder as {
    select: ReturnType<typeof vi.fn>
    eq: ReturnType<typeof vi.fn>
    in: ReturnType<typeof vi.fn>
  }
}

const registrationsChain = chainable([{ player_id: 'active-paid' }])
const profilesChain = chainable([{ id: 'active-paid', sx_score: 700 }])
const from = vi.fn((table: string) => (table === 'profiles' ? profilesChain : registrationsChain))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from }) }))

describe('seededPaidPlayers', () => {
  it('only pulls active registrations, not disqualified/removed ones that stayed marked paid', async () => {
    const { seededPaidPlayers } = await import('./seeded-players')
    const admin = { from } as unknown as Parameters<typeof seededPaidPlayers>[0]
    await seededPaidPlayers(admin, 't1')
    expect(registrationsChain.eq).toHaveBeenCalledWith('status', 'active')
  })
})

describe('seededPaidSquads', () => {
  it('orders complete squads by average roster sx_score desc', async () => {
    const squadsChain = { select: () => ({ eq: () => ({ eq: async () => ({ data: [{ id: 'low' }, { id: 'high' }] }) }) }) }
    const membersChain = {
      select: () => ({
        in: async () => ({
          data: [
            { squad_id: 'low', player_id: 'p1' },
            { squad_id: 'low', player_id: 'p2' },
            { squad_id: 'high', player_id: 'p3' },
            { squad_id: 'high', player_id: 'p4' },
          ],
        }),
      }),
    }
    const profilesChain2 = {
      select: () => ({
        in: async () => ({
          data: [
            { id: 'p1', sx_score: 500 },
            { id: 'p2', sx_score: 500 },
            { id: 'p3', sx_score: 900 },
            { id: 'p4', sx_score: 900 },
          ],
        }),
      }),
    }
    const from2 = vi.fn((table: string) =>
      table === 'squads' ? squadsChain : table === 'squad_members' ? membersChain : profilesChain2,
    )
    const { seededPaidSquads } = await import('./seeded-players')
    const admin = { from: from2 } as unknown as Parameters<typeof seededPaidSquads>[0]
    expect(await seededPaidSquads(admin, 't1')).toEqual(['high', 'low'])
  })

  it('returns an empty list when no squad is complete', async () => {
    const from2 = vi.fn(() => ({ select: () => ({ eq: () => ({ eq: async () => ({ data: [] }) }) }) }))
    const { seededPaidSquads } = await import('./seeded-players')
    const admin = { from: from2 } as unknown as Parameters<typeof seededPaidSquads>[0]
    expect(await seededPaidSquads(admin, 't1')).toEqual([])
  })
})
