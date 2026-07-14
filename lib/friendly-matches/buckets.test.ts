import { describe, it, expect } from 'vitest'
import { bucketFriendlies, type FriendlyMatchRow } from './buckets'

function m(over: Partial<FriendlyMatchRow> & { id: string }): FriendlyMatchRow {
  return {
    status: 'pending',
    challengerId: 'me',
    opponentId: 'them',
    ...over,
  }
}

describe('bucketFriendlies', () => {
  it('puts "pending" rows in pending regardless of which side the viewer is on', () => {
    const r = bucketFriendlies(
      [m({ id: 'a', status: 'pending', challengerId: 'me', opponentId: 'them' }),
       m({ id: 'b', status: 'pending', challengerId: 'them', opponentId: 'me' })],
      'me',
    )
    expect(r.pending.map((f) => f.id).sort()).toEqual(['a', 'b'])
    expect(r.active).toEqual([])
    expect(r.completed).toEqual([])
  })

  it('groups awaiting_payment / active / awaiting_admin_confirmation as active', () => {
    const r = bucketFriendlies(
      [
        m({ id: 'a', status: 'awaiting_payment' }),
        m({ id: 'b', status: 'active' }),
        m({ id: 'c', status: 'awaiting_admin_confirmation' }),
      ],
      'me',
    )
    expect(r.active.map((f) => f.id).sort()).toEqual(['a', 'b', 'c'])
  })

  it('groups completed / declined / disputed as completed', () => {
    const r = bucketFriendlies(
      [
        m({ id: 'a', status: 'completed' }),
        m({ id: 'b', status: 'declined' }),
        m({ id: 'c', status: 'disputed' }),
      ],
      'me',
    )
    expect(r.completed.map((f) => f.id).sort()).toEqual(['a', 'b', 'c'])
  })
})
