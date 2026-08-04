import { createAdminClient } from '@/lib/supabase/admin'
import {
  bandsForPlacements,
  pointsForBand,
  placementForBand,
  type PlacementMatch,
  type SeasonTournamentType,
} from '@/lib/tournaments/season-placement'

type Admin = ReturnType<typeof createAdminClient>

function isSeasonTournamentType(t: string): t is SeasonTournamentType {
  return t === 'community_club' || t === 'masters'
}

// No-op for 'open'/'champions_cup' tournaments or ones with no season_id
// (spec §3.4 — Champions Cup placement doesn't affect the season
// leaderboard). Idempotent via upsert on the (season_id, player_id,
// tournament_id) unique constraint, so re-running after a dispute
// resolution simply overwrites the prior points for that tournament.
export async function awardSeasonPoints(admin: Admin, tournamentId: string): Promise<void> {
  const { data: tournament } = await admin
    .from('tournaments')
    .select('id, tournament_type, season_id')
    .eq('id', tournamentId)
    .maybeSingle()
  if (!tournament || !tournament.season_id || !isSeasonTournamentType(tournament.tournament_type)) return

  const { data: registrations } = await admin
    .from('tournament_registrations')
    .select('player_id')
    .eq('tournament_id', tournamentId)
    .eq('status', 'active')
  const activePlayerIds = (registrations ?? []).map((r) => r.player_id)
  if (activePlayerIds.length === 0) return

  const { data: matches } = await admin
    .from('matches')
    .select('round, status, player_a_id, player_b_id, score_a, score_b')
    .eq('tournament_id', tournamentId)

  const placements = bandsForPlacements((matches ?? []) as PlacementMatch[], activePlayerIds)
  const tournamentType = tournament.tournament_type
  const rows = placements.map(({ playerId, band }) => ({
    season_id: tournament.season_id as string,
    player_id: playerId,
    tournament_id: tournamentId,
    points: pointsForBand(tournamentType, band),
    placement: placementForBand(tournamentType, band),
  }))

  await admin.from('season_ranking_points').upsert(rows, { onConflict: 'season_id,player_id,tournament_id' })
}
