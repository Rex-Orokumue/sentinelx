import { describe, it, expect } from 'vitest'
import { computeStakedBalance } from './balance'

describe('computeStakedBalance', () => {
  it('is zero with no wins', () => {
    expect(computeStakedBalance([], [])).toBe(0)
  })

  it('sums stake_amount * 2 across wins', () => {
    expect(computeStakedBalance([{ stakeAmount: 500 }, { stakeAmount: 1000 }], [])).toBe(3000)
  })

  it('subtracts pending and paid withdrawals', () => {
    expect(computeStakedBalance([{ stakeAmount: 500 }], [{ status: 'pending', amount: 400 }])).toBe(600)
  })

  it('does not subtract rejected withdrawals', () => {
    expect(computeStakedBalance([{ stakeAmount: 500 }], [{ status: 'rejected', amount: 1000 }])).toBe(1000)
  })
})
