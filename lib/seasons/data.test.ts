import { describe, it, expect } from 'vitest'
import { getSeasonLeaderboard } from './data'

function fakeAdmin(opts: {
  // game_id is optional so every pre-existing fixture (none of which cares
  // about game scoping) keeps matching regardless of which gameId the
  // function under test is called with — only the game-scoping test below
  // sets it, to prove filtering actually happens.
  seasonTournaments: { id: string; status: string; tournament_type: string; game_id?: string }[]
  registeredPlayerIds: string[]
  // tournament_id is optional for the same reason as game_id above — only
  // the game-scoping test sets it, to prove points/penalties are scoped to
  // the game-filtered tournamentIds, not just the season_id.
  pointsRows: { player_id: string; points: number; tournament_id?: string }[]
  // match_id is optional for the same permissive reason (season_noshow_penalties
  // has no tournament_id column — it's scoped via match_id instead).
  penaltyRows: { player_id: string; points: number; match_id?: string }[]
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
              eq: (_col: string, gameId: string) => ({
                in: async () => ({
                  data: opts.seasonTournaments.filter((t) => t.game_id === undefined || t.game_id === gameId),
                }),
              }),
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
            // Resolves gameMatchIds for season_noshow_penalties scoping —
            // one synthetic match id per requested tournament id, so the
            // real code's `gameMatchIds.length > 0` gate stays open and the
            // season_noshow_penalties mock's permissive match_id fallback
            // (below) gets a chance to run for fixtures that don't care
            // about this specific join.
            in: async (_col: string, ids: string[]) => ({ data: ids.map((id) => ({ id: `m-${id}` })) }),
          }),
        }
      }
      if (table === 'season_ranking_points') {
        return {
          select: () => ({
            eq: () => ({
              in: async (_col: string, ids: string[]) => ({
                data: opts.pointsRows.filter((r) => r.tournament_id === undefined || ids.includes(r.tournament_id)),
              }),
            }),
          }),
        }
      }
      if (table === 'season_noshow_penalties') {
        return {
          select: () => ({
            eq: () => ({
              in: async (_col: string, ids: string[]) => ({
                data: opts.penaltyRows.filter((r) => r.match_id === undefined || ids.includes(r.match_id)),
              }),
            }),
          }),
        }
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
    const rows = await getSeasonLeaderboard(admin as never, 's1', 'game-a')
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
    const rows = await getSeasonLeaderboard(admin as never, 's1', 'game-a')
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
    const rows = await getSeasonLeaderboard(admin as never, 's1', 'game-a')
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
    const rows = await getSeasonLeaderboard(admin as never, 's1', 'game-a')
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
    const rows = await getSeasonLeaderboard(admin as never, 's1', 'game-a')
    // 500 real + 25 provisional (quarter_final = placement 5 = 25 points).
    expect(rows).toEqual([
      { playerId: 'p1', username: 'double', displayName: null, avatarUrl: null, sxScore: 900, points: 525, isProvisional: true },
    ])
  })

  it('never mixes two games points in the same season', async () => {
    // Season S has one community_club tournament for game A (player X earns
    // 100 points there) and one for game B (player Y earns 70 points there)
    // — both tournaments share the same season_id, which is how DLS and FC
    // Mobile's tournaments actually coexist. A game-A query must return only
    // X's points; Y (and Y's tournament, t2) must not appear at all.
    const admin = fakeAdmin({
      seasonTournaments: [
        { id: 't1', status: 'completed', tournament_type: 'community_club', game_id: 'game-a' },
        { id: 't2', status: 'completed', tournament_type: 'community_club', game_id: 'game-b' },
      ],
      registeredPlayerIds: ['x'],
      pointsRows: [
        { player_id: 'x', points: 100, tournament_id: 't1' },
        { player_id: 'y', points: 70, tournament_id: 't2' },
      ],
      penaltyRows: [],
      profiles: [
        { id: 'x', username: 'player-x', display_name: null, avatar_url: null, sx_score: 900 },
        { id: 'y', username: 'player-y', display_name: null, avatar_url: null, sx_score: 900 },
      ],
    })
    const rows = await getSeasonLeaderboard(admin as never, 's1', 'game-a')
    expect(rows).toEqual([
      { playerId: 'x', username: 'player-x', displayName: null, avatarUrl: null, sxScore: 900, points: 100, isProvisional: false },
    ])
  })
})
