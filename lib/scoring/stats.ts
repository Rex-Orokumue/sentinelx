import { getChampion, type BracketMatch } from '@/lib/tournaments/bracket'

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

export interface TeamMatchRow {
  round: string
  status: string
  score_a: number | null
  score_b: number | null
  team_a_id: string | null
  team_b_id: string | null
}

// Reshapes a squad's completed team matches into the same CompletedMatch
// shape computeAggregates already consumes, standing playerId in for
// whichever side their squad was on. computeAggregates only ever compares
// player_a_id === playerId to decide "mine" vs "theirs" (see above) — the
// opposing side's real id is never read, so a placeholder is safe there.
export function completedMatchesForSquadPlayer(
  playerId: string,
  squadIds: Set<string>,
  matches: TeamMatchRow[],
): CompletedMatch[] {
  const result: CompletedMatch[] = []
  for (const m of matches) {
    if (m.status !== 'completed' || m.score_a == null || m.score_b == null) continue
    if (m.team_a_id && squadIds.has(m.team_a_id)) {
      result.push({ player_a_id: playerId, player_b_id: 'opponent', score_a: m.score_a, score_b: m.score_b })
    } else if (m.team_b_id && squadIds.has(m.team_b_id)) {
      result.push({ player_a_id: 'opponent', player_b_id: playerId, score_a: m.score_a, score_b: m.score_b })
    }
  }
  return result
}

// Same substitution, scoped to 'final' rows and reusing getChampion so "who
// won the final" has a single implementation shared with the bracket page.
export function teamTitlesWon(playerId: string, squadIds: Set<string>, finals: TeamMatchRow[]): number {
  return finals.filter((m) => {
    if (m.round !== 'final') return false
    const mySide = m.team_a_id && squadIds.has(m.team_a_id) ? 'a' : m.team_b_id && squadIds.has(m.team_b_id) ? 'b' : null
    if (!mySide) return false
    const bracketMatch: BracketMatch = {
      id: '',
      round: m.round,
      group_id: null,
      groupName: null,
      status: m.status,
      score_a: m.score_a,
      score_b: m.score_b,
      scheduled_at: null,
      is_full_day: false,
      playerA: { id: mySide === 'a' ? playerId : 'opponent', name: '' },
      playerB: { id: mySide === 'b' ? playerId : 'opponent', name: '' },
    }
    return getChampion([bracketMatch])?.id === playerId
  }).length
}
