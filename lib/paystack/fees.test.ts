import { describe, it, expect } from 'vitest'
import { computePaystackFee } from './fees'

describe('computePaystackFee', () => {
  it('waives the flat ₦100 fee under ₦2,500', () => {
    expect(computePaystackFee(1000)).toBe(15) // 1.5% of 1000 = 15, no flat fee
  })

  it('charges 1.5% + ₦100 at or above ₦2,500', () => {
    expect(computePaystackFee(2500)).toBe(138) // 37.5 + 100 = 137.5 -> rounds to 138
  })

  it('caps the fee at ₦2,000 for large amounts', () => {
    expect(computePaystackFee(200_000)).toBe(2000) // 3000 + 100 = 3100, capped at 2000
  })

  it('rounds to the nearest whole naira', () => {
    expect(computePaystackFee(10_000)).toBe(250) // 150 + 100 = 250, already whole
  })

  it('returns 0 for a zero amount', () => {
    expect(computePaystackFee(0)).toBe(0)
  })
})
