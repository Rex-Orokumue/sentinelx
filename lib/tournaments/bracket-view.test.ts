import { describe, it, expect } from 'vitest'
import { loadBracketView } from './bracket-view'

// Minimal Supabase-shaped mock covering exactly the five table queries
// loadBracketView makes — one group, zero knockout matches, mirroring what
// a round-robin tournament's data actually looks like. No registration
// fields configured by default, so clubNameByPlayer resolves to null for
// everyone unless a test overrides `fields`.
function fakeSupabase(opts: { fields?: { field_key: string; label: string; placeholder: string | null; input_type: string; required: boolean; validation_pattern: string | null; validation_message: string | null; show_on_bracket: boolean }[] } = {}) {
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
      if (table === 'tournaments') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { game_id: 'g1' } }) }) }) }
      }
      if (table === 'game_registration_fields') {
        return { select: () => ({ eq: () => ({ eq: () => ({ order: async () => ({ data: opts.fields ?? [] }) }) }) }) }
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
        if (table === 'tournaments') {
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { game_id: 'g1' } }) }) }) }
        }
        if (table === 'game_registration_fields') {
          return { select: () => ({ eq: () => ({ eq: () => ({ order: async () => ({ data: [] }) }) }) }) }
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

  it('shows the value of whichever field is flagged show_on_bracket, and null when none is', async () => {
    const withField = {
      ...fakeSupabase({ fields: [{ field_key: 'in_game_uid', label: 'In-game UID', placeholder: null, input_type: 'text', required: true, validation_pattern: null, validation_message: null, show_on_bracket: true }] }),
      from(table: string) {
        if (table === 'group_memberships') {
          return {
            select: () => ({
              in: async () => ({
                data: [{ group_id: 'g1', player_id: 'p1', team_id: null, wins: 1, draws: 0, losses: 0, goals_for: 3, goals_against: 1, points: 3, profiles: { username: 'ada', display_name: null }, squads: null }],
              }),
            }),
          }
        }
        if (table === 'tournament_registrations') {
          return { select: () => ({ eq: async () => ({ data: [{ player_id: 'p1', registration_details: { in_game_uid: '778899' } }] }) }) }
        }
        return fakeSupabase({ fields: [{ field_key: 'in_game_uid', label: 'In-game UID', placeholder: null, input_type: 'text', required: true, validation_pattern: null, validation_message: null, show_on_bracket: true }] }).from(table)
      },
    }
    const view = await loadBracketView(withField as never, 'tournament-id', 'round_robin')
    expect(view.standings[0].rows[0].clubName).toBe('778899')

    const withoutField = {
      ...fakeSupabase(),
      from(table: string) {
        if (table === 'group_memberships') {
          return {
            select: () => ({
              in: async () => ({
                data: [{ group_id: 'g1', player_id: 'p1', team_id: null, wins: 1, draws: 0, losses: 0, goals_for: 3, goals_against: 1, points: 3, profiles: { username: 'ada', display_name: null }, squads: null }],
              }),
            }),
          }
        }
        if (table === 'tournament_registrations') {
          return { select: () => ({ eq: async () => ({ data: [{ player_id: 'p1', registration_details: { in_game_uid: '778899' } }] }) }) }
        }
        return fakeSupabase().from(table)
      },
    }
    const view2 = await loadBracketView(withoutField as never, 'tournament-id', 'round_robin')
    expect(view2.standings[0].rows[0].clubName).toBeNull()
  })
})
