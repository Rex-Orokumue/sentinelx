import { describe, it, expect } from 'vitest'
import { getSeasonLeaderboard } from './data'

function fakeAdmin(opts: {
  seasonTournamentIds: string[]
  registeredPlayerIds: string[]
  pointsRows: { player_id: string; points: number }[]
  penaltyRows: { player_id: string; points: number }[]
  profiles: { id: string; username: string | null; display_name: string | null; avatar_url: string | null; sx_score: number }[]
}) {
  return {
    from(table: string) {
      if (table === 'tournaments') {
        return {
          select: () => ({
            eq: () => ({
              in: async () => ({ data: opts.seasonTournamentIds.map((id) => ({ id })) }),
            }),
          }),
        }
      }
      if (table === 'tournament_registrations') {
        return {
          select: () => ({
            in: () => ({
              eq: async () => ({ data: opts.registeredPlayerIds.map((player_id) => ({ player_id })) }),
            }),
          }),
        }
      }
      if (table === 'season_ranking_points') {
        return { select: () => ({ eq: async () => ({ data: opts.pointsRows }) }) }
      }
      if (table === 'season_noshow_penalties') {
        return { select: () => ({ eq: async () => ({ data: opts.penaltyRows }) }) }
      }
      if (table === 'profiles') {
        return { select: () => ({ in: async () => ({ data: opts.profiles }) }) }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

describe('getSeasonLeaderboard', () => {
  it('includes a registered player with zero points, not just players with a points/penalty row', async () => {
    const admin = fakeAdmin({
      seasonTournamentIds: ['t1'],
      registeredPlayerIds: ['p1', 'p2'],
      pointsRows: [{ player_id: 'p1', points: 500 }],
      penaltyRows: [],
      profiles: [
        { id: 'p1', username: 'winner', display_name: null, avatar_url: null, sx_score: 900 },
        { id: 'p2', username: 'still-competing', display_name: null, avatar_url: null, sx_score: 700 },
      ],
    })
    const rows = await getSeasonLeaderboard(admin as never, 's1')
    const usernames = rows.map((r) => r.username).sort()
    expect(usernames).toEqual(['still-competing', 'winner'])
    const zero = rows.find((r) => r.username === 'still-competing')
    expect(zero?.points).toBe(0)
  })

  it('still sums season_ranking_points and season_noshow_penalties together for a player who has both', async () => {
    const admin = fakeAdmin({
      seasonTournamentIds: ['t1'],
      registeredPlayerIds: ['p1'],
      pointsRows: [{ player_id: 'p1', points: 500 }],
      penaltyRows: [{ player_id: 'p1', points: -15 }],
      profiles: [{ id: 'p1', username: 'winner', display_name: null, avatar_url: null, sx_score: 900 }],
    })
    const rows = await getSeasonLeaderboard(admin as never, 's1')
    expect(rows).toEqual([{ playerId: 'p1', username: 'winner', displayName: null, avatarUrl: null, sxScore: 900, points: 485 }])
  })

  it('returns an empty list when the season has no community_club/masters tournaments at all', async () => {
    const admin = fakeAdmin({
      seasonTournamentIds: [],
      registeredPlayerIds: [],
      pointsRows: [],
      penaltyRows: [],
      profiles: [],
    })
    const rows = await getSeasonLeaderboard(admin as never, 's1')
    expect(rows).toEqual([])
  })
})
