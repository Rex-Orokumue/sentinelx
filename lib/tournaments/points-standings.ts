// Stage standings for a points-race (battle-royale) tournament.
//
// The sibling of sortStandings() in standings.ts, NOT a modification of it:
// that one is football (wins/draws/losses, goals for and against) and must keep
// behaving exactly as it does. This one is placement and kills.
//
// Pure, so the tiebreak rules are testable without a database.

export interface StageResultInput {
  entrantId: string
  roundNo: number
  placement: number
  kills: number
  placementPoints: number
  killPoints: number
}

export interface PointsStandingRow {
  entrantId: string
  displayName: string
  played: number
  totalPoints: number
  totalKills: number
  /** Best (numerically lowest) placement achieved in this stage; null if unplayed. */
  bestPlacement: number | null
  lastRoundPlacement: number | null
  rank: number
  advancing: boolean
  /** Entrants this row is still exactly level with after every tiebreak. */
  unresolvedTieWith: string[]
}

// Official BR tiebreak order: total points, then total kills, then best single
// placement, then placement in the most recent round. An entrant who has played
// nothing sorts last on every key rather than winning by vacuous "best"
// placement.
function compare(a: PointsStandingRow, b: PointsStandingRow): number {
  if (a.totalPoints !== b.totalPoints) return b.totalPoints - a.totalPoints
  if (a.totalKills !== b.totalKills) return b.totalKills - a.totalKills

  const bestA = a.bestPlacement ?? Number.POSITIVE_INFINITY
  const bestB = b.bestPlacement ?? Number.POSITIVE_INFINITY
  if (bestA !== bestB) return bestA - bestB

  const lastA = a.lastRoundPlacement ?? Number.POSITIVE_INFINITY
  const lastB = b.lastRoundPlacement ?? Number.POSITIVE_INFINITY
  if (lastA !== lastB) return lastA - lastB

  return 0
}

export function sortPointsStandings(
  entrants: { id: string; displayName: string }[],
  results: StageResultInput[],
  advanceCount: number,
): PointsStandingRow[] {
  const byEntrant = new Map<string, PointsStandingRow>()
  for (const e of entrants) {
    byEntrant.set(e.id, {
      entrantId: e.id,
      displayName: e.displayName,
      played: 0,
      totalPoints: 0,
      totalKills: 0,
      bestPlacement: null,
      lastRoundPlacement: null,
      rank: 0,
      advancing: false,
      unresolvedTieWith: [],
    })
  }

  // Highest round seen per entrant, so "most recent round placement" survives
  // results arriving out of order.
  const latestRound = new Map<string, number>()

  for (const r of results) {
    const row = byEntrant.get(r.entrantId)
    if (!row) continue // stale row for a withdrawn entrant — ignore, don't crash

    row.played += 1
    row.totalPoints += r.placementPoints + r.killPoints
    row.totalKills += r.kills
    row.bestPlacement = row.bestPlacement === null ? r.placement : Math.min(row.bestPlacement, r.placement)

    const seen = latestRound.get(r.entrantId)
    if (seen === undefined || r.roundNo >= seen) {
      latestRound.set(r.entrantId, r.roundNo)
      row.lastRoundPlacement = r.placement
    }
  }

  const rows = Array.from(byEntrant.values()).sort(compare)

  rows.forEach((row, i) => {
    row.rank = i + 1
    row.advancing = i < advanceCount
  })

  // Surface ties that every tiebreak failed to separate. Advancement across
  // such a boundary is genuinely ambiguous and the system must not guess — an
  // invented winner silently eliminates someone who did not lose.
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      if (compare(rows[i], rows[j]) !== 0) break
      rows[i].unresolvedTieWith.push(rows[j].entrantId)
      rows[j].unresolvedTieWith.push(rows[i].entrantId)
    }
  }

  return rows
}
