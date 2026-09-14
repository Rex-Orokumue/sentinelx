'use client'
import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { X, ImagePlus } from 'lucide-react'
import { HexAvatar } from '@/components/shared/HexAvatar'
import { createClient } from '@/lib/supabase/client'
import { createPost } from '@/lib/community/post-actions'
import { resizeImageToMaxWidth } from '@/lib/media/resize-image'
import { MAX_POST_IMAGES } from '@/lib/community/schema'
import type { MembershipTier } from '@/lib/membership/tiers'

const MAX_CHARS = 500

export interface ViewerProfile {
  avatarUrl: string | null
  username: string | null
  displayName: string | null
  membershipTier: string
  frameUrl?: string
}

// Bottom sheet on mobile, modal on desktop (spec §6). Images are only
// uploaded on submit, not on selection — avoids orphaning storage objects
// for a post the player never actually publishes. Up to MAX_POST_IMAGES
// files; clampImageUrls (lib/community/schema.ts) re-enforces the cap
// server-side so this client cap is a UX nicety, not the real gate.
export function PostComposer({ viewer, onClose }: { viewer: ViewerProfile; onClose: () => void }) {
  const router = useRouter()
  const [content, setContent] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
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

  // Object URLs are only ever derived from `files` — recompute and revoke the
  // previous batch whenever the file list changes, so nothing leaks.
  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f))
    setPreviews(urls)
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u))
    }
  }, [files])

  function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (picked.length === 0) return
    setFiles((prev) => [...prev, ...picked].slice(0, MAX_POST_IMAGES))
  }

  function removeImage(i: number) {
    setFiles((prev) => prev.filter((_, idx) => idx !== i))
  }

  const canPost = (content.trim().length > 0 || files.length > 0) && content.length <= MAX_CHARS

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canPost || pending) return
    setError(null)

    startTransition(async () => {
      const imageUrls: string[] = []
      if (files.length > 0) {
        const supabase = createClient()
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user) {
          setError('Please log in.')
          return
        }
        try {
          for (const file of files) {
            const resized = await resizeImageToMaxWidth(file, 800)
            const path = `${user.id}/${crypto.randomUUID()}.jpg`
            const { error: upErr } = await supabase.storage.from('community-images').upload(path, resized, { upsert: false, contentType: 'image/jpeg' })
            if (upErr) throw upErr
            imageUrls.push(supabase.storage.from('community-images').getPublicUrl(path).data.publicUrl)
          }
        } catch {
          setError('An image failed to upload. Please try again.')
          return
        }
      }

      const res = await createPost({ content, imageUrls })
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
            <HexAvatar src={viewer.avatarUrl} username={name} tier={viewer.membershipTier as MembershipTier} size="sm" frameUrl={viewer.frameUrl} />
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

          {previews.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-2">
              {previews.map((url, i) => (
                <div key={url} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" className="h-20 w-20 rounded-lg border border-sx-border object-cover" />
                  <button
                    type="button"
                    onClick={() => removeImage(i)}
                    aria-label="Remove image"
                    className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="mt-3 flex items-center justify-between gap-3">
            <label className="flex cursor-pointer items-center gap-1.5 text-xs font-bold text-sx-gray hover:text-sx-purple-text">
              <ImagePlus className="h-4 w-4" />
              {files.length > 0 ? `Add Screenshot (${files.length}/${MAX_POST_IMAGES})` : 'Add Screenshot'}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={onPickFiles}
                className="hidden"
                disabled={files.length >= MAX_POST_IMAGES}
              />
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
