export interface ReviewMatchInput {
  id: string
  status: string
  scheduledAt: string | null
  isFullDay: boolean
  autoExpired: boolean
  submissionCount: number
  round: string
  playerAName: string
  playerBName: string
  playerAClubName?: string | null
  playerBClubName?: string | null
  tournamentTitle: string
  tournamentSlug: string
}

// Split matches (already limited to status scheduled/live/disputed/cancelled) into three
// actionable buckets. `now` is injected for deterministic tests.
//
// Full-day matches are deliberately excluded from the time-based "no submission"
// check below — scheduledAt is midnight for them, so scheduledAt <= now would go
// true the instant the day STARTS, not ends. Instead, the "has the day ended"
// boundary is enforced entirely by expire_full_day_matches() (a Postgres cron
// job — see the #24 design spec): it only sets autoExpired once the day has
// actually passed, and THAT is what routes a full-day match into this queue.
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
      !mt.isFullDay &&
      mt.submissionCount === 0 &&
      mt.scheduledAt != null &&
      new Date(mt.scheduledAt).getTime() <= now.getTime()
    ) {
      noSubmission.push(mt)
    } else if (mt.status === 'cancelled' && mt.autoExpired && mt.submissionCount === 0) {
      noSubmission.push(mt)
    }
    // else: future scheduled / live-with-no-submission / full-day-still-in-progress
    // / cancelled-but-not-auto-expired -> excluded
  }
  return { needsReview, noSubmission, disputed }
}
