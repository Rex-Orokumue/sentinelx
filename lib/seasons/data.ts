import { createAdminClient } from '@/lib/supabase/admin'
import { sumPointsByPlayer, type PointsRow } from './points-aggregate'

type Admin = ReturnType<typeof createAdminClient>

export interface SeasonLeaderboardRow {
  playerId: string
  username: string | null
  displayName: string | null
  avatarUrl: string | null
  sentinelScore: number
  points: number
}

interface ProfileInfo {
  username: string | null
  displayName: string | null
  avatarUrl: string | null
  sentinelScore: number
}

async function playerProfiles(admin: Admin, playerIds: string[]): Promise<Map<string, ProfileInfo>> {
  const map = new Map<string, ProfileInfo>()
  if (playerIds.length === 0) return map
  const { data } = await admin
    .from('profiles')
    .select('id, username, display_name, avatar_url, sentinel_score')
    .in('id', playerIds)
  for (const p of data ?? []) {
    map.set(p.id, {
      username: p.username,
      displayName: p.display_name,
      avatarUrl: p.avatar_url,
      sentinelScore: p.sentinel_score ?? 0,
    })
  }
  return map
}

function toRows(totals: Map<string, number>, profiles: Map<string, ProfileInfo>): SeasonLeaderboardRow[] {
  return Array.from(totals.entries())
    .map(([playerId, points]) => {
      const p = profiles.get(playerId)
      return {
        playerId,
        username: p?.username ?? null,
        displayName: p?.displayName ?? null,
        avatarUrl: p?.avatarUrl ?? null,
        sentinelScore: p?.sentinelScore ?? 0,
        points,
      }
    })
    .sort((a, b) => b.points - a.points)
}

// Every player with at least one season_ranking_points or
// season_noshow_penalties row for this season, ranked by total points desc.
// Used for Champions Cup qualification (spec §4, "season cumulative").
export async function getSeasonLeaderboard(admin: Admin, seasonId: string): Promise<SeasonLeaderboardRow[]> {
  const [{ data: pointsRows }, { data: penaltyRows }] = await Promise.all([
    admin.from('season_ranking_points').select('player_id, points').eq('season_id', seasonId),
    admin.from('season_noshow_penalties').select('player_id, points').eq('season_id', seasonId),
  ])
  const rows: PointsRow[] = [
    ...(pointsRows ?? []).map((r) => ({ playerId: r.player_id, points: r.points })),
    ...(penaltyRows ?? []).map((r) => ({ playerId: r.player_id, points: r.points })),
  ]
  const totals = sumPointsByPlayer(rows)
  const profiles = await playerProfiles(admin, Array.from(totals.keys()))
  return toRows(totals, profiles)
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
  return toRows(totals, profiles)
}
