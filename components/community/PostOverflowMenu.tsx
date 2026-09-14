'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { MoreHorizontal, Rocket, Trash2, BellOff, Bell } from 'lucide-react'
import { mutePost, unmutePost } from '@/lib/notifications/mute-actions'
import type { MuteDuration } from '@/lib/notifications/mutes'

const MUTE_OPTIONS: { value: MuteDuration; label: string }[] = [
  { value: '1h', label: 'For 1 hour' },
  { value: '1w', label: 'For 1 week' },
  { value: 'always', label: 'Always' },
]

// Facebook-style "···" trigger replacing the inline Boost/Delete/Mute text
// buttons that used to sit in the card header. Boost and Delete stay owned
// by the card (it holds the error banner + router.refresh for both); Mute
// is self-contained here exactly like the standalone MutePostButton it
// replaces (same actions, same options — see mute-actions.ts).
export function PostOverflowMenu({
  canBoost,
  canDelete,
  loggedIn,
  muted,
  pending,
  onBoost,
  onDelete,
  postId,
}: {
  canBoost: boolean
  canDelete: boolean
  loggedIn: boolean
  muted: boolean
  pending: boolean
  onBoost: () => void
  onDelete: () => void
  postId: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [muteExpanded, setMuteExpanded] = useState(false)
  const [mutePending, startMuteTransition] = useTransition()

  if (!canBoost && !canDelete && !loggedIn) return null

  function close() {
    setOpen(false)
    setMuteExpanded(false)
  }

  function applyMute(duration: MuteDuration) {
    startMuteTransition(async () => {
      const fd = new FormData()
      fd.set('postId', postId)
      fd.set('duration', duration)
      await mutePost(undefined, fd)
      close()
      router.refresh()
    })
  }

  function clearMute() {
    startMuteTransition(async () => {
      const fd = new FormData()
      fd.set('postId', postId)
      await unmutePost(undefined, fd)
      close()
      router.refresh()
    })
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Post options"
        className="flex h-7 w-7 items-center justify-center rounded-full text-sx-gray transition-colors hover:bg-white/5 hover:text-white"
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-xl border border-sx-border bg-sx-surface py-1 shadow-lg">
          {canBoost && (
            <button
              type="button"
              onClick={() => {
                close()
                onBoost()
              }}
              disabled={pending}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-amber-400 hover:bg-white/5 disabled:opacity-50"
            >
              <Rocket className="h-3.5 w-3.5 shrink-0" aria-hidden />
              Boost (200 coins)
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              onClick={() => {
                close()
                onDelete()
              }}
              disabled={pending}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-red-400 hover:bg-white/5 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
              Delete
            </button>
          )}
          {loggedIn && (muted ? (
            <button
              type="button"
              onClick={clearMute}
              disabled={mutePending}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-amber-400 hover:bg-white/5 disabled:opacity-50"
            >
              <Bell className="h-3.5 w-3.5 shrink-0" aria-hidden />
              Unmute
            </button>
          ) : muteExpanded ? (
            MUTE_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => applyMute(o.value)}
                disabled={mutePending}
                className="flex w-full items-center px-3 py-2 pl-8 text-left text-xs text-white hover:bg-white/5 disabled:opacity-50"
              >
                {o.label}
              </button>
            ))
          ) : (
            <button
              type="button"
              onClick={() => setMuteExpanded(true)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-sx-gray hover:bg-white/5"
            >
              <BellOff className="h-3.5 w-3.5 shrink-0" aria-hidden />
              Mute
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
