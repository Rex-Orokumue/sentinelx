'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

// Multi-image upload to the community-images bucket, shared by the post and
// reply composers. Controlled: the parent owns the ordered URL list.
export function ImageUploader({
  images,
  onChange,
  max = 8,
}: {
  images: string[]
  onChange: (urls: string[]) => void
  max?: number
}) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length === 0) return
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
    const next = [...images]
    for (const file of files.slice(0, max - images.length)) {
      const ext = (file.name.split('.').pop() ?? 'jpg').replace(/[^a-z0-9]/gi, '')
      const path = `${user.id}/${crypto.randomUUID()}.${ext}`
      const { error: upErr } = await supabase.storage
        .from('community-images')
        .upload(path, file, { upsert: false })
      if (upErr) {
        setError('An image failed to upload. Please try again.')
        continue
      }
      const { data } = supabase.storage.from('community-images').getPublicUrl(path)
      next.push(data.publicUrl)
    }
    onChange(next)
    setUploading(false)
  }

  function remove(i: number) {
    onChange(images.filter((_, idx) => idx !== i))
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {images.map((url, i) => (
          <div key={url} className="relative h-20 w-20 overflow-hidden rounded-lg border border-slate-700">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="" className="h-full w-full object-cover" />
            <button
              type="button"
              onClick={() => remove(i)}
              aria-label="Remove image"
              className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-xs text-white"
            >
              ✕
            </button>
          </div>
        ))}
        {images.length < max && (
          <label className="flex h-20 w-20 cursor-pointer items-center justify-center rounded-lg border border-dashed border-slate-700 text-2xl text-slate-500 hover:border-slate-500">
            +
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={onFiles}
              className="hidden"
              disabled={uploading}
            />
          </label>
        )}
      </div>
      {uploading && <p className="text-xs text-slate-400">Uploading…</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}
