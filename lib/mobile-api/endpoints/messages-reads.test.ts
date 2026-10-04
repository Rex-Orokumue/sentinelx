import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ApiError, Errors } from '../errors'

const { authenticate } = vi.hoisted(() => ({ authenticate: vi.fn() }))
vi.mock('../auth', () => ({ authenticate, optionalAuth: vi.fn() }))
const rs = vi.hoisted(() => ({ listThreads: vi.fn(), getThreadHeader: vi.fn(), listMessages: vi.fn() }))
vi.mock('@/lib/messages/read-service', () => rs)

import { getMessageThreadsEndpoint, getMessageThreadEndpoint, getThreadMessagesEndpoint, toMessageCtx } from './messages-reads'

const ctx = { userId: 'u1', admin: 'adm', userClient: 'sb' }
const other = { id: 'o', name: 'Rex', username: 'rex', avatarUrl: null }
const get = (ep: typeof getMessageThreadsEndpoint, url: string, params: Record<string, string> = {}) =>
  ep.handler(new Request(url), { params })

beforeEach(() => {
  authenticate.mockResolvedValue(ctx)
  Object.values(rs).forEach((f) => f.mockReset())
})

describe('toMessageCtx', () => {
  it('maps the RLS client to supabase, keeps admin and the verified user id', () => {
    expect(toMessageCtx(ctx as never)).toEqual({ supabase: 'sb', admin: 'adm', userId: 'u1' })
  })
})

describe('getMessageThreadsEndpoint', () => {
  it('lists threads and forwards the cursor', async () => {
    rs.listThreads.mockResolvedValue({
      threads: [{ threadId: 't1', other, preview: { kind: 'text', text: 'hi', stickerId: null }, lastMessageAt: '2026-10-04T10:00:00Z', unread: 2 }],
      nextCursor: 'c2',
    })
    const res = await get(getMessageThreadsEndpoint, 'https://x.test/api/mobile/v1/messages/threads?cursor=abc')
    expect(res.status).toBe(200)
    expect(rs.listThreads).toHaveBeenCalledWith({ supabase: 'sb', admin: 'adm', userId: 'u1' }, { cursor: 'abc' })
    expect((await res.json()).data.nextCursor).toBe('c2')
  })
  it('passes no cursor when none is given', async () => {
    rs.listThreads.mockResolvedValue({ threads: [], nextCursor: null })
    await get(getMessageThreadsEndpoint, 'https://x.test/api/mobile/v1/messages/threads')
    expect(rs.listThreads).toHaveBeenCalledWith(expect.anything(), { cursor: undefined })
  })
  it('surfaces a bad cursor as 400 invalid_cursor', async () => {
    rs.listThreads.mockRejectedValue(new ApiError(400, 'invalid_cursor', 'Invalid cursor.'))
    const res = await get(getMessageThreadsEndpoint, 'https://x.test/x?cursor=bad')
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('invalid_cursor')
  })
  it('requires a signed-in caller', async () => {
    authenticate.mockRejectedValue(Errors.unauthorized())
    expect((await get(getMessageThreadsEndpoint, 'https://x.test/x')).status).toBe(401)
    expect(rs.listThreads).not.toHaveBeenCalled()
  })
})

describe('getMessageThreadEndpoint', () => {
  it('returns the header', async () => {
    rs.getThreadHeader.mockResolvedValue({ threadId: 't1', other, blockedByMe: false, blockedByThem: true })
    const res = await get(getMessageThreadEndpoint, 'https://x.test/x', { id: 't1' })
    expect(res.status).toBe(200)
    expect((await res.json()).data.blockedByThem).toBe(true)
    expect(rs.getThreadHeader).toHaveBeenCalledWith(expect.anything(), 't1')
  })
  it('404s a thread the caller is not in', async () => {
    rs.getThreadHeader.mockResolvedValue(null)
    expect((await get(getMessageThreadEndpoint, 'https://x.test/x', { id: 't1' })).status).toBe(404)
  })
})

describe('getThreadMessagesEndpoint', () => {
  const msg = {
    id: 'm1', senderId: 'o', body: 'hi', imageUrl: null, stickerId: null, audioUrl: null, audioDurationSeconds: null,
    forwarded: false, createdAt: '2026-10-04T10:00:00Z', deliveredAt: null, readAt: null, editedAt: null, deletedAt: null, replyTo: null,
  }
  it('returns a page and forwards the before cursor', async () => {
    rs.listMessages.mockResolvedValue({ messages: [msg], nextBefore: null })
    const res = await get(getThreadMessagesEndpoint, 'https://x.test/x?before=zzz', { id: 't1' })
    expect(res.status).toBe(200)
    expect(rs.listMessages).toHaveBeenCalledWith(expect.anything(), 't1', { before: 'zzz' })
    expect((await res.json()).data.messages).toHaveLength(1)
  })
  it('404s messages for a thread the caller is not in', async () => {
    rs.listMessages.mockResolvedValue(null)
    expect((await get(getThreadMessagesEndpoint, 'https://x.test/x', { id: 't1' })).status).toBe(404)
  })
  it('500s (not leaks) when the service returns a shape that breaks the published contract', async () => {
    rs.listMessages.mockResolvedValue({ messages: [{ ...msg, createdAt: 5 }], nextBefore: null })
    expect((await get(getThreadMessagesEndpoint, 'https://x.test/x', { id: 't1' })).status).toBe(500)
  })
})
