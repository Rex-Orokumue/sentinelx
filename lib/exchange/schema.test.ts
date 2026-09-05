import { describe, it, expect } from 'vitest'
import {
  LISTING_CATEGORIES,
  CATEGORY_TILE_LABELS,
  LISTING_BADGES,
  listingSchema,
} from './schema'

const valid = { title: 'FC Mobile stacked account', category: 'account', price: 5000, gameId: undefined, description: '' }

describe('listingSchema', () => {
  it('accepts a valid listing', () => {
    expect(listingSchema.safeParse(valid).success).toBe(true)
  })
  it('rejects a price below the ₦500 floor', () => {
    expect(listingSchema.safeParse({ ...valid, price: 400 }).success).toBe(false)
  })
  it('rejects an unknown category', () => {
    expect(listingSchema.safeParse({ ...valid, category: 'nft' }).success).toBe(false)
  })
  it('rejects an empty title', () => {
    expect(listingSchema.safeParse({ ...valid, title: '  ' }).success).toBe(false)
  })
})

describe('CATEGORY_TILE_LABELS', () => {
  it('has a tile label for every category, so no tile renders undefined', () => {
    for (const c of LISTING_CATEGORIES) {
      expect(CATEGORY_TILE_LABELS[c]).toBeTruthy()
    }
  })

  it('uses the mockup wording', () => {
    expect(CATEGORY_TILE_LABELS.account).toBe('Game Accounts')
    expect(CATEGORY_TILE_LABELS.coins).toBe('Coins & Currency')
    expect(CATEGORY_TILE_LABELS.gift_card).toBe('Gift Cards')
    expect(CATEGORY_TILE_LABELS.phone).toBe('Gaming Phones')
  })
})

describe('LISTING_BADGES', () => {
  it('matches the badge values the database CHECK allows', () => {
    expect([...LISTING_BADGES]).toEqual(['featured', 'hot', 'top_deal', 'new'])
  })
})

describe('listingSchema merchandising fields', () => {
  const base = { title: 'DLS 24 Account', category: 'account', price: 2500 }

  it('accepts a listing with no subtitle or original price', () => {
    expect(listingSchema.safeParse(base).success).toBe(true)
  })

  it('accepts a subtitle at the 60-character cap', () => {
    const r = listingSchema.safeParse({ ...base, subtitle: 'x'.repeat(60) })
    expect(r.success).toBe(true)
  })

  it('rejects a subtitle over the cap the database enforces', () => {
    const r = listingSchema.safeParse({ ...base, subtitle: 'x'.repeat(61) })
    expect(r.success).toBe(false)
  })

  it('rejects an original price at or below the asking price', () => {
    expect(listingSchema.safeParse({ ...base, originalPrice: 2500 }).success).toBe(false)
    expect(listingSchema.safeParse({ ...base, originalPrice: 2000 }).success).toBe(false)
  })

  it('accepts an original price above the asking price', () => {
    expect(listingSchema.safeParse({ ...base, originalPrice: 3000 }).success).toBe(true)
  })
})
