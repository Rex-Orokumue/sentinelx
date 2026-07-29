import { describe, it, expect } from 'vitest'
import { canCheckIn, checkInVerdict, soleAttendee } from './check-in'

const base = {
  isParticipant: true,
  dayReached: true,
  status: 'scheduled',
  alreadyCheckedIn: false,
}

describe('canCheckIn', () => {
  it('allows a participant on match day while the match is open', () => {
    expect(canCheckIn(base)).toBe(true)
    expect(canCheckIn({ ...base, status: 'live' })).toBe(true)
  })

  it('refuses a non-participant', () => {
    expect(canCheckIn({ ...base, isParticipant: false })).toBe(false)
  })

  it('refuses before the match day has arrived', () => {
    expect(canCheckIn({ ...base, dayReached: false })).toBe(false)
  })

  it('refuses once the match is resolved', () => {
    for (const status of ['completed', 'forfeited', 'cancelled', 'disputed', 'bye']) {
      expect(canCheckIn({ ...base, status })).toBe(false)
    }
  })

  it('refuses a second check-in', () => {
    expect(canCheckIn({ ...base, alreadyCheckedIn: true })).toBe(false)
  })
})

describe('checkInVerdict', () => {
  it('reads both, one, and neither', () => {
    expect(checkInVerdict({ playerACheckedIn: true, playerBCheckedIn: true })).toBe('both')
    expect(checkInVerdict({ playerACheckedIn: true, playerBCheckedIn: false })).toBe('one')
    expect(checkInVerdict({ playerACheckedIn: false, playerBCheckedIn: true })).toBe('one')
    expect(checkInVerdict({ playerACheckedIn: false, playerBCheckedIn: false })).toBe('none')
  })
})

describe('soleAttendee', () => {
  it('names the player who turned up alone', () => {
    expect(soleAttendee({ playerACheckedIn: true, playerBCheckedIn: false }, 'a', 'b')).toBe('a')
    expect(soleAttendee({ playerACheckedIn: false, playerBCheckedIn: true }, 'a', 'b')).toBe('b')
  })

  it('names nobody when both or neither turned up', () => {
    expect(soleAttendee({ playerACheckedIn: true, playerBCheckedIn: true }, 'a', 'b')).toBeNull()
    expect(soleAttendee({ playerACheckedIn: false, playerBCheckedIn: false }, 'a', 'b')).toBeNull()
  })
})
