export interface PointsRow {
  playerId: string
  points: number
}

// Sums arbitrary points rows (season_ranking_points ∪ season_noshow_penalties)
// per player. Players with no rows at all are absent from the result —
// callers merge this against whatever player list they need.
export function sumPointsByPlayer(rows: PointsRow[]): Map<string, number> {
  const totals = new Map<string, number>()
  for (const r of rows) {
    totals.set(r.playerId, (totals.get(r.playerId) ?? 0) + r.points)
  }
  return totals
}
