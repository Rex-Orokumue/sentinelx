import { describe, it, expect, vi, beforeEach } from 'vitest'

const { optionalAuth } = vi.hoisted(() => ({ optionalAuth: vi.fn() }))
vi.mock('../auth', () => ({ authenticate: vi.fn(), optionalAuth }))
const { fetchChampions } = vi.hoisted(() => ({ fetchChampions: vi.fn() }))
vi.mock('@/lib/tournaments/champions', () => ({ fetchChampions }))
const { isClosedWithoutWinner } = vi.hoisted(() => ({ isClosedWithoutWinner: vi.fn() }))
vi.mock('@/lib/tournaments/no-winner', () => ({ isClosedWithoutWinner }))

import { resultsEndpoint } from './results'

beforeEach(() => {
  optionalAuth.mockReset()
  fetchChampions.mockReset()
  isClosedWithoutWinner.mockReset()
})

function fakeSupabase(opts: { tournament: { id: string; status: string } | null; finalRows?: { round: string; status: string }[] }) {
  return {
    from: (table: string) => {
      if (table === 'tournaments') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.tournament }) }) }) }
      if (table === 'matches') return { select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: opts.finalRows ?? [] }) }) }) }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

const fakeChampion = {
  tournamentId: 't1', slug: 'sample', title: 'Sample Cup', tournamentType: 'open' as const,
  gameId: 'g1', gameName: 'DLS', date: '2026-09-01T00:00:00Z', prizePool: 50000,
  champion: { id: 'p1', name: 'Player One' }, runnerUp: { id: 'p2', name: 'Player Two' },
  championAvatarUrl: null, seasonName: null,
}

describe('resultsEndpoint', () => {
  it('404s when the tournament does not exist', async () => {
    optionalAuth.mockResolvedValue({ userClient: fakeSupabase({ tournament: null }) })
    const res = await resultsEndpoint.handler(new Request('https://x.test/api/mobile/v1/tournaments/t1/results'), { params: { id: 't1' } })
    expect(res.status).toBe(404)
  })

  it('returns the champion when the tournament is completed and one was resolved', async () => {
    const supabase = fakeSupabase({ tournament: { id: 't1', status: 'completed' } })
    optionalAuth.mockResolvedValue({ userClient: supabase })
    fetchChampions.mockResolvedValue([fakeChampion])
    const res = await resultsEndpoint.handler(new Request('https://x.test/api/mobile/v1/tournaments/t1/results'), { params: { id: 't1' } })
    expect(fetchChampions).toHaveBeenCalledWith(supabase, { tournamentId: 't1' })
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ champion: fakeChampion, noWinner: false })
  })

  it('reports noWinner when completed with no champion and the final was closed without one', async () => {
    const supabase = fakeSupabase({ tournament: { id: 't1', status: 'completed' }, finalRows: [{ round: 'final', status: 'disputed' }] })
    optionalAuth.mockResolvedValue({ userClient: supabase })
    fetchChampions.mockResolvedValue([])
    isClosedWithoutWinner.mockReturnValue(true)
    const res = await resultsEndpoint.handler(new Request('https://x.test/api/mobile/v1/tournaments/t1/results'), { params: { id: 't1' } })
    expect(isClosedWithoutWinner).toHaveBeenCalledWith('completed', [{ round: 'final', status: 'disputed' }])
    expect((await res.json()).data).toEqual({ champion: null, noWinner: true })
  })

  it('returns nulls for a tournament that has not finished', async () => {
    optionalAuth.mockResolvedValue({ userClient: fakeSupabase({ tournament: { id: 't1', status: 'active' } }) })
    const res = await resultsEndpoint.handler(new Request('https://x.test/api/mobile/v1/tournaments/t1/results'), { params: { id: 't1' } })
    expect(fetchChampions).not.toHaveBeenCalled()
    expect((await res.json()).data).toEqual({ champion: null, noWinner: false })
  })
})
