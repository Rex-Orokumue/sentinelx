'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { formatDateTime } from '@/lib/format'
import { togglePin, adminDeletePost, nominateBestPlay, type AdminActionState } from '@/lib/community/admin-actions'
import type { AdminPostRow as AdminPostRowData } from '@/lib/community/admin-query'

const TYPE_LABEL: Record<string, string> = {
  manual: 'Manual',
  match_result: 'Match Result',
  achievement: 'Achievement',
  announcement: 'Announcement',
}

export function AdminPostRow({ post }: { post: AdminPostRowData }) {
  const [pinState, pinAction] = useFormState<AdminActionState, FormData>(togglePin, undefined)
  const [delState, delAction] = useFormState<AdminActionState, FormData>(adminDeletePost, undefined)
  const [nomState, nomAction] = useFormState<AdminActionState, FormData>(nominateBestPlay, undefined)
  const [showDelete, setShowDelete] = useState(false)

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px]">
            <span className="rounded-full bg-slate-800 px-2 py-0.5 font-bold text-slate-300">{TYPE_LABEL[post.postType] ?? post.postType}</span>
            {post.isPinned && <span className="rounded-full bg-violet-900/50 px-2 py-0.5 font-bold text-violet-300">📌 Pinned</span>}
            <span className="text-slate-500">{post.authorUsername ?? 'System'} · {formatDateTime(post.createdAt)}</span>
          </div>
          <p className="mt-1 line-clamp-2 text-sm text-slate-200">{post.content}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <form action={pinAction}>
            <input type="hidden" name="id" value={post.id} />
            <input type="hidden" name="pinned" value={(!post.isPinned).toString()} />
            <button type="submit" className="text-xs font-semibold text-violet-400 hover:text-violet-300">
              {post.isPinned ? 'Unpin' : 'Pin'}
            </button>
          </form>
          {(post.postType === 'manual' || post.postType === 'match_result') && (
            <form action={nomAction}>
              <input type="hidden" name="postId" value={post.id} />
              <button type="submit" className="text-xs font-semibold text-amber-400 hover:text-amber-300">
                Nominate Best Play
              </button>
            </form>
          )}
          {!showDelete ? (
            <button type="button" onClick={() => setShowDelete(true)} className="text-xs font-semibold text-red-400 hover:text-red-300">
              Delete
            </button>
          ) : (
            <form action={delAction} className="flex items-center gap-1">
              <input type="hidden" name="id" value={post.id} />
              <input
                name="reason"
                placeholder="Reason (optional)"
                className="w-32 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-[11px] text-white placeholder:text-slate-600"
              />
              <button type="submit" className="text-xs font-bold text-red-400 hover:text-red-300">
                Confirm
              </button>
            </form>
          )}
        </div>
      </div>
      {pinState?.error && <p className="mt-1 text-[11px] text-red-400">{pinState.error}</p>}
      {delState?.error && <p className="mt-1 text-[11px] text-red-400">{delState.error}</p>}
      {nomState?.error && <p className="mt-1 text-[11px] text-red-400">{nomState.error}</p>}
    </div>
  )
}
