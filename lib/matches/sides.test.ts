import { describe, it, expect } from 'vitest'
import { sideName, myMatchesFilter, isMySide, pickOpponent } from './sides'

describe('sideName', () => {
  it('prefers the squad name', () => expect(sideName(null, { name: 'Alpha' })).toBe('Alpha'))
  it('falls back to player display_name then username', () => {
    expect(sideName({ username: 'u', display_name: 'D' }, null)).toBe('D')
    expect(sideName({ username: 'u', display_name: null }, null)).toBe('u')
  })
  it('unwraps one-element arrays', () => expect(sideName(null, [{ name: 'Beta' }])).toBe('Beta'))
  it('returns TBD when both refs are empty', () => expect(sideName(null, null)).toBe('TBD'))
  it('honors a custom fallback', () => expect(sideName(null, null, 'Player')).toBe('Player'))
})

describe('myMatchesFilter', () => {
  it('is solo-only when the user has no squads (no malformed in.())', () =>
    expect(myMatchesFilter('u1', [])).toBe('player_a_id.eq.u1,player_b_id.eq.u1'))
  it('adds squad clauses', () =>
    expect(myMatchesFilter('u1', ['s1', 's2'])).toBe(
      'player_a_id.eq.u1,player_b_id.eq.u1,team_a_id.in.(s1,s2),team_b_id.in.(s1,s2)',
    ))
})

const squadMatch = { player_a_id: null, player_b_id: null, team_a_id: 's1', team_b_id: 's2' }

describe('isMySide', () => {
  it('finds the squad side', () => expect(isMySide(squadMatch, 'u1', ['s2'])).toBe('b'))
  it('finds the solo side', () =>
    expect(isMySide({ ...squadMatch, player_a_id: 'u1', team_a_id: null }, 'u1', [])).toBe('a'))
  it('returns null for a bystander', () => expect(isMySide(squadMatch, 'u1', [])).toBeNull())
  it('ignores a null team id even if squadIds is non-empty', () =>
    expect(isMySide({ ...squadMatch, team_a_id: null }, 'u1', ['s1'])).toBeNull())
})

describe('pickOpponent', () => {
  const base = {
    ...squadMatch,
    player_a: null,
    player_b: null,
    team_a: { id: 's1', name: 'Alpha' },
    team_b: { id: 's2', name: 'Beta' },
  }
  it('squad match: user on side B sees side A squad, no player id', () =>
    expect(pickOpponent(base, 'u1', ['s2'])).toEqual({ name: 'Alpha', playerId: null, squadId: 's1' }))
  it('squad match: user on side A sees side B squad', () =>
    expect(pickOpponent(base, 'u1', ['s1'])).toEqual({ name: 'Beta', playerId: null, squadId: 's2' }))
  it('solo match: opponent is the other player', () =>
    expect(
      pickOpponent(
        {
          player_a_id: 'u1', player_b_id: 'u2', team_a_id: null, team_b_id: null,
          player_a: { username: 'me', display_name: null },
          player_b: { username: 'them', display_name: 'Them' },
          team_a: null, team_b: null,
        },
        'u1',
        [],
      ),
    ).toEqual({ name: 'Them', playerId: 'u2', squadId: null }))
  it('squad vs TBD (null side) renders TBD', () =>
    expect(pickOpponent({ ...base, team_b_id: null, team_b: null }, 'u1', ['s1'])).toEqual({
      name: 'TBD', playerId: null, squadId: null,
    }))
})
