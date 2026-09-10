'use client'
import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { SendHorizonal, ImagePlus, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { resizeImageToMaxWidth } from '@/lib/media/resize-image'
import { sendMessage } from '@/lib/messages/actions'
import { messageBodySchema } from '@/lib/messages/schema'

export function MessageComposer({ threadId, disabled, disabledReason }: { threadId: string; disabled?: boolean; disabledReason?: string }) {
  const router = useRouter()
  const [body, setBody] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const textRef = useRef<HTMLTextAreaElement>(null)

  if (disabled) {
    return (
      <div className="sticky bottom-0 z-10 border-t border-sx-border bg-sx-surface px-4 py-3 text-center text-xs text-sx-gray">
        {disabledReason ?? 'You cannot message this player.'}
      </div>
    )
  }

  function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setFile(f)
    setPreviewUrl(URL.createObjectURL(f))
  }
  function clearImage() {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setFile(null)
    setPreviewUrl(null)
  }

  const hasText = messageBodySchema.safeParse(body).success
  const ok = (hasText || file != null) && !pending

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!ok) return
    setError(null)
    const text = body
    const img = file
    setBody('')
    clearImage()

    start(async () => {
      let imageUrl: string | undefined
      if (img) {
        const supabase = createClient()
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user) {
          setError('Please log in.')
          return
        }
        try {
          const resized = await resizeImageToMaxWidth(img, 1280)
          const path = `${user.id}/${crypto.randomUUID()}.jpg`
          const { error: upErr } = await supabase.storage
            .from('dm-images')
            .upload(path, resized, { upsert: false, contentType: 'image/jpeg' })
          if (upErr) throw upErr
          imageUrl = path // store the PATH, not a URL
        } catch {
          setError('That image failed to upload. Please try again.')
          setBody(text)
          return
        }
      }
      const res = await sendMessage({ threadId, body: text || undefined, imageUrl })
      if (res.error) {
        setError(res.error)
        setBody(text)
        return
      }
      router.refresh()
      textRef.current?.focus()
    })
  }

  return (
    <form onSubmit={submit} className="sticky bottom-0 z-10 border-t border-sx-border bg-sx-surface px-3 py-2">
      {error && <p className="mb-1 text-xs text-red-400">{error}</p>}
      {previewUrl && (
        <div className="relative mb-2 inline-block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt="" className="max-h-32 rounded-lg border border-sx-border object-cover" />
          <button
            type="button"
            onClick={clearImage}
            aria-label="Remove image"
            className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <div className="flex items-end gap-2">
        <label className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-sx-gray hover:text-white">
          <ImagePlus className="h-5 w-5" />
          <input type="file" accept="image/*" onChange={pickFile} className="hidden" />
        </label>
        <textarea
          ref={textRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit(e as unknown as React.FormEvent)
            }
          }}
          rows={1}
          maxLength={2000}
          placeholder="Message…"
          className="max-h-32 min-h-[38px] flex-1 resize-none rounded-lg border border-sx-border bg-sx-bg px-3 py-2 text-sm text-white placeholder:text-sx-gray focus:border-sx-purple focus:outline-none"
        />
        <button
          type="submit"
          disabled={!ok}
          aria-label="Send"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sx-purple text-white hover:bg-sx-purple-light disabled:opacity-40"
        >
          <SendHorizonal className="h-4 w-4" />
        </button>
      </div>
    </form>
  )
}
