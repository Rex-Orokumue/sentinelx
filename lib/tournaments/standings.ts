export interface MembershipInput {
  playerId: string
  name: string
  wins: number
  draws: number
  losses: number
  goalsFor: number
  goalsAgainst: number
  points: number
}

export interface StandingRow {
  playerId: string
  name: string
  played: number
  wins: number
  draws: number
  losses: number
  goalsFor: number
  goalsAgainst: number
  goalDiff: number
  points: number
  rank: number
  advancing: boolean
}

// Order: points desc, then goal difference desc, then goals-for desc.
// advancingCount defaults to 2 (top-2 advance) but is a parameter so a future
// format (e.g. best third-place) needs no surgery.
export function sortStandings(
  memberships: MembershipInput[],
  advancingCount = 2,
): StandingRow[] {
  return memberships
    .map((s) => ({
      ...s,
      played: s.wins + s.draws + s.losses,
      goalDiff: s.goalsFor - s.goalsAgainst,
    }))
    .sort(
      (a, b) =>
        b.points - a.points ||
        b.goalDiff - a.goalDiff ||
        b.goalsFor - a.goalsFor,
    )
    .map((s, i) => ({
      ...s,
      rank: i + 1,
      advancing: i < advancingCount,
    }))
}
