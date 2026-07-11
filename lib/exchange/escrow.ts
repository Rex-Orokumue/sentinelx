import { timingSafeEqual } from 'crypto'

export const ESCROW_RETURN_URL = 'https://sentinelxesports.vercel.app/dashboard?tab=orders'

export type OrderStatus = 'initiated' | 'payment_held' | 'completed' | 'refunded'

export function toKobo(ngn: number): number {
  return Math.round(ngn * 100)
}

export function buildInitiatePayload(args: {
  listingId: string
  listingTitle: string
  buyerId: string
  sellerId: string
  priceNgn: number
}) {
  return {
    buyer_id: args.buyerId,
    seller_id: args.sellerId,
    listing_id: args.listingId,
    listing_title: args.listingTitle,
    amount: toKobo(args.priceNgn),
    return_url: ESCROW_RETURN_URL,
  }
}

// Zolarux event -> local order status + listing status.
const TRANSITIONS: Record<string, { orderStatus: OrderStatus; listingStatus: string }> = {
  payment_held: { orderStatus: 'payment_held', listingStatus: 'reserved' },
  delivery_confirmed: { orderStatus: 'completed', listingStatus: 'sold' },
  order_refunded: { orderStatus: 'refunded', listingStatus: 'active' },
}

export function transitionForEvent(
  event: string,
): { orderStatus: OrderStatus; listingStatus: string } | null {
  return TRANSITIONS[event] ?? null
}

export function validatePurchase(args: {
  userId: string | null
  listingStatus: string
  sellerId: string
}): string | null {
  if (!args.userId) return 'Please log in to buy.'
  if (args.userId === args.sellerId) return 'You cannot buy your own listing.'
  if (args.listingStatus !== 'active') return 'This listing is no longer available.'
  return null
}

export function bearerOk(header: string | null, secret: string | undefined): boolean {
  if (!header || !secret) return false
  const expected = `Bearer ${secret}`
  const a = Buffer.from(header)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
