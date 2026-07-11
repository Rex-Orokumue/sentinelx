import { describe, it, expect } from 'vitest'
import { maskAccountNumber, kycPanelMode } from './logic'

describe('maskAccountNumber', () => {
  it('shows only the last 4 digits', () => {
    expect(maskAccountNumber('0123456789')).toBe('•••6789')
  })
})

describe('kycPanelMode', () => {
  it('maps unverified to form', () => {
    expect(kycPanelMode('unverified')).toBe('form')
  })
  it('maps failed to form (retry)', () => {
    expect(kycPanelMode('failed')).toBe('form')
  })
  it('maps pending to pending', () => {
    expect(kycPanelMode('pending')).toBe('pending')
  })
  it('maps verified to verified', () => {
    expect(kycPanelMode('verified')).toBe('verified')
  })
  it('falls back to form for an unknown value', () => {
    expect(kycPanelMode('bogus')).toBe('form')
  })
})
