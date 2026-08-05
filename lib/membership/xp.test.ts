import { describe, it, expect } from 'vitest'
import { awardXP } from './xp'

function fakeAdmin(profile: { xp: number; membership_tier: string }) {
  const updates: Record<string, unknown>[] = []
  const inserts: Record<string, unknown>[] = []
  return {
    client: {
      from(table: string) {
        if (table === 'profiles') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: profile }),
              }),
            }),
            update: (vals: Record<string, unknown>) => ({
              eq: async () => {
                updates.push(vals)
                Object.assign(profile, vals)
                return { data: null, error: null }
              },
            }),
          }
        }
        if (table === 'xp_events') {
          return { insert: async (row: Record<string, unknown>) => { inserts.push(row); return { data: null, error: null } } }
        }
        throw new Error(`unexpected table ${table}`)
      },
    },
    updates,
    inserts,
  }
}

describe('awardXP', () => {
  it('adds xp, logs an event, and does not change tier below a threshold', async () => {
    const { client, updates, inserts } = fakeAdmin({ xp: 100, membership_tier: 'recruit' })
    const result = await awardXP(client as never, 'p1', 50, 'match_played', 'm1')
    expect(result).toEqual({ newXp: 150, tierChanged: false, newTier: 'recruit' })
    expect(updates).toEqual([{ xp: 150, membership_tier: 'recruit' }])
    expect(inserts).toEqual([{ player_id: 'p1', xp: 50, source: 'match_played', reference_id: 'm1' }])
  })

  it('flips tier and reports the change when crossing a threshold', async () => {
    const { client } = fakeAdmin({ xp: 950, membership_tier: 'recruit' })
    const result = await awardXP(client as never, 'p1', 100, 'match_won', 'm1')
    expect(result).toEqual({ newXp: 1050, tierChanged: true, newTier: 'guardian' })
  })
})
