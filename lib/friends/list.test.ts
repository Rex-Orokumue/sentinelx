import { describe, it, expect } from 'vitest'
import { isFriendsWith, sortFriendsFirst, type FriendshipRow } from './list'

function row(over: Partial<FriendshipRow>): FriendshipRow {
  return { requesterId: 'a', recipientId: 'b', status: 'accepted', ...over }
}

describe('isFriendsWith', () => {
  it('is true when accepted in the requester direction', () => {
    expect(isFriendsWith([row({ requesterId: 'me', recipientId: 'you' })], 'me', 'you')).toBe(true)
  })
  it('is true when accepted in the recipient direction (order-independent)', () => {
    expect(isFriendsWith([row({ requesterId: 'you', recipientId: 'me' })], 'me', 'you')).toBe(true)
  })
  it('is false when only pending', () => {
    expect(
      isFriendsWith([row({ requesterId: 'me', recipientId: 'you', status: 'pending' })], 'me', 'you'),
    ).toBe(false)
  })
  it('is false when no row exists', () => {
    expect(isFriendsWith([], 'me', 'you')).toBe(false)
  })
})

describe('sortFriendsFirst', () => {
  it('puts friend ids ahead of non-friends, stable order within each group', () => {
    const players = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const r = sortFriendsFirst(players, new Set(['c']))
    expect(r.map((p) => p.id)).toEqual(['c', 'a', 'b'])
  })
  it('is a no-op when no friends are present', () => {
    const players = [{ id: 'a' }, { id: 'b' }]
    expect(sortFriendsFirst(players, new Set()).map((p) => p.id)).toEqual(['a', 'b'])
  })
})
