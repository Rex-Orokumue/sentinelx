// Aggregates derive from the matches table (not the score log). Keys match the
// profiles columns exactly so the result can be spread straight into an update.
// Draws count as neither win nor loss — profiles has no draws column, by design.
export interface Aggregates {
  total_matches: number
  wins: number
  losses: number
  goals_scored: number
  goals_conceded: number
  total_titles: number
}

export interface CompletedMatch {
  player_a_id: string
  player_b_id: string
  score_a: number
  score_b: number
}

export function computeAggregates(
  playerId: string,
  matches: CompletedMatch[],
  titlesWon: number,
): Aggregates {
  let wins = 0
  let losses = 0
  let goalsScored = 0
  let goalsConceded = 0

  for (const m of matches) {
    const isA = m.player_a_id === playerId
    const mine = isA ? m.score_a : m.score_b
    const theirs = isA ? m.score_b : m.score_a
    goalsScored += mine
    goalsConceded += theirs
    if (mine > theirs) wins += 1
    else if (mine < theirs) losses += 1
  }

  return {
    total_matches: matches.length,
    wins,
    losses,
    goals_scored: goalsScored,
    goals_conceded: goalsConceded,
    total_titles: titlesWon,
  }
}
