import { formatDate } from '@/lib/format'

const TZ = 'Africa/Lagos'

function watDayKey(d: Date): string {
  return d.toLocaleDateString('sv-SE', { timeZone: TZ })
}
function watTimeLabel(d: Date): string {
  return d.toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true })
}

// Dashboard NextMatchCard's countdown chip text — spec §2 Section 2.
export function formatCountdown(scheduledAtIso: string, now: Date): string {
  const target = new Date(scheduledAtIso)
  const diffMs = target.getTime() - now.getTime()
  if (diffMs <= 0) return 'Starting soon'

  const diffMinutes = Math.floor(diffMs / 60_000)
  if (diffMinutes < 60) return `In ${diffMinutes}m`

  const diffHours = diffMinutes / 60
  if (diffHours < 6) {
    const h = Math.floor(diffHours)
    const m = diffMinutes % 60
    return m > 0 ? `In ${h}h ${m}m` : `In ${h}h`
  }

  const todayKey = watDayKey(now)
  const targetKey = watDayKey(target)
  const tomorrowKey = watDayKey(new Date(now.getTime() + 86_400_000))
  const timeLabel = watTimeLabel(target)

  if (targetKey === todayKey) return `Today ${timeLabel}`
  if (targetKey === tomorrowKey) return `Tomorrow ${timeLabel}`
  return formatDate(scheduledAtIso) ?? 'Upcoming'
}
