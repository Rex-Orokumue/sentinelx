'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createPost } from '@/lib/community/actions'
import { ImageUploader } from './ImageUploader'

export function PostComposer({ gameId }: { gameId: string }) {
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
      const res = await createPost({ gameId, body, imageUrls: images })
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
    <form onSubmit={onSubmit} className="mb-6 rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        maxLength={2000}
        placeholder="Share something with the community…"
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
      />
      <div className="mt-2">
        <ImageUploader images={images} onChange={setImages} />
      </div>
      <div className="mt-3 flex items-center justify-end gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-violet-600 px-5 py-2 text-xs font-bold text-white hover:bg-violet-500 disabled:opacity-50"
        >
          {pending ? 'Posting…' : 'Post'}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </form>
  )
}
