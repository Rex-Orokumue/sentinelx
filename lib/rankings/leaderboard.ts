export interface PlayerStatsInput {
  id: string
  username: string | null
  displayName: string | null
  avatarUrl: string | null
  country: string | null
  wins: number
  losses: number
  totalMatches: number
  goalsScored: number
  goalsConceded: number
  totalTitles: number
  sentinelScore: number
  sentinelTier: string | null
}

export interface RankedPlayer extends PlayerStatsInput {
  winRate: number
  goalDiff: number
  rank: number
}

// Minimum matches a player must have completed to appear in any ranking or award.
// Value equals the semantic minimum (1 = at least one match) so the constant never
// contradicts its name. Shared by the rankings page and the Hall of Fame.
export const RANKING_MIN_MATCHES = 1

export function isRankingEligible(p: { totalMatches: number }): boolean {
  return p.totalMatches >= RANKING_MIN_MATCHES
}

export type LeaderboardMetric = 'wins' | 'score' | 'goals'

const METRIC_VALUE: Record<LeaderboardMetric, (p: PlayerStatsInput) => number> = {
  wins: (p) => p.wins,
  score: (p) => p.sentinelScore,
  goals: (p) => p.goalsScored,
}

// Sort led by the chosen metric, falling back to the same tie-break cascade
// rankPlayers has always used: wins desc → win rate desc → titles desc →
// goal difference desc. When metric is 'wins', the leading term duplicates
// the first tie-break — harmless, and keeps this the single sort implementation.
export function rankPlayersBy(players: PlayerStatsInput[], metric: LeaderboardMetric): RankedPlayer[] {
  const lead = METRIC_VALUE[metric]
  return players
    .map((pl) => ({
      ...pl,
      winRate: pl.totalMatches > 0 ? pl.wins / pl.totalMatches : 0,
      goalDiff: pl.goalsScored - pl.goalsConceded,
    }))
    .sort(
      (a, b) =>
        lead(b) - lead(a) ||
        b.wins - a.wins ||
        b.winRate - a.winRate ||
        b.totalTitles - a.totalTitles ||
        b.goalDiff - a.goalDiff,
    )
    .map((pl, i) => ({ ...pl, rank: i + 1 }))
}

// Kept for existing callers/tests — identical to rankPlayersBy(players, 'wins').
export function rankPlayers(players: PlayerStatsInput[]): RankedPlayer[] {
  return rankPlayersBy(players, 'wins')
}
