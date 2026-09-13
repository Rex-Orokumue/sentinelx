'use client'
import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { SendHorizonal, ImagePlus, X, Check, Smile, Mic } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { resizeImageToMaxWidth } from '@/lib/media/resize-image'
import { extensionForAudioMime } from '@/lib/media/audio-extension'
import { sendMessage, editMessage } from '@/lib/messages/actions'
import { messageBodySchema } from '@/lib/messages/schema'
import { STICKER_PACK, stickerById } from '@/lib/messages/stickers'
import { buildOptimisticMessage, buildReplyPreview, newLocalId, type DisplayMessage } from '@/lib/messages/optimistic'
import type { ConversationMessage } from '@/lib/messages/query'
import { VoiceNoteRecorder } from './VoiceNoteRecorder'

type ComposerMode = { type: 'reply' | 'edit'; target: ConversationMessage } | null

// The "Replying to" preview reads the target message directly (unlike
// MessageBubble's replyTo pointer, which the server already enriched via
// resolveReply) — so it needs its own sticker/audio fallback here, or a
// reply-to-a-sticker would misleadingly show "📷 Photo".
function replyPreviewText(target: ConversationMessage): string {
  if (target.body) return target.body
  if (target.stickerId) return `${stickerById(target.stickerId)?.emoji ?? '🙂'} Sticker`
  if (target.audioUrl) return '🎤 Voice note'
  return '📷 Photo'
}

export function MessageComposer({
  threadId,
  viewerId,
  otherName,
  disabled,
  disabledReason,
  mode,
  onClearMode,
  onAddPending,
  onUpdateLocal,
}: {
  threadId: string
  viewerId: string
  otherName: string
  disabled?: boolean
  disabledReason?: string
  mode: ComposerMode
  onClearMode: () => void
  onAddPending: (message: DisplayMessage) => void
  onUpdateLocal: (tempId: string, patch: Partial<DisplayMessage>) => void
}) {
  const router = useRouter()
  const [body, setBody] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const [stickerPickerOpen, setStickerPickerOpen] = useState(false)
  const [recording, setRecording] = useState(false)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const stickerPickerRef = useRef<HTMLDivElement>(null)

  // Entering edit mode prefills the current text; entering reply mode leaves
  // whatever the player was already typing untouched.
  useEffect(() => {
    if (mode?.type === 'edit') {
      setBody(mode.target.body ?? '')
      textRef.current?.focus()
    }
  }, [mode])

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (stickerPickerRef.current && !stickerPickerRef.current.contains(e.target as Node)) setStickerPickerOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

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

  function cancelMode() {
    onClearMode()
    if (mode?.type === 'edit') setBody('')
  }

  function replyToFor(activeMode: ComposerMode): DisplayMessage['replyTo'] {
    if (!activeMode || activeMode.type !== 'reply') return null
    return buildReplyPreview(activeMode.target, viewerId, otherName, replyPreviewText(activeMode.target))
  }

  const hasText = messageBodySchema.safeParse(body).success
  // Edit still gates on !pending — one message being edited at a time is the
  // right restriction. A regular send does not: body/file are cleared
  // synchronously below before the upload/insert ever starts, so there's
  // nothing to double-submit, and each send gets its own tempId — so the
  // composer must stay usable while an earlier send is still in flight
  // (that's the whole point of showing a pending clock instead of blocking).
  const ok = mode?.type === 'edit' ? hasText && !pending : hasText || file != null

  // Retries an already-visible message in place — WhatsApp-style: a failed
  // send stays as a bubble with a red retry mark rather than dumping the
  // text/attachment back into the composer to resend from scratch.
  function attemptTextOrImage(tempId: string, text: string, img: File | null, replyToId: string | undefined) {
    onUpdateLocal(tempId, { status: 'pending' })
    start(async () => {
      let imageUrl: string | undefined
      if (img) {
        const supabase = createClient()
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user) {
          onUpdateLocal(tempId, { status: 'failed', retry: () => attemptTextOrImage(tempId, text, img, replyToId) })
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
          onUpdateLocal(tempId, { status: 'failed', retry: () => attemptTextOrImage(tempId, text, img, replyToId) })
          return
        }
      }
      const res = await sendMessage({ threadId, body: text || undefined, imageUrl, replyToId })
      if (res.error) {
        onUpdateLocal(tempId, { status: 'failed', retry: () => attemptTextOrImage(tempId, text, img, replyToId) })
        return
      }
      // Swap in the real id so the realtime echo of this same insert
      // (Supabase broadcasts INSERTs back to the writer too) dedupes against
      // this entry instead of appearing as a second copy.
      onUpdateLocal(tempId, { id: res.messageId ?? tempId, status: 'sent' })
      router.refresh()
    })
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!ok) return
    setError(null)
    const text = body
    const img = file
    const activeMode = mode

    if (activeMode?.type === 'edit') {
      setBody('')
      start(async () => {
        const res = await editMessage({ messageId: activeMode.target.id, body: text })
        if (res.error) {
          setError(res.error)
          setBody(text)
          return
        }
        onClearMode()
        textRef.current?.focus()
      })
      return
    }

    setBody('')
    clearImage()
    if (activeMode?.type === 'reply') onClearMode()

    const tempId = newLocalId()
    const replyToId = activeMode?.type === 'reply' ? activeMode.target.id : undefined
    // A fresh object URL, independent of the composer's own `previewUrl`
    // (clearImage() above already revoked that one) — never explicitly
    // revoked afterwards. The window where it'd be safe to (once the real,
    // signed-URL version has replaced this entry) is exactly the window a
    // premature revoke would show a broken image in; the per-session leak
    // of a few object URLs is the cheaper side of that trade.
    const optimisticImageUrl = img ? URL.createObjectURL(img) : null
    onAddPending(
      buildOptimisticMessage({ id: tempId, viewerId, body: text || null, imageUrl: optimisticImageUrl, replyTo: replyToFor(activeMode) }),
    )
    attemptTextOrImage(tempId, text, img, replyToId)
    textRef.current?.focus()
  }

  function attemptSticker(tempId: string, stickerId: string, replyToId: string | undefined) {
    onUpdateLocal(tempId, { status: 'pending' })
    start(async () => {
      const res = await sendMessage({ threadId, stickerId, replyToId })
      if (res.error) {
        onUpdateLocal(tempId, { status: 'failed', retry: () => attemptSticker(tempId, stickerId, replyToId) })
        return
      }
      onUpdateLocal(tempId, { id: res.messageId ?? tempId, status: 'sent' })
      router.refresh()
    })
  }

  // Tapping a sticker sends it immediately — no separate "Send" step,
  // matching WhatsApp. Edit mode has no sticker equivalent, so the picker
  // button is hidden then (same guard as the image button below).
  function sendSticker(stickerId: string) {
    setStickerPickerOpen(false)
    const activeMode = mode?.type === 'reply' ? mode : null
    if (activeMode) onClearMode()
    const tempId = newLocalId()
    const replyToId = activeMode?.target.id
    onAddPending(buildOptimisticMessage({ id: tempId, viewerId, stickerId, replyTo: replyToFor(activeMode) }))
    attemptSticker(tempId, stickerId, replyToId)
  }

  function attemptVoiceNote(tempId: string, blob: Blob, durationSeconds: number, replyToId: string | undefined) {
    onUpdateLocal(tempId, { status: 'pending' })
    start(async () => {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        onUpdateLocal(tempId, { status: 'failed', retry: () => attemptVoiceNote(tempId, blob, durationSeconds, replyToId) })
        return
      }
      const ext = extensionForAudioMime(blob.type)
      const path = `${user.id}/${crypto.randomUUID()}.${ext}`
      const { error: upErr } = await supabase.storage
        .from('dm-audio')
        .upload(path, blob, { upsert: false, contentType: blob.type || 'audio/webm' })
      if (upErr) {
        onUpdateLocal(tempId, { status: 'failed', retry: () => attemptVoiceNote(tempId, blob, durationSeconds, replyToId) })
        return
      }
      const res = await sendMessage({ threadId, audioUrl: path, audioDurationSeconds: durationSeconds, replyToId })
      if (res.error) {
        onUpdateLocal(tempId, { status: 'failed', retry: () => attemptVoiceNote(tempId, blob, durationSeconds, replyToId) })
        return
      }
      onUpdateLocal(tempId, { id: res.messageId ?? tempId, status: 'sent' })
      router.refresh()
    })
  }

  // Fires only once the recorder's own review step confirms Send — the
  // bubble appears immediately, playable from the local blob, with the same
  // pending-clock-then-tick treatment as every other message type.
  function handleRecorded(blob: Blob, durationSeconds: number) {
    const activeMode = mode?.type === 'reply' ? mode : null
    if (activeMode) onClearMode()
    setRecording(false)
    const tempId = newLocalId()
    const replyToId = activeMode?.target.id
    const localAudioUrl = URL.createObjectURL(blob)
    onAddPending(
      buildOptimisticMessage({ id: tempId, viewerId, audioUrl: localAudioUrl, audioDurationSeconds: durationSeconds, replyTo: replyToFor(activeMode) }),
    )
    attemptVoiceNote(tempId, blob, durationSeconds, replyToId)
  }

  return (
    <form onSubmit={submit} className="sticky bottom-0 z-10 border-t border-sx-border bg-sx-surface px-3 py-2">
      {error && <p className="mb-1 text-xs text-red-400">{error}</p>}

      {mode && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-sx-border bg-sx-bg px-2 py-1.5 text-xs">
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-sx-purple-text">{mode.type === 'edit' ? 'Editing message' : 'Replying to'}</p>
            {mode.type === 'reply' && <p className="truncate text-sx-gray">{replyPreviewText(mode.target)}</p>}
          </div>
          <button type="button" onClick={cancelMode} aria-label="Cancel" className="shrink-0 text-sx-gray hover:text-white">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

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
      {recording ? (
        <VoiceNoteRecorder onSend={handleRecorded} onCancel={() => setRecording(false)} />
      ) : (
        <div className="flex items-end gap-2">
          {mode?.type !== 'edit' && (
            <>
              <label className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-sx-gray hover:text-white">
                <ImagePlus className="h-5 w-5" />
                <input type="file" accept="image/*" onChange={pickFile} className="hidden" />
              </label>
              <div className="relative" ref={stickerPickerRef}>
                <button
                  type="button"
                  onClick={() => setStickerPickerOpen((o) => !o)}
                  aria-label="Send a sticker"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sx-gray hover:text-white"
                >
                  <Smile className="h-5 w-5" />
                </button>
                {stickerPickerOpen && (
                  <div className="absolute bottom-11 left-0 z-20 grid w-56 grid-cols-4 gap-1 rounded-xl border border-sx-border bg-sx-surface p-2 shadow-xl">
                    {STICKER_PACK.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => sendSticker(s.id)}
                        aria-label={s.label}
                        title={s.label}
                        className="flex h-11 w-11 items-center justify-center rounded-lg text-2xl hover:bg-white/5"
                      >
                        {s.emoji}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
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
          {/* Tap-to-record — no hold gesture, no drag-to-cancel: simpler and
              more reliable on mobile (see VoiceNoteRecorder). Hidden once
              there's text/an image to send, same slot the send button then
              takes over, matching WhatsApp's mic-becomes-send behaviour. */}
          {mode?.type !== 'edit' && !ok && (
            <button
              type="button"
              onClick={() => setRecording(true)}
              aria-label="Record a voice note"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sx-purple text-white hover:bg-sx-purple-light"
            >
              <Mic className="h-4 w-4" />
            </button>
          )}
          {(mode?.type === 'edit' || ok) && (
            <button
              type="submit"
              disabled={!ok}
              aria-label={mode?.type === 'edit' ? 'Save' : 'Send'}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sx-purple text-white hover:bg-sx-purple-light disabled:opacity-40"
            >
              {mode?.type === 'edit' ? <Check className="h-4 w-4" /> : <SendHorizonal className="h-4 w-4" />}
            </button>
          )}
        </div>
      )}
    </form>
  )
}
