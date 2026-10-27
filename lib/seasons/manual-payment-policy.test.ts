import { describe, expect, it } from 'vitest'
import { canRecordManualPayment } from './manual-payment-policy'

describe('manual payment control', () => {
  it('is available only to admins for unpaid live or expired invitations while registration is open', () => {
    const base = { isAdmin: true, tournamentStatus: 'registration_open', invitationStatus: 'accepted', paymentStatus: 'pending', registrationStatus: 'active', fee: 500 }
    expect(canRecordManualPayment(base)).toBe(true)
    expect(canRecordManualPayment({ ...base, invitationStatus: 'expired', paymentStatus: null, registrationStatus: null })).toBe(true)
    expect(canRecordManualPayment({ ...base, isAdmin: false })).toBe(false)
    expect(canRecordManualPayment({ ...base, invitationStatus: 'declined', paymentStatus: null })).toBe(false)
    expect(canRecordManualPayment({ ...base, paymentStatus: 'paid' })).toBe(false)
    expect(canRecordManualPayment({ ...base, tournamentStatus: 'registration_closed' })).toBe(false)
    expect(canRecordManualPayment({ ...base, registrationStatus: 'removed' })).toBe(false)
    expect(canRecordManualPayment({ ...base, fee: 0 })).toBe(false)
  })
})
