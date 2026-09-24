import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/tournaments/next-lobby', () => ({ fetchNextLobby: vi.fn().mockResolvedValue(null) }))

import { buildMeSummary } from './summary-service'

function fakeSupabase(opts: {
  nextMatch?: Record<string, unknown>[]
  resultsRows?: { match_id: string }[]
  openMatches?: { id: string; status: string; scheduled_at: string | null }[]
  registrations?: Record<string, unknown>[]
  groupMemberships?: Record<string, unknown>[]
  visibleMatches?: Record<string, unknown>[]
}) {
  return {
    from: (table: string) => {
      if (table === 'matches') {
        return {
          select: (cols: string) => {
            if (cols.includes('opponent_a')) return { or: () => ({ in: () => ({ order: () => ({ limit: () => Promise.resolve({ data: opts.nextMatch ?? [] }) }) }) }) }
            if (cols.includes('player_a:profiles')) return { or: () => Promise.resolve({ data: opts.visibleMatches ?? [] }) }
            return { or: () => ({ in: () => Promise.resolve({ data: opts.openMatches ?? [] }) }) }
          },
        }
      }
      if (table === 'match_results') return { select: () => ({ eq: () => Promise.resolve({ data: opts.resultsRows ?? [] }) }) }
      if (table === 'tournament_registrations') return { select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: opts.registrations ?? [] }) }) }) }
      if (table === 'group_memberships') return { select: () => ({ eq: () => Promise.resolve({ data: opts.groupMemberships ?? [] }) }) }
      throw new Error(`unexpected table ${table}`)
    },
  } as never
}

describe('buildMeSummary', () => {
  it('returns nulls/empty arrays for a player with nothing yet', async () => {
    const result = await buildMeSummary(fakeSupabase({}), 'u1')
    expect(result).toEqual({ nextMatch: null, nextLobby: null, hasSubmittableMatch: false, registrations: [], banners: [] })
  })

  it('reports hasSubmittableMatch when a live fixture has no submission yet', async () => {
    const result = await buildMeSummary(
      fakeSupabase({ openMatches: [{ id: 'm1', status: 'live', scheduled_at: new Date().toISOString() }] }),
      'u1',
    )
    expect(result.hasSubmittableMatch).toBe(true)
  })

  it('maps registration rows to the summary shape', async () => {
    const result = await buildMeSummary(
      fakeSupabase({
        registrations: [{ id: 'r1', payment_status: 'paid', tournament: { title: 'Cup', slug: 'cup', status: 'active' } }],
      }),
      'u1',
    )
    expect(result.registrations).toEqual([{ id: 'r1', paymentStatus: 'paid', tournamentTitle: 'Cup', tournamentSlug: 'cup' }])
  })
})
