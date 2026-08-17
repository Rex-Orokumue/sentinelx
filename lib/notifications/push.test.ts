import { describe, it, expect, vi } from 'vitest'

const sendFCMToPlayer = vi.fn().mockResolvedValue(undefined)
vi.mock('./fcm', () => ({ sendFCMToPlayer, sendToTokens: vi.fn() }))

const maybeSingle = vi.fn()
const eq = vi.fn(() => ({ maybeSingle }))
const select = vi.fn(() => ({ eq }))
const from = vi.fn(() => ({ select }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from }) }))

describe('pushToPlayer', () => {
  it('sends when the pref key is absent (default true)', async () => {
    maybeSingle.mockResolvedValueOnce({ data: { notification_prefs: { push: {} } } })
    const { pushToPlayer } = await import('./push')
    await pushToPlayer('p1', 'wager_settled', { title: 'T', body: 'B' }, { url: '/x' })
    expect(sendFCMToPlayer).toHaveBeenCalledWith('p1', { title: 'T', body: 'B' }, { url: '/x', type: 'wager_settled' })
  })

  it('skips when the player turned the type off', async () => {
    sendFCMToPlayer.mockClear()
    maybeSingle.mockResolvedValueOnce({ data: { notification_prefs: { push: { wager_settled: false } } } })
    const { pushToPlayer } = await import('./push')
    await pushToPlayer('p1', 'wager_settled', { title: 'T', body: 'B' }, { url: '/x' })
    expect(sendFCMToPlayer).not.toHaveBeenCalled()
  })
})
