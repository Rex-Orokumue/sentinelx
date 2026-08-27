import { createAdminClient } from '@/lib/supabase/admin'
import {
  bandsForPlacements,
  pointsForBand,
  placementForBand,
  type PlacementMatch,
  type PlacementBand,
  type SeasonTournamentType,
} from '@/lib/tournaments/season-placement'
import { recordCoinTransaction } from '@/lib/coins/service'
import { awardXP } from '@/lib/membership/xp'
import { checkAndUnlockAchievements } from '@/lib/achievements/unlock'
import { pointsForRoundRobinRank, coinsForRoundRobinRank, xpForRoundRobinRank } from '@/lib/tournaments/round-robin-placement'
import { sortStandings, type MembershipInput } from '@/lib/tournaments/standings'

type Admin = ReturnType<typeof createAdminClient>

function isSeasonTournamentType(t: string): t is SeasonTournamentType {
  return t === 'community_club' || t === 'masters'
}

// design doc §3.2 placement tiers, keyed by the same numeric placement
// placementForBand() already produces (1, 2, 3, 5, 9, 17). Shared by
// community_club and masters — every band from champion through
// round_of_16 already resolves to the same numeric placement in both
// COMMUNITY_CLUB_PLACEMENT and MASTERS_PLACEMENT (lib/tournaments/
// season-placement.ts); they only diverge at round_of_32/non_advancer
// (17 vs 9), which is exactly why the two types must resolve through
// their OWN placementForBand() call below, not a hardcoded one.
const PLACEMENT_COINS: Record<number, number> = { 1: 500, 2: 300, 3: 150, 5: 75, 9: 30, 17: 10 }
const PLACEMENT_XP: Record<number, number> = { 1: 500, 2: 300, 3: 200, 5: 100 }

// Champions Cup — higher-stakes invitational, own reward scale entirely
// (values confirmed with product owner 2026-08-15, scaled above Masters'
// own +500 coins/+1000 XP champion reward per the original Phase 2 design
// doc). Band->placement mapping mirrors COMMUNITY_CLUB_PLACEMENT/
// MASTERS_PLACEMENT in lib/tournaments/season-placement.ts, but is defined
// here rather than there since SeasonTournamentType specifically means
// "earns a season_ranking_points row," which Champions Cup still doesn't
// (Global Constraints #3, original Phase 2 plan) — this table is ONLY ever
// used for the coin/XP loop below, never for season points.
// round_of_32/non_advancer default to round_of_16's tier (9th-16th) since
// Champions Cup, like Masters, is a capped invitational bracket that
// shouldn't realistically reach those bands.
const CHAMPIONS_CUP_PLACEMENT: Record<PlacementBand, number> = {
  champion: 1,
  runner_up: 2,
  semi_final: 3,
  quarter_final: 5,
  round_of_16: 9,
  round_of_32: 9,
  non_advancer: 9,
}
const CHAMPIONS_CUP_COINS: Record<number, number> = { 1: 2000, 2: 1200, 3: 800, 5: 400, 9: 150 }
const CHAMPIONS_CUP_XP: Record<number, number> = { 1: 3000, 2: 2000, 3: 1200, 5: 600, 9: 250 }

// Runs for EVERY tournament type once a tournament completes — coins/XP/
// achievement checks are not gated on having a season, only the
// season_ranking_points write is (Global Constraints #3: Champions Cup
// deliberately doesn't join the season leaderboard, but its players still
// earn coins/XP and can unlock champions_cup_* achievements).
export async function awardSeasonPoints(admin: Admin, tournamentId: string): Promise<void> {
  const { data: tournament } = await admin
    .from('tournaments')
    .select('id, tournament_type, season_id, format')
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

  if (tournament.format === 'round_robin') {
    const { data: groupRow } = await admin
      .from('groups')
      .select('id')
      .eq('tournament_id', tournamentId)
      .maybeSingle()
    if (!groupRow) return
    const { data: memberships } = await admin
      .from('group_memberships')
      .select('player_id, wins, draws, losses, goals_for, goals_against, points')
      .eq('group_id', groupRow.id)
    const standings = sortStandings(
      (memberships ?? []).map(
        (m): MembershipInput => ({
          playerId: m.player_id,
          name: '',
          wins: m.wins,
          draws: m.draws,
          losses: m.losses,
          goalsFor: m.goals_for,
          goalsAgainst: m.goals_against,
          points: m.points,
        }),
      ),
    )

    if (tournament.season_id) {
      const rows = standings.map((s) => ({
        season_id: tournament.season_id as string,
        player_id: s.playerId,
        tournament_id: tournamentId,
        points: pointsForRoundRobinRank(s.rank),
        placement: s.rank,
      }))
      await admin.from('season_ranking_points').upsert(rows, { onConflict: 'season_id,player_id,tournament_id' })
    }

    for (const s of standings) {
      const coins = coinsForRoundRobinRank(s.rank)
      if (coins) await recordCoinTransaction(admin, s.playerId, coins, 'tournament_placement', tournamentId)
      const xp = xpForRoundRobinRank(s.rank)
      if (xp) await awardXP(admin, s.playerId, xp, 'tournament_placement', tournamentId)
      await checkAndUnlockAchievements(admin, s.playerId, {
        type: 'tournament_completed',
        tournamentId,
        placement: s.rank,
        tournamentType: tournament.tournament_type,
      })
    }
    return
  }

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

  // Coin/XP tiers key off each tournament type's OWN placement table.
  // Champions Cup gets its own reward scale entirely (CHAMPIONS_CUP_*
  // above); Community Club and Masters share PLACEMENT_COINS/PLACEMENT_XP
  // but resolve through their own band->number mapping via placementForBand
  // (masters collapses several bands to the same number community_club
  // doesn't, so the two must NOT share one hardcoded 'community_club' call
  // — that was the pre-existing bug this fixes). Any other/future
  // tournament type falls back to community_club's numbers.
  const isChampionsCup = tournament.tournament_type === 'champions_cup'
  const coinXpTournamentType = tournament.tournament_type === 'masters' ? 'masters' : 'community_club'
  for (const { playerId, band } of placements) {
    const placement = isChampionsCup ? CHAMPIONS_CUP_PLACEMENT[band] : placementForBand(coinXpTournamentType, band)
    const coins = isChampionsCup ? CHAMPIONS_CUP_COINS[placement] : PLACEMENT_COINS[placement]
    if (coins) await recordCoinTransaction(admin, playerId, coins, 'tournament_placement', tournamentId)
    const xp = isChampionsCup ? CHAMPIONS_CUP_XP[placement] : PLACEMENT_XP[placement]
    if (xp) await awardXP(admin, playerId, xp, 'tournament_placement', tournamentId)
    await checkAndUnlockAchievements(admin, playerId, {
      type: 'tournament_completed',
      tournamentId,
      placement,
      tournamentType: tournament.tournament_type,
    })
  }
}
