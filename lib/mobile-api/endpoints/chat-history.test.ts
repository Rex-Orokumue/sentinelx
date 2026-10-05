import { describe, it, expect, vi, beforeEach } from 'vitest'

const { authenticate } = vi.hoisted(() => ({ authenticate: vi.fn() }))
vi.mock('../auth', () => ({ authenticate, optionalAuth: vi.fn(), strictOptionalAuth: vi.fn() }))
const { listChatHistory, clearChatHistory } = vi.hoisted(() => ({ listChatHistory: vi.fn(), clearChatHistory: vi.fn() }))
vi.mock('@/lib/chat/history', () => ({ listChatHistory, clearChatHistory }))
vi.mock('groq-sdk', () => ({ default: class {} }))

import { getChatHistoryEndpoint, deleteChatHistoryEndpoint } from './chat'

const get = (qs = '') => getChatHistoryEndpoint.handler(new Request(`https://x.test/api/mobile/v1/chat/history${qs}`))
beforeEach(() => {
  authenticate.mockReset().mockResolvedValue({ userId: 'u1', admin: 'admin', userClient: 'sb' })
  listChatHistory.mockReset().mockResolvedValue({ messages: [{ id: 'm1', role: 'user', content: 'hi', createdAt: '2026-10-05T10:00:00+00:00' }], nextBefore: null })
  clearChatHistory.mockReset().mockResolvedValue(undefined)
})

describe('GET /chat/history', () => {
  it('returns { messages, nextBefore } for the signed-in caller only', async () => {
    const res = await get()
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ messages: [{ id: 'm1', role: 'user', content: 'hi', createdAt: '2026-10-05T10:00:00+00:00' }], nextBefore: null })
    expect(listChatHistory).toHaveBeenCalledWith('admin', 'u1', { before: undefined, limit: undefined })
  })
  it('passes before and limit through', async () => {
    await get('?before=abc&limit=25')
    expect(listChatHistory).toHaveBeenCalledWith('admin', 'u1', { before: 'abc', limit: 25 })
  })
  it('limit above 100, below 1 or non-numeric is validation_failed', async () => {
    for (const qs of ['?limit=101', '?limit=0', '?limit=abc']) {
      const res = await get(qs)
      expect(res.status, qs).toBe(400)
      expect((await res.json()).error.code).toBe('validation_failed')
    }
    expect(listChatHistory).not.toHaveBeenCalled()
  })
  it('requires sign-in', async () => {
    const { ApiError } = await import('../errors')
    authenticate.mockRejectedValue(new ApiError(401, 'unauthorized', 'Sign in required.'))
    expect((await get()).status).toBe(401)
  })
})

describe('DELETE /chat/history', () => {
  it('clears only the caller’s history and returns { ok: true }', async () => {
    const res = await deleteChatHistoryEndpoint.handler(new Request('https://x.test/api/mobile/v1/chat/history', { method: 'DELETE' }))
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ ok: true })
    expect(clearChatHistory).toHaveBeenCalledWith('admin', 'u1')
  })
})
