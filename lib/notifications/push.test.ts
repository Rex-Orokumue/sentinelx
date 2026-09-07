import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ALWAYS_MUTED_UNTIL, type MuteRow } from './mutes'

const sendFCMToPlayer = vi.fn().mockResolvedValue(undefined)
vi.mock('./fcm', () => ({ sendFCMToPlayer, sendToTokens: vi.fn() }))

const maybeSingle = vi.fn()
// notification_mutes is queried as .select().eq().gt() and resolves to a list;
// profiles as .select().eq().maybeSingle(). One mock has to serve both shapes.
let muteRows: MuteRow[] = []
const from = vi.fn((table: string) => {
  if (table === 'notification_mutes') {
    return {
      select: () => ({ eq: () => ({ gt: async () => ({ data: muteRows }) }) }),
    }
  }
  return { select: () => ({ eq: () => ({ maybeSingle }) }) }
})
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from }) }))

const future = new Date(Date.now() + 60 * 60 * 1000).toISOString()

beforeEach(() => {
  sendFCMToPlayer.mockClear()
  muteRows = []
})

describe('pushToPlayer', () => {
  it('sends when the pref key is absent (default true)', async () => {
    maybeSingle.mockResolvedValueOnce({ data: { notification_prefs: { push: {} } } })
    const { pushToPlayer } = await import('./push')
    await pushToPlayer('p1', 'wager_settled', { title: 'T', body: 'B' }, { url: '/x' })
    expect(sendFCMToPlayer).toHaveBeenCalledWith('p1', { title: 'T', body: 'B' }, { url: '/x', type: 'wager_settled' })
  })

  it('skips when the player turned the type off', async () => {
    maybeSingle.mockResolvedValueOnce({ data: { notification_prefs: { push: { wager_settled: false } } } })
    const { pushToPlayer } = await import('./push')
    await pushToPlayer('p1', 'wager_settled', { title: 'T', body: 'B' }, { url: '/x' })
    expect(sendFCMToPlayer).not.toHaveBeenCalled()
  })
})

// Reactions push by default now, which is the easiest way to make someone
// disable notifications wholesale — and then the fixture assignments go with
// them. A mute has to actually stop the push for that to be a real
// alternative.
describe('pushToPlayer — mutes', () => {
  it('skips a muted type', async () => {
    maybeSingle.mockResolvedValueOnce({ data: { notification_prefs: { push: {} } } })
    muteRows = [{ notification_type: 'post_reaction', post_id: null, muted_until: future }]
    const { pushToPlayer } = await import('./push')
    await pushToPlayer('p1', 'post_reaction', { title: 'T', body: 'B' }, { url: '/x' })
    expect(sendFCMToPlayer).not.toHaveBeenCalled()
  })

  it('still sends a type that is not muted', async () => {
    maybeSingle.mockResolvedValueOnce({ data: { notification_prefs: { push: {} } } })
    muteRows = [{ notification_type: 'post_reaction', post_id: null, muted_until: future }]
    const { pushToPlayer } = await import('./push')
    await pushToPlayer('p1', 'match_assigned', { title: 'T', body: 'B' }, { url: '/x' })
    expect(sendFCMToPlayer).toHaveBeenCalled()
  })

  it('skips anything about a muted post, whatever the type', async () => {
    maybeSingle.mockResolvedValueOnce({ data: { notification_prefs: { push: {} } } })
    muteRows = [{ notification_type: null, post_id: 'post-9', muted_until: future }]
    const { pushToPlayer } = await import('./push')
    await pushToPlayer('p1', 'post_comment', { title: 'T', body: 'B' }, { url: '/x' }, { postId: 'post-9' })
    expect(sendFCMToPlayer).not.toHaveBeenCalled()
  })

  // Muting one busy thread must not silence the rest of the feed.
  it('still sends about a different post', async () => {
    maybeSingle.mockResolvedValueOnce({ data: { notification_prefs: { push: {} } } })
    muteRows = [{ notification_type: null, post_id: 'post-9', muted_until: future }]
    const { pushToPlayer } = await import('./push')
    await pushToPlayer('p1', 'post_comment', { title: 'T', body: 'B' }, { url: '/x' }, { postId: 'post-1' })
    expect(sendFCMToPlayer).toHaveBeenCalled()
  })

  it('treats an always mute as live', async () => {
    maybeSingle.mockResolvedValueOnce({ data: { notification_prefs: { push: {} } } })
    muteRows = [{ notification_type: 'post_comment', post_id: null, muted_until: ALWAYS_MUTED_UNTIL }]
    const { pushToPlayer } = await import('./push')
    await pushToPlayer('p1', 'post_comment', { title: 'T', body: 'B' }, { url: '/x' })
    expect(sendFCMToPlayer).not.toHaveBeenCalled()
  })
})
