import { describe, it, expect } from 'vitest'
import { bucketReviewQueue, type ReviewMatchInput } from './review-queue'

const NOW = new Date('2026-07-08T12:00:00Z')

function m(over: Partial<ReviewMatchInput> & { id: string }): ReviewMatchInput {
  return {
    status: 'scheduled',
    scheduledAt: null,
    isFullDay: false,
    autoExpired: false,
    submissionCount: 0,
    round: 'group',
    playerAName: 'A',
    playerBName: 'B',
    tournamentTitle: 'Cup',
    tournamentSlug: 'cup',
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
  it('routes an auto-expired match to No submission', () => {
    const r = bucketReviewQueue(
      [m({ id: 'ax', status: 'cancelled', autoExpired: true, submissionCount: 0 })],
      NOW,
    )
    expect(r.noSubmission.map((x) => x.id)).toEqual(['ax'])
  })
  it('excludes a cancelled match that was not auto-expired', () => {
    const r = bucketReviewQueue(
      [m({ id: 'c', status: 'cancelled', autoExpired: false, submissionCount: 0 })],
      NOW,
    )
    expect(r.needsReview.concat(r.noSubmission, r.disputed)).toEqual([])
  })
})
