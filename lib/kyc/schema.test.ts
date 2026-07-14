import { describe, it, expect } from 'vitest'
import { kycSchema } from './schema'

const valid = {
  bankCode: '058',
  accountNumber: '0123456789',
  firstName: 'Ada',
  lastName: 'Lovelace',
}

describe('kycSchema', () => {
  it('accepts a valid submission', () => {
    expect(kycSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects a missing bank', () => {
    expect(kycSchema.safeParse({ ...valid, bankCode: '' }).success).toBe(false)
  })

  it('rejects an account number that is not exactly 10 digits', () => {
    expect(kycSchema.safeParse({ ...valid, accountNumber: '123456789' }).success).toBe(false)
    expect(kycSchema.safeParse({ ...valid, accountNumber: '01234567890' }).success).toBe(false)
  })

  it('rejects empty first or last name', () => {
    expect(kycSchema.safeParse({ ...valid, firstName: '  ' }).success).toBe(false)
    expect(kycSchema.safeParse({ ...valid, lastName: '' }).success).toBe(false)
  })
})
