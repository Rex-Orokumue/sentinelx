import { describe, it, expect } from 'vitest'
import { canFollow, isFollowing, safeCount } from './predicates'

describe('canFollow', () => {
  it('allows following someone else', () => {
    expect(canFollow('a', 'b')).toEqual({ ok: true })
  })
  it('rejects following yourself', () => {
    expect(canFollow('a', 'a')).toEqual({ ok: false, error: 'You cannot follow yourself.' })
  })
})

describe('isFollowing', () => {
  const rows = [
    { followerId: 'a', followingId: 'b' },
    { followerId: 'c', followingId: 'b' },
  ]
  it('is true for an existing pair', () => {
    expect(isFollowing(rows, 'a', 'b')).toBe(true)
  })
  it('is false for a reversed pair (asymmetric)', () => {
    expect(isFollowing(rows, 'b', 'a')).toBe(false)
  })
  it('is false for an unrelated pair', () => {
    expect(isFollowing(rows, 'a', 'c')).toBe(false)
  })
  it('is false for an empty graph', () => {
    expect(isFollowing([], 'a', 'b')).toBe(false)
  })
})

describe('safeCount', () => {
  it('passes through a real count', () => {
    expect(safeCount(42)).toBe(42)
  })
  it('coerces null to zero', () => {
    expect(safeCount(null)).toBe(0)
  })
})
