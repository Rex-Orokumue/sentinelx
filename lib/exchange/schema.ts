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

// Long-form labels for the /exchange category tiles. Deliberately separate from
// CATEGORY_LABELS, which stays short for filter chips, the sell form and admin —
// "Coins & Currency" would crowd a chip but reads right on a tile.
export const CATEGORY_TILE_LABELS: Record<ListingCategory, string> = {
  account: 'Game Accounts',
  coins: 'Coins & Currency',
  gift_card: 'Gift Cards',
  accessories: 'Accessories',
  phone: 'Gaming Phones',
  controller: 'Controllers',
}

// Promo badges shown on listing cards. Admin-set, never derived — the values
// mirror the marketplace_listings.badge CHECK constraint (migration 077).
export const LISTING_BADGES = ['featured', 'hot', 'top_deal', 'new'] as const
export type ListingBadge = (typeof LISTING_BADGES)[number]

export const SUBTITLE_MAX_LENGTH = 60

export const PRICE_FLOOR_NGN = 500

export const listingSchema = z
  .object({
    title: z.string().trim().min(1, 'Enter a title'),
    category: z.enum(LISTING_CATEGORIES),
    price: z.coerce.number().int().min(PRICE_FLOOR_NGN, `Price must be at least ₦${PRICE_FLOOR_NGN}`),
    gameId: z.union([z.literal(''), z.string().uuid()]).optional(),
    description: z.union([z.literal(''), z.string().trim()]).optional(),
    // One-line hook shown on the listing card. Capped to match the DB CHECK.
    subtitle: z
      .union([
        z.literal(''),
        z.string().trim().max(SUBTITLE_MAX_LENGTH, `Keep it under ${SUBTITLE_MAX_LENGTH} characters`),
      ])
      .optional(),
    // Was-price. Drives the strikethrough and the derived discount pill.
    originalPrice: z.union([z.literal(''), z.coerce.number().int().positive()]).optional(),
  })
  // Cross-field: a bare field rule can't see `price`. Mirrors the DB CHECK.
  .superRefine((v, ctx) => {
    if (typeof v.originalPrice === 'number' && v.originalPrice <= v.price) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['originalPrice'],
        message: 'Original price must be higher than the asking price',
      })
    }
  })

export type ListingInput = z.infer<typeof listingSchema>

export const BUY_REQUEST_BUDGET_FLOOR_NGN = 100

export const buyRequestSchema = z.object({
  title: z.string().trim().min(1, 'Enter a title'),
  category: z.enum(LISTING_CATEGORIES),
  gameId: z.union([z.literal(''), z.string().uuid()]).optional(),
  budget: z.coerce
    .number()
    .int()
    .min(BUY_REQUEST_BUDGET_FLOOR_NGN, `Budget must be at least ₦${BUY_REQUEST_BUDGET_FLOOR_NGN}`),
  description: z.union([z.literal(''), z.string().trim()]).optional(),
})

export type BuyRequestInput = z.infer<typeof buyRequestSchema>
