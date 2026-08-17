/**
 * Pure interpolation for a count-up animation — given elapsed time, total
 * duration, and a target value, returns the value to render right now.
 * Ease-out cubic, so the count feels like it's decelerating into place
 * rather than ticking up linearly. Clamped to `to` once elapsed >= duration,
 * and short-circuits to `to` for a non-positive duration.
 */
export function computeCountUpValue(elapsedMs: number, durationMs: number, to: number): number {
  if (durationMs <= 0) return to
  const progress = Math.min(1, Math.max(0, elapsedMs / durationMs))
  const eased = 1 - Math.pow(1 - progress, 3)
  return Math.round(to * eased)
}
