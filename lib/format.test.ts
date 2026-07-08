import { describe, it, expect } from 'vitest'
import { formatNaira } from './format'

describe('formatNaira', () => {
  it('prepends ₦ and groups thousands', () => {
    expect(formatNaira(1000)).toBe('₦1,000')
    expect(formatNaira(50000)).toBe('₦50,000')
    expect(formatNaira(0)).toBe('₦0')
  })
})
