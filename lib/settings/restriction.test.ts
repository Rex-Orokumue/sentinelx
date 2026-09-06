import { describe, it, expect } from 'vitest'
import { restrictionMessage, RESTRICTION_MESSAGE } from './restriction'

describe('restrictionMessage', () => {
  it('permits a live account', () => {
    expect(restrictionMessage({ deletion_requested_at: null, deleted_at: null })).toBeNull()
  })

  // Without this, the guards that passed at request time no longer hold at
  // execution: a user could join a tournament on day 3 and be deleted
  // mid-bracket on day 15.
  it('blocks an account pending deletion', () => {
    expect(
      restrictionMessage({ deletion_requested_at: '2026-09-06T10:00:00Z', deleted_at: null }),
    ).toBe(RESTRICTION_MESSAGE)
  })

  // Nobody is left to restrict; the action fails elsewhere for lack of a
  // session.
  it('permits a tombstone', () => {
    expect(
      restrictionMessage({
        deletion_requested_at: '2026-09-06T10:00:00Z',
        deleted_at: '2026-09-21T10:00:00Z',
      }),
    ).toBeNull()
  })

  it('permits a missing profile', () => {
    expect(restrictionMessage(null)).toBeNull()
  })

  it('names Settings, so the user knows where to cancel', () => {
    expect(RESTRICTION_MESSAGE).toMatch(/Settings/)
  })
})
