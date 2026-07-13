'use client'
import { useFormState } from 'react-dom'
import { deletePost, type DeleteState } from '@/lib/community/actions'
import { formatDateTime } from '@/lib/format'

export interface AdminCommunityPost {
  id: string
  body: string
  imageUrl: string | null
  gameName: string
  authorUsername: string | null
  replyCount: number
  createdAt: string
}

export function AdminCommunityPostRow({ post }: { post: AdminCommunityPost }) {
  const [state, action] = useFormState<DeleteState, FormData>(deletePost, undefined)
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 gap-3">
        {post.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={post.imageUrl} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
        )}
        <div className="min-w-0">
          <p className="truncate text-sm text-slate-200">{post.body}</p>
          <p className="mt-1 text-xs text-slate-500">
            @{post.authorUsername ?? 'unknown'} · {post.gameName} · {post.replyCount} repl
            {post.replyCount === 1 ? 'y' : 'ies'} · {formatDateTime(post.createdAt)}
          </p>
          {state?.error && <p className="mt-1 text-xs text-red-400">{state.error}</p>}
        </div>
      </div>
      <form action={action}>
        <input type="hidden" name="id" value={post.id} />
        <button
          type="submit"
          className="shrink-0 rounded-lg border border-red-500/40 px-3 py-1.5 text-xs font-bold text-red-400 hover:bg-red-500/10"
        >
          Remove
        </button>
      </form>
    </div>
  )
}
