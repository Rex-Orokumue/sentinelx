import { describe, it, expect } from 'vitest'
import { validateGrantAmount } from './player-economy-validate'

describe('validateGrantAmount', () => {
  it('rejects a non-positive amount', () => {
    expect(validateGrantAmount(0)).toBe('Enter a whole amount greater than 0.')
    expect(validateGrantAmount(-5)).toBe('Enter a whole amount greater than 0.')
  })
  it('rejects a non-integer amount', () => {
    expect(validateGrantAmount(5.5)).toBe('Enter a whole amount greater than 0.')
  })
  it('accepts a positive integer', () => {
    expect(validateGrantAmount(100)).toBeNull()
  })
})
