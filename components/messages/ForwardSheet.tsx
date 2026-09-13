'use client'
import { useEffect, useState, useTransition } from 'react'
import { X, Check } from 'lucide-react'
import { Avatar } from '@/components/shared/Avatar'
import { forwardMessage } from '@/lib/messages/actions'
import type { ThreadSummary } from '@/lib/messages/query'

// Bottom sheet listing the viewer's existing conversations (reuses the same
// thread list already fetched for /messages — blocked pairs are already
// excluded there). Forwarding to someone not yet messaged isn't in this
// pass: go to their profile and hit Message first, same as starting any new
// conversation today. Same modal lifecycle as MobileNavSheet (Escape closes,
// body scroll locks).
export function ForwardSheet({
  messageId,
  threads,
  onClose,
}: {
  messageId: string
  threads: ThreadSummary[]
  onClose: () => void
}) {
  const [sentTo, setSentTo] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const [pendingThreadId, setPendingThreadId] = useState<string | null>(null)

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

  function forwardTo(threadId: string) {
    if (pending || sentTo.has(threadId)) return
    setError(null)
    setPendingThreadId(threadId)
    start(async () => {
      const res = await forwardMessage({ messageId, toThreadId: threadId })
      if (res.error) {
        setError(res.error)
        return
      }
      setSentTo((prev) => new Set(prev).add(threadId))
    })
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Forward message" className="fixed inset-0 z-[70] flex items-end justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} aria-hidden />
      <div
        className="relative flex max-h-[75vh] w-full max-w-2xl flex-col overflow-y-auto rounded-t-2xl border-t border-sx-border bg-sx-surface p-4"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1rem)' }}
      >
        <div className="mb-3 flex items-center justify-between">
          <span className="font-display text-base font-bold uppercase tracking-wide text-white">Forward to</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-white/80 transition hover:bg-white/10"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && <p className="mb-2 text-xs text-red-400">{error}</p>}

        {threads.length === 0 ? (
          <p className="py-6 text-center text-xs text-sx-gray">No conversations to forward to yet.</p>
        ) : (
          <div className="space-y-1">
            {threads.map((t) => {
              const sent = sentTo.has(t.threadId)
              return (
                <button
                  key={t.threadId}
                  type="button"
                  onClick={() => forwardTo(t.threadId)}
                  disabled={pending && pendingThreadId === t.threadId}
                  className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-white/5 disabled:opacity-60"
                >
                  <Avatar avatarUrl={t.otherAvatarUrl} displayName={t.otherName} username={t.otherUsername} size={40} />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-white">{t.otherName}</span>
                  {sent ? (
                    <span className="flex shrink-0 items-center gap-1 text-xs font-bold text-green-400">
                      <Check className="h-4 w-4" /> Sent
                    </span>
                  ) : (
                    pending && pendingThreadId === t.threadId && <span className="shrink-0 text-xs text-sx-gray">Sending…</span>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
