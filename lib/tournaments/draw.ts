// Group count from the registered (paid) player count. 0 => straight knockout.
export function groupCountFor(n: number): 0 | 2 | 4 | 8 {
  if (n <= 8) return 0
  if (n <= 16) return 2
  if (n <= 32) return 4
  return 8 // 33–64
}

// Snake draft: row 0 fills groups left→right, row 1 right→left, etc.
export function snakeDistribute(orderedPlayerIds: string[], groups: number): string[][] {
  const out: string[][] = Array.from({ length: groups }, () => [])
  orderedPlayerIds.forEach((id, i) => {
    const row = Math.floor(i / groups)
    const pos = i % groups
    const g = row % 2 === 0 ? pos : groups - 1 - pos
    out[g].push(id)
  })
  return out
}

// Every unordered pair once (all-play-all).
export function roundRobinPairs(playerIds: string[]): [string, string][] {
  const pairs: [string, string][] = []
  for (let i = 0; i < playerIds.length; i++) {
    for (let j = i + 1; j < playerIds.length; j++) pairs.push([playerIds[i], playerIds[j]])
  }
  return pairs
}

function nextPow2(n: number): number {
  let p = 1
  while (p < n) p *= 2
  return p
}

// First knockout round from seeded players. bracketSize = next power of 2 >= n;
// the top (bracketSize - n) seeds get byes; the rest pair highest-vs-lowest.
export function knockoutRound1(orderedPlayerIds: string[]): {
  round: 'final' | 'semi_final' | 'quarter_final'
  matches: [string, string][]
  byePlayerIds: string[]
} {
  const n = orderedPlayerIds.length
  const size = nextPow2(n)
  const byes = size - n
  const byePlayerIds = orderedPlayerIds.slice(0, byes)
  const playing = orderedPlayerIds.slice(byes)
  const matches: [string, string][] = []
  for (let i = 0, j = playing.length - 1; i < j; i++, j--) matches.push([playing[i], playing[j]])
  const round = size <= 2 ? 'final' : size <= 4 ? 'semi_final' : 'quarter_final'
  return { round, matches, byePlayerIds }
}
