import Link from 'next/link'
import { ArrowRight, Flame } from 'lucide-react'
import { ListingCard, type ListingCardData } from './ListingCard'
import { EmptyState } from '@/components/shared/EmptyState'

export function FeaturedListings({ listings }: { listings: ListingCardData[] }) {
  return (
    <section id="featured-listings" className="scroll-mt-24">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-white">
          <Flame className="h-4 w-4 text-sx-amber" />
          Featured Listings
        </h2>
        <p className="text-[11px] text-sx-gray">Hot deals from verified sellers</p>
        <Link
          href="/exchange"
          className="ml-auto flex items-center gap-1 text-[11px] font-bold text-sx-purple-text hover:text-sx-purple-light"
        >
          View All Categories
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {listings.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            icon="🛒"
            title="Nothing listed yet"
            body="Be the first to list an item on the Gaming Exchange."
          />
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {listings.map((l) => (
            <ListingCard key={l.id} listing={l} />
          ))}
        </div>
      )}
    </section>
  )
}
