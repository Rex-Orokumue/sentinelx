import { describe, it, expect } from 'vitest'
import { latestPerListing, type OrderRow } from './orders'

function o(over: Partial<OrderRow> & { id: string; listingId: string }): OrderRow {
  return { title: 'Listing', amount: 1000, status: 'initiated', ...over }
}

describe('latestPerListing', () => {
  it('keeps only the first (newest) row per listing', () => {
    const rows = [
      o({ id: 'c', listingId: 'x', status: 'payment_held' }),
      o({ id: 'b', listingId: 'x', status: 'initiated' }),
      o({ id: 'a', listingId: 'x', status: 'initiated' }),
    ]
    expect(latestPerListing(rows).map((r) => r.id)).toEqual(['c'])
  })

  it('keeps one row per distinct listing', () => {
    const rows = [
      o({ id: '1', listingId: 'x' }),
      o({ id: '2', listingId: 'y' }),
      o({ id: '3', listingId: 'x' }),
    ]
    expect(latestPerListing(rows).map((r) => r.id)).toEqual(['1', '2'])
  })

  it('returns an empty array unchanged', () => {
    expect(latestPerListing([])).toEqual([])
  })

  it('preserves input order for the kept rows', () => {
    const rows = [o({ id: 'first', listingId: 'a' }), o({ id: 'second', listingId: 'b' })]
    expect(latestPerListing(rows).map((r) => r.id)).toEqual(['first', 'second'])
  })
})
