import { describe, it, expect } from 'vitest'
import { bubbleSkinUrlFor, BUBBLE_SKIN_FRAMES } from './cosmetics'

describe('bubbleSkinUrlFor', () => {
  it('resolves an equipped slug to its artwork', () => {
    expect(bubbleSkinUrlFor('bubble_gold_mascot')).toBe('/coin-items/bubble-mascot-gold.webp')
  })

  it('returns undefined for a player with no bubble skin equipped', () => {
    // null is what the column holds; undefined is what a query that forgot to
    // select it yields. Both mean "default mascot", same contract as frameUrlFor.
    expect(bubbleSkinUrlFor(null)).toBeUndefined()
    expect(bubbleSkinUrlFor(undefined)).toBeUndefined()
    expect(bubbleSkinUrlFor('')).toBeUndefined()
  })

  it('returns undefined for a slug with no artwork yet', () => {
    expect(bubbleSkinUrlFor('bubble_not_drawn_yet')).toBeUndefined()
  })

  it('has artwork for every bubble skin slug in the catalogue map', () => {
    for (const [slug, url] of Object.entries(BUBBLE_SKIN_FRAMES)) {
      expect(bubbleSkinUrlFor(slug), slug).toBe(url)
    }
  })
})
