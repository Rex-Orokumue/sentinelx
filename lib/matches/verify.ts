export interface SubmittedScore {
  scoreA: number
  scoreB: number
}

// Pre-fill the official score from up to two submissions:
// both agree -> that score; disagree -> null (no anchoring); exactly one -> it; none -> null.
export function prefillScore(
  a: SubmittedScore | null,
  b: SubmittedScore | null,
): SubmittedScore | null {
  if (a && b) return a.scoreA === b.scoreA && a.scoreB === b.scoreB ? a : null
  return a ?? b ?? null
}
