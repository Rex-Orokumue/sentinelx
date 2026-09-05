import Link from 'next/link'
import { BadgeCheck, ShoppingCart } from 'lucide-react'
import { formatNaira } from '@/lib/format'
import type { ListingBadge, ListingCategory } from '@/lib/exchange/schema'
import { BADGE_PRESENTATION, discountPercent } from '@/lib/exchange/badges'
import { resolveSpecLine } from '@/lib/exchange/subtitle'

export interface ListingCardData {
  id: string
  title: string
  price: number
  originalPrice: number | null
  category: ListingCategory
  badge: ListingBadge | null
  subtitle: string | null
  description: string | null
  gameName: string | null
  primaryImage: string | null
  sellerName: string | null
  sellerVerified: boolean
}

export function ListingCard({ listing }: { listing: ListingCardData }) {
  const specLine = resolveSpecLine({
    subtitle: listing.subtitle,
    description: listing.description,
    gameName: listing.gameName,
    category: listing.category,
  })
  const discount = discountPercent(listing.price, listing.originalPrice)
  const badge = listing.badge ? BADGE_PRESENTATION[listing.badge] : null

  return (
    <Link
      href={`/exchange/${listing.id}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-sx-border bg-sx-surface transition-colors hover:border-sx-purple/40"
    >
      <div className="relative aspect-square w-full bg-sx-bg">
        {listing.primaryImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={listing.primaryImage}
            alt={listing.title}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-3xl text-sx-border">🎮</div>
        )}

        {badge && (
          <span
            className={`absolute left-2 top-2 rounded-md px-2 py-0.5 text-[10px] font-black tracking-wide ${badge.className}`}
          >
            {badge.label}
          </span>
        )}

        {discount !== null && (
          <span className="absolute right-2 top-2 rounded-md bg-sx-green px-2 py-0.5 text-[10px] font-black text-white">
            -{discount}%
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1 p-3">
        <p className="truncate text-sm font-semibold text-white">{listing.title}</p>
        <p className="truncate text-[11px] text-sx-gray">{specLine}</p>

        {listing.sellerName && (
          <p className="flex items-center gap-1 truncate text-[11px] text-sx-gray">
            <span className="truncate">{listing.sellerName}</span>
            {listing.sellerVerified && (
              <BadgeCheck aria-label="Verified seller" className="h-3 w-3 shrink-0 text-sx-purple-text" />
            )}
          </p>
        )}

        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          <div className="min-w-0">
            <p className="truncate font-black text-sx-purple-text">{formatNaira(listing.price)}</p>
            {listing.originalPrice !== null && (
              <p className="truncate text-[11px] text-sx-gray line-through">
                {formatNaira(listing.originalPrice)}
              </p>
            )}
          </div>
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-sx-purple text-white transition-colors group-hover:bg-sx-purple-light">
            <ShoppingCart className="h-4 w-4" />
          </span>
        </div>
      </div>
    </Link>
  )
}
