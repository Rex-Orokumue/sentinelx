// Circuit Cup placement: unlike a knockout's fixed set of bracket bands
// (lib/tournaments/season-placement.ts), a round-robin table's final rank
// is already a plain 1-based number from sortStandings (lib/tournaments/
// standings.ts) — no band abstraction needed, just tier breakpoints over
// that number. Values mirror the spec's documented tiers and the existing
// bracket PLACEMENT_COINS/PLACEMENT_XP anchors (lib/matches/season-points.ts)
// at the corresponding placements — starting values, tunable like those are.

export function pointsForRoundRobinRank(rank: number): number {
  if (rank === 1) return 100
  if (rank === 2) return 70
  if (rank <= 4) return 45
  if (rank <= 8) return 25
  return 5
}

export function coinsForRoundRobinRank(rank: number): number {
  if (rank === 1) return 500
  if (rank === 2) return 300
  if (rank <= 4) return 150
  if (rank <= 8) return 75
  if (rank <= 16) return 30
  return 10
}

export function xpForRoundRobinRank(rank: number): number {
  if (rank === 1) return 500
  if (rank === 2) return 300
  if (rank <= 4) return 200
  if (rank <= 8) return 100
  return 0
}
