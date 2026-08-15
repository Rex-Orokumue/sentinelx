'use client'
import { useEffect, useState } from 'react'
import { formatCountdown } from '@/lib/dashboard/countdown'

// The only client component in the Dashboard overhaul (spec §4) — everything
// else stays server-rendered. Ticks every 30s; a full-minute countdown
// doesn't need finer granularity than that.
export function CountdownChip({ scheduledAt }: { scheduledAt: string }) {
  const [label, setLabel] = useState(() => formatCountdown(scheduledAt, new Date()))

  useEffect(() => {
    const tick = () => setLabel(formatCountdown(scheduledAt, new Date()))
    tick()
    const id = setInterval(tick, 30_000)
    return () => clearInterval(id)
  }, [scheduledAt])

  return <span className="text-xs font-bold uppercase tracking-wide text-sx-purple-text">{label}</span>
}
