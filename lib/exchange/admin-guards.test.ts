import { describe, it, expect } from 'vitest'
import { hasAnyOrder, hasInProgressOrder } from './admin-guards'

describe('hasAnyOrder', () => {
  it('returns false for no orders', () => {
    expect(hasAnyOrder([])).toBe(false)
  })
  it('returns true when any order exists, regardless of status', () => {
    expect(hasAnyOrder(['completed'])).toBe(true)
    expect(hasAnyOrder(['refunded'])).toBe(true)
  })
})

describe('hasInProgressOrder', () => {
  it('returns false for no orders', () => {
    expect(hasInProgressOrder([])).toBe(false)
  })
  it('returns false when all orders are terminal', () => {
    expect(hasInProgressOrder(['completed', 'refunded'])).toBe(false)
  })
  it('returns true when an order is initiated', () => {
    expect(hasInProgressOrder(['initiated'])).toBe(true)
  })
  it('returns true when an order has payment held', () => {
    expect(hasInProgressOrder(['completed', 'payment_held'])).toBe(true)
  })
})
