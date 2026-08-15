import { createAdminClient } from '@/lib/supabase/admin'
import { sumPointsByPlayer, type PointsRow } from './points-aggregate'
import {
  guaranteedBandsForPlacements,
  pointsForBand,
  type PlacementMatch,
  type SeasonTournamentType,
} from '@/lib/tournaments/season-placement'

type Admin = ReturnType<typeof createAdminClient>

export interface SeasonLeaderboardRow {
  playerId: string
  username: string | null
  displayName: string | null
  avatarUrl: string | null
  sxScore: number
  points: number
  /** True if any part of this player's total comes from a still-active
   *  tournament's guaranteed-floor estimate rather than a locked-in
   *  season_ranking_points row — the number can still go up. */
  isProvisional: boolean
}

interface ProfileInfo {
  username: string | null
  displayName: string | null
  avatarUrl: string | null
  sxScore: number
}

async function playerProfiles(admin: Admin, playerIds: string[]): Promise<Map<string, ProfileInfo>> {
  const map = new Map<string, ProfileInfo>()
  if (playerIds.length === 0) return map
  const { data } = await admin
    .from('profiles')
    .select('id, username, display_name, avatar_url, sx_score')
    .in('id', playerIds)
  for (const p of data ?? []) {
    map.set(p.id, {
      username: p.username,
      displayName: p.display_name,
      avatarUrl: p.avatar_url,
      sxScore: p.sx_score ?? 0,
    })
  }
  return map
}

function toRows(
  totals: Map<string, number>,
  profiles: Map<string, ProfileInfo>,
  provisionalPlayerIds: Set<string>,
): SeasonLeaderboardRow[] {
  return Array.from(totals.entries())
    .map(([playerId, points]) => {
      const p = profiles.get(playerId)
      return {
        playerId,
        username: p?.username ?? null,
        displayName: p?.displayName ?? null,
        avatarUrl: p?.avatarUrl ?? null,
        sxScore: p?.sxScore ?? 0,
        points,
        isProvisional: provisionalPlayerIds.has(playerId),
      }
    })
    .sort((a, b) => b.points - a.points)
}

// Every player actively registered in one of this season's community_club/
// masters tournaments, ranked by total points desc. Real, locked-in points
// come from season_ranking_points (written once, at tournament completion —
// see lib/matches/season-points.ts). A player still competing in a tournament
// that hasn't completed yet additionally gets a provisional guaranteed-floor
// contribution computed live from that tournament's current match state
// (guaranteedBandsForPlacements) — never persisted, recomputed on every read,
// and clearly marked via isProvisional so a still-moving number is never
// mistaken for a final one. Used for Champions Cup qualification (spec §4,
// "season cumulative") — that qualification ranking (lib/seasons/
// invitation-actions.ts) reads real season_ranking_points rows directly and
// is completely unaffected by this provisional layer.
export async function getSeasonLeaderboard(admin: Admin, seasonId: string): Promise<SeasonLeaderboardRow[]> {
  const { data: seasonTournamentsData } = await admin
    .from('tournaments')
    .select('id, status, tournament_type')
    .eq('season_id', seasonId)
    .in('tournament_type', ['community_club', 'masters'])
  const seasonTournaments = seasonTournamentsData ?? []
  const tournamentIds = seasonTournaments.map((t) => t.id)
  const activeTournaments = seasonTournaments.filter((t) => t.status === 'active')

  const [{ data: registrations }, { data: pointsRows }, { data: penaltyRows }, provisionalByTournament] = await Promise.all([
    tournamentIds.length > 0
      ? admin.from('tournament_registrations').select('player_id').in('tournament_id', tournamentIds).eq('status', 'active')
      : Promise.resolve({ data: [] as { player_id: string }[] }),
    admin.from('season_ranking_points').select('player_id, points').eq('season_id', seasonId),
    admin.from('season_noshow_penalties').select('player_id, points').eq('season_id', seasonId),
    Promise.all(
      activeTournaments.map(async (t) => {
        const [{ data: activeRegs }, { data: matches }] = await Promise.all([
          admin.from('tournament_registrations').select('player_id').eq('tournament_id', t.id).eq('status', 'active'),
          admin.from('matches').select('round, status, player_a_id, player_b_id, score_a, score_b').eq('tournament_id', t.id),
        ])
        const activePlayerIds = (activeRegs ?? []).map((r) => r.player_id)
        const placements = guaranteedBandsForPlacements((matches ?? []) as PlacementMatch[], activePlayerIds)
        const tournamentType = t.tournament_type as SeasonTournamentType
        return placements.map(({ playerId, band }) => ({
          playerId,
          points: pointsForBand(tournamentType, band),
        }))
      }),
    ),
  ])

  const provisionalRows = provisionalByTournament.flat()
  const rows: PointsRow[] = [
    ...(pointsRows ?? []).map((r) => ({ playerId: r.player_id, points: r.points })),
    ...(penaltyRows ?? []).map((r) => ({ playerId: r.player_id, points: r.points })),
    ...provisionalRows,
  ]
  const totals = sumPointsByPlayer(rows)
  const provisionalPlayerIds = new Set(provisionalRows.map((r) => r.playerId))

  // Guarantee every actively-registered season player appears, even at 0.
  for (const reg of registrations ?? []) {
    if (!totals.has(reg.player_id)) totals.set(reg.player_id, 0)
  }

  const profiles = await playerProfiles(admin, Array.from(totals.keys()))
  return toRows(totals, profiles, provisionalPlayerIds)
}

// Points from community_club tournaments whose tournament_start falls in
// the given UTC calendar month, plus no-show penalties from matches
// belonging to those same tournaments. Used for Masters qualification
// (spec §4, "monthly").
export async function getMonthlyLeaderboard(
  admin: Admin,
  seasonId: string,
  monthStart: Date,
): Promise<SeasonLeaderboardRow[]> {
  const monthEnd = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1))
  const monthStartUtc = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), 1))

  const { data: tournaments } = await admin
    .from('tournaments')
    .select('id')
    .eq('season_id', seasonId)
    .eq('tournament_type', 'community_club')
    .gte('tournament_start', monthStartUtc.toISOString())
    .lt('tournament_start', monthEnd.toISOString())
  const tournamentIds = (tournaments ?? []).map((t) => t.id)
  if (tournamentIds.length === 0) return []

  const { data: matches } = await admin.from('matches').select('id').in('tournament_id', tournamentIds)
  const matchIds = (matches ?? []).map((m) => m.id)

  const [{ data: pointsRows }, penaltyResult] = await Promise.all([
    admin
      .from('season_ranking_points')
      .select('player_id, points')
      .eq('season_id', seasonId)
      .in('tournament_id', tournamentIds),
    matchIds.length > 0
      ? admin.from('season_noshow_penalties').select('player_id, points').eq('season_id', seasonId).in('match_id', matchIds)
      : Promise.resolve({ data: [] as { player_id: string; points: number }[] }),
  ])
  const rows: PointsRow[] = [
    ...(pointsRows ?? []).map((r) => ({ playerId: r.player_id, points: r.points })),
    ...(penaltyResult.data ?? []).map((r) => ({ playerId: r.player_id, points: r.points })),
  ]
  const totals = sumPointsByPlayer(rows)
  const profiles = await playerProfiles(admin, Array.from(totals.keys()))
  return toRows(totals, profiles, new Set())
}
