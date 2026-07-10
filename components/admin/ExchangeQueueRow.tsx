'use client'
import { useFormState } from 'react-dom'
import { approveListing, removeListingAdmin, type ActionState } from '@/lib/exchange/admin-actions'
import { formatNaira } from '@/lib/format'
import { CATEGORY_LABELS, type ListingCategory } from '@/lib/exchange/schema'

export interface PendingListing {
  id: string
  title: string
  price: number
  category: ListingCategory
  sellerName: string
  primaryImage: string | null
  imageCount: number
}

export function ExchangeQueueRow({ listing }: { listing: PendingListing }) {
  const [approveState, approve] = useFormState<ActionState, FormData>(approveListing, undefined)
  const [removeState, remove] = useFormState<ActionState, FormData>(removeListingAdmin, undefined)
  const err = approveState?.error || removeState?.error
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex gap-3">
        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-slate-950">
          {listing.primaryImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={listing.primaryImage} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xl text-slate-700">🎮</div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold text-white">{listing.title}</p>
          <p className="text-xs text-slate-500">
            {CATEGORY_LABELS[listing.category]} · {formatNaira(listing.price)} · {listing.imageCount} image(s) · @{listing.sellerName}
          </p>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <form action={approve}>
          <input type="hidden" name="id" value={listing.id} />
          <button type="submit" className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500">Approve</button>
        </form>
        <form action={remove}>
          <input type="hidden" name="id" value={listing.id} />
          <button type="submit" className="rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white hover:bg-red-500">Remove</button>
        </form>
      </div>
      {err && <p className="mt-2 text-xs text-red-400">{err}</p>}
    </div>
  )
}
