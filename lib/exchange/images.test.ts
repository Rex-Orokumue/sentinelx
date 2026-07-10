import { describe, it, expect } from 'vitest'
import { imageRequired, validateImageCount, primaryImageUrl } from './images'

describe('imageRequired', () => {
  it('requires images for account, controller, phone', () => {
    expect(imageRequired('account')).toBe(true)
    expect(imageRequired('controller')).toBe(true)
    expect(imageRequired('phone')).toBe(true)
  })
  it('does not require images for coins, accessories, gift_card', () => {
    expect(imageRequired('coins')).toBe(false)
    expect(imageRequired('accessories')).toBe(false)
    expect(imageRequired('gift_card')).toBe(false)
  })
})

describe('validateImageCount', () => {
  it('fails a required category with zero images', () => {
    expect(validateImageCount('account', 0)).toBe(false)
    expect(validateImageCount('account', 1)).toBe(true)
  })
  it('passes an optional category with zero images', () => {
    expect(validateImageCount('coins', 0)).toBe(true)
  })
})

describe('primaryImageUrl', () => {
  it('returns the lowest display_order image', () => {
    expect(primaryImageUrl([
      { image_url: 'b', display_order: 1 },
      { image_url: 'a', display_order: 0 },
    ])).toBe('a')
  })
  it('returns null for no images', () => {
    expect(primaryImageUrl([])).toBeNull()
  })
})
