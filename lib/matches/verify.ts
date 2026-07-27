export interface SubmittedScore {
  scoreA: number
  scoreB: number
}

function scoresMatch(a: SubmittedScore, b: SubmittedScore): boolean {
  return a.scoreA === b.scoreA && a.scoreB === b.scoreB
}

// Pre-fill the official score from up to two submissions:
// both agree -> that score; disagree -> null (no anchoring); exactly one -> it; none -> null.
export function prefillScore(
  a: SubmittedScore | null,
  b: SubmittedScore | null,
): SubmittedScore | null {
  if (a && b) return scoresMatch(a, b) ? a : null
  return a ?? b ?? null
}

// True when there are 2+ submissions and at least one disagrees with another —
// a signal of a possible forged/misreported score. False for 0 or 1 submissions
// (nothing to compare yet).
export function hasScoreMismatch(submissions: SubmittedScore[]): boolean {
  if (submissions.length < 2) return false
  return submissions.some((s) => !scoresMatch(s, submissions[0]))
}
