export interface CountdownParts {
  closed: boolean
  days: number
  hours: number
  minutes: number
  seconds: number
}

// Whole-unit breakdown of the time remaining until `deadline`, floored to zero
// once passed. `now` is injected for deterministic tests.
export function countdownTo(deadline: Date, now: Date): CountdownParts {
  const msRemaining = deadline.getTime() - now.getTime()
  if (msRemaining <= 0) return { closed: true, days: 0, hours: 0, minutes: 0, seconds: 0 }
  const totalSeconds = Math.floor(msRemaining / 1000)
  return {
    closed: false,
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  }
}
