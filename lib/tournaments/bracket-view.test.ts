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
})
