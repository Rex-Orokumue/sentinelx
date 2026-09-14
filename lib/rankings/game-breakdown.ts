import { matchWinnerId, sideAId, sideAIds, sideBIds, type RosterAwareMatch } from '@/lib/tournaments/advancement'

export interface GameScopedMatch extends RosterAwareMatch {
  game_id: string
  game_name: string
  game_category: string
}

export interface GameWinCount {
  game: string
  wins: number
}

// Groups completed-match wins by (player, game). Draws and undecided matches
// (matchWinnerId returns null) are skipped, not counted for anyone — reuses
// the single "who won" implementation rather than reimplementing it. A team
// match's win credits every roster member of the winning squad.
export function winsByPlayerAndGame(matches: GameScopedMatch[]): Map<string, GameWinCount[]> {
  const counts = new Map<string, Map<string, number>>()
  for (const match of matches) {
    const winnerId = matchWinnerId(match)
    if (!winnerId) continue
    const winnerIds = winnerId === sideAId(match) ? sideAIds(match) : sideBIds(match)
    for (const id of winnerIds) {
      const byGame = counts.get(id) ?? new Map<string, number>()
      byGame.set(match.game_name, (byGame.get(match.game_name) ?? 0) + 1)
      counts.set(id, byGame)
    }
  }
  // .forEach() rather than for...of / Array.from(map.entries()) — this
  // project's tsconfig has no explicit `target`, which defaults low enough
  // that native Map iteration needs `downlevelIteration` (not set here);
  // .forEach() is a plain method call and side-steps that entirely.
  const result = new Map<string, GameWinCount[]>()
  counts.forEach((byGame, playerId) => {
    const entries: GameWinCount[] = []
    byGame.forEach((wins, game) => entries.push({ game, wins }))
    result.set(playerId, entries)
  })
  return result
}

export interface CategoryStat {
  category: string
  scored: number
  conceded: number
}

// Sums score_a/score_b from completed matches scoped to the given category.
// Works identically for any category — football goals, fighting rounds
// won, shooter kills are all just the match's numeric score_a/score_b. This
// deliberately does NOT read profiles.goals_scored — that column mixes
// every game a player has played with no per-game provenance, so it can't
// be filtered after the fact. See the #23/#21a design specs.
export function scoreStatsByPlayerAndCategory(
  matches: GameScopedMatch[],
  category: string,
): Map<string, { scored: number; conceded: number }> {
  const result = new Map<string, { scored: number; conceded: number }>()
  for (const match of matches) {
    if (match.game_category !== category) continue
    if (match.status !== 'completed') continue
    if (match.score_a == null || match.score_b == null) continue
    const aIds = sideAIds(match)
    const bIds = sideBIds(match)
    if (aIds.length === 0 || bIds.length === 0) continue

    for (const id of aIds) {
      const s = result.get(id) ?? { scored: 0, conceded: 0 }
      s.scored += match.score_a
      s.conceded += match.score_b
      result.set(id, s)
    }
    for (const id of bIds) {
      const s = result.get(id) ?? { scored: 0, conceded: 0 }
      s.scored += match.score_b
      s.conceded += match.score_a
      result.set(id, s)
    }
  }
  return result
}

// Kept for existing callers/tests — identical to
// scoreStatsByPlayerAndCategory(matches, 'football').
export function footballGoalsByPlayer(matches: GameScopedMatch[]): Map<string, { scored: number; conceded: number }> {
  return scoreStatsByPlayerAndCategory(matches, 'football')
}

export function categoryStat(stats: CategoryStat[], category: string): CategoryStat {
  return stats.find((s) => s.category === category) ?? { category, scored: 0, conceded: 0 }
}

// Same aggregation as scoreStatsByPlayerAndCategory, scoped to one game_id
// instead of one category — lets a category with 2+ active games (e.g.
// football: DLS + EA FC Mobile) be narrowed to a single game's numbers
// without touching the category-wide aggregate at all.
export function scoreStatsByPlayerAndGame(
  matches: GameScopedMatch[],
  gameId: string,
): Map<string, { scored: number; conceded: number }> {
  const result = new Map<string, { scored: number; conceded: number }>()
  for (const match of matches) {
    if (match.game_id !== gameId) continue
    if (match.status !== 'completed') continue
    if (match.score_a == null || match.score_b == null) continue
    const aIds = sideAIds(match)
    const bIds = sideBIds(match)
    if (aIds.length === 0 || bIds.length === 0) continue

    for (const id of aIds) {
      const s = result.get(id) ?? { scored: 0, conceded: 0 }
      s.scored += match.score_a
      s.conceded += match.score_b
      result.set(id, s)
    }
    for (const id of bIds) {
      const s = result.get(id) ?? { scored: 0, conceded: 0 }
      s.scored += match.score_b
      s.conceded += match.score_a
      result.set(id, s)
    }
  }
  return result
}

export interface GameStat {
  gameId: string
  scored: number
  conceded: number
}

export function gameStat(stats: GameStat[], gameId: string): GameStat {
  return stats.find((s) => s.gameId === gameId) ?? { gameId, scored: 0, conceded: 0 }
}
