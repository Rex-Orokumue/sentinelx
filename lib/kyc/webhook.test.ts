import { describe, it, expect } from 'vitest'
import { identificationEventTarget } from './webhook'

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
