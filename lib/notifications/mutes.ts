// Temporary notification mutes. See migration 082.
//
// Reactions push by default now, which is right but also the easiest way to
// make someone switch notifications off entirely — and then the channel is
// gone for the ones that matter, like a fixture assignment. A cheap mute is
// what keeps the important ones alive.

export type MuteDuration = '1h' | '1w' | 'always'

// Far future rather than a nullable column, so every mute — timed or
// permanent — goes through the same single comparison.
export const ALWAYS_MUTED_UNTIL = '9999-12-31T00:00:00.000Z'

export interface MuteRow {
  notification_type: string | null
  post_id: string | null
  muted_until: string
}

const HOUR_MS = 60 * 60 * 1000
const WEEK_MS = 7 * 24 * HOUR_MS

export function muteExpiryFor(duration: MuteDuration, now: Date): Date {
  if (duration === 'always') return new Date(ALWAYS_MUTED_UNTIL)
  return new Date(now.getTime() + (duration === '1h' ? HOUR_MS : WEEK_MS))
}

// Either scope silences: a muted type stops every notification of that kind,
// and a muted post stops everything about that thread whatever its type.
//
// `postId` is absent for notifications that have no post — a match
// assignment, a prize credit — and those can only ever be silenced by a type
// mute.
export function isMuted(
  mutes: MuteRow[],
  target: { type: string; postId?: string | null },
  now: Date,
): boolean {
  const nowMs = now.getTime()
  return mutes.some((m) => {
    // A lapsed mute is simply ignored; nothing has to clean it up for the
    // player's notifications to start again.
    if (new Date(m.muted_until).getTime() <= nowMs) return false
    if (m.notification_type != null) return m.notification_type === target.type
    if (m.post_id != null) return target.postId != null && m.post_id === target.postId
    return false
  })
}
