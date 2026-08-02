import { describe, it, expect } from 'vitest'
import { decideDepositConfirmation } from './confirm'

const pending = { status: 'pending' }
const paid = { status: 'paid' }
const ok = { status: 'success', amountKobo: 110_000 } // ₦1,000 + ₦100 fee, in kobo
const expectedKobo = 110_000

describe('decideDepositConfirmation', () => {
  it('returns not_found when there is no deposit row', () => {
    expect(decideDepositConfirmation({ existing: null, verify: ok, expectedKobo })).toBe('not_found')
  })

  it('returns already_paid before verifying (idempotent short-circuit)', () => {
    expect(decideDepositConfirmation({ existing: paid, verify: ok, expectedKobo })).toBe('already_paid')
  })

  it('confirms on success with the exact expected amount', () => {
    expect(decideDepositConfirmation({ existing: pending, verify: ok, expectedKobo })).toBe('confirmed')
  })

  it('rejects when Paystack status is not success', () => {
    expect(
      decideDepositConfirmation({
        existing: pending,
        verify: { status: 'failed', amountKobo: 110_000 },
        expectedKobo,
      }),
    ).toBe('not_successful')
  })

  it('rejects underpayment', () => {
    expect(
      decideDepositConfirmation({
        existing: pending,
        verify: { status: 'success', amountKobo: 100 },
        expectedKobo,
      }),
    ).toBe('not_successful')
  })

  it('confirms overpayment (customer-bears-fee accounts can verify slightly higher)', () => {
    expect(
      decideDepositConfirmation({
        existing: pending,
        verify: { status: 'success', amountKobo: 110_500 },
        expectedKobo,
      }),
    ).toBe('confirmed')
  })

  it('rejects when verify data is unavailable', () => {
    expect(decideDepositConfirmation({ existing: pending, verify: null, expectedKobo })).toBe('not_successful')
  })
})
