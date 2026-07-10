import Link from 'next/link'
import { formatNaira } from '@/lib/format'
import { CATEGORY_LABELS, type ListingCategory } from '@/lib/exchange/schema'

export interface ListingCardData {
  id: string
  title: string
  price: number
  category: ListingCategory
  gameName: string | null
  primaryImage: string | null
}

export function ListingCard({ listing }: { listing: ListingCardData }) {
  return (
    <Link
      href={`/exchange/${listing.id}`}
      className="group block overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 transition-colors hover:border-violet-500/40"
    >
      <div className="relative aspect-square w-full bg-slate-950">
        {listing.primaryImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={listing.primaryImage} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-3xl text-slate-700">🎮</div>
        )}
        <span className="absolute left-2 top-2 rounded-full bg-slate-950/80 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-200">
          {CATEGORY_LABELS[listing.category]}
        </span>
      </div>
      <div className="p-3">
        <p className="truncate text-sm font-semibold text-white">{listing.title}</p>
        <p className="mt-0.5 font-black text-violet-400">{formatNaira(listing.price)}</p>
        {listing.gameName && <p className="truncate text-[11px] text-slate-500">{listing.gameName}</p>}
      </div>
    </Link>
  )
}
