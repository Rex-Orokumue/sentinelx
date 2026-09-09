'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { formatDateTime } from '@/lib/format'
import { adminDeleteStatus, type AdminActionState } from '@/lib/community/admin-actions'
import type { AdminStatusRow } from '@/lib/community/admin-query'

export function AdminStatusList({ statuses }: { statuses: AdminStatusRow[] }) {
  if (statuses.length === 0) {
    return (
      <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center text-sm text-slate-500">
        No live statuses.
      </p>
    )
  }
  return (
    <div className="space-y-2">
      {statuses.map((s) => (
        <AdminStatusRowItem key={s.id} status={s} />
      ))}
    </div>
  )
}

function AdminStatusRowItem({ status }: { status: AdminStatusRow }) {
  const [state, action] = useFormState<AdminActionState, FormData>(adminDeleteStatus, undefined)
  const [confirm, setConfirm] = useState(false)

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          {status.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={status.imageUrl} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
          )}
          <div className="min-w-0">
            <p className="text-[11px] text-slate-500">
              {status.authorUsername ?? 'Player'} · {formatDateTime(status.createdAt)} · 👁 {status.viewCount}
            </p>
            <p className="mt-1 line-clamp-2 text-sm text-slate-200">
              {status.caption ?? <span className="text-slate-500">(image only)</span>}
            </p>
          </div>
        </div>
        {!confirm ? (
          <button
            type="button"
            onClick={() => setConfirm(true)}
            className="shrink-0 text-xs font-semibold text-red-400 hover:text-red-300"
          >
            Delete
          </button>
        ) : (
          <form action={action} className="shrink-0">
            <input type="hidden" name="id" value={status.id} />
            <button type="submit" className="text-xs font-bold text-red-400 hover:text-red-300">
              Confirm
            </button>
          </form>
        )}
      </div>
      {state?.error && <p className="mt-1 text-[11px] text-red-400">{state.error}</p>}
    </div>
  )
}
