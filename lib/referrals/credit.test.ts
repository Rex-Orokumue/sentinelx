import { describe, it, expect } from 'vitest'
import { qualifiesForReferralCredit } from './credit'

describe('qualifiesForReferralCredit', () => {
  it('qualifies a genuinely paid entry', () => {
    expect(qualifiesForReferralCredit({ registrationFee: 500, feeWaived: false })).toBe(true)
  })

  it('does not qualify a free tournament', () => {
    expect(qualifiesForReferralCredit({ registrationFee: 0, feeWaived: false })).toBe(false)
  })

  it('does not qualify a comped entry on a fee-paying tournament', () => {
    expect(qualifiesForReferralCredit({ registrationFee: 500, feeWaived: true })).toBe(false)
  })

  it('does not qualify a comped entry on a free tournament', () => {
    expect(qualifiesForReferralCredit({ registrationFee: 0, feeWaived: true })).toBe(false)
  })
})
