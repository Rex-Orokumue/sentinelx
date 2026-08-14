import { describe, it, expect, vi } from 'vitest'
import { awardSeasonPoints } from './season-points'

vi.mock('@/lib/coins/service', () => ({ awardCoins: vi.fn() }))
vi.mock('@/lib/membership/xp', () => ({ awardXP: vi.fn() }))
vi.mock('@/lib/achievements/unlock', () => ({ checkAndUnlockAchievements: vi.fn() }))

function fakeAdmin(opts: {
  tournament: { id: string; tournament_type: string; season_id: string | null }
  registrations: { player_id: string }[]
  matches: { round: string; status: string; player_a_id: string | null; player_b_id: string | null; score_a: number | null; score_b: number | null }[]
}) {
  const upserts: Record<string, unknown>[] = []
  return {
    client: {
      from(table: string) {
        if (table === 'tournaments') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.tournament }) }) }) }
        if (table === 'tournament_registrations') return { select: () => ({ eq: () => ({ eq: async () => ({ data: opts.registrations }) }) }) }
        if (table === 'matches') return { select: () => ({ eq: async () => ({ data: opts.matches }) }) }
        if (table === 'season_ranking_points') return { upsert: async (rows: Record<string, unknown>[]) => { upserts.push(...rows); return { data: null, error: null } } }
        throw new Error(`unexpected table ${table}`)
      },
    },
    upserts,
  }
}

const championMatch = { round: 'final', status: 'completed', player_a_id: 'winner', player_b_id: 'loser', score_a: 3, score_b: 1 }

describe('awardSeasonPoints', () => {
  it('writes season_ranking_points AND awards placement coins/xp for a community_club tournament', async () => {
    const { awardCoins } = await import('@/lib/coins/service')
    const { client, upserts } = fakeAdmin({
      tournament: { id: 't1', tournament_type: 'community_club', season_id: 's1' },
      registrations: [{ player_id: 'winner' }, { player_id: 'loser' }],
      matches: [championMatch],
    })
    await awardSeasonPoints(client as never, 't1')
    expect(upserts.length).toBe(2)
    expect(awardCoins).toHaveBeenCalledWith(client, 'winner', 500, 'tournament_placement', 't1')
  })

  it('awards placement coins/xp for a champions_cup tournament even though it writes no season_ranking_points', async () => {
    const { awardCoins } = await import('@/lib/coins/service')
    vi.mocked(awardCoins).mockClear()
    const { client, upserts } = fakeAdmin({
      tournament: { id: 't2', tournament_type: 'champions_cup', season_id: null },
      registrations: [{ player_id: 'winner' }, { player_id: 'loser' }],
      matches: [championMatch],
    })
    await awardSeasonPoints(client as never, 't2')
    expect(upserts.length).toBe(0)
    expect(awardCoins).toHaveBeenCalledWith(client, 'winner', 500, 'tournament_placement', 't2')
  })
})
