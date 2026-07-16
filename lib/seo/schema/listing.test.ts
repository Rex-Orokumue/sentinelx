import { describe, it, expect } from 'vitest'
import { buildListingJsonLd } from './listing'
import { SITE_URL, SITE_NAME } from '../site'

describe('buildListingJsonLd', () => {
  it('prices the offer in NGN and marks it in stock when active', () => {
    const result = buildListingJsonLd({
      id: 'listing-1',
      title: 'Maxed DLS Account',
      description: 'Level 99, all players unlocked.',
      price: 15000,
      image: 'https://example.com/listing.png',
      status: 'active',
    })
    expect(result.url).toBe(`${SITE_URL}/exchange/listing-1`)
    expect(result.offers).toMatchObject({ price: 15000, priceCurrency: 'NGN', availability: 'https://schema.org/InStock' })
    expect(result.seller).toEqual({ '@type': 'Organization', name: SITE_NAME, url: SITE_URL })
    expect(result.image).toBe('https://example.com/listing.png')
  })

  it('marks the offer sold out when the listing is no longer active', () => {
    const result = buildListingJsonLd({
      id: 'listing-2',
      title: 'Maxed DLS Account',
      description: null,
      price: 15000,
      image: null,
      status: 'sold',
    })
    expect(result.offers.availability).toBe('https://schema.org/SoldOut')
    expect(result).not.toHaveProperty('image')
    expect(result.description).toContain('Maxed DLS Account')
  })
})
