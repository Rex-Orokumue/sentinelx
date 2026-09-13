import { describe, it, expect } from 'vitest'
import { formingSquadRefunds } from './squad-refund'

describe('formingSquadRefunds', () => {
  it('refunds the full fee for a plain paid member', () => {
    const refunds = formingSquadRefunds(
      [{ playerId: 'p1', registrationId: 'r1', paymentStatus: 'paid', feeWaived: false, coinsUsed: 0, coinDiscountNaira: 0 }],
      500,
    )
    expect(refunds).toEqual([{ playerId: 'p1', registrationId: 'r1', cashNaira: 500, coinsUsed: 0 }])
  })

  it('refunds cash net of a coin discount, and reverses the coins separately', () => {
    const refunds = formingSquadRefunds(
      [{ playerId: 'p1', registrationId: 'r1', paymentStatus: 'paid', feeWaived: false, coinsUsed: 500, coinDiscountNaira: 250 }],
      500,
    )
    expect(refunds).toEqual([{ playerId: 'p1', registrationId: 'r1', cashNaira: 250, coinsUsed: 500 }])
  })

  it('skips a member whose registration never paid', () => {
    const refunds = formingSquadRefunds(
      [{ playerId: 'p1', registrationId: 'r1', paymentStatus: 'pending', feeWaived: false, coinsUsed: 0, coinDiscountNaira: 0 }],
      500,
    )
    expect(refunds).toEqual([])
  })

  it('skips a fee-waived member — nothing was actually paid', () => {
    const refunds = formingSquadRefunds(
      [{ playerId: 'p1', registrationId: 'r1', paymentStatus: 'paid', feeWaived: true, coinsUsed: 0, coinDiscountNaira: 0 }],
      500,
    )
    expect(refunds).toEqual([])
  })

  it('still reverses a full-price coin discount even though cash owed is zero', () => {
    const refunds = formingSquadRefunds(
      [{ playerId: 'p1', registrationId: 'r1', paymentStatus: 'paid', feeWaived: false, coinsUsed: 1000, coinDiscountNaira: 500 }],
      500,
    )
    expect(refunds).toEqual([{ playerId: 'p1', registrationId: 'r1', cashNaira: 0, coinsUsed: 1000 }])
  })
})
