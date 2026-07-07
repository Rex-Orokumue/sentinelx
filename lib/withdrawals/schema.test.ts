import { describe, it, expect } from 'vitest'
import { withdrawalSchema } from './schema'

const valid = {
  amount: '5000',
  bankName: 'GTBank',
  accountName: 'Ada Lovelace',
  accountNumber: '0123456789',
}

describe('withdrawalSchema', () => {
  it('accepts a valid request and coerces amount to a number', () => {
    const r = withdrawalSchema.safeParse(valid)
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.amount).toBe(5000)
  })

  it('rejects amounts below the ₦1,000 floor', () => {
    expect(withdrawalSchema.safeParse({ ...valid, amount: '0' }).success).toBe(false)
    expect(withdrawalSchema.safeParse({ ...valid, amount: '1' }).success).toBe(false)
    expect(withdrawalSchema.safeParse({ ...valid, amount: '999' }).success).toBe(false)
  })

  it('accepts the floor exactly', () => {
    expect(withdrawalSchema.safeParse({ ...valid, amount: '1000' }).success).toBe(true)
  })

  it('rejects a non-integer amount', () => {
    expect(withdrawalSchema.safeParse({ ...valid, amount: '1500.5' }).success).toBe(false)
  })

  it('rejects amounts over the ceiling', () => {
    expect(withdrawalSchema.safeParse({ ...valid, amount: '100000001' }).success).toBe(false)
  })

  it('rejects empty bank or account name', () => {
    expect(withdrawalSchema.safeParse({ ...valid, bankName: '   ' }).success).toBe(false)
    expect(withdrawalSchema.safeParse({ ...valid, accountName: '' }).success).toBe(false)
  })

  it('rejects account numbers that are not exactly 10 digits', () => {
    expect(withdrawalSchema.safeParse({ ...valid, accountNumber: '123456789' }).success).toBe(false)
    expect(withdrawalSchema.safeParse({ ...valid, accountNumber: '01234567890' }).success).toBe(false)
    expect(withdrawalSchema.safeParse({ ...valid, accountNumber: '12345abcde' }).success).toBe(false)
  })
})
