export interface ReviewMatchInput {
  id: string
  status: string
  scheduledAt: string | null
  isFullDay: boolean
  submissionCount: number
  hasMismatch: boolean
  round: string
  playerAName: string
  playerBName: string
  playerAClubName?: string | null
  playerBClubName?: string | null
  tournamentTitle: string
  tournamentSlug: string
  noshowFlaggedAt: string | null
}

// Split matches (already limited to status scheduled/live/disputed) into three
// actionable buckets. `now` is injected for deterministic tests.
//
// Full-day matches are deliberately excluded from the time-based "no submission"
// check below — scheduledAt is midnight for them, so scheduledAt <= now would go
// true the instant the day STARTS, not ends. Instead, they wait for
// noshow_flagged_at like every other match: the hourly no-show sweep
// (resolvePendingNoShowMatches, lib/matches/noshow-actions.ts) already computes
// the "has the day ended" boundary correctly via noShowDeadlinePassed
// (lib/matches/noshow.ts), and is what routes a stale full-day match into this
// queue. There used to be a second, competing path here — a Postgres cron job
// that auto-cancelled full-day matches directly, bypassing admin review
// entirely — removed because it raced this same-minute sweep and could cancel
// a match before it was ever flagged for a decision.
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
      mt.submissionCount === 0 &&
      ((mt.status === 'scheduled' &&
        !mt.isFullDay &&
        mt.scheduledAt != null &&
        new Date(mt.scheduledAt).getTime() <= now.getTime()) ||
        ((mt.status === 'scheduled' || mt.status === 'live') && mt.noshowFlaggedAt != null))
    ) {
      noSubmission.push(mt)
    }
    // else: future scheduled / live-with-no-submission / full-day-still-in-progress
    // / cancelled -> excluded (cancellation is a terminal admin decision, never
    // auto-resolved back into a review bucket)
  }
  return { needsReview, noSubmission, disputed }
}
