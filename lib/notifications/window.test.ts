import { describe, it, expect } from 'vitest'
import { isWithinReminderWindow } from './window'

const now = new Date('2026-07-10T12:00:00Z')
const at = (min: number) => new Date(now.getTime() + min * 60_000).toISOString()

describe('isWithinReminderWindow', () => {
  it('is true for a match ~1 hour out', () => {
    expect(isWithinReminderWindow(at(60), now)).toBe(true)
  })
  it('is true at the window edge (65 min) and false beyond it', () => {
    expect(isWithinReminderWindow(at(65), now)).toBe(true)
    expect(isWithinReminderWindow(at(66), now)).toBe(false)
  })
  it('is false for a past or missing time', () => {
    expect(isWithinReminderWindow(at(-5), now)).toBe(false)
    expect(isWithinReminderWindow(null, now)).toBe(false)
  })
})
