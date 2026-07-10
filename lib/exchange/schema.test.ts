import { describe, it, expect } from 'vitest'
import { listingSchema } from './schema'

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
