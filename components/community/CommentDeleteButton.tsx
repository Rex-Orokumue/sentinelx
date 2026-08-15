'use client'
import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { deleteComment } from '@/lib/community/comment-actions'

// Spec §7 — "long-press (mobile) or hover (desktop) shows Delete". A
// straightforward always-visible-on-hover button is the pragmatic reading of
// that on the web (hover already covers desktop; on touch devices the
// button is simply always visible, which is no worse than a hidden control
// that's hard to discover).
export function CommentDeleteButton({ commentId, postId }: { commentId: string; postId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const fd = new FormData()
          fd.set('id', commentId)
          fd.set('postId', postId)
          await deleteComment(undefined, fd)
          router.refresh()
        })
      }
      className="shrink-0 text-[11px] font-semibold text-red-400 opacity-0 hover:text-red-300 group-hover:opacity-100 disabled:opacity-50"
    >
      Delete
    </button>
  )
}
