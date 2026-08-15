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
    // Champions Cup gets its own, higher reward scale (Task 4.3) — not
    // community_club's 500, which this assertion used to (incorrectly)
    // expect before Champions Cup had its own table.
    expect(awardCoins).toHaveBeenCalledWith(client, 'winner', 2000, 'tournament_placement', 't2')
  })

  it('awards Champions Cup its own full placement table, not Community Club\'s', async () => {
    const { awardCoins } = await import('@/lib/coins/service')
    const { awardXP } = await import('@/lib/membership/xp')
    vi.mocked(awardCoins).mockClear()
    vi.mocked(awardXP).mockClear()
    const { client } = fakeAdmin({
      tournament: { id: 't4', tournament_type: 'champions_cup', season_id: null },
      registrations: [{ player_id: 'winner' }, { player_id: 'loser' }],
      matches: [championMatch],
    })
    await awardSeasonPoints(client as never, 't4')
    expect(awardCoins).toHaveBeenCalledWith(client, 'winner', 2000, 'tournament_placement', 't4')
    expect(awardXP).toHaveBeenCalledWith(client, 'winner', 3000, 'tournament_placement', 't4')
    expect(awardCoins).toHaveBeenCalledWith(client, 'loser', 1200, 'tournament_placement', 't4')
    expect(awardXP).toHaveBeenCalledWith(client, 'loser', 2000, 'tournament_placement', 't4')
  })

  it('uses Masters\' own placement table for a non-advancer, where it diverges from Community Club\'s', async () => {
    // COMMUNITY_CLUB_PLACEMENT.non_advancer = 17 (PLACEMENT_COINS has no
    // entry for 17 — the pre-fix bug silently awarded nothing to a Masters
    // non-advancer). MASTERS_PLACEMENT.non_advancer = 9, which DOES have a
    // real coin reward (30). This is where the two tables genuinely diverge
    // — every band from champion through round_of_16 resolves to the same
    // numeric placement in both tables today. (PLACEMENT_XP has no entry
    // for placement 9 at all — a separate, pre-existing gap unrelated to
    // this fix, so no XP assertion here; only coins meaningfully diverge.)
    const { awardCoins } = await import('@/lib/coins/service')
    vi.mocked(awardCoins).mockClear()
    const { client } = fakeAdmin({
      tournament: { id: 't5', tournament_type: 'masters', season_id: 's1' },
      registrations: [{ player_id: 'winner' }, { player_id: 'loser' }, { player_id: 'bystander' }],
      matches: [championMatch], // bystander never appears in any match -> non_advancer
    })
    await awardSeasonPoints(client as never, 't5')
    expect(awardCoins).toHaveBeenCalledWith(client, 'bystander', 30, 'tournament_placement', 't5')
  })
})
