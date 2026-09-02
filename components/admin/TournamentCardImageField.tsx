'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resizeImageToMaxWidth } from '@/lib/media/resize-image'

// Upload control for a tournament's card/hero image. Mirrors BannerForm's
// pattern: the file is uploaded to Storage on pick and only its public URL
// rides along in the form (hidden input), so the parent stays a plain
// <form action={serverAction}>. Leaving without saving can orphan an object
// in the bucket — acceptable for a staff-only form.
export function TournamentCardImageField({ initialUrl }: { initialUrl: string }) {
  const [imageUrl, setImageUrl] = useState(initialUrl)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const resized = await resizeImageToMaxWidth(file, 1280)
      const supabase = createClient()
      const path = `${crypto.randomUUID()}.jpg`
      const { error: upErr } = await supabase.storage
        .from('tournament-images')
        .upload(path, resized, { upsert: false, contentType: 'image/jpeg' })
      if (upErr) throw upErr
      setImageUrl(supabase.storage.from('tournament-images').getPublicUrl(path).data.publicUrl)
    } catch {
      setError('Image failed to upload. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-slate-300">
        Card / hero image <span className="text-slate-500">(optional)</span>
      </label>
      <p className="text-xs text-slate-500">
        Shown on tournament cards and as the detail-page hero. If left blank, the game&apos;s
        artwork is used automatically.
      </p>
      {imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt=""
          className="mt-1 aspect-video max-h-44 w-full rounded-lg border border-slate-700 object-cover"
        />
      )}
      <div className="flex items-center gap-3">
        <input
          type="file"
          accept="image/*"
          onChange={onFile}
          disabled={uploading}
          className="block w-full text-xs text-slate-400 file:mr-3 file:rounded-lg file:border-0 file:bg-violet-600 file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-white hover:file:bg-violet-500"
        />
        {imageUrl && !uploading && (
          <button
            type="button"
            onClick={() => setImageUrl('')}
            className="shrink-0 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-300 hover:border-slate-500"
          >
            Remove
          </button>
        )}
      </div>
      {uploading && <span className="text-xs text-slate-400">Uploading…</span>}
      {error && <span className="text-xs text-red-400">{error}</span>}
      <input type="hidden" name="cardImageUrl" value={imageUrl} />
    </div>
  )
}
