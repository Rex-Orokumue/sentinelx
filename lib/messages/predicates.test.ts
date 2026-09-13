import { describe, it, expect } from 'vitest'
import { unreadCount, isBlockedBetween, countNewContactsSince, canEditOrUnsend, resolveParticipantContent, canForward } from './predicates'

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

describe('canEditOrUnsend', () => {
  it('is true within the 10-minute window', () => {
    expect(canEditOrUnsend('2026-09-12T12:00:00Z', '2026-09-12T12:09:59Z')).toBe(true)
  })
  it('is true at exactly 10 minutes', () => {
    expect(canEditOrUnsend('2026-09-12T12:00:00Z', '2026-09-12T12:10:00Z')).toBe(true)
  })
  it('is false just past 10 minutes', () => {
    expect(canEditOrUnsend('2026-09-12T12:00:00Z', '2026-09-12T12:10:01Z')).toBe(false)
  })
})

describe('resolveParticipantContent', () => {
  it('hides content once deleted', () => {
    expect(resolveParticipantContent({ body: 'hi', imageUrl: null, deletedAt: '2026-09-12T12:00:00Z' })).toEqual({
      body: null,
      imageUrl: null,
      removed: true,
      stickerId: null,
      audioUrl: null,
    })
  })
  it('passes through untouched content when not deleted', () => {
    expect(resolveParticipantContent({ body: 'hi', imageUrl: null, deletedAt: null })).toEqual({
      body: 'hi',
      imageUrl: null,
      removed: false,
      stickerId: null,
      audioUrl: null,
    })
  })
  it('hides a sticker once deleted', () => {
    expect(resolveParticipantContent({ body: null, imageUrl: null, deletedAt: '2026-09-12T12:00:00Z', stickerId: 'gg' })).toEqual({
      body: null,
      imageUrl: null,
      removed: true,
      stickerId: null,
      audioUrl: null,
    })
  })
  it('passes through a sticker or a voice note when not deleted', () => {
    expect(resolveParticipantContent({ body: null, imageUrl: null, deletedAt: null, stickerId: 'gg' })).toEqual({
      body: null,
      imageUrl: null,
      removed: false,
      stickerId: 'gg',
      audioUrl: null,
    })
    expect(resolveParticipantContent({ body: null, imageUrl: null, deletedAt: null, audioUrl: 'u1/a.webm' })).toEqual({
      body: null,
      imageUrl: null,
      removed: false,
      stickerId: null,
      audioUrl: 'u1/a.webm',
    })
  })
})

describe('canForward', () => {
  it('is true for a message that still has content', () => {
    expect(canForward(null)).toBe(true)
  })
  it('is false once the message has been unsent', () => {
    expect(canForward('2026-09-12T12:00:00Z')).toBe(false)
  })
})
