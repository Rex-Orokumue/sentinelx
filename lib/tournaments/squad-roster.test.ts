import { describe, it, expect, vi } from 'vitest'
import { rostersForSquads } from './squad-roster'

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

function fakeClient(rows: { squad_id: string; player_id: string }[]) {
  return {
    from(table: string) {
      if (table !== 'squad_members') throw new Error(`unexpected table ${table}`)
      return { select: () => ({ in: async () => ({ data: rows }) }) }
    },
  }
}

describe('rostersForSquads', () => {
  it('returns an empty map for no squad ids, with no query', async () => {
    const client = { from: () => { throw new Error('should not query') } }
    const result = await rostersForSquads(client as never, [])
    expect(result.size).toBe(0)
  })

  it('groups member player ids by squad id', async () => {
    const client = fakeClient([
      { squad_id: 's1', player_id: 'p1' },
      { squad_id: 's1', player_id: 'p2' },
      { squad_id: 's2', player_id: 'p3' },
    ])
    const result = await rostersForSquads(client as never, ['s1', 's2'])
    expect(result.get('s1')).toEqual(['p1', 'p2'])
    expect(result.get('s2')).toEqual(['p3'])
  })
})
