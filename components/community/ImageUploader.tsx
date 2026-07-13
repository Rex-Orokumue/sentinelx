'use client'
import { useState } from 'react'
import { ImagePlus } from 'lucide-react'
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
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((url, i) => (
            <div key={url} className="relative h-16 w-16 overflow-hidden rounded-lg border border-slate-700">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label="Remove image"
                className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/70 text-[10px] text-white"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <label
          className={`flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-800 hover:text-violet-400 ${
            uploading || images.length >= max ? 'pointer-events-none opacity-40' : 'cursor-pointer'
          }`}
        >
          <ImagePlus className="h-5 w-5" />
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={onFiles}
            className="hidden"
            disabled={uploading || images.length >= max}
          />
        </label>
        {uploading && <span className="text-xs text-slate-400">Uploading…</span>}
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
    </div>
  )
}
