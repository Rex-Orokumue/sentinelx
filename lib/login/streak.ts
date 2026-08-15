const WAT_OFFSET_MS = 60 * 60 * 1000 // UTC+1, no DST

// YYYY-MM-DD calendar date in West Africa Time.
export function todayInWAT(now: Date): string {
  const wat = new Date(now.getTime() + WAT_OFFSET_MS)
  return wat.toISOString().slice(0, 10)
}

function daysBetween(a: string, b: string): number {
  const msPerDay = 24 * 60 * 60 * 1000
  return Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / msPerDay)
}

export interface NextLoginStateInput {
  lastLoginDate: string | null
  loginStreak: number
  now: Date
}

export interface NextLoginState {
  alreadyLoggedToday: boolean
  newStreak: number
  todayWAT: string
}

// design doc §3.7: no-op same day; +1 on a consecutive day; reset to 1 on a
// gap or a first-ever login.
export function nextLoginState({ lastLoginDate, loginStreak, now }: NextLoginStateInput): NextLoginState {
  const todayWAT = todayInWAT(now)
  if (lastLoginDate === todayWAT) {
    return { alreadyLoggedToday: true, newStreak: loginStreak, todayWAT }
  }
  const gap = lastLoginDate ? daysBetween(lastLoginDate, todayWAT) : null
  const newStreak = gap === 1 ? loginStreak + 1 : 1
  return { alreadyLoggedToday: false, newStreak, todayWAT }
}
