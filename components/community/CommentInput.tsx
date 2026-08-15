'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createComment } from '@/lib/community/comment-actions'

const MAX_CHARS = 280

export function CommentInput({ postId, loggedIn }: { postId: string; loggedIn: boolean }) {
  const router = useRouter()
  const [content, setContent] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (!loggedIn) {
    return (
      <a href="/login?next=/community" className="mt-4 block text-sm font-bold text-sx-purple-text hover:text-sx-purple-light">
        Log in to comment
      </a>
    )
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!content.trim() || pending) return
    setError(null)
    startTransition(async () => {
      const res = await createComment({ postId, content })
      if (res.error) {
        setError(res.error)
        return
      }
      setContent('')
      router.refresh()
    })
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 flex items-end gap-2 border-t border-sx-border pt-4">
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={1}
        maxLength={MAX_CHARS}
        placeholder="Write a comment…"
        className="min-w-0 flex-1 resize-none rounded-lg border border-sx-border bg-sx-bg px-3 py-2 text-sm text-sx-white placeholder:text-sx-gray focus:border-sx-purple focus:outline-none"
      />
      <button
        type="submit"
        disabled={pending || !content.trim()}
        className="shrink-0 rounded-lg bg-sx-purple px-4 py-2 text-xs font-bold text-white hover:bg-sx-purple-light disabled:opacity-50"
      >
        {pending ? '…' : 'Send'}
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </form>
  )
}
