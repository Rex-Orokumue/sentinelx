// Sentinel Score is derived: base 70 plus the sum of every logged points_delta,
// clamped to 0–100. profiles.sentinel_score is a cache of this value, never the source.
export const BASE_SCORE = 70
const MIN_SCORE = 0
const MAX_SCORE = 100

export function computeScore(events: { points_delta: number }[]): number {
  const raw = BASE_SCORE + events.reduce((sum, e) => sum + e.points_delta, 0)
  return Math.max(MIN_SCORE, Math.min(MAX_SCORE, raw))
}
