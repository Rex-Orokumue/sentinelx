import { describe, it, expect } from 'vitest'
import { referralWithdrawalSchema } from './schema'

describe('referralWithdrawalSchema', () => {
  it('accepts a valid amount', () => {
    expect(referralWithdrawalSchema.safeParse({ amount: '500' }).success).toBe(true)
  })

  it('rejects an amount below the 500 minimum', () => {
    expect(referralWithdrawalSchema.safeParse({ amount: '100' }).success).toBe(false)
  })

  it('rejects a non-integer amount', () => {
    expect(referralWithdrawalSchema.safeParse({ amount: '500.5' }).success).toBe(false)
  })

  it('coerces a numeric string', () => {
    const r = referralWithdrawalSchema.safeParse({ amount: '600' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.amount).toBe(600)
  })
})
