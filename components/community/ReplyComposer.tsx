'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createReply } from '@/lib/community/actions'
import { ImageUploader } from './ImageUploader'

export function ReplyComposer({ postId }: { postId: string }) {
  const router = useRouter()
  const [body, setBody] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    if (!body.trim()) {
      setError('Write something first')
      return
    }
    startTransition(async () => {
      const res = await createReply({ postId, body, imageUrls: images })
      if (res.error) {
        setError(res.error)
        return
      }
      setBody('')
      setImages([])
      router.refresh()
    })
  }

  return (
    <form onSubmit={onSubmit} className="mt-3 space-y-2">
      <div className="flex gap-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={1}
          maxLength={2000}
          placeholder="Write a reply…"
          className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={pending}
          className="shrink-0 rounded-lg bg-violet-600 px-4 py-2 text-xs font-bold text-white hover:bg-violet-500 disabled:opacity-60"
        >
          {pending ? '…' : 'Reply'}
        </button>
      </div>
      <ImageUploader images={images} onChange={setImages} />
      {error && <p className="text-xs text-red-400">{error}</p>}
    </form>
  )
}
