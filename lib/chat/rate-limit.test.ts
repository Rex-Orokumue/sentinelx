import { describe, it, expect } from 'vitest'
import { isOverLimit, RATE_LIMIT_MAX_MESSAGES } from './rate-limit'

describe('isOverLimit', () => {
  it('is false under the limit', () => {
    expect(isOverLimit(0)).toBe(false)
    expect(isOverLimit(RATE_LIMIT_MAX_MESSAGES - 1)).toBe(false)
  })

  it('is true at or over the limit', () => {
    expect(isOverLimit(RATE_LIMIT_MAX_MESSAGES)).toBe(true)
    expect(isOverLimit(RATE_LIMIT_MAX_MESSAGES + 5)).toBe(true)
  })

  it('respects a custom limit override', () => {
    expect(isOverLimit(3, 5)).toBe(false)
    expect(isOverLimit(5, 5)).toBe(true)
  })
})
