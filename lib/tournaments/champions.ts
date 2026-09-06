export interface H2HMatch {
  playerAId: string
  playerBId: string
  scoreA: number | null
  scoreB: number | null
  status: string
}

// Fourth tiebreak for a round-robin title, applied only after points-per-game,
// goal difference and goals-for have all failed to separate two players.
// Standard football convention: head-to-head points, then head-to-head goal
// difference. Returns null when it genuinely cannot separate them — the caller
// must then report the title as undecided rather than guess.
export function headToHeadWinner(aId: string, bId: string, matches: H2HMatch[]): string | null {
  let pointsA = 0
  let pointsB = 0
  let goalsA = 0
  let goalsB = 0
  let met = false

  for (const m of matches) {
    if (m.status !== 'completed' || m.scoreA == null || m.scoreB == null) continue
    const isAB = m.playerAId === aId && m.playerBId === bId
    const isBA = m.playerAId === bId && m.playerBId === aId
    if (!isAB && !isBA) continue
    met = true

    const forA = isAB ? m.scoreA : m.scoreB
    const forB = isAB ? m.scoreB : m.scoreA
    goalsA += forA
    goalsB += forB
    if (forA > forB) pointsA += 3
    else if (forB > forA) pointsB += 3
    else {
      pointsA += 1
      pointsB += 1
    }
  }

  if (!met) return null
  if (pointsA !== pointsB) return pointsA > pointsB ? aId : bId
  const diffA = goalsA - goalsB
  if (diffA !== 0) return diffA > 0 ? aId : bId
  return null
}
