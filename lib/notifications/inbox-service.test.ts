import { describe, it, expect } from 'vitest'
import { fakeAdmin, argsOf } from './fake-admin'
import { markRead, markAllRead } from './inbox-service'

describe('markRead', () => {
  it('scopes the update to the caller and reports ok when a row matched (including already-read)', async () => {
    const { admin, calls } = fakeAdmin(() => ({ data: [{ id: 'n1' }] }))
    expect(await markRead(admin, 'u1', 'n1')).toBe('ok')
    expect(calls[0].table).toBe('player_notifications')
    expect(argsOf(calls[0], 'update')).toEqual([{ read: true }])
    expect(calls[0].ops.filter(([m]) => m === 'eq').map(([, a]) => a)).toEqual([['id', 'n1'], ['player_id', 'u1']])
  })
  it('reports not_found when nothing matched (unknown id or someone else row)', async () => {
    const { admin } = fakeAdmin(() => ({ data: [] }))
    expect(await markRead(admin, 'u1', 'n1')).toBe('not_found')
  })
  it('throws on a database error rather than claiming success', async () => {
    const { admin } = fakeAdmin(() => ({ data: null, error: { message: 'x' } }))
    await expect(markRead(admin, 'u1', 'n1')).rejects.toThrow()
  })
})

describe('markAllRead', () => {
  it('updates only the caller unread rows and returns how many', async () => {
    const { admin, calls } = fakeAdmin(() => ({ data: [{ id: 'a' }, { id: 'b' }] }))
    expect(await markAllRead(admin, 'u1')).toBe(2)
    expect(calls[0].ops.filter(([m]) => m === 'eq').map(([, a]) => a)).toEqual([['player_id', 'u1'], ['read', false]])
  })
  it('returns 0 when there is nothing unread', async () => {
    const { admin } = fakeAdmin(() => ({ data: [] }))
    expect(await markAllRead(admin, 'u1')).toBe(0)
  })
})
