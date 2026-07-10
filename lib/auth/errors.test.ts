import { describe, it, expect } from 'vitest'
import { isUsernameTakenError, mapSignupError } from './errors'

describe('isUsernameTakenError', () => {
  it('detects a raw Postgres 23505 code', () => {
    expect(isUsernameTakenError({ code: '23505' })).toBe(true)
  })
  it('detects a duplicate key message', () => {
    expect(isUsernameTakenError({ message: 'duplicate key value violates unique constraint' })).toBe(true)
  })
  it('does NOT treat the generic GoTrue wrapper as username-taken', () => {
    // "Database error saving new user" is emitted for ANY trigger/DB failure,
    // not just a username collision, so mapping it to "username taken" would
    // mislabel unrelated failures (e.g. an SMTP 500). The signup action's
    // pre-check against `profiles` is the precise path instead.
    expect(isUsernameTakenError({ message: 'Database error saving new user' })).toBe(false)
  })
  it('ignores unrelated errors', () => {
    expect(isUsernameTakenError({ message: 'Invalid login credentials' })).toBe(false)
  })
  it('is safe on null', () => {
    expect(isUsernameTakenError(null)).toBe(false)
  })
})

describe('mapSignupError', () => {
  it('returns the username-taken message for a 23505', () => {
    expect(mapSignupError({ code: '23505' })).toMatch(/taken/i)
  })
  it('falls back to a generic message otherwise', () => {
    expect(mapSignupError({ message: 'network down' })).toMatch(/something went wrong/i)
  })
})
