import { ROUND_ORDER } from './bracket'
import { matchWinnerId, type AdvanceMatch } from './advancement'

export type PlacementBand =
  | 'champion'
  | 'runner_up'
  | 'semi_final'
  | 'quarter_final'
  | 'round_of_16'
  | 'round_of_32'
  | 'non_advancer'

export interface PlacementMatch extends AdvanceMatch {
  round: string
}

export interface PlacementResult {
  playerId: string
  band: PlacementBand
}

// Buckets every actively-registered player into a placement band by walking
// the knockout rounds forward. A bye never decides anything — only a real
// loss, or a 'forfeited' double-no-show, assigns a band. Players who never
// appear in a knockout-round match (eliminated in, or never advanced out
// of, the group stage) fall into 'non_advancer'. Group-round matches are
// ignored entirely; this function is only about the knockout bracket.
export function bandsForPlacements(
  matches: PlacementMatch[],
  activePlayerIds: string[],
): PlacementResult[] {
  const byRound = new Map<string, PlacementMatch[]>()
  for (const m of matches) {
    if (m.round === 'group') continue
    const list = byRound.get(m.round)
    if (list) list.push(m)
    else byRound.set(m.round, [m])
  }

  const band = new Map<string, PlacementBand>()

  for (const round of ROUND_ORDER) {
    const roundMatches = byRound.get(round)
    if (!roundMatches) continue

    for (const match of roundMatches) {
      if (match.status === 'bye') continue

      if (round === 'final') {
        if (match.status === 'forfeited') {
          // Double no-show in the grand final: nobody proved they won, but
          // both finalists still made the final — a shared runner-up
          // placement, not a drop to 'non_advancer'.
          if (match.player_a_id) band.set(match.player_a_id, 'runner_up')
          if (match.player_b_id) band.set(match.player_b_id, 'runner_up')
          continue
        }
        const winner = matchWinnerId(match)
        if (!winner) continue // not yet decided — caller shouldn't reach here
        const loser = winner === match.player_a_id ? match.player_b_id : match.player_a_id
        band.set(winner, 'champion')
        if (loser) band.set(loser, 'runner_up')
        continue
      }

      if (match.status === 'forfeited') {
        if (match.player_a_id) band.set(match.player_a_id, round as PlacementBand)
        if (match.player_b_id) band.set(match.player_b_id, round as PlacementBand)
        continue
      }

      const winner = matchWinnerId(match)
      if (!winner) continue
      const loser = winner === match.player_a_id ? match.player_b_id : match.player_a_id
      if (loser) band.set(loser, round as PlacementBand)
    }
  }

  return activePlayerIds.map((playerId) => ({
    playerId,
    band: band.get(playerId) ?? 'non_advancer',
  }))
}

// The guaranteed floor for a still-competing player: the furthest round
// they've already secured passage into, regardless of whether that round's
// match has been played (or even generated) yet. Unlike bandsForPlacements
// (which only assigns a band on a LOSS), this assigns a band the moment a
// player is KNOWN to be in a given round — a real match listing them as a
// participant proves they survived everything before it, so "if they lose
// this exact match" is their honest worst-case outcome right now. Rounds
// are walked in order so a later appearance always overrides an earlier
// one. For a player who has already been eliminated mid-tournament, this
// happens to return the exact same (now-locked) band bandsForPlacements
// would — there's no remaining uncertainty for them either way.
export function guaranteedBandsForPlacements(
  matches: PlacementMatch[],
  activePlayerIds: string[],
): PlacementResult[] {
  const floor = new Map<string, PlacementBand>()

  for (let i = 0; i < ROUND_ORDER.length; i++) {
    const round = ROUND_ORDER[i]
    const nextRound = ROUND_ORDER[i + 1] as PlacementBand | undefined
    const roundMatches = matches.filter((m) => m.round === round)

    for (const match of roundMatches) {
      if (match.status === 'bye') {
        // A bye auto-advances its one real participant into the next
        // round, even if that round's match row doesn't exist in the DB
        // yet (bracket generation for later rounds waits on this round
        // finishing).
        const soloPlayer = match.player_a_id ?? match.player_b_id
        if (soloPlayer && nextRound) floor.set(soloPlayer, nextRound)
        continue
      }
      if (match.player_a_id) floor.set(match.player_a_id, round as PlacementBand)
      if (match.player_b_id) floor.set(match.player_b_id, round as PlacementBand)
    }
  }

  return activePlayerIds.map((playerId) => ({
    playerId,
    band: floor.get(playerId) ?? 'non_advancer',
  }))
}

const COMMUNITY_CLUB_POINTS: Record<PlacementBand, number> = {
  champion: 100,
  runner_up: 70,
  semi_final: 45,
  quarter_final: 25,
  round_of_16: 10,
  round_of_32: 5,
  non_advancer: 5,
}

const MASTERS_POINTS: Record<PlacementBand, number> = {
  champion: 300,
  runner_up: 200,
  semi_final: 150,
  quarter_final: 100,
  round_of_16: 50,
  round_of_32: 50, // defensive fallback — Masters' bracket should never reach this round
  non_advancer: 50,
}

const COMMUNITY_CLUB_PLACEMENT: Record<PlacementBand, number> = {
  champion: 1,
  runner_up: 2,
  semi_final: 3,
  quarter_final: 5,
  round_of_16: 9,
  round_of_32: 17,
  non_advancer: 17,
}

const MASTERS_PLACEMENT: Record<PlacementBand, number> = {
  champion: 1,
  runner_up: 2,
  semi_final: 3,
  quarter_final: 5,
  round_of_16: 9,
  round_of_32: 9, // defensive fallback, see MASTERS_POINTS
  non_advancer: 9,
}

export type SeasonTournamentType = 'community_club' | 'masters'

export function pointsForBand(tournamentType: SeasonTournamentType, band: PlacementBand): number {
  return (tournamentType === 'community_club' ? COMMUNITY_CLUB_POINTS : MASTERS_POINTS)[band]
}

export function placementForBand(tournamentType: SeasonTournamentType, band: PlacementBand): number {
  return (tournamentType === 'community_club' ? COMMUNITY_CLUB_PLACEMENT : MASTERS_PLACEMENT)[band]
}
