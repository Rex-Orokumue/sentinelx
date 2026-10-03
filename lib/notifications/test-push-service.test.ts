import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeAdmin } from './fake-admin'

const { sendToTokens } = vi.hoisted(() => ({ sendToTokens: vi.fn() }))
vi.mock('./fcm', () => ({ sendToTokens }))

import { sendTestPushToPlayer, TEST_PUSH_NOTIFICATION, TEST_PUSH_DATA } from './test-push-service'

beforeEach(() => sendToTokens.mockReset())

describe('sendTestPushToPlayer', () => {
  it('sends to every token of the caller (and only the caller) through the real sender', async () => {
    const rows = [
      { id: 'r1', token: 't1', platform: 'android' },
      { id: 'r2', token: 't2', platform: 'web' },
    ]
    const { admin, calls } = fakeAdmin(() => ({ data: rows }))
    sendToTokens.mockResolvedValue({ attempted: 2, succeeded: 2 })
    expect(await sendTestPushToPlayer(admin, 'u1')).toBe('ok')
    expect(calls[0].table).toBe('fcm_tokens')
    expect(calls[0].ops.find(([m]) => m === 'eq')?.[1]).toEqual(['player_id', 'u1'])
    expect(sendToTokens).toHaveBeenCalledWith(rows, TEST_PUSH_NOTIFICATION, TEST_PUSH_DATA)
  })
  it('uses a clearly labelled message with a known type so the android channel applies', () => {
    expect(TEST_PUSH_NOTIFICATION.title).toContain('test')
    expect(TEST_PUSH_DATA.type).toBe('result_confirmed')
  })
  it('returns no_device without sending when the caller has no token', async () => {
    const { admin } = fakeAdmin(() => ({ data: [] }))
    expect(await sendTestPushToPlayer(admin, 'u1')).toBe('no_device')
    expect(sendToTokens).not.toHaveBeenCalled()
  })
  it('throws when nothing was delivered (unconfigured sender or every send rejected) instead of reporting sent', async () => {
    const { admin } = fakeAdmin(() => ({ data: [{ id: 'r1', token: 't1', platform: 'android' }] }))
    sendToTokens.mockResolvedValue({ attempted: 0, succeeded: 0 })
    await expect(sendTestPushToPlayer(admin, 'u1')).rejects.toThrow()
    sendToTokens.mockResolvedValue({ attempted: 1, succeeded: 0 })
    await expect(sendTestPushToPlayer(admin, 'u1')).rejects.toThrow()
  })
})
