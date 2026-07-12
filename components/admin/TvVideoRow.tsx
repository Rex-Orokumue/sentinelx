'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { toggleVideoActive, deleteVideo, type TvVideoState } from '@/lib/tv/admin-actions'
import { CATEGORY_LABELS, type TvCategory } from '@/lib/tv/schema'
import { TvVideoForm } from '@/components/admin/TvVideoForm'

export interface AdminTvVideo {
  id: string
  title: string
  category: TvCategory
  youtubeUrl: string
  description: string | null
  active: boolean
}

export function TvVideoRow({ video }: { video: AdminTvVideo }) {
  const [editing, setEditing] = useState(false)
  const [toggleState, toggleAction] = useFormState<TvVideoState, FormData>(toggleVideoActive, undefined)
  const [deleteState, deleteAction] = useFormState<TvVideoState, FormData>(deleteVideo, undefined)

  if (editing) {
    return (
      <div className="space-y-2">
        <TvVideoForm
          defaults={{
            id: video.id,
            title: video.title,
            category: video.category,
            youtubeUrl: video.youtubeUrl,
            description: video.description ?? '',
          }}
          onDone={() => setEditing(false)}
        />
        <button type="button" onClick={() => setEditing(false)} className="text-xs text-slate-400 hover:text-white">
          Cancel edit
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="truncate font-bold text-white">
          {video.title}
          {!video.active && <span className="ml-2 text-[11px] font-semibold text-slate-500">(hidden)</span>}
        </p>
        <p className="text-xs text-slate-500">{CATEGORY_LABELS[video.category]}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-200 hover:border-slate-500"
        >
          Edit
        </button>
        <form action={toggleAction}>
          <input type="hidden" name="id" value={video.id} />
          <input type="hidden" name="active" value={String(video.active)} />
          <button
            type="submit"
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-200 hover:border-slate-500"
          >
            {video.active ? 'Hide' : 'Unhide'}
          </button>
        </form>
        <form action={deleteAction}>
          <input type="hidden" name="id" value={video.id} />
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
