'use client'
import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { X, ImagePlus } from 'lucide-react'
import { HexAvatar } from '@/components/shared/HexAvatar'
import { createClient } from '@/lib/supabase/client'
import { createPost } from '@/lib/community/post-actions'
import { resizeImageToMaxWidth } from '@/lib/media/resize-image'
import type { MembershipTier } from '@/lib/membership/tiers'

const MAX_CHARS = 500

export interface ViewerProfile {
  avatarUrl: string | null
  username: string | null
  displayName: string | null
  membershipTier: string
}

// Bottom sheet on mobile, modal on desktop (spec §6). Image is only uploaded
// on submit, not on selection — avoids orphaning storage objects for a post
// the player never actually publishes.
export function PostComposer({ viewer, onClose }: { viewer: ViewerProfile; onClose: () => void }) {
  const router = useRouter()
  const [content, setContent] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const name = viewer.displayName ?? viewer.username ?? 'You'

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

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setFile(f)
    setPreviewUrl(URL.createObjectURL(f))
  }

  function removeImage() {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setFile(null)
    setPreviewUrl(null)
  }

  const canPost = (content.trim().length > 0 || file != null) && content.length <= MAX_CHARS

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canPost || pending) return
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
          const resized = await resizeImageToMaxWidth(file, 800)
          const path = `${user.id}/${crypto.randomUUID()}.jpg`
          const { error: upErr } = await supabase.storage.from('community-images').upload(path, resized, { upsert: false, contentType: 'image/jpeg' })
          if (upErr) throw upErr
          imageUrl = supabase.storage.from('community-images').getPublicUrl(path).data.publicUrl
        } catch {
          setError('An image failed to upload. Please try again.')
          return
        }
      }

      const res = await createPost({ content, imageUrl })
      if (res.error) {
        setError(res.error)
        return
      }
      router.refresh()
      onClose()
    })
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="New post" className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative w-full sm:max-w-lg sm:px-4">
        <form
          onSubmit={onSubmit}
          className="max-h-[85vh] overflow-y-auto rounded-t-2xl border border-sx-border bg-sx-surface p-4 sm:rounded-2xl"
        >
          <div className="flex items-center justify-between">
            <p className="text-sm font-black uppercase tracking-widest text-sx-white">New Post</p>
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-sx-gray hover:text-sx-white">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="mt-4 flex items-start gap-2.5">
            <HexAvatar src={viewer.avatarUrl} username={name} tier={viewer.membershipTier as MembershipTier} size="sm" />
            <div className="min-w-0 flex-1">
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={4}
                maxLength={MAX_CHARS}
                placeholder="What's happening in the SentinelX community?"
                className="w-full resize-none rounded-lg border border-sx-border bg-sx-bg px-3 py-2 text-sm text-sx-white placeholder:text-sx-gray focus:border-sx-purple focus:outline-none"
                autoFocus
              />
              <p className="mt-1 text-right text-[11px] text-sx-gray">
                {content.length} / {MAX_CHARS}
              </p>
            </div>
          </div>

          {previewUrl && (
            <div className="relative mt-1 inline-block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previewUrl} alt="" className="max-h-48 rounded-lg border border-sx-border object-cover" />
              <button
                type="button"
                onClick={removeImage}
                aria-label="Remove image"
                className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          <div className="mt-3 flex items-center justify-between gap-3">
            <label className="flex cursor-pointer items-center gap-1.5 text-xs font-bold text-sx-gray hover:text-sx-purple-text">
              <ImagePlus className="h-4 w-4" />
              Add Screenshot
              <input ref={fileInputRef} type="file" accept="image/*" onChange={onPickFile} className="hidden" disabled={!!file} />
            </label>
            <div className="flex items-center gap-2">
              <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-xs font-bold text-sx-gray hover:text-sx-white">
                Cancel
              </button>
              <button
                type="submit"
                disabled={!canPost || pending}
                className="rounded-lg bg-sx-purple px-5 py-2 text-xs font-bold text-white hover:bg-sx-purple-light disabled:opacity-50"
              >
                {pending ? 'Posting…' : 'Post'}
              </button>
            </div>
          </div>
          {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        </form>
      </div>
    </div>
  )
}
