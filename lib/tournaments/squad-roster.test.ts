import { describe, it, expect, vi } from 'vitest'

describe('squadRosterIds', () => {
  it('returns every current member of a squad', async () => {
    const from = vi.fn(() => ({ select: () => ({ eq: async () => ({ data: [{ player_id: 'p1' }, { player_id: 'p2' }] }) }) }))
    const { squadRosterIds } = await import('./squad-roster')
    const admin = { from } as unknown as Parameters<typeof squadRosterIds>[0]
    expect(await squadRosterIds(admin, 's1')).toEqual(['p1', 'p2'])
  })
})

describe('matchRosters', () => {
  it('fetches both sides in one call, an empty array for a null side', async () => {
    const from = vi.fn((_table: string) => ({
      select: () => ({
        eq: async () => ({ data: [{ player_id: 'a1' }, { player_id: 'a2' }] }),
      }),
    }))
    const { matchRosters } = await import('./squad-roster')
    const admin = { from } as unknown as Parameters<typeof matchRosters>[0]
    const { rosterA, rosterB } = await matchRosters(admin, 'sqA', null)
    expect(rosterA).toEqual(['a1', 'a2'])
    expect(rosterB).toEqual([])
  })
})

describe('squadIdByPlayerForTournament', () => {
  it('maps every roster member to their squad id', async () => {
    const from = vi.fn(() => ({
      select: () => ({
        eq: async () => ({
          data: [
            { player_id: 'p1', squad_id: 'sqA' },
            { player_id: 'p2', squad_id: 'sqA' },
            { player_id: 'p3', squad_id: 'sqB' },
          ],
        }),
      }),
    }))
    const { squadIdByPlayerForTournament } = await import('./squad-roster')
    const admin = { from } as unknown as Parameters<typeof squadIdByPlayerForTournament>[0]
    const map = await squadIdByPlayerForTournament(admin, 't1')
    expect(map.get('p1')).toBe('sqA')
    expect(map.get('p3')).toBe('sqB')
  })
})
