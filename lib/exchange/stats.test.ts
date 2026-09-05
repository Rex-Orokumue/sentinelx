import { describe, it, expect } from 'vitest'
import { formatStatCount, formatPositiveFeedback, formatListingCount } from './stats'

describe('formatStatCount', () => {
  it('shows small numbers exactly, because early real numbers are small', () => {
    expect(formatStatCount(0)).toBe('0')
    expect(formatStatCount(12)).toBe('12')
    expect(formatStatCount(950)).toBe('950')
  })

  it('abbreviates with a + once the number is large', () => {
    expect(formatStatCount(1200)).toBe('1.2K+')
    expect(formatStatCount(50000)).toBe('50K+')
  })
})

describe('formatPositiveFeedback', () => {
  it('reports the completion rate to one decimal', () => {
    expect(formatPositiveFeedback(499, 1)).toBe('99.8%')
    expect(formatPositiveFeedback(3, 1)).toBe('75%')
  })

  it('shows an em dash rather than NaN or a misleading 100% with no orders', () => {
    expect(formatPositiveFeedback(0, 0)).toBe('—')
  })

  it('drops a trailing .0', () => {
    expect(formatPositiveFeedback(10, 0)).toBe('100%')
  })
})

describe('formatListingCount', () => {
  it('pluralises correctly and names the empty case', () => {
    expect(formatListingCount(0)).toBe('No listings yet')
    expect(formatListingCount(1)).toBe('1 Listing')
    expect(formatListingCount(2)).toBe('2 Listings')
  })

  it('abbreviates large counts like the mockup', () => {
    expect(formatListingCount(1200)).toBe('1.2K+ Listings')
  })
})
