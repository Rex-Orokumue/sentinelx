export interface ReviewMatchInput {
  id: string
  status: string
  scheduledAt: string | null
  submissionCount: number
  round: string
  playerAName: string
  playerBName: string
  playerAClubName?: string | null
  playerBClubName?: string | null
  tournamentTitle: string
  tournamentSlug: string
}

// Split matches (already limited to status scheduled/live/disputed) into three actionable
// buckets. `now` is injected for deterministic tests.
export function bucketReviewQueue(
  matches: ReviewMatchInput[],
  now: Date,
): { needsReview: ReviewMatchInput[]; noSubmission: ReviewMatchInput[]; disputed: ReviewMatchInput[] } {
  const needsReview: ReviewMatchInput[] = []
  const noSubmission: ReviewMatchInput[] = []
  const disputed: ReviewMatchInput[] = []
  for (const mt of matches) {
    if (mt.status === 'disputed') {
      disputed.push(mt)
    } else if (mt.submissionCount >= 1 && (mt.status === 'scheduled' || mt.status === 'live')) {
      needsReview.push(mt)
    } else if (
      mt.status === 'scheduled' &&
      mt.submissionCount === 0 &&
      mt.scheduledAt != null &&
      new Date(mt.scheduledAt).getTime() <= now.getTime()
    ) {
      noSubmission.push(mt)
    }
    // else: future scheduled / live-with-no-submission -> excluded
  }
  return { needsReview, noSubmission, disputed }
}
