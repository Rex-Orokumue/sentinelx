import { describe, it, expect } from 'vitest'
import { loadBracketView } from './bracket-view'

// Minimal Supabase-shaped mock covering exactly the four table queries
// loadBracketView makes — one group, zero knockout matches, mirroring what
// a round-robin tournament's data actually looks like.
function fakeSupabase() {
  return {
    from(table: string) {
      if (table === 'groups') {
        return {
          select: () => ({
            eq: () => ({
              order: async () => ({ data: [{ id: 'g1', name: 'League Table' }] }),
            }),
          }),
        }
      }
      if (table === 'group_memberships') {
        return { select: () => ({ in: async () => ({ data: [] }) }) }
      }
      if (table === 'matches') {
        return { select: () => ({ eq: async () => ({ data: [] }) }) }
      }
      if (table === 'tournament_registrations') {
        return { select: () => ({ eq: async () => ({ data: [] }) }) }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

describe('loadBracketView', () => {
  it('never projects knockout rounds for a round_robin tournament', async () => {
    const view = await loadBracketView(fakeSupabase() as never, 'tournament-id', 'round_robin')
    expect(view.projected).toEqual([])
    expect(view.hasKnockout).toBe(false)
    expect(view.hasGroups).toBe(true)
  })

  it('still projects knockout rounds for a group_knockout tournament with groups', async () => {
    const view = await loadBracketView(fakeSupabase() as never, 'tournament-id', 'group_knockout')
    expect(view.projected.length).toBeGreaterThan(0)
  })

  it('resolves a squad name for a team match and a team group standing', async () => {
    const client = {
      from(table: string) {
        if (table === 'groups') {
          return { select: () => ({ eq: () => ({ order: async () => ({ data: [{ id: 'g1', name: 'Group A' }] }) }) }) }
        }
        if (table === 'group_memberships') {
          return {
            select: () => ({
              in: async () => ({
                data: [
                  {
                    group_id: 'g1', player_id: null, team_id: 'sq1',
                    wins: 2, draws: 0, losses: 0, goals_for: 6, goals_against: 1, points: 6,
                    profiles: null, squads: { name: 'Lagos Vipers' },
                  },
                ],
              }),
            }),
          }
        }
        if (table === 'matches') {
          return {
            select: () => ({
              eq: async () => ({
                data: [
                  {
                    id: 'm1', round: 'group', group_id: 'g1', status: 'completed', score_a: 2, score_b: 1,
                    scheduled_at: null, is_full_day: false,
                    player_a: null, player_b: null,
                    team_a: { id: 'sq1', name: 'Lagos Vipers' },
                    team_b: { id: 'sq2', name: 'Thunder Squad' },
                  },
                ],
              }),
            }),
          }
        }
        if (table === 'tournament_registrations') {
          return { select: () => ({ eq: async () => ({ data: [] }) }) }
        }
        throw new Error(`unexpected table ${table}`)
      },
    }
    const view = await loadBracketView(client as never, 'tournament-id', 'round_robin')
    expect(view.fixtures.completed[0].playerA).toEqual({ id: 'sq1', name: 'Lagos Vipers' })
    expect(view.fixtures.completed[0].playerB).toEqual({ id: 'sq2', name: 'Thunder Squad' })
    expect(view.standings[0].rows[0].name).toBe('Lagos Vipers')
    expect(view.standings[0].rows[0].playerId).toBe('sq1')
  })
})
