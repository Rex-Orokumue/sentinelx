import { describe, it, expect } from 'vitest'
import { BADGE_PRESENTATION, discountPercent, badgeSortWeight } from './badges'
import { LISTING_BADGES } from './schema'

describe('BADGE_PRESENTATION', () => {
  it('covers every badge the database allows', () => {
    for (const b of LISTING_BADGES) {
      expect(BADGE_PRESENTATION[b].label).toBeTruthy()
      expect(BADGE_PRESENTATION[b].className).toBeTruthy()
    }
  })

  it('uses the mockup labels', () => {
    expect(BADGE_PRESENTATION.featured.label).toBe('FEATURED')
    expect(BADGE_PRESENTATION.hot.label).toBe('HOT')
    expect(BADGE_PRESENTATION.top_deal.label).toBe('TOP DEAL')
    expect(BADGE_PRESENTATION.new.label).toBe('NEW')
  })
})

describe('discountPercent', () => {
  it('computes the mockup percentages', () => {
    expect(discountPercent(9000, 10000)).toBe(10)
    expect(discountPercent(39000, 42500)).toBe(8)
  })

  it('rounds to the nearest whole percent', () => {
    expect(discountPercent(6667, 10000)).toBe(33)
  })

  it('returns null when there is no original price', () => {
    expect(discountPercent(9000, null)).toBeNull()
  })

  it('returns null when the original price is not above the asking price', () => {
    expect(discountPercent(9000, 9000)).toBeNull()
    expect(discountPercent(9000, 8000)).toBeNull()
  })

  it('returns null rather than dividing by zero', () => {
    expect(discountPercent(0, 0)).toBeNull()
  })
})

describe('badgeSortWeight', () => {
  it('sorts featured listings ahead of everything else', () => {
    expect(badgeSortWeight('featured')).toBeLessThan(badgeSortWeight('hot'))
    expect(badgeSortWeight('hot')).toBeLessThan(badgeSortWeight(null))
    expect(badgeSortWeight(null)).toBeGreaterThan(badgeSortWeight('new'))
  })
})
