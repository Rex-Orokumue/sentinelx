'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { createPost } from '@/lib/community/actions'

export function PostComposer({ gameId }: { gameId: string }) {
  const router = useRouter()
  const [body, setBody] = useState('')
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    setError(null)
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      setUploading(false)
      setError('Please log in.')
      return
    }
    const ext = (file.name.split('.').pop() ?? 'jpg').replace(/[^a-z0-9]/gi, '')
    const path = `${user.id}/${crypto.randomUUID()}.${ext}`
    const { error: upErr } = await supabase.storage
      .from('community-images')
      .upload(path, file, { upsert: false })
    if (upErr) {
      setError('Image failed to upload. Please try again.')
      setUploading(false)
      return
    }
    const { data } = supabase.storage.from('community-images').getPublicUrl(path)
    setImageUrl(data.publicUrl)
    setUploading(false)
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    if (!body.trim()) {
      setError('Write something first')
      return
    }
    startTransition(async () => {
      const res = await createPost({ gameId, body, imageUrl: imageUrl ?? undefined })
      if (res.error) {
        setError(res.error)
        return
      }
      setBody('')
      setImageUrl(null)
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
      {imageUrl && (
        <div className="relative mt-2 inline-block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="" className="h-24 w-24 rounded-lg object-cover" />
          <button
            type="button"
            onClick={() => setImageUrl(null)}
            className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-slate-950 text-xs text-white"
            aria-label="Remove image"
          >
            ✕
          </button>
        </div>
      )}
      <div className="mt-3 flex items-center justify-between gap-3">
        <label className="cursor-pointer text-xs font-bold text-violet-400 hover:text-violet-300">
          {uploading ? 'Uploading…' : imageUrl ? 'Change image' : '+ Add image'}
          <input type="file" accept="image/*" onChange={onFile} className="hidden" disabled={uploading} />
        </label>
        <button
          type="submit"
          disabled={pending || uploading}
          className="rounded-lg bg-violet-600 px-5 py-2 text-xs font-bold text-white hover:bg-violet-500 disabled:opacity-50"
        >
          {pending ? 'Posting…' : 'Post'}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </form>
  )
}
