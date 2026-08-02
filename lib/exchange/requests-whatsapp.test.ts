import { describe, it, expect } from 'vitest'
import { buildBuyerWhatsAppUrl } from './requests-whatsapp'

const base = {
  buyerWhatsapp: '08012345678',
  buyerCountry: null as string | null,
  buyerName: 'Chidi',
  requestTitle: 'FC Mobile account, high rated',
  budget: 15000,
}

describe('buildBuyerWhatsAppUrl', () => {
  it('builds a wa.me link with the buyer request details', () => {
    const url = buildBuyerWhatsAppUrl(base)!
    expect(url.startsWith('https://wa.me/2348012345678?text=')).toBe(true)
    const text = decodeURIComponent(url.split('?text=')[1])
    expect(text).toContain('Chidi')
    expect(text).toContain('FC Mobile account, high rated')
    expect(text).toContain('₦15,000')
  })

  it('parses against the buyer own country', () => {
    const url = buildBuyerWhatsAppUrl({ ...base, buyerWhatsapp: '0712345678', buyerCountry: 'Kenya' })!
    expect(url.startsWith('https://wa.me/254712345678?text=')).toBe(true)
  })

  it('returns null when the buyer has no WhatsApp number', () => {
    expect(buildBuyerWhatsAppUrl({ ...base, buyerWhatsapp: null })).toBeNull()
  })

  it('returns null when the number is unparseable', () => {
    expect(buildBuyerWhatsAppUrl({ ...base, buyerWhatsapp: 'ask me on IG' })).toBeNull()
  })
})
