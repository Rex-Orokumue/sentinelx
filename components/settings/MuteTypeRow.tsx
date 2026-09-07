'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { muteType, unmuteType } from '@/lib/notifications/mute-actions'
import type { MuteDuration } from '@/lib/notifications/mutes'

const OPTIONS: { value: MuteDuration; label: string }[] = [
  { value: '1h', label: '1 hour' },
  { value: '1w', label: '1 week' },
  { value: 'always', label: 'Always' },
]

function formatUntil(iso: string): string {
  const d = new Date(iso)
  // "Always" is stored as a far-future timestamp; showing the year 9999 would
  // be nonsense, so it reads as what the player actually chose.
  if (d.getFullYear() > 3000) return 'Muted'
  return `Muted until ${d.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })}`
}

// One notification type, with a timed mute rather than only an on/off switch.
// A player who cannot quiet something for an hour tends to switch the whole
// category off instead — and never turns it back on.
export function MuteTypeRow({
  type,
  label,
  mutedUntil,
}: {
  type: string
  label: string
  mutedUntil: string | null
}) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function apply(duration: MuteDuration) {
    startTransition(async () => {
      const fd = new FormData()
      fd.set('type', type)
      fd.set('duration', duration)
      await muteType(undefined, fd)
      setOpen(false)
      router.refresh()
    })
  }

  function clear() {
    startTransition(async () => {
      const fd = new FormData()
      fd.set('type', type)
      await unmuteType(undefined, fd)
      router.refresh()
    })
  }

  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm text-white">{label}</p>
        {mutedUntil && <p className="text-[11px] text-amber-400">{formatUntil(mutedUntil)}</p>}
      </div>
      {mutedUntil ? (
        <button
          type="button"
          onClick={clear}
          disabled={pending}
          className="shrink-0 text-xs font-semibold text-sx-purple-text hover:text-sx-purple-light disabled:opacity-50"
        >
          Unmute
        </button>
      ) : (
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            disabled={pending}
            aria-expanded={open}
            className="text-xs font-semibold text-sx-gray hover:text-white disabled:opacity-50"
          >
            Mute ▾
          </button>
          {open && (
            <div className="absolute right-0 z-20 mt-1 w-32 overflow-hidden rounded-xl border border-sx-border bg-sx-bg shadow-lg">
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
      )}
    </div>
  )
}
