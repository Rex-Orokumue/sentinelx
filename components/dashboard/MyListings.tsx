'use client'
import { useFormState } from 'react-dom'
import { removeListing, type ActionState } from '@/lib/exchange/actions'
import { formatNaira } from '@/lib/format'

export interface MyListing {
  id: string
  title: string
  price: number
  status: string
}

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Pending review', cls: 'text-amber-400' },
  active: { label: 'Active', cls: 'text-emerald-400' },
  removed: { label: 'Removed', cls: 'text-slate-500' },
  sold: { label: 'Sold', cls: 'text-violet-400' },
}

export function MyListings({ listings }: { listings: MyListing[] }) {
  if (listings.length === 0) return null
  return (
    <section className="mb-10">
      <h2 className="mb-4 text-base font-bold text-white">My listings</h2>
      <div className="space-y-2">
        {listings.map((l) => (
          <Row key={l.id} listing={l} />
        ))}
      </div>
    </section>
  )
}

function Row({ listing }: { listing: MyListing }) {
  const [state, action] = useFormState<ActionState, FormData>(removeListing, undefined)
  const s = STATUS[listing.status] ?? { label: listing.status, cls: 'text-slate-400' }
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <div className="min-w-0">
        <p className="truncate font-bold text-white">{listing.title}</p>
        <p className="text-xs text-slate-500">
          {formatNaira(listing.price)} · <span className={s.cls}>{s.label}</span>
        </p>
      </div>
      {(listing.status === 'pending' || listing.status === 'active') && (
        <form action={action} className="shrink-0">
          <input type="hidden" name="id" value={listing.id} />
          <button type="submit" className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-200 hover:border-slate-500">
            Remove
          </button>
          {state?.error && <span className="ml-2 text-xs text-red-400">{state.error}</span>}
        </form>
      )}
    </div>
  )
}
