import { describe, it, expect } from 'vitest'
import { mapOwnedItems } from './owned-items'

describe('mapOwnedItems', () => {
  it('flattens the store_items embed and sorts equipped items first', () => {
    const result = mapOwnedItems([
      {
        item_id: 'a',
        equipped: false,
        store_items: { slug: 'username_gold', name: 'Gold Username', category: 'username_colour', price_coins: 150, preview_url: null },
      },
      {
        item_id: 'b',
        equipped: true,
        store_items: { slug: 'avatar_border_bronze', name: 'Bronze Border', category: 'avatar_border', price_coins: 100, preview_url: 'https://x/y.png' },
      },
    ])
    expect(result).toEqual([
      { id: 'b', slug: 'avatar_border_bronze', name: 'Bronze Border', category: 'avatar_border', priceCoins: 100, previewUrl: 'https://x/y.png', equipped: true },
      { id: 'a', slug: 'username_gold', name: 'Gold Username', category: 'username_colour', priceCoins: 150, previewUrl: null, equipped: false },
    ])
  })

  it('breaks ties within the same equipped state by category then name', () => {
    const result = mapOwnedItems([
      { item_id: 'a', equipped: false, store_items: { slug: 'username_teal', name: 'Teal Username', category: 'username_colour', price_coins: 150, preview_url: null } },
      { item_id: 'b', equipped: false, store_items: { slug: 'avatar_border_bronze', name: 'Bronze Border', category: 'avatar_border', price_coins: 100, preview_url: null } },
      { item_id: 'c', equipped: false, store_items: { slug: 'username_gold', name: 'Gold Username', category: 'username_colour', price_coins: 150, preview_url: null } },
    ])
    expect(result.map((i) => i.id)).toEqual(['b', 'c', 'a'])
  })

  it('handles the array-shaped store_items embed the same as the object-shaped one', () => {
    const result = mapOwnedItems([
      { item_id: 'a', equipped: true, store_items: [{ slug: 'username_teal', name: 'Teal Username', category: 'username_colour', price_coins: 150, preview_url: null }] },
    ])
    expect(result[0]?.slug).toBe('username_teal')
  })

  it('drops a row with no resolvable store_items instead of crashing', () => {
    expect(mapOwnedItems([{ item_id: 'a', equipped: true, store_items: null }])).toEqual([])
  })

  it('returns an empty list for no owned items', () => {
    expect(mapOwnedItems([])).toEqual([])
  })
})
