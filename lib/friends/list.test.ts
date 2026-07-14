import { describe, it, expect } from 'vitest'
import { isFriendsWith, sortFriendsFirst, friendshipStatus, type FriendshipRow } from './list'

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

describe('friendshipStatus', () => {
  it('is "none" when no row exists', () => {
    expect(friendshipStatus([], 'me', 'you')).toBe('none')
  })
  it('is "friends" when accepted, requester direction', () => {
    expect(friendshipStatus([row({ requesterId: 'me', recipientId: 'you' })], 'me', 'you')).toBe('friends')
  })
  it('is "friends" when accepted, recipient direction', () => {
    expect(friendshipStatus([row({ requesterId: 'you', recipientId: 'me' })], 'me', 'you')).toBe('friends')
  })
  it('is "pending_sent" when viewer is the requester of a pending row', () => {
    expect(
      friendshipStatus([row({ requesterId: 'me', recipientId: 'you', status: 'pending' })], 'me', 'you'),
    ).toBe('pending_sent')
  })
  it('is "pending_received" when viewer is the recipient of a pending row', () => {
    expect(
      friendshipStatus([row({ requesterId: 'you', recipientId: 'me', status: 'pending' })], 'me', 'you'),
    ).toBe('pending_received')
  })
})
