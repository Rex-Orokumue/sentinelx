import { fromDateLocal } from '@/lib/format'

const TZ = 'Africa/Lagos'

// WAT calendar date ("YYYY-MM-DD") a UTC instant falls on.
function watDateOf(iso: string): string {
  return new Date(iso).toLocaleDateString('sv-SE', { timeZone: TZ })
}

// True once the WAT calendar day scheduledAtISO falls on has fully elapsed —
// i.e. `now` is at or past the following midnight WAT. This is the "once
// it's 12AM the next day" no-show resolution deadline.
export function noShowDeadlinePassed(scheduledAtISO: string | null, now: Date): boolean {
  if (!scheduledAtISO) return false
  const day = watDateOf(scheduledAtISO)
  const dayStartUtc = fromDateLocal(day)
  if (!dayStartUtc) return false
  const deadline = new Date(dayStartUtc).getTime() + 86_400_000 // next WAT midnight
  return now.getTime() >= deadline
}
