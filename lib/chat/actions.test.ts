import { describe, it, expect, vi, beforeEach } from 'vitest'

const getUser = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ createClient: () => ({ auth: { getUser } }) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ __admin: true }) }))
const { listChatHistory, clearChatHistory } = vi.hoisted(() => ({ listChatHistory: vi.fn(), clearChatHistory: vi.fn() }))
vi.mock('./history', () => ({ listChatHistory, clearChatHistory }))

import { getChatHistory, clearMyChatHistory } from './actions'

beforeEach(() => {
  getUser.mockReset().mockResolvedValue({ data: { user: { id: 'u1' } } })
  listChatHistory.mockReset().mockResolvedValue({ messages: [{ id: 'm1', role: 'user', content: 'hi', createdAt: 'x' }], nextBefore: null })
  clearChatHistory.mockReset().mockResolvedValue(undefined)
})

describe('getChatHistory', () => {
  it('returns the signed-in caller’s recent messages as role/content only', async () => {
    expect(await getChatHistory()).toEqual({ ok: true, messages: [{ role: 'user', content: 'hi' }] })
    expect(listChatHistory).toHaveBeenCalledWith({ __admin: true }, 'u1', { limit: 50 })
  })
  it('logged out is an error and reads nothing', async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    expect(await getChatHistory()).toEqual({ ok: false, error: 'Please log in.' })
    expect(listChatHistory).not.toHaveBeenCalled()
  })
  it('a read failure is a generic error', async () => {
    listChatHistory.mockRejectedValue(new Error('boom'))
    expect(await getChatHistory()).toEqual({ ok: false, error: 'Could not load chat history.' })
  })
})

describe('clearMyChatHistory', () => {
  it('clears only the session user’s history', async () => {
    expect(await clearMyChatHistory()).toEqual({ ok: true })
    expect(clearChatHistory).toHaveBeenCalledWith({ __admin: true }, 'u1')
  })
  it('logged out clears nothing', async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    expect(await clearMyChatHistory()).toEqual({ ok: false, error: 'Please log in.' })
    expect(clearChatHistory).not.toHaveBeenCalled()
  })
  it('a delete failure is reported, not swallowed', async () => {
    clearChatHistory.mockRejectedValue(new Error('boom'))
    expect(await clearMyChatHistory()).toEqual({ ok: false, error: 'Could not clear chat history.' })
  })
})
