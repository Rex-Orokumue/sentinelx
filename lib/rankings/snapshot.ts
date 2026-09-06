import { isRankingEligible, rankPlayersBy, type PlayerStatsInput } from './leaderboard'

export interface SnapshotRow {
  player_id: string
  /** null = the global, all-games board. */
  game_id: string | null
  rank: number
  metric_value: number
  /** ISO date, YYYY-MM-DD. */
  captured_on: string
}

/**
 * Per-game wins for one game, keyed by game **id**.
 *
 * Deliberately not `PlayerStatsInput['winsByGame']`: that shape is
 * `{ game: string; wins: number }` keyed by game *name* (see
 * `winsByPlayerAndGame`, which groups on `match.game_name`). Snapshot rows need
 * the id, so the caller resolves it from the matches it already loaded rather
 * than threading a name-to-id map through this module.
 */
export interface GameWinEntry {
  playerId: string
  wins: number
  sxScore: number
}

// Global board: SX Score, matching the page's own statement that players are
// ranked by their total SX Score across all games they compete in.
export function buildGlobalSnapshotRows(
  players: PlayerStatsInput[],
  capturedOn: string,
): SnapshotRow[] {
  const eligible = players.filter(isRankingEligible)
  return rankPlayersBy(eligible, 'score').map((p) => ({
    player_id: p.id,
    game_id: null,
    rank: p.rank,
    metric_value: p.sxScore,
    captured_on: capturedOn,
  }))
}

// Per-game board: wins in that game. SX Score is a single global figure on
// profiles, so ranking a game tab by it would reproduce the global order
// exactly and the tab would say nothing. Ties break on SX Score then player id,
// so the order never depends on input order.
export function buildGameSnapshotRows(
  entries: GameWinEntry[],
  gameId: string,
  capturedOn: string,
): SnapshotRow[] {
  return entries
    .filter((e) => e.wins > 0)
    .slice()
    .sort((a, b) => b.wins - a.wins || b.sxScore - a.sxScore || a.playerId.localeCompare(b.playerId))
    .map((e, i) => ({
      player_id: e.playerId,
      game_id: gameId,
      rank: i + 1,
      metric_value: e.wins,
      captured_on: capturedOn,
    }))
}
