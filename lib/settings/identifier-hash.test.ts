import { describe, it, expect } from 'vitest'
import { hashIdentifier } from './identifier-hash'

const PEPPER = 'test-pepper'

describe('hashIdentifier', () => {
  it('is stable for the same input', () => {
    expect(hashIdentifier('a@b.com', PEPPER)).toBe(hashIdentifier('a@b.com', PEPPER))
  })

  it('returns a 64-character hex digest', () => {
    expect(hashIdentifier('a@b.com', PEPPER)).toMatch(/^[0-9a-f]{64}$/)
  })

  // Signup must match however the user typed it, or the block is trivial to
  // sidestep by capitalising a letter.
  it('is case-insensitive', () => {
    expect(hashIdentifier('A@B.COM', PEPPER)).toBe(hashIdentifier('a@b.com', PEPPER))
  })

  it('ignores surrounding whitespace', () => {
    expect(hashIdentifier('  a@b.com  ', PEPPER)).toBe(hashIdentifier('a@b.com', PEPPER))
  })

  it('differs for different values', () => {
    expect(hashIdentifier('a@b.com', PEPPER)).not.toBe(hashIdentifier('c@d.com', PEPPER))
  })

  // The pepper is what stops the table being reversed by hashing a list of
  // common addresses, so it must actually affect the digest.
  it('differs without the pepper', () => {
    expect(hashIdentifier('a@b.com', PEPPER)).not.toBe(hashIdentifier('a@b.com', ''))
  })

  it('differs under a different pepper', () => {
    expect(hashIdentifier('a@b.com', PEPPER)).not.toBe(hashIdentifier('a@b.com', 'other'))
  })

  // Phone numbers go through the same function; no separate normalisation.
  it('handles phone numbers', () => {
    expect(hashIdentifier(' +2349032395685 ', PEPPER)).toBe(
      hashIdentifier('+2349032395685', PEPPER),
    )
  })
})
