'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { markThreadRead } from '@/lib/messages/actions'
import { formatRelativeTime } from '@/lib/format'
import type { ThreadDetail, ConversationMessage } from '@/lib/messages/query'
import { MessageComposer } from './MessageComposer'

export function Conversation({ detail, viewerId }: { detail: ThreadDetail; viewerId: string }) {
  const router = useRouter()
  const [messages, setMessages] = useState<ConversationMessage[]>(detail.messages)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Realtime append. RLS scopes the stream; the filter is a second guard. The
  // payload has the storage PATH in image_url, not a signed URL — a message
  // with an image triggers a router.refresh() so the server re-signs it. Text
  // messages append optimistically from the payload; the id de-dupe guards
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
          { event: 'INSERT', schema: 'public', table: 'dm_messages', filter: `thread_id=eq.${detail.threadId}` },
          (payload) => {
            const r = payload.new as { id: string; sender_id: string; body: string | null; image_url: string | null; created_at: string; read_at: string | null }
            if (r.image_url) {
              router.refresh()
              if (r.sender_id !== viewerId) void markThreadRead(detail.threadId)
              return
            }
            setMessages((prev) =>
              prev.some((m) => m.id === r.id)
                ? prev
                : [...prev, { id: r.id, senderId: r.sender_id, body: r.body, imageUrl: null, createdAt: r.created_at, readAt: r.read_at }],
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
      <div className="space-y-2 px-4 py-4">
        {messages.length === 0 && <p className="py-8 text-center text-xs text-sx-gray">Say hello 👋</p>}
        {messages.map((m) => {
          const mine = m.senderId === viewerId
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] overflow-hidden rounded-2xl text-sm ${mine ? 'bg-sx-purple text-white' : 'bg-sx-surface text-white'}`}>
                {m.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.imageUrl} alt="" className="max-h-72 w-full object-cover" />
                )}
                {m.body && <p className="whitespace-pre-wrap break-words px-3 py-2">{m.body}</p>}
                <p className={`px-3 pb-1.5 text-[10px] ${mine ? 'text-white/60' : 'text-sx-gray'} ${m.body ? '' : 'pt-1.5'}`}>
                  {formatRelativeTime(m.createdAt)}
                </p>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>
      <MessageComposer threadId={detail.threadId} disabled={disabled} disabledReason={disabledReason} />
    </div>
  )
}
