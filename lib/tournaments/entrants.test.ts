import { describe, it, expect } from 'vitest'
import { soloEntrantRows, squadEntrantRows } from './entrants'

const T = 'ffffffff-ffff-4fff-8fff-ffffffffffff'

describe('soloEntrantRows', () => {
  it('builds one active solo entrant per seed', () => {
    const rows = soloEntrantRows(T, [
      { playerId: 'p1', displayName: 'ShadowX' },
      { playerId: 'p2', displayName: 'Kelvin_G' },
    ])

    expect(rows).toEqual([
      { tournament_id: T, kind: 'solo', player_id: 'p1', display_name: 'ShadowX', status: 'active' },
      { tournament_id: T, kind: 'solo', player_id: 'p2', display_name: 'Kelvin_G', status: 'active' },
    ])
  })

  it('preserves seed order', () => {
    // The caller passes seededPaidPlayers order (strongest first). Round 1's
    // lobby draw shuffles, but later re-seeding relies on this being the order
    // the caller intended rather than whatever the DB returns.
    const rows = soloEntrantRows(T, [
      { playerId: 'c', displayName: 'C' },
      { playerId: 'a', displayName: 'A' },
      { playerId: 'b', displayName: 'B' },
    ])
    expect(rows.map((r) => r.player_id)).toEqual(['c', 'a', 'b'])
  })

  it('falls back to a neutral name when a profile has none', () => {
    // display_name is frozen at entry time and NOT NULL. A nameless profile
    // must not break registration close.
    const rows = soloEntrantRows(T, [{ playerId: 'p1', displayName: '' }])
    expect(rows[0].display_name).toBe('Player')
  })

  it('drops duplicate players rather than violating the unique index', () => {
    // tournament_entrants has UNIQUE (tournament_id, player_id). A duplicate
    // would abort the whole insert and fail registration close for everyone.
    const rows = soloEntrantRows(T, [
      { playerId: 'p1', displayName: 'ShadowX' },
      { playerId: 'p1', displayName: 'ShadowX again' },
    ])
    expect(rows).toHaveLength(1)
  })

  it('returns nothing for no seeds', () => {
    expect(soloEntrantRows(T, [])).toEqual([])
  })
})

describe('squadEntrantRows', () => {
  it('builds one row per squad, kind squad', () => {
    const rows = squadEntrantRows('t1', [
      { squadId: 's1', displayName: 'Lagos Vipers' },
      { squadId: 's2', displayName: 'Abuja Falcons' },
    ])
    expect(rows).toEqual([
      { tournament_id: 't1', kind: 'squad', squad_id: 's1', display_name: 'Lagos Vipers', status: 'active' },
      { tournament_id: 't1', kind: 'squad', squad_id: 's2', display_name: 'Abuja Falcons', status: 'active' },
    ])
  })

  it('drops a duplicate squad id rather than letting the UNIQUE constraint abort the insert', () => {
    const rows = squadEntrantRows('t1', [
      { squadId: 's1', displayName: 'Lagos Vipers' },
      { squadId: 's1', displayName: 'Lagos Vipers' },
    ])
    expect(rows).toHaveLength(1)
  })

  it('falls back to a placeholder name for a blank display name', () => {
    const rows = squadEntrantRows('t1', [{ squadId: 's1', displayName: '  ' }])
    expect(rows[0].display_name).toBe('Squad')
  })
})
