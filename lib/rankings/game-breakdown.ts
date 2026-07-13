import { matchWinnerId, type AdvanceMatch } from '@/lib/tournaments/advancement'

export interface GameScopedMatch extends AdvanceMatch {
  game_name: string
  game_category: string
}

export interface GameWinCount {
  game: string
  wins: number
}

// Groups completed-match wins by (player, game). Draws and undecided matches
// (matchWinnerId returns null) are skipped, not counted for anyone — reuses
// the single "who won" implementation rather than reimplementing it.
export function winsByPlayerAndGame(matches: GameScopedMatch[]): Map<string, GameWinCount[]> {
  const counts = new Map<string, Map<string, number>>()
  for (const match of matches) {
    const winnerId = matchWinnerId(match)
    if (!winnerId) continue
    const byGame = counts.get(winnerId) ?? new Map<string, number>()
    byGame.set(match.game_name, (byGame.get(match.game_name) ?? 0) + 1)
    counts.set(winnerId, byGame)
  }
  const result = new Map<string, GameWinCount[]>()
  for (const [playerId, byGame] of counts) {
    result.set(
      playerId,
      Array.from(byGame.entries()).map(([game, wins]) => ({ game, wins })),
    )
  }
  return result
}

export interface FootballGoals {
  scored: number
  conceded: number
}

// Sums score_a/score_b from completed matches whose game category is
// 'football' only. This deliberately does NOT read profiles.goals_scored —
// that column mixes every game a player has played with no per-game
// provenance, so it can't be filtered after the fact. See the #23 design
// spec for why the Goals tab and Golden Boot need this instead.
export function footballGoalsByPlayer(matches: GameScopedMatch[]): Map<string, FootballGoals> {
  const result = new Map<string, FootballGoals>()
  for (const match of matches) {
    if (match.game_category !== 'football') continue
    if (match.status !== 'completed') continue
    if (match.score_a == null || match.score_b == null) continue
    if (!match.player_a_id || !match.player_b_id) continue

    const a = result.get(match.player_a_id) ?? { scored: 0, conceded: 0 }
    a.scored += match.score_a
    a.conceded += match.score_b
    result.set(match.player_a_id, a)

    const b = result.get(match.player_b_id) ?? { scored: 0, conceded: 0 }
    b.scored += match.score_b
    b.conceded += match.score_a
    result.set(match.player_b_id, b)
  }
  return result
}
