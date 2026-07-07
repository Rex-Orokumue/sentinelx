import { isRankingEligible, type PlayerStatsInput } from '@/lib/rankings/leaderboard'

function winRate(p: PlayerStatsInput): number {
  return p.totalMatches > 0 ? p.wins / p.totalMatches : 0
}

// Most Valuable Player: highest Sentinel Score among eligible players. Ties break by
// wins then win rate — so at launch, when every score is the default 70, MVP resolves
// to most wins with no special-case code.
export function pickMVP(players: PlayerStatsInput[]): PlayerStatsInput | null {
  const eligible = players.filter(isRankingEligible)
  if (eligible.length === 0) return null
  return [...eligible].sort(
    (a, b) =>
      b.sentinelScore - a.sentinelScore ||
      b.wins - a.wins ||
      winRate(b) - winRate(a),
  )[0]
}

// Golden Boot: most goals scored among eligible players, ties broken by wins.
export function pickGoldenBoot(players: PlayerStatsInput[]): PlayerStatsInput | null {
  const eligible = players.filter(isRankingEligible)
  if (eligible.length === 0) return null
  return [...eligible].sort(
    (a, b) => b.goalsScored - a.goalsScored || b.wins - a.wins,
  )[0]
}
