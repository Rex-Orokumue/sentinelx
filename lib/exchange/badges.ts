import type { ListingBadge } from './schema'

export const BADGE_PRESENTATION: Record<ListingBadge, { label: string; className: string }> = {
  featured: { label: 'FEATURED', className: 'bg-sx-purple text-white' },
  hot: { label: 'HOT', className: 'bg-red-600 text-white' },
  top_deal: { label: 'TOP DEAL', className: 'bg-emerald-600 text-white' },
  new: { label: 'NEW', className: 'bg-sky-600 text-white' },
}

// The -10% / -8% pill. Derived arithmetic on the admin-entered was-price, not an
// editorial label, so unlike `badge` it needs no control of its own.
export function discountPercent(price: number, originalPrice: number | null): number | null {
  if (originalPrice === null || originalPrice <= price || originalPrice <= 0) return null
  return Math.round(((originalPrice - price) / originalPrice) * 100)
}

const WEIGHTS: Record<ListingBadge, number> = { featured: 0, hot: 1, top_deal: 2, new: 3 }

// Featured first, then the other badges, then unbadged listings.
export function badgeSortWeight(badge: ListingBadge | null): number {
  return badge === null ? 99 : WEIGHTS[badge]
}
