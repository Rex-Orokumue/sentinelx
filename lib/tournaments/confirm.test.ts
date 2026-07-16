import { describe, it, expect } from 'vitest'
import { decideConfirmation } from './confirm'

const pending = { payment_status: 'pending' }
const paid = { payment_status: 'paid' }
const ok = { status: 'success', amountKobo: 50000 }
const expectedKobo = 50000

describe('decideConfirmation', () => {
  it('returns not_found when there is no registration', () => {
    expect(decideConfirmation({ existing: null, verify: ok, expectedKobo })).toBe('not_found')
  })

  it('returns already_paid before verifying (idempotent short-circuit)', () => {
    expect(decideConfirmation({ existing: paid, verify: ok, expectedKobo })).toBe('already_paid')
  })

  it('confirms on success with the exact expected amount', () => {
    expect(decideConfirmation({ existing: pending, verify: ok, expectedKobo })).toBe('confirmed')
  })

  it('rejects when Paystack status is not success', () => {
    expect(
      decideConfirmation({
        existing: pending,
        verify: { status: 'failed', amountKobo: 50000 },
        expectedKobo,
      }),
    ).toBe('not_successful')
  })

  it('rejects underpayment (partial or tampered payment)', () => {
    expect(
      decideConfirmation({
        existing: pending,
        verify: { status: 'success', amountKobo: 100 },
        expectedKobo,
      }),
    ).toBe('not_successful')
  })

  it('confirms when the amount paid exceeds the expected fee (customer-bears-fee accounts)', () => {
    // Paystack adds its transaction fee on top of the requested amount when the
    // account is configured for the customer to bear fees — verify's amount then
    // reflects amount+fee, not the exact figure we sent to initialize.
    expect(
      decideConfirmation({
        existing: pending,
        verify: { status: 'success', amountKobo: 50762 },
        expectedKobo,
      }),
    ).toBe('confirmed')
  })

  it('rejects when verify data is unavailable', () => {
    expect(decideConfirmation({ existing: pending, verify: null, expectedKobo })).toBe('not_successful')
  })

  it('uses the tournament-specific expected fee, not a fixed platform-wide amount', () => {
    // A ₦1,000 tournament (100000 kobo) must reject a ₦500 payment even though
    // ₦500 used to be the hardcoded platform default.
    expect(
      decideConfirmation({
        existing: pending,
        verify: { status: 'success', amountKobo: 50000 },
        expectedKobo: 100000,
      }),
    ).toBe('not_successful')
  })
})
