import { describe, it, expect } from 'vitest'
import { ApiError, Errors, errorBody } from './errors'

describe('errors', () => {
  it('unauthorized is a 401 with a stable code', () => {
    const e = Errors.unauthorized()
    expect(e).toBeInstanceOf(ApiError)
    expect([e.status, e.code]).toEqual([401, 'unauthorized'])
  })
  it('validation carries per-field codes into the body', () => {
    expect(errorBody(Errors.validation({ username: 'username_too_short' }))).toEqual({
      error: { code: 'validation_failed', message: 'Some fields are invalid.', fields: { username: 'username_too_short' } },
    })
  })
  it('omits fields when there are none', () => {
    expect(errorBody(Errors.forbidden())).toEqual({
      error: { code: 'forbidden', message: 'You do not have access to this.' },
    })
  })
  it('carries structured details into the body when given', () => {
    const e = new ApiError(409, 'deletion_blocked', 'blocked', undefined, { blockers: [{ code: 'wallet_balance', amount: 5 }] })
    expect(errorBody(e)).toEqual({
      error: { code: 'deletion_blocked', message: 'blocked', details: { blockers: [{ code: 'wallet_balance', amount: 5 }] } },
    })
  })
  it('upgradeRequired is a 426 that names the minimum version', () => {
    const e = Errors.upgradeRequired('1.2.0')
    expect([e.status, e.code]).toEqual([426, 'app_update_required'])
    expect(e.message).toContain('1.2.0')
  })
})
