import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeAdmin, type Op } from '@/lib/notifications/fake-admin'

const { notifyBoth } = vi.hoisted(() => ({ notifyBoth: vi.fn() }))
vi.mock('@/lib/notifications/send', () => ({ notifyBoth }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

let sessionUser: string | null = 'u1'
let sessionFake = fakeAdmin()
let adminFake = fakeAdmin()
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: sessionUser ? { id: sessionUser } : null } }) },
    from: (t: string) => (sessionFake.admin as unknown as { from: (t: string) => unknown }).from(t),
  }),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => adminFake.admin }))

import { sendMessage, forwardMessage, editMessage, unsendMessage, markThreadRead, blockUser, reportConversation } from './actions'

const T = 'thread-1'
const thread = { player_a: 'u1', player_b: 'u2' }

function adminResolver(over: Record<string, unknown> = {}) {
  return (op: Op) => {
    if (op.table in over) return { data: over[op.table] }
    if (op.table === 'dm_threads') return { data: thread }
    if (op.table === 'profiles') return { data: { display_name: 'Me', username: 'me' } }
    return { data: null }
  }
}

beforeEach(() => {
  sessionUser = 'u1'
  notifyBoth.mockReset()
  sessionFake = fakeAdmin((op) => (op.table === 'dm_messages' ? { data: { id: 'm-new' } } : { data: null }))
  adminFake = fakeAdmin(adminResolver())
})

describe('sendMessage (current behaviour)', () => {
  it('requires login', async () => {
    sessionUser = null
    expect(await sendMessage({ threadId: T, body: 'hi' })).toEqual({ error: 'Please log in.' })
  })
  it('rejects an empty message', async () => {
    expect(await sendMessage({ threadId: T })).toEqual({ error: 'Type a message, add a photo, or send a sticker.' })
  })
  it('rejects a thread the caller is not in', async () => {
    adminFake = fakeAdmin(adminResolver({ dm_threads: { player_a: 'x', player_b: 'y' } }))
    expect(await sendMessage({ threadId: T, body: 'hi' })).toEqual({ error: 'Conversation not found.' })
  })
  it('explains a block the caller placed', async () => {
    adminFake = fakeAdmin(adminResolver({ dm_blocks: [{ blocker_id: 'u1' }] }))
    expect(await sendMessage({ threadId: T, body: 'hi' })).toEqual({ error: 'Unblock this player to message them.' })
  })
  it('uses the neutral wording when the OTHER player blocked', async () => {
    adminFake = fakeAdmin(adminResolver({ dm_blocks: [{ blocker_id: 'u2' }] }))
    expect(await sendMessage({ threadId: T, body: 'hi' })).toEqual({ error: 'You can no longer message this player.' })
  })
  it('inserts via the session client, bumps the thread, notifies once', async () => {
    const res = await sendMessage({ threadId: T, body: 'hello there' })
    expect(res).toEqual({ threadId: T, messageId: 'm-new' })
    expect(sessionFake.calls.some((c) => c.table === 'dm_messages' && c.ops.some(([m]) => m === 'insert'))).toBe(true)
    expect(adminFake.calls.some((c) => c.table === 'dm_threads' && c.ops.some(([m]) => m === 'update'))).toBe(true)
    expect(notifyBoth).toHaveBeenCalledTimes(1)
    expect(notifyBoth.mock.calls[0][0]).toBe('u2')
    expect(notifyBoth.mock.calls[0][1]).toMatchObject({ type: 'direct_message', kind: 'text', excerpt: 'hello there' })
    expect(notifyBoth.mock.calls[0][3]).toEqual({ link: `/messages/${T}`, data: { threadId: T } })
  })
})

describe('forwardMessage (current behaviour)', () => {
  it('copies the SOURCE row paths into the target thread and flags forwarded', async () => {
    adminFake = fakeAdmin((op) => {
      if (op.table === 'dm_messages')
        return { data: { thread_id: 'src', body: null, image_url: 'u2/pic.jpg', sticker_id: null, audio_url: null, audio_duration_seconds: null, deleted_at: null } }
      if (op.table === 'dm_threads') return { data: thread }
      if (op.table === 'profiles') return { data: { display_name: 'Me', username: 'me' } }
      return { data: null }
    })
    const res = await forwardMessage({ messageId: 'm1', toThreadId: T })
    expect(res).toEqual({})
    const insert = sessionFake.calls.find((c) => c.table === 'dm_messages')
    expect(JSON.stringify(insert?.ops)).toContain('u2/pic.jpg')
    expect(JSON.stringify(insert?.ops)).toContain('"forwarded":true')
  })
  it('refuses an unsent message', async () => {
    adminFake = fakeAdmin((op) =>
      op.table === 'dm_messages' ? { data: { thread_id: 'src', deleted_at: '2026-10-01T00:00:00Z' } } : { data: null },
    )
    expect(await forwardMessage({ messageId: 'm1', toThreadId: T })).toEqual({ error: 'This message can no longer be forwarded.' })
  })
})

describe('edit / unsend windows', () => {
  const recent = new Date().toISOString()
  const old = new Date(Date.now() - 11 * 60 * 1000).toISOString()
  const row = (created_at: string) => (op: Op) =>
    op.table === 'dm_messages' ? { data: { id: 'm1', thread_id: T, sender_id: 'u1', body: 'x', image_url: null, created_at } } : { data: null }
  it('edit inside the window writes history then updates', async () => {
    adminFake = fakeAdmin(row(recent))
    expect(await editMessage({ messageId: 'm1', body: 'new' })).toEqual({})
    expect(adminFake.calls.some((c) => c.table === 'dm_message_edits')).toBe(true)
  })
  it('edit outside the window is refused', async () => {
    adminFake = fakeAdmin(row(old))
    expect(await editMessage({ messageId: 'm1', body: 'new' })).toEqual({
      error: 'This message can only be edited within 10 minutes of sending.',
    })
  })
  it('unsend outside the window is refused', async () => {
    adminFake = fakeAdmin(row(old))
    expect(await unsendMessage('m1')).toEqual({ error: 'This message can only be unsent within 10 minutes of sending.' })
  })
  it('only the sender may edit', async () => {
    adminFake = fakeAdmin((op) => (op.table === 'dm_messages' ? { data: { id: 'm1', thread_id: T, sender_id: 'u2', created_at: recent } } : { data: null }))
    expect(await editMessage({ messageId: 'm1', body: 'new' })).toEqual({ error: 'Message not found.' })
  })
})

describe('read / block / report', () => {
  it('markThreadRead stamps read+delivered and clears the matching bell rows', async () => {
    await markThreadRead(T)
    const upd = sessionFake.calls.find((c) => c.table === 'dm_messages')
    expect(JSON.stringify(upd?.ops)).toContain('read_at')
    const bell = adminFake.calls.find((c) => c.table === 'player_notifications')
    expect(JSON.stringify(bell?.ops)).toContain(`/messages/${T}`)
  })
  it('blockUser severs follows in both directions with the admin client', async () => {
    expect(await blockUser('u2')).toEqual({})
    const del = adminFake.calls.find((c) => c.table === 'player_follows')
    expect(JSON.stringify(del?.ops)).toContain('follower_id.eq.u1')
    expect(JSON.stringify(del?.ops)).toContain('follower_id.eq.u2')
  })
  it('cannot block yourself', async () => {
    expect(await blockUser('u1')).toEqual({ error: 'You cannot block yourself.' })
  })
  it('report resolves the reported player from the thread', async () => {
    expect(await reportConversation({ threadId: T, reason: 'spam' })).toEqual({})
    const ins = sessionFake.calls.find((c) => c.table === 'dm_reports')
    expect(JSON.stringify(ins?.ops)).toContain('"reported_id":"u2"')
  })
  it('report needs a reason', async () => {
    expect(await reportConversation({ threadId: T, reason: '   ' })).toEqual({ error: 'Add a reason so staff can act on it' })
  })
})
