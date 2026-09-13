'use client'
import { useEffect, useRef, useState, useTransition } from 'react'
import { Reply, MoreVertical, Pencil, Trash2, Forward, Check, CheckCheck } from 'lucide-react'
import { formatRelativeTime } from '@/lib/format'
import { canEditOrUnsend, canForward } from '@/lib/messages/predicates'
import { unsendMessage } from '@/lib/messages/actions'
import { stickerById } from '@/lib/messages/stickers'
import type { ConversationMessage } from '@/lib/messages/query'
import { VoiceNoteBubble } from './VoiceNoteBubble'

// Swipe-right reveals a reply icon behind the bubble, matching WhatsApp's
// gesture. Desktop has no swipe — hovering reveals the same icon instead
// (see the `sm:opacity-0 sm:group-hover:opacity-100` pair below). No gesture
// library: a plain touch-delta drag, clamped to a max travel distance, with
// a threshold to trigger reply on release.
const SWIPE_REVEAL_PX = 56
const SWIPE_TRIGGER_PX = 36

export function MessageBubble({
  m,
  mine,
  onReply,
  onEdit,
  onForward,
}: {
  m: ConversationMessage
  mine: boolean
  onReply: (m: ConversationMessage) => void
  onEdit: (m: ConversationMessage) => void
  onForward: (m: ConversationMessage) => void
}) {
  const [dragX, setDragX] = useState(0)
  const draggingRef = useRef(false)
  const startXRef = useRef<number | null>(null)

  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  function onTouchStart(e: React.TouchEvent) {
    startXRef.current = e.touches[0].clientX
    draggingRef.current = true
  }
  function onTouchMove(e: React.TouchEvent) {
    if (!draggingRef.current || startXRef.current == null) return
    const dx = e.touches[0].clientX - startXRef.current
    setDragX(Math.max(0, Math.min(dx, SWIPE_REVEAL_PX)))
  }
  function onTouchEnd() {
    draggingRef.current = false
    startXRef.current = null
    if (dragX >= SWIPE_TRIGGER_PX) onReply(m)
    setDragX(0)
  }

  function handleUnsend() {
    setMenuOpen(false)
    if (!window.confirm('Unsend this message? This cannot be undone.')) return
    start(async () => {
      const res = await unsendMessage(m.id)
      if (res.error) setError(res.error)
    })
  }

  const editable = mine && !m.deletedAt && canEditOrUnsend(m.createdAt, new Date().toISOString())
  const removed = !!m.deletedAt
  const forwardable = canForward(m.deletedAt)
  const showMenu = editable || forwardable
  const isSticker = !!m.stickerId && !removed

  const ticks =
    mine && !removed ? (
      m.readAt ? (
        <CheckCheck className="h-3 w-3 text-sky-300" aria-label="Read" />
      ) : (
        <Check className="h-3 w-3" aria-label="Sent" />
      )
    ) : null

  return (
    <div
      className={`group relative flex ${mine ? 'justify-end' : 'justify-start'}`}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      style={{ transform: dragX ? `translateX(${dragX}px)` : undefined }}
    >
      {/* Reply reveal — visible while dragging (mobile) or on hover (desktop, no swipe). */}
      <button
        type="button"
        onClick={() => onReply(m)}
        aria-label="Reply"
        className={`absolute top-1/2 -translate-y-1/2 ${mine ? '-right-9' : '-left-9'} hidden h-7 w-7 items-center justify-center rounded-full text-sx-gray transition-opacity hover:text-white sm:flex sm:opacity-0 sm:group-hover:opacity-100`}
        style={dragX ? { opacity: dragX / SWIPE_REVEAL_PX } : undefined}
      >
        <Reply className="h-4 w-4" />
      </button>

      {isSticker ? (
        // Stickers float with no bubble background, WhatsApp/Telegram-style —
        // no forwarded tag or reply-quote here, that dressing only makes
        // sense on a bubble; the sticker itself is still forwardable/
        // reply-able via the menu/swipe like any other message.
        <div className={`flex max-w-[80%] flex-col ${mine ? 'items-end' : 'items-start'}`}>
          <span className="text-6xl leading-none">{stickerById(m.stickerId!)?.emoji ?? '🙂'}</span>
          <span className="mt-1 flex items-center gap-1 text-[10px] text-sx-gray">
            {formatRelativeTime(m.createdAt)}
            {ticks}
          </span>
        </div>
      ) : (
        <div className="relative max-w-[80%]">
          <div className={`overflow-hidden rounded-2xl text-sm ${mine ? 'bg-sx-purple text-white' : 'bg-sx-surface text-white'}`}>
            {m.forwarded && !removed && (
              <p className={`mx-2 mt-2 flex items-center gap-1 text-[10px] italic ${mine ? 'text-white/60' : 'text-sx-gray'}`}>
                <Forward className="h-3 w-3" /> Forwarded
              </p>
            )}

            {m.replyTo && (
              <div className={`mx-2 mt-2 rounded-lg border-l-2 ${mine ? 'border-white/40 bg-white/10' : 'border-sx-purple bg-black/20'} px-2 py-1 text-xs`}>
                <p className="font-semibold opacity-80">{m.replyTo.senderName}</p>
                <p className="truncate opacity-70">{m.replyTo.removed ? 'Original message was removed' : (m.replyTo.body ?? '📷 Photo')}</p>
              </div>
            )}

            {removed ? (
              <p className="px-3 py-2 italic text-white/50">Message removed</p>
            ) : (
              <>
                {m.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.imageUrl} alt="" className="max-h-72 w-full object-cover" />
                )}
                {m.audioUrl && <VoiceNoteBubble src={m.audioUrl} durationSeconds={m.audioDurationSeconds} mine={mine} />}
                {m.body && <p className="whitespace-pre-wrap break-words px-3 py-2">{m.body}</p>}
              </>
            )}

            <p className={`flex items-center gap-1 px-3 pb-1.5 text-[10px] ${mine ? 'text-white/60' : 'text-sx-gray'} ${m.body || removed ? '' : 'pt-1.5'}`}>
              {formatRelativeTime(m.createdAt)}
              {m.editedAt && !removed && <span>(edited)</span>}
              {ticks}
            </p>
          </div>
          {/* Bubble tail — a small triangular nub on the outer bottom corner,
              same colour as the bubble it's attached to. Lives on this outer
              (non-clipping) wrapper, not the rounded/overflow-hidden div
              above, so it isn't clipped by that div's own rounded corners. */}
          <span
            aria-hidden
            className={`absolute bottom-0 h-3 w-3 ${mine ? '-right-1 bg-sx-purple' : '-left-1 bg-sx-surface'}`}
            style={{ clipPath: mine ? 'polygon(0 0, 0% 100%, 100% 100%)' : 'polygon(100% 0, 0% 100%, 100% 100%)' }}
          />
        </div>
      )}

      {showMenu && (
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Message options"
            className="flex h-7 w-7 shrink-0 items-center justify-center self-center text-sx-gray opacity-0 transition-opacity hover:text-white group-hover:opacity-100"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-8 z-20 w-36 overflow-hidden rounded-xl border border-sx-border bg-sx-surface py-1 shadow-xl">
              {editable && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false)
                      onEdit(m)
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-white hover:bg-white/5"
                  >
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </button>
                  <button
                    type="button"
                    onClick={handleUnsend}
                    disabled={pending}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-red-400 hover:bg-white/5"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Unsend
                  </button>
                </>
              )}
              {forwardable && (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false)
                    onForward(m)
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-white hover:bg-white/5"
                >
                  <Forward className="h-3.5 w-3.5" /> Forward
                </button>
              )}
            </div>
          )}
          {error && <p className="absolute right-0 top-9 z-20 w-40 text-[10px] text-red-400">{error}</p>}
        </div>
      )}
    </div>
  )
}
