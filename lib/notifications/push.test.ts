import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ALWAYS_MUTED_UNTIL, type MuteRow } from './mutes'
import type { NotificationInput } from './copy'

const WAGER: NotificationInput = { type: 'wager_settled', won: true, payout: 10, stake: 5 }
const SAMPLE: Record<string, NotificationInput> = {
  wager_settled: WAGER,
  post_reaction: { type: 'post_reaction', onMatch: false, reaction: '🔥' },
  post_comment: { type: 'post_comment', onMatch: false, excerpt: 'hi' },
  match_assigned: { type: 'fixture_updated', round: 'final', opponent: null },
}

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
    await pushToPlayer('p1', WAGER, { url: '/x' })
    expect(sendFCMToPlayer).toHaveBeenCalledWith(
      'p1',
      { title: expect.any(String), body: expect.any(String) },
      { url: '/x', type: 'wager_settled' },
    )
  })

  it('skips when the player turned the type off', async () => {
    maybeSingle.mockResolvedValueOnce({ data: { notification_prefs: { push: { wager_settled: false } } } })
    const { pushToPlayer } = await import('./push')
    await pushToPlayer('p1', WAGER, { url: '/x' })
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
    await pushToPlayer('p1', SAMPLE['post_reaction'], { url: '/x' })
    expect(sendFCMToPlayer).not.toHaveBeenCalled()
  })

  it('still sends a type that is not muted', async () => {
    maybeSingle.mockResolvedValueOnce({ data: { notification_prefs: { push: {} } } })
    muteRows = [{ notification_type: 'post_reaction', post_id: null, muted_until: future }]
    const { pushToPlayer } = await import('./push')
    await pushToPlayer('p1', SAMPLE['match_assigned'], { url: '/x' })
    expect(sendFCMToPlayer).toHaveBeenCalled()
  })

  it('skips anything about a muted post, whatever the type', async () => {
    maybeSingle.mockResolvedValueOnce({ data: { notification_prefs: { push: {} } } })
    muteRows = [{ notification_type: null, post_id: 'post-9', muted_until: future }]
    const { pushToPlayer } = await import('./push')
    await pushToPlayer('p1', SAMPLE['post_comment'], { url: '/x' }, { postId: 'post-9' })
    expect(sendFCMToPlayer).not.toHaveBeenCalled()
  })

  // Muting one busy thread must not silence the rest of the feed.
  it('still sends about a different post', async () => {
    maybeSingle.mockResolvedValueOnce({ data: { notification_prefs: { push: {} } } })
    muteRows = [{ notification_type: null, post_id: 'post-9', muted_until: future }]
    const { pushToPlayer } = await import('./push')
    await pushToPlayer('p1', SAMPLE['post_comment'], { url: '/x' }, { postId: 'post-1' })
    expect(sendFCMToPlayer).toHaveBeenCalled()
  })

  it('treats an always mute as live', async () => {
    maybeSingle.mockResolvedValueOnce({ data: { notification_prefs: { push: {} } } })
    muteRows = [{ notification_type: 'post_comment', post_id: null, muted_until: ALWAYS_MUTED_UNTIL }]
    const { pushToPlayer } = await import('./push')
    await pushToPlayer('p1', SAMPLE['post_comment'], { url: '/x' })
    expect(sendFCMToPlayer).not.toHaveBeenCalled()
  })
})
