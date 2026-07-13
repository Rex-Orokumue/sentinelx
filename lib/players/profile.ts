export interface MatchSides {
  player_a_id: string
  player_b_id: string
  score_a: number
  score_b: number
}

export interface ProfileView {
  id: string
  username: string
  displayName: string | null
  avatarUrl: string | null
  country: string | null
  bio: string | null
  createdAt: string | null
  sentinelScore: number
  sentinelTier: string | null
  totalMatches: number
  wins: number
  losses: number
  goalsScored: number
  goalsConceded: number
  totalTitles: number
  rank: number | null // null = unranked
}

export interface ProfileMatch {
  id: string
  opponentName: string
  playerScore: number
  opponentScore: number
  outcome: 'win' | 'loss' | 'draw'
  tournamentTitle: string | null
  completedAt: string | null
}

export interface ProfileTitle {
  tournamentTitle: string
  tournamentSlug: string
  gameName: string | null
  date: string | null
}

export function winPercent(wins: number, total: number): string {
  if (total <= 0) return '0%'
  return `${Math.round((wins / total) * 100)}%`
}

export function goalDifference(scored: number, conceded: number): number {
  return scored - conceded
}

export function matchOutcome(playerId: string, m: MatchSides): 'win' | 'loss' | 'draw' {
  const isA = m.player_a_id === playerId
  const mine = isA ? m.score_a : m.score_b
  const theirs = isA ? m.score_b : m.score_a
  if (mine > theirs) return 'win'
  if (mine < theirs) return 'loss'
  return 'draw'
}
