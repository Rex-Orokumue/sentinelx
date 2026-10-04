import { describe, it, expect, vi, beforeEach } from 'vitest'

const { authenticate } = vi.hoisted(() => ({ authenticate: vi.fn() }))
vi.mock('../auth', () => ({ authenticate, optionalAuth: vi.fn() }))
const { runIdempotent } = vi.hoisted(() => ({ runIdempotent: vi.fn() }))
vi.mock('../idempotency', () => ({ runIdempotent }))
const svc = vi.hoisted(() => ({
  startConversation: vi.fn(),
  sendClientMessage: vi.fn(),
  editMessageCore: vi.fn(),
  unsendMessageCore: vi.fn(),
  forwardMessageCore: vi.fn(),
  markThreadRead: vi.fn(),
  markAllDelivered: vi.fn(),
  blockPlayer: vi.fn(),
  unblockPlayer: vi.fn(),
  reportThread: vi.fn(),
}))
vi.mock('@/lib/messages/service', () => svc)

import {
  startMessageThreadEndpoint,
  sendMessageEndpoint,
  editMessageEndpoint,
  unsendMessageEndpoint,
  forwardMessageEndpoint,
  markThreadReadEndpoint,
  markAllDeliveredEndpoint,
  blockPlayerEndpoint,
  unblockPlayerEndpoint,
  reportThreadEndpoint,
} from './messages-writes'

const ctx = { userId: 'u1', admin: 'adm', userClient: 'sb' }
const mctx = { supabase: 'sb', admin: 'adm', userId: 'u1' }
const U2 = '22222222-2222-4222-8222-222222222222'
const fail = (errorCode: string, message: string) => ({ ok: false, errorCode, message })

function post(ep: { handler: (r: Request, c?: { params: Record<string, string> }) => Promise<Response> }, body: unknown, params: Record<string, string> = {}, key: string | null = 'k1', method = 'POST') {
  return ep.handler(
    new Request('https://x.test/api/mobile/v1/messages/threads/t1/messages', {
      method,
      headers: { 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params },
  )
}
const code = async (r: Response) => (await r.json()).error?.code

beforeEach(() => {
  authenticate.mockResolvedValue(ctx)
  runIdempotent.mockImplementation(async (_a: unknown, _b: unknown, run: () => Promise<unknown>) => run())
  Object.values(svc).forEach((f) => f.mockReset())
})

describe('sendMessageEndpoint', () => {
  it('maps imagePath/audioPath to the service and returns the new message', async () => {
    svc.sendClientMessage.mockResolvedValue({ ok: true, threadId: 't1', messageId: 'm1', createdAt: '2026-10-05T00:00:00Z' })
    const res = await post(sendMessageEndpoint, { imagePath: `u1/a.jpg`, replyToId: U2 }, { id: 't1' })
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ messageId: 'm1', createdAt: '2026-10-05T00:00:00Z' })
    expect(svc.sendClientMessage).toHaveBeenCalledWith(mctx, expect.objectContaining({ threadId: 't1', imageUrl: 'u1/a.jpg', replyToId: U2 }))
  })
  it('requires an Idempotency-Key', async () => {
    const res = await post(sendMessageEndpoint, { body: 'hi' }, { id: 't1' }, null)
    expect(res.status).toBe(400)
    expect(await code(res)).toBe('idempotency_key_required')
    expect(svc.sendClientMessage).not.toHaveBeenCalled()
  })
  it('claims the key per user and route, and a replay does not send again', async () => {
    svc.sendClientMessage.mockResolvedValue({ ok: true, threadId: 't1', messageId: 'm1', createdAt: '2026-10-05T00:00:00Z' })
    await post(sendMessageEndpoint, { body: 'hi' }, { id: 't1' })
    expect(runIdempotent).toHaveBeenCalledWith('adm', { key: 'k1', userId: 'u1', route: '/api/mobile/v1/messages/threads/t1/messages' }, expect.any(Function))
    runIdempotent.mockImplementationOnce(async () => ({
      status: 200,
      body: { data: { messageId: 'm1', createdAt: '2026-10-05T00:00:00Z' } },
    }))
    const replay = await post(sendMessageEndpoint, { body: 'hi' }, { id: 't1' })
    expect(replay.status).toBe(200)
    expect((await replay.json()).data.messageId).toBe('m1')
    expect(svc.sendClientMessage).toHaveBeenCalledTimes(1)
  })
  it('rejects an over-long body at the boundary', async () => {
    const res = await post(sendMessageEndpoint, { body: 'x'.repeat(2001) }, { id: 't1' })
    expect(res.status).toBe(400)
    expect(await code(res)).toBe('validation_failed')
  })
  it.each([
    ['blocked_by_me', 403],
    ['blocked', 403],
    ['messaging_restricted', 403],
    ['not_found', 404],
    ['validation', 400],
    ['send_failed', 500],
  ])('maps failure %s to %i with its own code', async (errorCode, status) => {
    svc.sendClientMessage.mockResolvedValue(fail(errorCode, 'msg'))
    const res = await post(sendMessageEndpoint, { body: 'hi' }, { id: 't1' })
    expect(res.status).toBe(status)
    expect(await code(res)).toBe(errorCode)
  })
})

describe('startMessageThreadEndpoint', () => {
  it('returns the thread id', async () => {
    svc.startConversation.mockResolvedValue({ ok: true, threadId: 't9' })
    const res = await post(startMessageThreadEndpoint, { recipientId: U2 }, {}, null)
    expect((await res.json()).data).toEqual({ threadId: 't9' })
    expect(svc.startConversation).toHaveBeenCalledWith(mctx, U2)
  })
  it('400s when messaging yourself', async () => {
    svc.startConversation.mockResolvedValue(fail('validation', 'Pick someone to message.'))
    expect((await post(startMessageThreadEndpoint, { recipientId: U2 }, {}, null)).status).toBe(400)
  })
  it('400s a non-uuid recipient', async () => {
    expect((await post(startMessageThreadEndpoint, { recipientId: 'nope' }, {}, null)).status).toBe(400)
  })
})

describe('editMessageEndpoint / unsendMessageEndpoint', () => {
  it('edits', async () => {
    svc.editMessageCore.mockResolvedValue({ ok: true, threadId: 't1' })
    const res = await post(editMessageEndpoint, { body: 'new' }, { id: 'm1' }, null, 'PATCH')
    expect(res.status).toBe(200)
    expect(svc.editMessageCore).toHaveBeenCalledWith(mctx, { messageId: 'm1', body: 'new' })
  })
  it('409s once the 10-minute window has closed', async () => {
    svc.editMessageCore.mockResolvedValue(fail('edit_window_closed', 'x'))
    const res = await post(editMessageEndpoint, { body: 'new' }, { id: 'm1' }, null, 'PATCH')
    expect(res.status).toBe(409)
    expect(await code(res)).toBe('edit_window_closed')
  })
  it('404s editing someone elses message', async () => {
    svc.editMessageCore.mockResolvedValue(fail('not_found', 'Message not found.'))
    expect((await post(editMessageEndpoint, { body: 'new' }, { id: 'm1' }, null, 'PATCH')).status).toBe(404)
  })
  it('unsends, and 409s outside the window', async () => {
    svc.unsendMessageCore.mockResolvedValueOnce({ ok: true, threadId: 't1' })
    expect((await post(unsendMessageEndpoint, undefined, { id: 'm1' }, null, 'DELETE')).status).toBe(200)
    svc.unsendMessageCore.mockResolvedValueOnce(fail('edit_window_closed', 'x'))
    expect((await post(unsendMessageEndpoint, undefined, { id: 'm1' }, null, 'DELETE')).status).toBe(409)
  })
})

describe('forwardMessageEndpoint', () => {
  it('forwards and returns the new message id', async () => {
    svc.forwardMessageCore.mockResolvedValue({ ok: true, messageId: 'm2' })
    const res = await post(forwardMessageEndpoint, { toThreadId: U2 }, { id: 'm1' })
    expect((await res.json()).data).toEqual({ messageId: 'm2' })
    expect(svc.forwardMessageCore).toHaveBeenCalledWith(mctx, { messageId: 'm1', toThreadId: U2 })
  })
  it('requires an Idempotency-Key', async () => {
    expect(await code(await post(forwardMessageEndpoint, { toThreadId: U2 }, { id: 'm1' }, null))).toBe('idempotency_key_required')
  })
  it('409s an unsent source message', async () => {
    svc.forwardMessageCore.mockResolvedValue(fail('not_forwardable', 'x'))
    expect((await post(forwardMessageEndpoint, { toThreadId: U2 }, { id: 'm1' })).status).toBe(409)
  })
})

describe('receipts are best-effort', () => {
  it('markThreadRead is 200 even if the service throws', async () => {
    svc.markThreadRead.mockRejectedValue(new Error('db down'))
    expect((await post(markThreadReadEndpoint, undefined, { id: 't1' }, null)).status).toBe(200)
    expect(svc.markThreadRead).toHaveBeenCalledWith(mctx, 't1')
  })
  it('markAllDelivered is 200 even if the service throws', async () => {
    svc.markAllDelivered.mockRejectedValue(new Error('db down'))
    expect((await post(markAllDeliveredEndpoint, undefined, {}, null)).status).toBe(200)
  })
})

describe('block / unblock / report', () => {
  it('blocks a player', async () => {
    svc.blockPlayer.mockResolvedValue({ ok: true })
    const res = await post(blockPlayerEndpoint, undefined, { playerId: U2 }, null, 'PUT')
    expect(res.status).toBe(200)
    expect(svc.blockPlayer).toHaveBeenCalledWith(mctx, U2)
  })
  it('400s blocking yourself and a non-uuid id', async () => {
    svc.blockPlayer.mockResolvedValue(fail('validation', 'You cannot block yourself.'))
    expect((await post(blockPlayerEndpoint, undefined, { playerId: U2 }, null, 'PUT')).status).toBe(400)
    expect((await post(blockPlayerEndpoint, undefined, { playerId: 'nope' }, null, 'PUT')).status).toBe(400)
  })
  it('unblocks', async () => {
    svc.unblockPlayer.mockResolvedValue({ ok: true })
    expect((await post(unblockPlayerEndpoint, undefined, { playerId: U2 }, null, 'DELETE')).status).toBe(200)
  })
  it('reports with the reason and optional message id', async () => {
    svc.reportThread.mockResolvedValue({ ok: true })
    const res = await post(reportThreadEndpoint, { reason: 'spam', messageId: U2 }, { id: 't1' }, null)
    expect(res.status).toBe(200)
    expect(svc.reportThread).toHaveBeenCalledWith(mctx, { threadId: 't1', messageId: U2, reason: 'spam' })
  })
  it('400s a missing or over-long reason', async () => {
    expect((await post(reportThreadEndpoint, { reason: 'x'.repeat(1001) }, { id: 't1' }, null)).status).toBe(400)
    svc.reportThread.mockResolvedValue(fail('validation', 'Add a reason so staff can act on it'))
    expect((await post(reportThreadEndpoint, { reason: '  ' }, { id: 't1' }, null)).status).toBe(400)
  })
})
