import type { PointsStandingRow } from './points-standings'

// Who plays in a stage, and in what order they are drawn into its lobbies.
//
// Split out from the server action so both decisions are testable without a
// database: getting either wrong silently removes a paying entrant from a
// tournament, which is the kind of bug nobody notices until someone complains.

// Stage 1 takes the whole active field. Every later stage takes exactly the top
// `advanceCountOfPrevious` of the stage before it, in finishing order.
export function stageIntake(
  previousStanding: PointsStandingRow[] | null,
  allActiveEntrantIds: string[],
  advanceCountOfPrevious: number | null,
): string[] {
  if (previousStanding === null) return [...allActiveEntrantIds]

  const ordered = [...previousStanding].sort((a, b) => a.rank - b.rank)
  const take = advanceCountOfPrevious ?? ordered.length
  return ordered.slice(0, take).map((r) => r.entrantId)
}

// Fisher-Yates. Round 1 has no standings, so any "seeding" would be fictional —
// a shuffle is the honest option and keeps repeat pairings from ossifying.
function shuffle(ids: string[]): string[] {
  const out = [...ids]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// The order handed to assignLobbies, which snake-drafts it so the strongest are
// spread across lobbies rather than stacked into one.
export function seedOrderForRound(
  roundNo: number,
  intake: string[],
  standing: PointsStandingRow[],
): string[] {
  if (roundNo <= 1) return shuffle(intake)

  const inStage = new Set(intake)
  const rankById = new Map(
    standing.filter((r) => inStage.has(r.entrantId)).map((r) => [r.entrantId, r.rank]),
  )

  // An entrant with no standings row has not played a scored round yet. They
  // sort last, but they are never dropped — that would remove a paying entrant
  // from the tournament.
  return [...intake].sort(
    (a, b) =>
      (rankById.get(a) ?? Number.POSITIVE_INFINITY) - (rankById.get(b) ?? Number.POSITIVE_INFINITY),
  )
}
