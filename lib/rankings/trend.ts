export type TrendDirection = 'up' | 'down' | 'flat' | 'new'

export interface Trend {
  direction: TrendDirection
  /** Places moved. Always >= 0; read the direction for which way. */
  delta: number
}

export interface RankSnapshot {
  playerId: string
  /** null = the global, all-games board. */
  gameId: string | null
  rank: number
  /** ISO date, YYYY-MM-DD. */
  capturedOn: string
}

// Rank 1 is the best rank, so a SMALLER number is an improvement — the
// comparison is inverted relative to the raw values, which is the easy thing to
// get backwards here.
//
// A player with no earlier snapshot is 'new', never 'up': they haven't risen,
// they've just arrived. The table renders that as a dash.
export function trendFor(currentRank: number, previousRank: number | null): Trend {
  if (previousRank === null) return { direction: 'new', delta: 0 }
  if (previousRank === currentRank) return { direction: 'flat', delta: 0 }
  return previousRank > currentRank
    ? { direction: 'up', delta: previousRank - currentRank }
    : { direction: 'down', delta: currentRank - previousRank }
}

// The most recent snapshot for this player and scope from BEFORE today, so a
// second run on the same day compares against yesterday rather than itself.
// Dates are ISO (YYYY-MM-DD), which compares correctly as a string.
export function previousRankFor(
  snapshots: RankSnapshot[],
  playerId: string,
  gameId: string | null,
  today: string,
): number | null {
  let best: RankSnapshot | null = null
  for (const s of snapshots) {
    if (s.playerId !== playerId) continue
    if (s.gameId !== gameId) continue
    if (s.capturedOn >= today) continue
    if (!best || s.capturedOn > best.capturedOn) best = s
  }
  return best?.rank ?? null
}
