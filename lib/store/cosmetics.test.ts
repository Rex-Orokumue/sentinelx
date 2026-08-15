import { describe, it, expect } from 'vitest'
import { equippedCosmeticsBySlug } from './cosmetics'

describe('equippedCosmeticsBySlug', () => {
  it('resolves one equipped item per category, ignoring unequipped ones', () => {
    const result = equippedCosmeticsBySlug([
      { item_id: 'a', equipped: true, store_items: { slug: 'avatar_border_gold_crown', category: 'avatar_border' } },
      { item_id: 'b', equipped: false, store_items: { slug: 'avatar_border_bronze', category: 'avatar_border' } },
      { item_id: 'c', equipped: true, store_items: { slug: 'theme_neon_grid', category: 'profile_theme' } },
      { item_id: 'd', equipped: true, store_items: { slug: 'username_gold', category: 'username_colour' } },
      { item_id: 'e', equipped: true, store_items: { slug: 'bubble_gold_mascot', category: 'bubble_skin' } },
    ])
    expect(result).toEqual({
      avatarBorder: 'avatar_border_gold_crown',
      profileTheme: 'theme_neon_grid',
      usernameColour: 'username_gold',
    })
  })

  it('returns all-null when nothing is equipped', () => {
    expect(equippedCosmeticsBySlug([])).toEqual({ avatarBorder: null, profileTheme: null, usernameColour: null })
  })

  it('handles the array-shaped store_items embed the same as the object-shaped one', () => {
    const result = equippedCosmeticsBySlug([
      { item_id: 'a', equipped: true, store_items: [{ slug: 'username_teal', category: 'username_colour' }] },
    ])
    expect(result.usernameColour).toBe('username_teal')
  })
})
