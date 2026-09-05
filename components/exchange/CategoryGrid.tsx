import Link from 'next/link'
import { Coins, CreditCard, Gamepad, Gamepad2, Headphones, Smartphone } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { CATEGORY_TILE_LABELS, type ListingCategory } from '@/lib/exchange/schema'
import { formatListingCount } from '@/lib/exchange/stats'

// Tile order follows the mockup, left to right. Typed as a full Record so a new
// category fails to compile here rather than rendering a blank tile.
const CATEGORY_ICONS: Record<ListingCategory, LucideIcon> = {
  account: Gamepad2,
  coins: Coins,
  gift_card: CreditCard,
  accessories: Headphones,
  phone: Smartphone,
  controller: Gamepad,
}

const TILE_ORDER: ListingCategory[] = [
  'account',
  'coins',
  'gift_card',
  'accessories',
  'phone',
  'controller',
]

export function CategoryGrid({ counts }: { counts: Record<ListingCategory, number> }) {
  return (
    <section className="rounded-2xl border border-sx-border bg-sx-surface p-5">
      <h2 className="text-xs font-black uppercase tracking-wider text-white">Browse Categories</h2>

      {/* Scrolls horizontally on a phone rather than wrapping into a tall block. */}
      <div className="-mx-5 mt-4 flex snap-x gap-3 overflow-x-auto px-5 pb-1 lg:mx-0 lg:grid lg:grid-cols-6 lg:overflow-visible lg:px-0 lg:pb-0">
        {TILE_ORDER.map((category) => {
          const Icon = CATEGORY_ICONS[category]
          return (
            <Link
              key={category}
              href={`/exchange?category=${category}`}
              className="flex w-28 shrink-0 snap-start flex-col items-center gap-2 rounded-xl border border-sx-border bg-sx-bg px-2 py-4 text-center transition-colors hover:border-sx-purple/50 lg:w-auto"
            >
              <Icon className="h-6 w-6 text-sx-purple-text" />
              <span className="text-[11px] font-bold leading-tight text-white">
                {CATEGORY_TILE_LABELS[category]}
              </span>
              <span className="text-[10px] text-sx-gray">{formatListingCount(counts[category])}</span>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
