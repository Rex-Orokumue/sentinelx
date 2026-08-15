import { describe, it, expect } from 'vitest'
import { getSeasonLeaderboard } from './data'

function fakeAdmin(opts: {
  seasonTournaments: { id: string; status: string; tournament_type: string }[]
  registeredPlayerIds: string[]
  pointsRows: { player_id: string; points: number }[]
  penaltyRows: { player_id: string; points: number }[]
  profiles: { id: string; username: string | null; display_name: string | null; avatar_url: string | null; sx_score: number }[]
  // keyed by tournament id -> that tournament's active registrations + matches,
  // only consulted for tournaments with status 'active'.
  perTournament?: Record<string, { activePlayerIds: string[]; matches: unknown[] }>
}) {
  return {
    from(table: string) {
      if (table === 'tournaments') {
        return {
          select: () => ({
            eq: () => ({
              in: async () => ({ data: opts.seasonTournaments }),
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
            eq: (col: string, val: string) => ({
              eq: async () => ({
                data: (opts.perTournament?.[val]?.activePlayerIds ?? []).map((player_id) => ({ player_id })),
              }),
            }),
          }),
        }
      }
      if (table === 'matches') {
        return {
          select: () => ({
            eq: async (col: string, val: string) => ({ data: opts.perTournament?.[val]?.matches ?? [] }),
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
      seasonTournaments: [{ id: 't1', status: 'completed', tournament_type: 'community_club' }],
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
    expect(zero?.isProvisional).toBe(false)
  })

  it('still sums season_ranking_points and season_noshow_penalties together for a player who has both', async () => {
    const admin = fakeAdmin({
      seasonTournaments: [{ id: 't1', status: 'completed', tournament_type: 'community_club' }],
      registeredPlayerIds: ['p1'],
      pointsRows: [{ player_id: 'p1', points: 500 }],
      penaltyRows: [{ player_id: 'p1', points: -15 }],
      profiles: [{ id: 'p1', username: 'winner', display_name: null, avatar_url: null, sx_score: 900 }],
    })
    const rows = await getSeasonLeaderboard(admin as never, 's1')
    expect(rows).toEqual([
      { playerId: 'p1', username: 'winner', displayName: null, avatarUrl: null, sxScore: 900, points: 485, isProvisional: false },
    ])
  })

  it('returns an empty list when the season has no community_club/masters tournaments at all', async () => {
    const admin = fakeAdmin({
      seasonTournaments: [],
      registeredPlayerIds: [],
      pointsRows: [],
      penaltyRows: [],
      profiles: [],
    })
    const rows = await getSeasonLeaderboard(admin as never, 's1')
    expect(rows).toEqual([])
  })

  it('gives a still-competing player in an active tournament a provisional floor, marked isProvisional', async () => {
    const admin = fakeAdmin({
      seasonTournaments: [{ id: 't2', status: 'active', tournament_type: 'community_club' }],
      registeredPlayerIds: ['p1'],
      pointsRows: [],
      penaltyRows: [],
      profiles: [{ id: 'p1', username: 'stillin', display_name: null, avatar_url: null, sx_score: 700 }],
      perTournament: {
        t2: {
          activePlayerIds: ['p1'],
          matches: [
            { round: 'semi_final', status: 'scheduled', player_a_id: 'p1', player_b_id: 'p9', score_a: null, score_b: null },
          ],
        },
      },
    })
    const rows = await getSeasonLeaderboard(admin as never, 's1')
    // semi_final band on the community_club table = placement 3 = 45 points
    // (COMMUNITY_CLUB_POINTS.semi_final, lib/tournaments/season-placement.ts).
    expect(rows).toEqual([
      { playerId: 'p1', username: 'stillin', displayName: null, avatarUrl: null, sxScore: 700, points: 45, isProvisional: true },
    ])
  })

  it('does not let a provisional contribution overwrite or double-count a real locked-in row', async () => {
    // p1 already has a real, locked 500-point row from a COMPLETED tournament
    // (t1), and is also still competing in a second, ACTIVE tournament (t2)
    // in the same season. Both must combine into one total, and the row
    // must be marked provisional since part of it can still move.
    const admin = fakeAdmin({
      seasonTournaments: [
        { id: 't1', status: 'completed', tournament_type: 'community_club' },
        { id: 't2', status: 'active', tournament_type: 'community_club' },
      ],
      registeredPlayerIds: ['p1'],
      pointsRows: [{ player_id: 'p1', points: 500 }],
      penaltyRows: [],
      profiles: [{ id: 'p1', username: 'double', display_name: null, avatar_url: null, sx_score: 900 }],
      perTournament: {
        t2: {
          activePlayerIds: ['p1'],
          matches: [
            { round: 'quarter_final', status: 'scheduled', player_a_id: 'p1', player_b_id: 'p9', score_a: null, score_b: null },
          ],
        },
      },
    })
    const rows = await getSeasonLeaderboard(admin as never, 's1')
    // 500 real + 25 provisional (quarter_final = placement 5 = 25 points).
    expect(rows).toEqual([
      { playerId: 'p1', username: 'double', displayName: null, avatarUrl: null, sxScore: 900, points: 525, isProvisional: true },
    ])
  })
})
