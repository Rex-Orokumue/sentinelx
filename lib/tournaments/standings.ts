export interface MembershipInput {
  playerId: string
  name: string
  clubName?: string | null
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
  clubName?: string | null
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

// Order: points-per-game-played desc, then goal difference desc, then goals-for desc.
// Points-per-game equals raw points whenever `played` is equal across the group
// (the normal case, and every group once its round-robin finishes), so this only
// changes ordering when a substitute has played fewer matches than the rest —
// exactly the case it needs to handle fairly.
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
    .sort((a, b) => {
      const ppgA = a.played > 0 ? a.points / a.played : -Infinity
      const ppgB = b.played > 0 ? b.points / b.played : -Infinity
      return ppgB - ppgA || b.goalDiff - a.goalDiff || b.goalsFor - a.goalsFor
    })
    .map((s, i) => ({
      ...s,
      rank: i + 1,
      advancing: i < advancingCount,
    }))
}
