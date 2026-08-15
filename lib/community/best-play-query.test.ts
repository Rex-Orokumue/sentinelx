import { describe, it, expect } from 'vitest'
import { isVotingWindowOpen } from './best-play-query'

describe('isVotingWindowOpen', () => {
  it('is closed before Friday 9am WAT', () => {
    expect(isVotingWindowOpen(new Date('2026-08-14T08:59:00+01:00'))).toBe(false) // Fri 8:59am
    expect(isVotingWindowOpen(new Date('2026-08-13T23:59:00+01:00'))).toBe(false) // Thu
  })

  it('is open from Friday 9am WAT through all of Saturday', () => {
    expect(isVotingWindowOpen(new Date('2026-08-14T09:00:00+01:00'))).toBe(true) // Fri 9:00am
    expect(isVotingWindowOpen(new Date('2026-08-14T23:59:00+01:00'))).toBe(true) // Fri late
    expect(isVotingWindowOpen(new Date('2026-08-15T12:00:00+01:00'))).toBe(true) // Sat noon
  })

  it('is open on Sunday until 9pm WAT, then closed', () => {
    expect(isVotingWindowOpen(new Date('2026-08-16T20:59:00+01:00'))).toBe(true) // Sun 8:59pm
    expect(isVotingWindowOpen(new Date('2026-08-16T21:00:00+01:00'))).toBe(false) // Sun 9:00pm
  })

  it('is closed Monday through Thursday', () => {
    expect(isVotingWindowOpen(new Date('2026-08-10T12:00:00+01:00'))).toBe(false) // Mon
    expect(isVotingWindowOpen(new Date('2026-08-12T12:00:00+01:00'))).toBe(false) // Wed
  })
})
