'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { Avatar } from '@/components/shared/Avatar'
import { formatDateTime } from '@/lib/format'
import { deletePost, deleteReply, type DeleteState } from '@/lib/community/actions'
import { ReplyComposer } from './ReplyComposer'
import { ImageLightbox } from './ImageLightbox'

export interface ReplyView {
  id: string
  body: string
  imageUrls: string[]
  createdAt: string
  authorUsername: string | null
  authorDisplayName: string | null
  authorAvatarUrl: string | null
  canDelete: boolean
}

export interface PostView {
  id: string
  body: string
  imageUrls: string[]
  createdAt: string
  authorUsername: string | null
  authorDisplayName: string | null
  authorAvatarUrl: string | null
  canDelete: boolean
  replies: ReplyView[]
}

function ImageGrid({ urls, className = 'mt-3' }: { urls: string[]; className?: string }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  if (urls.length === 0) return null
  return (
    <>
      <div className={`flex flex-wrap gap-2 ${className}`}>
        {urls.map((url, i) => (
          <button
            key={url}
            type="button"
            onClick={() => setOpenIndex(i)}
            aria-label="View image"
            className="h-28 w-28 overflow-hidden rounded-lg sm:h-36 sm:w-36"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="" className="h-full w-full object-cover" />
          </button>
        ))}
      </div>
      {openIndex !== null && (
        <ImageLightbox
          urls={urls}
          index={openIndex}
          onClose={() => setOpenIndex(null)}
          onIndexChange={setOpenIndex}
        />
      )}
    </>
  )
}

export function PostCard({ post, canReply }: { post: PostView; canReply: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const [delState, delAction] = useFormState<DeleteState, FormData>(deletePost, undefined)
  const authorName = post.authorDisplayName ?? post.authorUsername ?? 'Player'

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <Avatar
            avatarUrl={post.authorAvatarUrl}
            displayName={post.authorDisplayName}
            username={post.authorUsername}
            size={32}
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-white">{authorName}</p>
            <p className="text-[11px] text-slate-500">{formatDateTime(post.createdAt)}</p>
          </div>
        </div>
        {post.canDelete && (
          <form action={delAction}>
            <input type="hidden" name="id" value={post.id} />
            <button type="submit" className="shrink-0 text-xs font-semibold text-red-400 hover:text-red-300">
              Delete
            </button>
          </form>
        )}
      </div>

      <p className="mt-3 whitespace-pre-line text-sm text-slate-200">{post.body}</p>
      <ImageGrid urls={post.imageUrls} />
      {delState?.error && <p className="mt-2 text-xs text-red-400">{delState.error}</p>}

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="mt-3 text-xs font-bold text-violet-400 hover:text-violet-300"
      >
        {post.replies.length === 0
          ? 'Reply'
          : `${expanded ? 'Hide' : 'Show'} ${post.replies.length} repl${post.replies.length === 1 ? 'y' : 'ies'}`}
      </button>

      {expanded && (
        <div className="mt-3 space-y-3 border-l-2 border-slate-800 pl-4">
          {post.replies.map((r) => (
            <ReplyRow key={r.id} reply={r} />
          ))}
        </div>
      )}
      {(expanded || post.replies.length === 0) && canReply && <ReplyComposer postId={post.id} />}
    </div>
  )
}

function ReplyRow({ reply }: { reply: ReplyView }) {
  const [delState, delAction] = useFormState<DeleteState, FormData>(deleteReply, undefined)
  const name = reply.authorDisplayName ?? reply.authorUsername ?? 'Player'
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-2">
        <Avatar
          avatarUrl={reply.authorAvatarUrl}
          displayName={reply.authorDisplayName}
          username={reply.authorUsername}
          size={22}
        />
        <div className="min-w-0">
          <p className="text-xs font-bold text-white">
            {name} <span className="font-normal text-slate-500">· {formatDateTime(reply.createdAt)}</span>
          </p>
          <p className="mt-0.5 whitespace-pre-line text-xs text-slate-300">{reply.body}</p>
          <ImageGrid urls={reply.imageUrls} className="mt-2" />
          {delState?.error && <p className="mt-1 text-[11px] text-red-400">{delState.error}</p>}
        </div>
      </div>
      {reply.canDelete && (
        <form action={delAction}>
          <input type="hidden" name="id" value={reply.id} />
          <button type="submit" className="shrink-0 text-[11px] font-semibold text-red-400 hover:text-red-300">
            Delete
          </button>
        </form>
      )}
    </div>
  )
}
