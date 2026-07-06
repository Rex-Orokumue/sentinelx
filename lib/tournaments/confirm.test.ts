import { describe, it, expect } from 'vitest'
import { decideConfirmation } from './confirm'

const pending = { payment_status: 'pending' }
const paid = { payment_status: 'paid' }
const ok = { status: 'success', amountKobo: 50000 }

describe('decideConfirmation', () => {
  it('returns not_found when there is no registration', () => {
    expect(decideConfirmation({ existing: null, verify: ok })).toBe('not_found')
  })

  it('returns already_paid before verifying (idempotent short-circuit)', () => {
    expect(decideConfirmation({ existing: paid, verify: ok })).toBe('already_paid')
  })

  it('confirms on success with the exact expected amount', () => {
    expect(decideConfirmation({ existing: pending, verify: ok })).toBe('confirmed')
  })

  it('rejects when Paystack status is not success', () => {
    expect(
      decideConfirmation({ existing: pending, verify: { status: 'failed', amountKobo: 50000 } }),
    ).toBe('not_successful')
  })

  it('rejects on amount mismatch (partial or tampered payment)', () => {
    expect(
      decideConfirmation({ existing: pending, verify: { status: 'success', amountKobo: 100 } }),
    ).toBe('not_successful')
  })

  it('rejects when verify data is unavailable', () => {
    expect(decideConfirmation({ existing: pending, verify: null })).toBe('not_successful')
  })
})
