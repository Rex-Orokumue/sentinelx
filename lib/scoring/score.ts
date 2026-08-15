// SX Score is derived: base 700 plus the sum of every logged points_delta,
// floored at 0 with no upper bound. profiles.sx_score is a cache of this
// value, never the source. (Rescaled ×10 from the old 0-100 Sentinel Score —
// see docs/superpowers/specs/2026-08-05-phase2-economy-design.md §2.)
export const BASE_SCORE = 700
const MIN_SCORE = 0

export function computeScore(events: { points_delta: number }[]): number {
  const raw = BASE_SCORE + events.reduce((sum, e) => sum + e.points_delta, 0)
  return Math.max(MIN_SCORE, raw)
}
