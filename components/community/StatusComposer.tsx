'use client'
import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { X, ImagePlus } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { resizeImageToMaxWidth } from '@/lib/media/resize-image'
import { postStatus } from '@/lib/community/status-actions'
import { validateStatusInput } from '@/lib/community/status-schema'

const MAX_CHARS = 200

export function StatusComposer({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const [caption, setCaption] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onEsc)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onEsc)
      document.body.style.overflow = prev
    }
  }, [onClose])

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setFile(f)
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(URL.createObjectURL(f))
  }

  function removeImage() {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setFile(null)
    setPreviewUrl(null)
  }

  const canPost = validateStatusInput({ imageUrl: file ? 'pending' : null, caption }).ok && !pending

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canPost) return
    setError(null)

    startTransition(async () => {
      let imageUrl: string | null = null
      if (file) {
        const supabase = createClient()
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user) {
          setError('Please log in.')
          return
        }
        try {
          const resized = await resizeImageToMaxWidth(file, 1080)
          const path = `${user.id}/statuses/${crypto.randomUUID()}.jpg`
          const { error: upErr } = await supabase.storage
            .from('community-images')
            .upload(path, resized, { upsert: false, contentType: 'image/jpeg' })
          if (upErr) throw upErr
          imageUrl = supabase.storage.from('community-images').getPublicUrl(path).data.publicUrl
        } catch {
          setError('That image failed to upload. Please try again.')
          return
        }
      }

      const res = await postStatus({ imageUrl, caption })
      if (res.error) {
        setError(res.error)
        return
      }
      router.refresh()
      onClose()
    })
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="New status"
      className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center"
    >
      <div className="absolute inset-0 bg-black/80" onClick={onClose} />
      <div className="relative w-full sm:max-w-md sm:px-4">
        <form
          onSubmit={onSubmit}
          className="max-h-[90vh] overflow-y-auto rounded-t-2xl border border-sx-border bg-sx-surface p-4 sm:rounded-2xl"
        >
          <div className="flex items-center justify-between">
            <p className="text-sm font-black uppercase tracking-widest text-sx-white">New Status</p>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-lg p-1 text-sx-gray hover:text-sx-white"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <p className="mt-1 text-[11px] text-sx-gray">Disappears after 24 hours.</p>

          {previewUrl ? (
            <div className="relative mt-4 overflow-hidden rounded-xl border border-sx-border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previewUrl} alt="" className="max-h-[50vh] w-full bg-black object-contain" />
              <button
                type="button"
                onClick={removeImage}
                aria-label="Remove image"
                className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <label className="mt-4 flex h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-sx-border text-sx-gray hover:border-sx-purple/50 hover:text-sx-white">
              <ImagePlus className="h-6 w-6" />
              <span className="text-xs font-bold">Add a photo (optional)</span>
              <input ref={inputRef} type="file" accept="image/*" onChange={onPickFile} className="hidden" />
            </label>
          )}

          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            rows={2}
            maxLength={MAX_CHARS}
            placeholder="Say something…"
            className="mt-3 w-full resize-none rounded-lg border border-sx-border bg-sx-bg px-3 py-2 text-sm text-sx-white placeholder:text-sx-gray focus:border-sx-purple focus:outline-none"
          />
          <p className="mt-1 text-right text-[11px] text-sx-gray">
            {caption.length} / {MAX_CHARS}
          </p>

          {error && <p className="mt-1 text-xs text-red-400">{error}</p>}

          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-xs font-bold text-sx-gray hover:text-sx-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canPost}
              className="rounded-lg bg-sx-purple px-5 py-2 text-xs font-bold text-white hover:bg-sx-purple-light disabled:opacity-50"
            >
              {pending ? 'Sharing…' : 'Share status'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
