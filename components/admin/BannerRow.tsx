'use client'
import { useFormState } from 'react-dom'
import { toggleBannerActive, deleteBanner, type BannerFormState } from '@/lib/banners/admin-actions'

export interface AdminBanner {
  id: string
  title: string
  imageUrl: string
  linkUrl: string
  active: boolean
}

export function BannerRow({ banner }: { banner: AdminBanner }) {
  const [toggleState, toggleAction] = useFormState<BannerFormState, FormData>(toggleBannerActive, undefined)
  const [deleteState, deleteAction] = useFormState<BannerFormState, FormData>(deleteBanner, undefined)

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={banner.imageUrl} alt="" className="h-12 w-20 shrink-0 rounded-lg border border-slate-700 object-cover" />
        <div className="min-w-0">
          <p className="truncate font-bold text-white">
            {banner.title}
            {!banner.active && <span className="ml-2 text-[11px] font-semibold text-slate-500">(hidden)</span>}
          </p>
          <p className="truncate text-xs text-slate-500">{banner.linkUrl}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <form action={toggleAction}>
          <input type="hidden" name="id" value={banner.id} />
          <input type="hidden" name="active" value={String(banner.active)} />
          <button
            type="submit"
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-200 hover:border-slate-500"
          >
            {banner.active ? 'Hide' : 'Unhide'}
          </button>
        </form>
        <form action={deleteAction}>
          <input type="hidden" name="id" value={banner.id} />
          <button
            type="submit"
            className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-500"
          >
            Delete
          </button>
        </form>
      </div>
      {(toggleState?.error || deleteState?.error) && (
        <span className="text-xs text-red-400">{toggleState?.error ?? deleteState?.error}</span>
      )}
    </div>
  )
}
