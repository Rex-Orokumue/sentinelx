import { describe, it, expect } from 'vitest'
import { buildSellerWhatsAppUrl } from './admin-whatsapp'

const base = {
  sellerWhatsapp: '08012345678',
  sellerCountry: null as string | null,
  sellerName: 'Chidi',
  listingTitle: 'FC Mobile account',
  price: 15000,
}

describe('buildSellerWhatsAppUrl', () => {
  it('builds a wa.me link with the seller listing details', () => {
    const url = buildSellerWhatsAppUrl(base)!
    expect(url.startsWith('https://wa.me/2348012345678?text=')).toBe(true)
    const text = decodeURIComponent(url.split('?text=')[1])
    expect(text).toContain('Chidi')
    expect(text).toContain('FC Mobile account')
    expect(text).toContain('₦15,000')
  })

  it('parses against the seller own country', () => {
    const url = buildSellerWhatsAppUrl({ ...base, sellerWhatsapp: '0712345678', sellerCountry: 'Kenya' })!
    expect(url.startsWith('https://wa.me/254712345678?text=')).toBe(true)
  })

  it('returns null when the seller has no WhatsApp number', () => {
    expect(buildSellerWhatsAppUrl({ ...base, sellerWhatsapp: null })).toBeNull()
  })

  it('returns null when the number is unparseable', () => {
    expect(buildSellerWhatsAppUrl({ ...base, sellerWhatsapp: 'ask me on IG' })).toBeNull()
  })
})
