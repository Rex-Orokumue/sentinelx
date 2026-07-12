import { describe, it, expect } from 'vitest'
import {
  toKobo,
  buildInitiatePayload,
  transitionForEvent,
  validatePurchase,
  bearerOk,
  buildZolaruxWhatsAppUrl,
  ZOLARUX_WHATSAPP_NUMBER,
  ESCROW_RETURN_URL,
} from './escrow'

describe('toKobo', () => {
  it('converts NGN to kobo', () => {
    expect(toKobo(500)).toBe(50000)
    expect(toKobo(1)).toBe(100)
  })
})

describe('buildInitiatePayload', () => {
  it('builds the Zolarux initiate body with kobo amount and return_url', () => {
    const body = buildInitiatePayload({
      listingId: 'l1',
      listingTitle: 'FC Mobile account',
      buyerId: 'b1',
      sellerId: 's1',
      priceNgn: 2500,
    })
    expect(body).toEqual({
      buyer_id: 'b1',
      seller_id: 's1',
      listing_id: 'l1',
      listing_title: 'FC Mobile account',
      amount: 250000,
      return_url: ESCROW_RETURN_URL,
    })
  })
})

describe('transitionForEvent', () => {
  it('maps payment_held to held order + reserved listing', () => {
    expect(transitionForEvent('payment_held')).toEqual({
      orderStatus: 'payment_held',
      listingStatus: 'reserved',
    })
  })
  it('maps delivery_confirmed to completed order + sold listing', () => {
    expect(transitionForEvent('delivery_confirmed')).toEqual({
      orderStatus: 'completed',
      listingStatus: 'sold',
    })
  })
  it('maps order_refunded to refunded order + active listing', () => {
    expect(transitionForEvent('order_refunded')).toEqual({
      orderStatus: 'refunded',
      listingStatus: 'active',
    })
  })
  it('returns null for an unknown event', () => {
    expect(transitionForEvent('nonsense')).toBeNull()
  })
})

describe('validatePurchase', () => {
  it('rejects a logged-out user', () => {
    expect(validatePurchase({ userId: null, listingStatus: 'active', sellerId: 's1' })).toMatch(/log in/i)
  })
  it('rejects buying your own listing', () => {
    expect(validatePurchase({ userId: 's1', listingStatus: 'active', sellerId: 's1' })).toMatch(/your own/i)
  })
  it('rejects a listing that is not active', () => {
    expect(validatePurchase({ userId: 'b1', listingStatus: 'reserved', sellerId: 's1' })).toMatch(/no longer available/i)
  })
  it('accepts a valid purchase', () => {
    expect(validatePurchase({ userId: 'b1', listingStatus: 'active', sellerId: 's1' })).toBeNull()
  })
})

describe('buildZolaruxWhatsAppUrl', () => {
  it('targets the Zolarux WhatsApp number in international format', () => {
    const url = buildZolaruxWhatsAppUrl({
      listingTitle: 'FC Mobile account',
      amountNgn: 2500,
      zolaruxOrderRef: 'zx_ref_1',
      buyerUsername: 'zee',
      status: 'payment_held',
    })
    expect(url.startsWith(`https://wa.me/${ZOLARUX_WHATSAPP_NUMBER}?text=`)).toBe(true)
    expect(ZOLARUX_WHATSAPP_NUMBER).toBe('2348120288390')
  })

  it('URL-encodes the message and includes the key order details', () => {
    const url = buildZolaruxWhatsAppUrl({
      listingTitle: 'FC Mobile account',
      amountNgn: 2500,
      zolaruxOrderRef: 'zx_ref_1',
      buyerUsername: 'zee',
      status: 'payment_held',
    })
    const decoded = decodeURIComponent(url.split('?text=')[1])
    expect(decoded).toContain('FC Mobile account')
    expect(decoded).toContain('₦2,500')
    expect(decoded).toContain('zx_ref_1')
    expect(decoded).toContain('@zee')
    expect(decoded).toContain('payment_held')
  })

  it('falls back to "unknown" when the buyer has no username', () => {
    const url = buildZolaruxWhatsAppUrl({
      listingTitle: 'FC Mobile account',
      amountNgn: 2500,
      zolaruxOrderRef: 'zx_ref_1',
      buyerUsername: null,
      status: 'initiated',
    })
    expect(decodeURIComponent(url)).toContain('@unknown')
  })
})

describe('bearerOk', () => {
  it('accepts a matching bearer header', () => {
    expect(bearerOk('Bearer secret123', 'secret123')).toBe(true)
  })
  it('rejects a mismatched token', () => {
    expect(bearerOk('Bearer wrong', 'secret123')).toBe(false)
  })
  it('rejects a missing header', () => {
    expect(bearerOk(null, 'secret123')).toBe(false)
  })
  it('rejects when the secret is unset', () => {
    expect(bearerOk('Bearer secret123', undefined)).toBe(false)
  })
})
