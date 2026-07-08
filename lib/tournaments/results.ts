export interface GroupMatchResult {
  playerAId: string
  playerBId: string
  scoreA: number
  scoreB: number
}

export interface PlayerGroupStats {
  playerId: string
  points: number
  wins: number
  draws: number
  losses: number
  goalsFor: number
  goalsAgainst: number
}

// Recompute every player's stats from a group's completed matches (win 3 / draw 1 / loss 0).
export function computeGroupStats(
  playerIds: string[],
  matches: GroupMatchResult[],
): PlayerGroupStats[] {
  const base = new Map<string, PlayerGroupStats>(
    playerIds.map((id) => [
      id,
      { playerId: id, points: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 },
    ]),
  )
  for (const m of matches) {
    const a = base.get(m.playerAId)
    const b = base.get(m.playerBId)
    if (!a || !b) continue
    a.goalsFor += m.scoreA
    a.goalsAgainst += m.scoreB
    b.goalsFor += m.scoreB
    b.goalsAgainst += m.scoreA
    if (m.scoreA > m.scoreB) {
      a.wins++
      a.points += 3
      b.losses++
    } else if (m.scoreA < m.scoreB) {
      b.wins++
      b.points += 3
      a.losses++
    } else {
      a.draws++
      b.draws++
      a.points++
      b.points++
    }
  }
  return playerIds.map((id) => base.get(id)!)
}

// Seed order for the knockout draw: every group's winner first, then every runner-up.
// Each group's rows must be pre-sorted (rank order); `advancing` marks the top 2.
export function collectAdvancers(
  standingsPerGroup: { playerId: string; advancing: boolean }[][],
): string[] {
  const adv = standingsPerGroup.map((rows) => rows.filter((r) => r.advancing).map((r) => r.playerId))
  const winners = adv.map((ids) => ids[0]).filter(Boolean) as string[]
  const runnersUp = adv.map((ids) => ids[1]).filter(Boolean) as string[]
  return [...winners, ...runnersUp]
}
