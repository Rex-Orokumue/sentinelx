import { createAdminClient } from '@/lib/supabase/admin'
import {
  bandsForPlacements,
  pointsForBand,
  placementForBand,
  type PlacementMatch,
  type SeasonTournamentType,
} from '@/lib/tournaments/season-placement'
import { awardCoins } from '@/lib/coins/service'
import { awardXP } from '@/lib/membership/xp'
import { checkAndUnlockAchievements } from '@/lib/achievements/unlock'

type Admin = ReturnType<typeof createAdminClient>

function isSeasonTournamentType(t: string): t is SeasonTournamentType {
  return t === 'community_club' || t === 'masters'
}

// design doc §3.2 placement tiers, keyed by the same numeric placement
// placementForBand() already produces (1, 2, 3, 5, 9, 17).
const PLACEMENT_COINS: Record<number, number> = { 1: 500, 2: 300, 3: 150, 5: 75, 9: 30, 17: 10 }
const PLACEMENT_XP: Record<number, number> = { 1: 500, 2: 300, 3: 200, 5: 100 }

// Runs for EVERY tournament type once a tournament completes — coins/XP/
// achievement checks are not gated on having a season, only the
// season_ranking_points write is (Global Constraints #3: Champions Cup
// deliberately doesn't join the season leaderboard, but its players still
// earn coins/XP and can unlock champions_cup_* achievements).
export async function awardSeasonPoints(admin: Admin, tournamentId: string): Promise<void> {
  const { data: tournament } = await admin
    .from('tournaments')
    .select('id, tournament_type, season_id')
    .eq('id', tournamentId)
    .maybeSingle()
  if (!tournament) return

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

  if (tournament.season_id && isSeasonTournamentType(tournament.tournament_type)) {
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

  // Placement is only meaningful relative to *some* tournament type's bands
  // — reuse community_club's band->number mapping for coin/XP tiers since
  // it's the finer-grained one (masters collapses several bands to the same
  // number); the coin/XP table keys off the numeric placement, not the band.
  for (const { playerId, band } of placements) {
    const placement = placementForBand('community_club', band)
    const coins = PLACEMENT_COINS[placement]
    if (coins) await awardCoins(admin, playerId, coins, 'tournament_placement', tournamentId)
    const xp = PLACEMENT_XP[placement]
    if (xp) await awardXP(admin, playerId, xp, 'tournament_placement', tournamentId)
    await checkAndUnlockAchievements(admin, playerId, {
      type: 'tournament_completed',
      tournamentId,
      placement,
      tournamentType: tournament.tournament_type,
    })
  }
}
