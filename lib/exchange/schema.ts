import { z } from 'zod'

export const LISTING_CATEGORIES = [
  'account', 'coins', 'accessories', 'gift_card', 'controller', 'phone',
] as const
export type ListingCategory = (typeof LISTING_CATEGORIES)[number]

export const CATEGORY_LABELS: Record<ListingCategory, string> = {
  account: 'Account',
  coins: 'Coins',
  accessories: 'Accessories',
  gift_card: 'Gift Card',
  controller: 'Controller',
  phone: 'Phone',
}

export const PRICE_FLOOR_NGN = 500

export const listingSchema = z.object({
  title: z.string().trim().min(1, 'Enter a title'),
  category: z.enum(LISTING_CATEGORIES),
  price: z.coerce.number().int().min(PRICE_FLOOR_NGN, `Price must be at least ₦${PRICE_FLOOR_NGN}`),
  gameId: z.union([z.literal(''), z.string().uuid()]).optional(),
  description: z.union([z.literal(''), z.string().trim()]).optional(),
})

export type ListingInput = z.infer<typeof listingSchema>
