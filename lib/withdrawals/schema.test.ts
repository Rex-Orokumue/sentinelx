import { describe, it, expect } from 'vitest'
import { withdrawalSchema } from './schema'

describe('withdrawalSchema', () => {
  it('accepts a valid amount and coerces it to a number', () => {
    const r = withdrawalSchema.safeParse({ amount: '5000' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.amount).toBe(5000)
  })

  it('rejects amounts below the ₦1,000 floor', () => {
    expect(withdrawalSchema.safeParse({ amount: '0' }).success).toBe(false)
    expect(withdrawalSchema.safeParse({ amount: '1' }).success).toBe(false)
    expect(withdrawalSchema.safeParse({ amount: '999' }).success).toBe(false)
  })

  it('accepts the floor exactly', () => {
    expect(withdrawalSchema.safeParse({ amount: '1000' }).success).toBe(true)
  })

  it('rejects a non-integer amount', () => {
    expect(withdrawalSchema.safeParse({ amount: '1500.5' }).success).toBe(false)
  })

  it('rejects amounts over the ceiling', () => {
    expect(withdrawalSchema.safeParse({ amount: '100000001' }).success).toBe(false)
  })
})
