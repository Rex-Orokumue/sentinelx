// A match is due for a ~1-hour reminder when it starts within the next 65 minutes.
// The cron runs every 15 min; the log dedupe means each match reminds exactly once.
const WINDOW_MINUTES = 65

export function isWithinReminderWindow(scheduledAtISO: string | null, now: Date): boolean {
  if (!scheduledAtISO) return false
  const t = new Date(scheduledAtISO).getTime()
  if (Number.isNaN(t)) return false
  const nowMs = now.getTime()
  return t > nowMs && t <= nowMs + WINDOW_MINUTES * 60_000
}
