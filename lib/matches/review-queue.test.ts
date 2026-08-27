import { describe, it, expect } from 'vitest'
import { bucketReviewQueue, type ReviewMatchInput } from './review-queue'

const NOW = new Date('2026-07-08T12:00:00Z')

function m(over: Partial<ReviewMatchInput> & { id: string }): ReviewMatchInput {
  return {
    status: 'scheduled',
    scheduledAt: null,
    isFullDay: false,
    submissionCount: 0,
    hasMismatch: false,
    round: 'group',
    playerAName: 'A',
    playerBName: 'B',
    tournamentTitle: 'Cup',
    tournamentSlug: 'cup',
    noshowFlaggedAt: null,
    ...over,
  }
}

describe('bucketReviewQueue', () => {
  it('routes a submitted scheduled/live match to Needs review (regardless of scheduledAt)', () => {
    const r = bucketReviewQueue([m({ id: 's', submissionCount: 1, scheduledAt: null })], NOW)
    expect(r.needsReview.map((x) => x.id)).toEqual(['s'])
  })
  it('routes a past-due unsubmitted scheduled match to No submission', () => {
    const r = bucketReviewQueue(
      [m({ id: 'p', submissionCount: 0, scheduledAt: '2026-07-01T10:00:00Z' })],
      NOW,
    )
    expect(r.noSubmission.map((x) => x.id)).toEqual(['p'])
  })
  it('routes disputed matches to Disputed', () => {
    const r = bucketReviewQueue([m({ id: 'd', status: 'disputed', submissionCount: 0 })], NOW)
    expect(r.disputed.map((x) => x.id)).toEqual(['d'])
  })
  it('excludes a future scheduled match with no submission', () => {
    const r = bucketReviewQueue(
      [m({ id: 'f', submissionCount: 0, scheduledAt: '2026-08-01T10:00:00Z' })],
      NOW,
    )
    expect(r.needsReview.concat(r.noSubmission, r.disputed)).toEqual([])
  })
  it('excludes a full-day match still within its day, even though scheduledAt <= now', () => {
    const r = bucketReviewQueue(
      [m({ id: 'fd', submissionCount: 0, scheduledAt: '2026-07-08T00:00:00Z', isFullDay: true })],
      NOW,
    )
    expect(r.needsReview.concat(r.noSubmission, r.disputed)).toEqual([])
  })
  it('excludes a cancelled match (cancellation is never auto-resolved into a review bucket)', () => {
    const r = bucketReviewQueue([m({ id: 'c', status: 'cancelled', submissionCount: 0 })], NOW)
    expect(r.needsReview.concat(r.noSubmission, r.disputed)).toEqual([])
  })
  it('routes a flagged full-day match with no submission to No submission', () => {
    const r = bucketReviewQueue(
      [
        m({
          id: 'fl',
          status: 'scheduled',
          isFullDay: true,
          submissionCount: 0,
          noshowFlaggedAt: '2026-07-08T00:00:00Z',
        }),
      ],
      NOW,
    )
    expect(r.noSubmission.map((x) => x.id)).toEqual(['fl'])
  })
  it('routes a flagged live match with no submission to No submission', () => {
    const r = bucketReviewQueue(
      [m({ id: 'lv', status: 'live', submissionCount: 0, noshowFlaggedAt: '2026-07-08T00:00:00Z' })],
      NOW,
    )
    expect(r.noSubmission.map((x) => x.id)).toEqual(['lv'])
  })
  it('routes a flagged match that already has a submission to Needs review, not No submission', () => {
    const r = bucketReviewQueue(
      [m({ id: 'sf', status: 'scheduled', submissionCount: 1, noshowFlaggedAt: '2026-07-08T00:00:00Z' })],
      NOW,
    )
    expect(r.needsReview.map((x) => x.id)).toEqual(['sf'])
    expect(r.noSubmission).toEqual([])
  })
})
