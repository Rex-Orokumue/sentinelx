import { describe, it, expect } from 'vitest'
import { frameUrlFor, AVATAR_BORDER_FRAMES } from './cosmetics'

describe('frameUrlFor', () => {
  it('resolves an equipped slug to its artwork', () => {
    expect(frameUrlFor('avatar_border_gold_crown')).toBe('/coin-items/gold-crown.webp')
  })

  it('returns undefined for a player with no frame equipped', () => {
    // null is what the column holds; undefined is what a query that forgot to
    // select it yields. Both mean "no frame", and HexAvatar takes undefined.
    expect(frameUrlFor(null)).toBeUndefined()
    expect(frameUrlFor(undefined)).toBeUndefined()
    expect(frameUrlFor('')).toBeUndefined()
  })

  it('returns undefined for a slug with no artwork yet', () => {
    // A store item can exist before its frame image ships. That must render a
    // plain avatar, not a broken image.
    expect(frameUrlFor('avatar_border_not_drawn_yet')).toBeUndefined()
  })

  it('has artwork for every frame slug in the catalogue map', () => {
    for (const [slug, url] of Object.entries(AVATAR_BORDER_FRAMES)) {
      expect(frameUrlFor(slug), slug).toBe(url)
    }
  })
})
