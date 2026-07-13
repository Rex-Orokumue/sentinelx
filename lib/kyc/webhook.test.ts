import { describe, it, expect } from 'vitest'
import { identificationEventTarget, extractIdentificationCustomerCode } from './webhook'

describe('identificationEventTarget', () => {
  it('maps customeridentification.success to verified', () => {
    expect(identificationEventTarget('customeridentification.success')).toBe('verified')
  })
  it('maps customeridentification.failed to failed', () => {
    expect(identificationEventTarget('customeridentification.failed')).toBe('failed')
  })
  it('returns null for an unrelated event', () => {
    expect(identificationEventTarget('charge.success')).toBeNull()
  })
})

describe('extractIdentificationCustomerCode', () => {
  it('reads customer_code from the top level of data (actual customeridentification.* shape — data IS the customer object)', () => {
    expect(extractIdentificationCustomerCode({ customer_code: 'CUS_abc123', identified: true })).toBe(
      'CUS_abc123',
    )
  })

  it('falls back to a nested data.customer.customer_code (the charge.success shape) if present', () => {
    expect(extractIdentificationCustomerCode({ customer: { customer_code: 'CUS_nested' } })).toBe(
      'CUS_nested',
    )
  })

  it('prefers the top-level customer_code when both are present', () => {
    expect(
      extractIdentificationCustomerCode({
        customer_code: 'CUS_top',
        customer: { customer_code: 'CUS_nested' },
      }),
    ).toBe('CUS_top')
  })

  it('returns null when neither shape has a customer code', () => {
    expect(extractIdentificationCustomerCode({})).toBeNull()
  })

  it('returns null for null/undefined data', () => {
    expect(extractIdentificationCustomerCode(null)).toBeNull()
    expect(extractIdentificationCustomerCode(undefined)).toBeNull()
  })
})
