import { describe, it, expect } from 'vitest'
import {
  GRACE_DAYS,
  deletionDueAt,
  isGraceElapsed,
  daysRemaining,
  isPendingDeletion,
} from './grace'

const requested = new Date('2026-09-06T10:00:00Z')
const plus = (days: number, hours = 0) =>
  new Date(requested.getTime() + days * 86_400_000 + hours * 3_600_000)

describe('grace window', () => {
  it('is 15 days', () => {
    expect(GRACE_DAYS).toBe(15)
  })

  it('due date is 15 days after the request', () => {
    expect(deletionDueAt(requested).toISOString()).toBe('2026-09-21T10:00:00.000Z')
  })

  // Boundary: day 14 must not execute, day 15 must.
  it('has not elapsed on day 14', () => {
    expect(isGraceElapsed(requested, plus(14))).toBe(false)
  })

  it('has not elapsed one hour before the due moment', () => {
    expect(isGraceElapsed(requested, plus(14, 23))).toBe(false)
  })

  it('has elapsed exactly at the due moment', () => {
    expect(isGraceElapsed(requested, plus(15))).toBe(true)
  })

  it('has elapsed after the due moment', () => {
    expect(isGraceElapsed(requested, plus(20))).toBe(true)
  })

  it('counts days remaining, rounding a partial day up', () => {
    expect(daysRemaining(requested, requested)).toBe(15)
    expect(daysRemaining(requested, plus(3))).toBe(12)
    expect(daysRemaining(requested, plus(12, 1))).toBe(3)
  })

  // A countdown that reads zero while the account still exists looks broken,
  // so it only reaches zero once the deletion is actually due.
  it('floors at zero once due', () => {
    expect(daysRemaining(requested, plus(15))).toBe(0)
    expect(daysRemaining(requested, plus(30))).toBe(0)
  })
})

describe('isPendingDeletion', () => {
  it('is true while requested and not yet executed', () => {
    expect(
      isPendingDeletion({ deletion_requested_at: requested.toISOString(), deleted_at: null }),
    ).toBe(true)
  })

  it('is false for a live account', () => {
    expect(isPendingDeletion({ deletion_requested_at: null, deleted_at: null })).toBe(false)
  })

  // A tombstone is deleted, not pending — there is nobody left to restrict.
  it('is false for a tombstone', () => {
    expect(
      isPendingDeletion({
        deletion_requested_at: requested.toISOString(),
        deleted_at: '2026-09-21T10:00:00Z',
      }),
    ).toBe(false)
  })
})
