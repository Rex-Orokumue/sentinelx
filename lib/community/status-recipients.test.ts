import { describe, it, expect } from 'vitest'
import { friendStatusRecipients } from './status-recipients'

const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const C = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const D = 'dddddddd-dddd-dddd-dddd-dddddddddddd'

describe('friendStatusRecipients', () => {
  it('returns the other side of every accepted friendship, regardless of direction', () => {
    const rows = [
      { requester_id: A, recipient_id: B, status: 'accepted' }, // A sent to B
      { requester_id: C, recipient_id: A, status: 'accepted' }, // C sent to A
    ]
    expect(friendStatusRecipients({ friendRows: rows, authorId: A }).sort()).toEqual([B, C].sort())
  })

  it('ignores pending requests', () => {
    const rows = [
      { requester_id: A, recipient_id: B, status: 'accepted' },
      { requester_id: A, recipient_id: C, status: 'pending' },
    ]
    expect(friendStatusRecipients({ friendRows: rows, authorId: A })).toEqual([B])
  })

  it('de-duplicates when both directions somehow exist', () => {
    const rows = [
      { requester_id: A, recipient_id: B, status: 'accepted' },
      { requester_id: B, recipient_id: A, status: 'accepted' },
    ]
    expect(friendStatusRecipients({ friendRows: rows, authorId: A })).toEqual([B])
  })

  it('never includes the author', () => {
    const rows = [{ requester_id: A, recipient_id: A, status: 'accepted' }]
    expect(friendStatusRecipients({ friendRows: rows, authorId: A })).toEqual([])
  })

  it('drops rows that do not involve the author', () => {
    const rows = [{ requester_id: C, recipient_id: D, status: 'accepted' }]
    expect(friendStatusRecipients({ friendRows: rows, authorId: A })).toEqual([])
  })

  it('returns an empty array for no rows', () => {
    expect(friendStatusRecipients({ friendRows: [], authorId: A })).toEqual([])
  })
})
