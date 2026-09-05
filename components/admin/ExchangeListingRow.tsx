'use client'
import { useFormState } from 'react-dom'
import {
  deleteListingAdmin,
  markListingSoldAdmin,
  setListingMerchandising,
  type ActionState,
} from '@/lib/exchange/admin-actions'
import { formatNaira } from '@/lib/format'
import { CATEGORY_LABELS, LISTING_BADGES, type ListingBadge, type ListingCategory } from '@/lib/exchange/schema'
import { BADGE_PRESENTATION } from '@/lib/exchange/badges'
import { WhatsAppChip } from '@/components/shared/WhatsAppChip'

export interface AdminListing {
  id: string
  title: string
  price: number
  category: ListingCategory
  status: 'pending' | 'active' | 'sold' | 'removed' | 'reserved'
  sellerName: string
  primaryImage: string | null
  whatsappUrl: string | null
  canDelete: boolean
  canMarkSold: boolean
  badge: ListingBadge | null
  originalPrice: number | null
}

const STATUS_CLS: Record<AdminListing['status'], string> = {
  pending: 'text-amber-400',
  active: 'text-emerald-400',
  sold: 'text-slate-400',
  removed: 'text-red-400',
  reserved: 'text-sky-400',
}

export function ExchangeListingRow({ listing }: { listing: AdminListing }) {
  const [deleteState, del] = useFormState<ActionState, FormData>(deleteListingAdmin, undefined)
  const [soldState, markSold] = useFormState<ActionState, FormData>(markListingSoldAdmin, undefined)
  const [merchState, saveMerch] = useFormState<ActionState, FormData>(setListingMerchandising, undefined)
  const err = deleteState?.error || soldState?.error || merchState?.error
  const showMarkSold = listing.status === 'active' || listing.status === 'reserved'

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
            {CATEGORY_LABELS[listing.category]} · {formatNaira(listing.price)} ·{' '}
            <span className={STATUS_CLS[listing.status]}>{listing.status}</span> · @{listing.sellerName}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {showMarkSold && (
          <form
            action={markSold}
            onSubmit={(e) => {
              if (!listing.canMarkSold) return
              if (!window.confirm(`Mark "${listing.title}" as sold? This is for sales completed off-platform.`)) {
                e.preventDefault()
              }
            }}
          >
            <input type="hidden" name="id" value={listing.id} />
            <button
              type="submit"
              disabled={!listing.canMarkSold}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
              title={listing.canMarkSold ? undefined : 'Blocked — an order is in progress on this listing.'}
            >
              Mark as sold
            </button>
          </form>
        )}
        <form
          action={del}
          onSubmit={(e) => {
            if (!listing.canDelete) return
            if (!window.confirm(`Permanently delete "${listing.title}"? This can't be undone.`)) {
              e.preventDefault()
            }
          }}
        >
          <input type="hidden" name="id" value={listing.id} />
          <button
            type="submit"
            disabled={!listing.canDelete}
            className="rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
            title={listing.canDelete ? undefined : 'Blocked — this listing has order history.'}
          >
            Delete
          </button>
        </form>
        <WhatsAppChip name={`Message @${listing.sellerName}`} url={listing.whatsappUrl} />
      </div>

      {/* Merchandising: the promo badge and the was-price behind the discount pill. */}
      <form action={saveMerch} className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-800 pt-3">
        <input type="hidden" name="id" value={listing.id} />
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-slate-400">Badge</span>
          <select
            name="badge"
            defaultValue={listing.badge ?? ''}
            className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white focus:border-violet-500 focus:outline-none"
          >
            <option value="">None</option>
            {LISTING_BADGES.map((b) => (
              <option key={b} value={b}>{BADGE_PRESENTATION[b].label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-slate-400">Original price (₦)</span>
          <input
            name="originalPrice"
            type="number"
            defaultValue={listing.originalPrice ?? ''}
            placeholder="—"
            className="w-32 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
          />
        </label>
        <button
          type="submit"
          className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-bold text-slate-200 hover:border-slate-500"
        >
          Save
        </button>
        {merchState?.success && <span className="text-xs text-emerald-400">Saved</span>}
      </form>

      {err && <p className="mt-2 text-xs text-red-400">{err}</p>}
    </div>
  )
}
