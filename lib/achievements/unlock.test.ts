import { describe, it, expect, vi } from 'vitest'
import { checkAndUnlockAchievements } from './unlock'

vi.mock('@/lib/membership/xp', () => ({ awardXP: vi.fn() }))
vi.mock('@/lib/coins/service', () => ({ recordCoinTransaction: vi.fn() }))
vi.mock('@/lib/notifications/inbox', () => ({ notifyInApp: vi.fn() }))

function fakeAdmin(opts: {
  unlockedSlugs?: string[]
  achievements: { id: string; slug: string; name: string; category: string; xp_reward: number; coin_reward: number }[]
  profile?: { total_matches: number; wins: number }
  recentMatches?: { outcome: 'win' | 'loss' | 'draw' }[]
  seasonRankingWins?: number
}) {
  const inserted: Record<string, unknown>[] = []
  return {
    client: {
      from(table: string) {
        if (table === 'player_achievements') {
          return {
            select: () => ({ eq: async () => ({ data: (opts.unlockedSlugs ?? []).map((slug) => ({ achievement_id: slug })) }) }),
            insert: async (row: Record<string, unknown>) => { inserted.push(row); return { data: null, error: null } },
          }
        }
        if (table === 'achievements') {
          return { select: () => ({ eq: () => ({ eq: async () => ({ data: opts.achievements }) }) }) }
        }
        if (table === 'profiles') {
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.profile }) }) }) }
        }
        if (table === 'season_ranking_points') {
          return { select: () => ({ eq: () => ({ eq: async () => ({ data: Array(opts.seasonRankingWins ?? 0).fill({ placement: 1 }) }) }) }) }
        }
        if (table === 'matches') {
          const rows = (opts.recentMatches ?? []).map((m) => ({
            player_a_id: 'p1',
            player_b_id: 'opponent',
            score_a: m.outcome === 'win' ? 2 : m.outcome === 'loss' ? 1 : 1,
            score_b: m.outcome === 'win' ? 1 : m.outcome === 'loss' ? 2 : 1,
            completed_at: new Date().toISOString(),
          }))
          return {
            select: () => ({
              eq: () => ({
                or: () => ({
                  order: () => ({
                    limit: async () => ({ data: rows }),
                  }),
                }),
              }),
            }),
          }
        }
        throw new Error(`unexpected table ${table}`)
      },
    },
    inserted,
  }
}

describe('checkAndUnlockAchievements — match_completed', () => {
  it('unlocks first_match and first_win on a winning first match', async () => {
    const { client, inserted } = fakeAdmin({
      achievements: [
        { id: 'a1', slug: 'first_match', name: 'First Blood', category: 'matches', xp_reward: 50, coin_reward: 20 },
        { id: 'a2', slug: 'first_win', name: 'First W', category: 'matches', xp_reward: 100, coin_reward: 50 },
      ],
      profile: { total_matches: 1, wins: 1 },
    })
    await checkAndUnlockAchievements(client as never, 'p1', { type: 'match_completed', matchId: 'm1', won: true })
    expect(inserted.map((r) => r.achievement_id)).toEqual(['a1', 'a2'])
  })

  it('does not unlock first_win on a loss', async () => {
    const { client, inserted } = fakeAdmin({
      achievements: [{ id: 'a2', slug: 'first_win', name: 'First W', category: 'matches', xp_reward: 100, coin_reward: 50 }],
      profile: { total_matches: 1, wins: 0 },
    })
    await checkAndUnlockAchievements(client as never, 'p1', { type: 'match_completed', matchId: 'm1', won: false })
    expect(inserted).toEqual([])
  })

  it('never re-unlocks an achievement the player already has', async () => {
    const { client, inserted } = fakeAdmin({
      unlockedSlugs: ['a1'], // dedup is keyed on achievement_id (a real UUID-shaped id), not slug
      achievements: [
        { id: 'a1', slug: 'first_match', name: 'First Blood', category: 'matches', xp_reward: 50, coin_reward: 20 },
        { id: 'a2', slug: 'first_win', name: 'First W', category: 'matches', xp_reward: 100, coin_reward: 50 },
      ],
      profile: { total_matches: 1, wins: 1 },
    })
    await checkAndUnlockAchievements(client as never, 'p1', { type: 'match_completed', matchId: 'm1', won: true })
    // a1 (first_match) is already unlocked and must be skipped; a2 (first_win) is still due and unlocks.
    expect(inserted.map((r) => r.achievement_id)).toEqual(['a2'])
  })
})

describe('checkAndUnlockAchievements — sx_score_updated', () => {
  it('unlocks sx_score_100 once the threshold is crossed', async () => {
    const { client, inserted } = fakeAdmin({
      achievements: [{ id: 'a3', slug: 'sx_score_100', name: 'Rising Talent', category: 'score', xp_reward: 50, coin_reward: 25 }],
    })
    await checkAndUnlockAchievements(client as never, 'p1', { type: 'sx_score_updated', newScore: 120 })
    expect(inserted.map((r) => r.achievement_id)).toEqual(['a3'])
  })

  it('does not unlock a threshold not yet reached', async () => {
    const { client, inserted } = fakeAdmin({
      achievements: [{ id: 'a3', slug: 'sx_score_100', name: 'Rising Talent', category: 'score', xp_reward: 50, coin_reward: 25 }],
    })
    await checkAndUnlockAchievements(client as never, 'p1', { type: 'sx_score_updated', newScore: 99 })
    expect(inserted).toEqual([])
  })
})

describe('checkAndUnlockAchievements — awards + notification', () => {
  it('awards xp and coins and sends an achievement_unlocked notification on unlock', async () => {
    const { awardXP } = await import('@/lib/membership/xp')
    const { recordCoinTransaction } = await import('@/lib/coins/service')
    const { notifyInApp } = await import('@/lib/notifications/inbox')
    const { client } = fakeAdmin({
      achievements: [{ id: 'a1', slug: 'first_match', name: 'First Blood', category: 'matches', xp_reward: 50, coin_reward: 20 }],
      profile: { total_matches: 1, wins: 0 },
    })
    await checkAndUnlockAchievements(client as never, 'p1', { type: 'match_completed', matchId: 'm1', won: false })
    expect(awardXP).toHaveBeenCalledWith(client, 'p1', 50, 'achievement_unlocked', 'a1')
    expect(recordCoinTransaction).toHaveBeenCalledWith(client, 'p1', 20, 'achievement_unlocked', 'a1')
    expect(notifyInApp).toHaveBeenCalledWith(expect.objectContaining({ playerId: 'p1', type: 'achievement_unlocked' }))
  })
})
