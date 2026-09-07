'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { BellOff } from 'lucide-react'
import { mutePost, unmutePost } from '@/lib/notifications/mute-actions'
import type { MuteDuration } from '@/lib/notifications/mutes'

const OPTIONS: { value: MuteDuration; label: string }[] = [
  { value: '1h', label: 'For 1 hour' },
  { value: '1w', label: 'For 1 week' },
  { value: 'always', label: 'Always' },
]

// Mutes every notification about one thread — comments and reactions alike.
// Sits on the post itself because that is where the noise is: asking someone
// to go to Settings to silence the post currently buzzing their phone is how
// they end up switching notifications off entirely instead.
//
// Only silences push. The bell still records everything, because muting means
// "stop interrupting me", not "hide this from me".
export function MutePostButton({ postId, muted }: { postId: string; muted: boolean }) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function apply(duration: MuteDuration) {
    startTransition(async () => {
      const fd = new FormData()
      fd.set('postId', postId)
      fd.set('duration', duration)
      await mutePost(undefined, fd)
      setOpen(false)
      router.refresh()
    })
  }

  function clear() {
    startTransition(async () => {
      const fd = new FormData()
      fd.set('postId', postId)
      await unmutePost(undefined, fd)
      setOpen(false)
      router.refresh()
    })
  }

  if (muted) {
    return (
      <button
        type="button"
        onClick={clear}
        disabled={pending}
        className="flex items-center gap-1 text-xs font-semibold text-amber-400 hover:text-amber-300 disabled:opacity-50"
      >
        <BellOff className="h-3.5 w-3.5" aria-hidden />
        Muted · Unmute
      </button>
    )
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={pending}
        aria-expanded={open}
        className="flex items-center gap-1 text-xs font-semibold text-sx-gray hover:text-white disabled:opacity-50"
      >
        <BellOff className="h-3.5 w-3.5" aria-hidden />
        Mute
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-40 overflow-hidden rounded-xl border border-sx-border bg-sx-surface shadow-lg">
          {OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => apply(o.value)}
              disabled={pending}
              className="block w-full px-3 py-2 text-left text-xs text-white hover:bg-white/5 disabled:opacity-50"
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
