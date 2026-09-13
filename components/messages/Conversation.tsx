'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { markThreadRead } from '@/lib/messages/actions'
import { resolveParticipantContent } from '@/lib/messages/predicates'
import { dayKeyWAT, formatDateDivider } from '@/lib/format'
import type { ThreadDetail, ConversationMessage, ThreadSummary } from '@/lib/messages/query'
import { MessageComposer } from './MessageComposer'
import { MessageBubble } from './MessageBubble'
import { ForwardSheet } from './ForwardSheet'

// A subtle crosshatch, WhatsApp-doodle-wallpaper-style — CSS only, no image
// asset, and not user-selectable/buyable (that's a future Store feature, not
// this pass). Layered over the existing sx-bg token so it works in both the
// current dark theme and any future light one without a separate asset.
const WALLPAPER_STYLE: React.CSSProperties = {
  backgroundImage:
    'repeating-linear-gradient(135deg, rgba(255,255,255,0.035) 0, rgba(255,255,255,0.035) 1px, transparent 1px, transparent 14px), ' +
    'repeating-linear-gradient(45deg, rgba(255,255,255,0.025) 0, rgba(255,255,255,0.025) 1px, transparent 1px, transparent 14px)',
}

export function Conversation({
  detail,
  viewerId,
  threads,
}: {
  detail: ThreadDetail
  viewerId: string
  threads: ThreadSummary[]
}) {
  const router = useRouter()
  const [messages, setMessages] = useState<ConversationMessage[]>(detail.messages)
  const [composerMode, setComposerMode] = useState<{ type: 'reply' | 'edit'; target: ConversationMessage } | null>(null)
  const [forwardTarget, setForwardTarget] = useState<ConversationMessage | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Realtime append. RLS scopes the stream; the filter is a second guard. The
  // payload has the storage PATH in image_url/audio_url, not a signed URL —
  // a message with an image or voice note triggers a router.refresh() so the
  // server re-signs it. Text and sticker messages (no server-only work
  // needed) append optimistically from the payload; the id de-dupe guards
  // against the refresh (or its own echo) double-rendering either kind.
  //
  // Supabase Realtime's socket can drop silently (no thrown error, no visible
  // symptom besides "new messages stop appearing") after a burst of unrelated
  // activity — e.g. block/unblock's two action+refresh round-trips in quick
  // succession. `.subscribe()`'s status callback reports CHANNEL_ERROR /
  // TIMED_OUT / CLOSED when that happens; without handling it the page is
  // stuck until a manual reload opens a fresh connection. Resubscribing after
  // a short backoff recovers without one.
  useEffect(() => {
    const supabase = createClient()
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let currentChannel: ReturnType<typeof supabase.channel> | null = null

    function subscribe() {
      currentChannel = supabase
        .channel(`dm:thread:${detail.threadId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'dm_messages', filter: `thread_id=eq.${detail.threadId}` },
          (payload) => {
            if (payload.eventType === 'UPDATE') {
              const r = payload.new as {
                id: string
                body: string | null
                image_url: string | null
                sticker_id: string | null
                audio_url: string | null
                edited_at: string | null
                deleted_at: string | null
              }
              const content = resolveParticipantContent({
                body: r.body,
                imageUrl: r.image_url,
                deletedAt: r.deleted_at,
                stickerId: r.sticker_id,
                audioUrl: r.audio_url,
              })
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === r.id
                    ? {
                        ...m,
                        body: content.body,
                        imageUrl: content.removed ? null : m.imageUrl,
                        stickerId: content.removed ? null : m.stickerId,
                        audioUrl: content.removed ? null : m.audioUrl,
                        editedAt: r.edited_at,
                        deletedAt: r.deleted_at,
                      }
                    : m,
                ),
              )
              return
            }
            // INSERT. An image/voice note needs a fresh signed URL and a
            // reply needs its target's content resolved — all server-only
            // work, so those cases refresh instead of appending the raw
            // payload. A plain text message or a sticker needs neither.
            const r = payload.new as {
              id: string
              sender_id: string
              body: string | null
              image_url: string | null
              sticker_id: string | null
              audio_url: string | null
              created_at: string
              read_at: string | null
              reply_to_id: string | null
              forwarded: boolean
            }
            if (r.image_url || r.audio_url || r.reply_to_id) {
              router.refresh()
              if (r.sender_id !== viewerId) void markThreadRead(detail.threadId)
              return
            }
            setMessages((prev) =>
              prev.some((m) => m.id === r.id)
                ? prev
                : [
                    ...prev,
                    {
                      id: r.id,
                      senderId: r.sender_id,
                      body: r.body,
                      imageUrl: null,
                      stickerId: r.sticker_id,
                      audioUrl: null,
                      audioDurationSeconds: null,
                      forwarded: r.forwarded,
                      createdAt: r.created_at,
                      readAt: r.read_at,
                      editedAt: null,
                      deletedAt: null,
                      replyTo: null,
                    },
                  ],
            )
            if (r.sender_id !== viewerId) void markThreadRead(detail.threadId)
          },
        )
        .subscribe((status) => {
          if (cancelled) return
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            if (currentChannel) supabase.removeChannel(currentChannel)
            retryTimer = setTimeout(subscribe, 2000)
          }
        })
    }
    subscribe()

    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
      if (currentChannel) supabase.removeChannel(currentChannel)
    }
  }, [detail.threadId, viewerId, router])

  useEffect(() => {
    setMessages(detail.messages)
  }, [detail.messages])

  useEffect(() => {
    void markThreadRead(detail.threadId)
  }, [detail.threadId, messages.length])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length])

  const disabled = detail.blockedByMe || detail.blockedByThem
  const disabledReason = detail.blockedByMe
    ? 'You blocked this player. Unblock from the menu to message them.'
    : detail.blockedByThem
      ? 'You can no longer message this player.'
      : undefined

  return (
    <div>
      <div className="space-y-2 px-4 py-4" style={WALLPAPER_STYLE}>
        {messages.length === 0 && <p className="py-8 text-center text-xs text-sx-gray">Say hello 👋</p>}
        {messages.map((m, i) => {
          const prev = messages[i - 1]
          const isNewDay = dayKeyWAT(m.createdAt) !== (prev ? dayKeyWAT(prev.createdAt) : null)
          return (
            <div key={m.id}>
              {isNewDay && (
                <div className="my-3 flex justify-center">
                  <span className="rounded-full bg-black/30 px-3 py-1 text-[11px] font-semibold text-sx-gray">
                    {formatDateDivider(m.createdAt)}
                  </span>
                </div>
              )}
              <MessageBubble
                m={m}
                mine={m.senderId === viewerId}
                onReply={(target) => setComposerMode({ type: 'reply', target })}
                onEdit={(target) => setComposerMode({ type: 'edit', target })}
                onForward={(target) => setForwardTarget(target)}
              />
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>
      <MessageComposer
        threadId={detail.threadId}
        disabled={disabled}
        disabledReason={disabledReason}
        mode={composerMode}
        onClearMode={() => setComposerMode(null)}
      />
      {forwardTarget && (
        <ForwardSheet messageId={forwardTarget.id} threads={threads} onClose={() => setForwardTarget(null)} />
      )}
    </div>
  )
}
