import { describe, it, expect } from 'vitest'
import { unreadCount, isBlockedBetween, countNewContactsSince } from './predicates'

describe('unreadCount', () => {
  const rows = [
    { senderId: 'them', readAt: null },
    { senderId: 'them', readAt: '2026-09-09T00:00:00Z' },
    { senderId: 'me', readAt: null },
    { senderId: 'them', readAt: null },
  ]
  it('counts only unread messages from the other person', () => {
    expect(unreadCount(rows, 'me')).toBe(2)
  })
  it('is zero for an empty thread', () => {
    expect(unreadCount([], 'me')).toBe(0)
  })
})

describe('isBlockedBetween', () => {
  it('is true when x blocked y', () => {
    expect(isBlockedBetween([{ blockerId: 'x', blockedId: 'y' }], 'x', 'y')).toBe(true)
  })
  it('is true when y blocked x (symmetric in effect)', () => {
    expect(isBlockedBetween([{ blockerId: 'y', blockedId: 'x' }], 'x', 'y')).toBe(true)
  })
  it('is false for an unrelated block', () => {
    expect(isBlockedBetween([{ blockerId: 'x', blockedId: 'z' }], 'x', 'y')).toBe(false)
  })
})

describe('countNewContactsSince', () => {
  it('counts timestamps at or after the cutoff', () => {
    expect(
      countNewContactsSince(
        ['2026-09-09T10:00:00Z', '2026-09-08T10:00:00Z', '2026-09-09T12:00:00Z'],
        '2026-09-09T00:00:00Z',
      ),
    ).toBe(2)
  })
  it('is zero for none', () => {
    expect(countNewContactsSince([], '2026-09-09T00:00:00Z')).toBe(0)
  })
})
