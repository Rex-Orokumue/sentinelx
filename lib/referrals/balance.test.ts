import { describe, it, expect } from 'vitest'
import { computeReferralBalance, isEligibleForReferralWithdrawal, REFERRAL_MIN_COUNT } from './balance'

describe('computeReferralBalance', () => {
  it('is zero with no referrals', () => {
    expect(computeReferralBalance(0, [])).toBe(0)
  })

  it('is referralCount * 100 with no withdrawals', () => {
    expect(computeReferralBalance(5, [])).toBe(500)
  })

  it('subtracts pending withdrawals', () => {
    expect(computeReferralBalance(5, [{ status: 'pending', amount: 200 }])).toBe(300)
  })

  it('subtracts paid withdrawals', () => {
    expect(computeReferralBalance(5, [{ status: 'paid', amount: 500 }])).toBe(0)
  })

  it('does not subtract rejected withdrawals', () => {
    expect(computeReferralBalance(5, [{ status: 'rejected', amount: 500 }])).toBe(500)
  })

  it('handles a mix of statuses', () => {
    const withdrawals = [
      { status: 'paid', amount: 200 },
      { status: 'rejected', amount: 300 },
      { status: 'pending', amount: 100 },
    ]
    // 10 referrals = 1000; paid 200 + pending 100 = 300 reserved; rejected ignored
    expect(computeReferralBalance(10, withdrawals)).toBe(700)
  })
})

describe('isEligibleForReferralWithdrawal', () => {
  it('is false below the threshold', () => {
    expect(isEligibleForReferralWithdrawal(REFERRAL_MIN_COUNT - 1)).toBe(false)
  })

  it('is true at the threshold', () => {
    expect(isEligibleForReferralWithdrawal(REFERRAL_MIN_COUNT)).toBe(true)
  })

  it('is true above the threshold', () => {
    expect(isEligibleForReferralWithdrawal(REFERRAL_MIN_COUNT + 3)).toBe(true)
  })
})
