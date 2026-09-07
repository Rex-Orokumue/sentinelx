import { describe, it, expect } from 'vitest'
import { isLive, groupIntoRings, type StatusRow } from './statuses'

const NOW = new Date('2026-09-07T12:00:00Z')

const s = (over: Partial<StatusRow> & { id: string; playerId: string }): StatusRow => ({
  imageUrl: null,
  caption: 'hi',
  createdAt: '2026-09-07T10:00:00Z',
  expiresAt: '2026-09-08T10:00:00Z',
  authorName: over.playerId,
  authorUsername: over.playerId,
  authorAvatarUrl: null,
  ...over,
})

describe('isLive', () => {
  it('is live before expiry', () => {
    expect(isLive(s({ id: '1', playerId: 'a' }), NOW)).toBe(true)
  })

  it('is not live once expired', () => {
    expect(isLive(s({ id: '1', playerId: 'a', expiresAt: '2026-09-07T11:59:00Z' }), NOW)).toBe(false)
  })

  it('treats the exact expiry instant as expired', () => {
    expect(isLive(s({ id: '1', playerId: 'a', expiresAt: NOW.toISOString() }), NOW)).toBe(false)
  })
})

describe('groupIntoRings', () => {
  it('groups every status under its author', () => {
    const rings = groupIntoRings(
      [
        s({ id: '1', playerId: 'a' }),
        s({ id: '2', playerId: 'a' }),
        s({ id: '3', playerId: 'b' }),
      ],
      new Set(),
      null,
      NOW,
    )
    expect(rings).toHaveLength(2)
    expect(rings.find((r) => r.playerId === 'a')?.statuses).toHaveLength(2)
  })

  it('drops expired statuses so an expired-only author has no ring', () => {
    const rings = groupIntoRings(
      [s({ id: '1', playerId: 'a', expiresAt: '2026-09-07T09:00:00Z' })],
      new Set(),
      null,
      NOW,
    )
    expect(rings).toEqual([])
  })

  it('marks a ring unseen until every one of its statuses is viewed', () => {
    const rows = [s({ id: '1', playerId: 'a' }), s({ id: '2', playerId: 'a' })]
    expect(groupIntoRings(rows, new Set(['1']), null, NOW)[0].hasUnseen).toBe(true)
    expect(groupIntoRings(rows, new Set(['1', '2']), null, NOW)[0].hasUnseen).toBe(false)
  })

  it('puts the viewer their own ring first, however old it is', () => {
    const rings = groupIntoRings(
      [
        s({ id: '1', playerId: 'other', createdAt: '2026-09-07T11:00:00Z' }),
        s({ id: '2', playerId: 'me', createdAt: '2026-09-07T01:00:00Z' }),
      ],
      new Set(),
      'me',
      NOW,
    )
    expect(rings[0].playerId).toBe('me')
    expect(rings[0].isSelf).toBe(true)
  })

  it('orders unseen rings ahead of fully-seen ones', () => {
    const rings = groupIntoRings(
      [
        s({ id: '1', playerId: 'seen', createdAt: '2026-09-07T11:00:00Z' }),
        s({ id: '2', playerId: 'unseen', createdAt: '2026-09-07T09:00:00Z' }),
      ],
      new Set(['1']),
      null,
      NOW,
    )
    expect(rings.map((r) => r.playerId)).toEqual(['unseen', 'seen'])
  })

  it('orders rings of equal seen-ness by most recent status', () => {
    const rings = groupIntoRings(
      [
        s({ id: '1', playerId: 'older', createdAt: '2026-09-07T08:00:00Z' }),
        s({ id: '2', playerId: 'newer', createdAt: '2026-09-07T11:00:00Z' }),
      ],
      new Set(),
      null,
      NOW,
    )
    expect(rings.map((r) => r.playerId)).toEqual(['newer', 'older'])
  })

  it('orders each author’s own statuses oldest first, so playback runs forwards', () => {
    const rings = groupIntoRings(
      [
        s({ id: 'late', playerId: 'a', createdAt: '2026-09-07T11:00:00Z' }),
        s({ id: 'early', playerId: 'a', createdAt: '2026-09-07T09:00:00Z' }),
      ],
      new Set(),
      null,
      NOW,
    )
    expect(rings[0].statuses.map((x) => x.id)).toEqual(['early', 'late'])
  })

  it('returns nothing for no statuses', () => {
    expect(groupIntoRings([], new Set(), 'me', NOW)).toEqual([])
  })
})
