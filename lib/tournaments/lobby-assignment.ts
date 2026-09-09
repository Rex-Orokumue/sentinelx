import { snakeDistribute } from './draw'

// Splitting a stage's entrants into lobbies.
//
// Reuses snakeDistribute() from the group-draw code unchanged: "spread evenly,
// strongest not stacked together, sizes never differing by more than one" is
// exactly the same problem groups already solved, and solving it twice invites
// the two to disagree.

export function lobbyCountFor(entrants: number, lobbySize: number): number {
  if (entrants <= 0) return 0
  // A zero or negative size is bad data, not a reason to divide by zero. One
  // lobby holding everyone is recoverable; a crash mid-stage-open is not.
  if (lobbySize <= 0) return 1
  return Math.ceil(entrants / lobbySize)
}

// A, B, ... Z, AA, AB, ... Spreadsheet-column style, so a 30-lobby qualifier
// still has unique readable labels.
export function lobbyLabel(index: number): string {
  let n = index
  let label = ''
  do {
    label = String.fromCharCode(65 + (n % 26)) + label
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return label
}

// `orderedEntrantIds` must be ordered strongest-first (current standings) so the
// snake draft spreads seeds across lobbies. For round 1 of stage 1 there are no
// standings yet, so the caller passes a shuffled list.
export function assignLobbies(
  orderedEntrantIds: string[],
  lobbySize: number,
): { label: string; entrantIds: string[] }[] {
  const count = lobbyCountFor(orderedEntrantIds.length, lobbySize)
  if (count === 0) return []

  return snakeDistribute(orderedEntrantIds, count).map((entrantIds, i) => ({
    label: lobbyLabel(i),
    entrantIds,
  }))
}
