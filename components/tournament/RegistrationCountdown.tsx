'use client'
import { useEffect, useState } from 'react'
import { countdownTo } from '@/lib/tournaments/countdown'

export function RegistrationCountdown({ registrationEnd }: { registrationEnd: string | null }) {
  const [now, setNow] = useState<Date | null>(null)

  useEffect(() => {
    setNow(new Date())
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  // Server render (and the pre-mount client render) show nothing rather than a
  // guessed value — avoids a hydration mismatch between server and client clocks.
  if (!registrationEnd || !now) return null

  const parts = countdownTo(new Date(registrationEnd), now)
  if (parts.closed) {
    return <p className="mb-4 text-sm font-bold text-slate-400">Registration closed.</p>
  }
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    <p className="mb-4 text-sm font-bold text-violet-400">
      ⏳ Registration closes in {parts.days > 0 && `${parts.days}d `}
      {pad(parts.hours)}h {pad(parts.minutes)}m {pad(parts.seconds)}s
    </p>
  )
}
