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
  // Each side is credited independently. A player substituted out keeps their
  // id on already-completed matches (see addSubstitute in
  // lib/tournaments/registrations-admin-actions.ts), so those matches reference
  // someone no longer in `playerIds` — but the opponent still played and still
  // earned the result. Voiding the whole match robbed them of it.
  const credit = (s: PlayerGroupStats | undefined, own: number, against: number) => {
    if (!s) return // not a current group member — nothing to track for them
    s.goalsFor += own
    s.goalsAgainst += against
    if (own > against) {
      s.wins++
      s.points += 3
    } else if (own < against) {
      s.losses++
    } else {
      s.draws++
      s.points++
    }
  }
  for (const m of matches) {
    credit(base.get(m.playerAId), m.scoreA, m.scoreB)
    credit(base.get(m.playerBId), m.scoreB, m.scoreA)
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
