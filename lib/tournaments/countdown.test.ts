import { describe, it, expect } from 'vitest'
import { countdownTo } from './countdown'

describe('countdownTo', () => {
  it('breaks down a future deadline into days/hours/minutes/seconds', () => {
    const now = new Date('2026-07-12T00:00:00Z')
    const deadline = new Date('2026-07-14T03:04:05Z') // +2d 3h 4m 5s
    expect(countdownTo(deadline, now)).toEqual({ closed: false, days: 2, hours: 3, minutes: 4, seconds: 5 })
  })

  it('reports closed at the exact deadline', () => {
    const now = new Date('2026-07-12T00:00:00Z')
    expect(countdownTo(now, now)).toEqual({ closed: true, days: 0, hours: 0, minutes: 0, seconds: 0 })
  })

  it('reports closed after the deadline has passed', () => {
    const now = new Date('2026-07-12T00:00:00Z')
    const deadline = new Date('2026-07-11T00:00:00Z')
    expect(countdownTo(deadline, now)).toEqual({ closed: true, days: 0, hours: 0, minutes: 0, seconds: 0 })
  })

  it('rolls seconds correctly under a minute', () => {
    const now = new Date('2026-07-12T00:00:00Z')
    const deadline = new Date('2026-07-12T00:00:45Z')
    expect(countdownTo(deadline, now)).toEqual({ closed: false, days: 0, hours: 0, minutes: 0, seconds: 45 })
  })

  it('handles a deadline under an hour away', () => {
    const now = new Date('2026-07-12T00:00:00Z')
    const deadline = new Date('2026-07-12T00:42:30Z')
    expect(countdownTo(deadline, now)).toEqual({ closed: false, days: 0, hours: 0, minutes: 42, seconds: 30 })
  })
})
