import type { GameWinCount } from './game-breakdown'

export const MAX_CHIPS = 4

export interface GameChips {
  chips: string[]
  overflow: number
  total: number
}

// The Games Played cell: the player's games, most-won first, capped so a table
// row stays one line. Ties break on name so the order never depends on the
// order the aggregate happened to produce.
export function gameChipsFor(winsByGame: GameWinCount[], max: number = MAX_CHIPS): GameChips {
  const ordered = [...winsByGame].sort((a, b) => b.wins - a.wins || a.game.localeCompare(b.game))
  return {
    chips: ordered.slice(0, max).map((g) => g.game),
    overflow: Math.max(0, ordered.length - max),
    total: ordered.length,
  }
}
