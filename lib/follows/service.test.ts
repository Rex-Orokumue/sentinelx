import { describe, it, expect, vi } from 'vitest'
import type { FollowClient } from './service'
import { followPlayer, unfollowPlayer } from './service'

function client(opts: {
  upserted?: { follower_id: string }[] | null
  error?: { code: string } | null
  me?: { display_name: string | null; username: string | null } | null
}): FollowClient {
  const upsert = vi.fn(() => ({ select: async () => ({ data: opts.upserted ?? null, error: opts.error ?? null }) }))
  const del = vi.fn(() => ({ eq: () => ({ eq: async () => ({ error: opts.error ?? null }) }) }))
  return {
    from: (t: string) =>
      t === 'player_follows'
        ? { upsert, delete: del }
        : { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.me ?? null }) }) }) },
  } as unknown as FollowClient
}

describe('followPlayer', () => {
  it('rejects self-follow without touching the DB or notifying', async () => {
    const notify = vi.fn()
    expect(await followPlayer(client({}), 'a', 'a', { notify })).toEqual({ ok: false, code: 'self' })
    expect(notify).not.toHaveBeenCalled()
  })

  it('creates a follow and notifies exactly once', async () => {
    const notify = vi.fn()
    const c = client({ upserted: [{ follower_id: 'a' }], me: { display_name: 'Ada', username: 'ada' } })
    expect(await followPlayer(c, 'a', 'b', { notify })).toEqual({ ok: true, created: true })
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith('b', { type: 'new_follower', followerName: 'Ada' }, 'new_follower', { link: '/players/ada' })
  })

  it('a duplicate follow reports created:false and does NOT notify', async () => {
    const notify = vi.fn()
    expect(await followPlayer(client({ upserted: [] }), 'a', 'b', { notify })).toEqual({ ok: true, created: false })
    expect(notify).not.toHaveBeenCalled()
  })

  it('maps RLS 42501 (dm_blocks) to blocked', async () => {
    expect(await followPlayer(client({ error: { code: '42501' } }), 'a', 'b', { notify: vi.fn() })).toEqual({ ok: false, code: 'blocked' })
  })

  it('maps any other error to error', async () => {
    expect(await followPlayer(client({ error: { code: 'XX000' } }), 'a', 'b', { notify: vi.fn() })).toEqual({ ok: false, code: 'error' })
  })

  it('falls back to "Someone" and no link when the follower has no name', async () => {
    const notify = vi.fn()
    await followPlayer(client({ upserted: [{ follower_id: 'a' }], me: null }), 'a', 'b', { notify })
    expect(notify.mock.calls[0][1]).toEqual({ type: 'new_follower', followerName: 'Someone' })
    expect(notify.mock.calls[0][3]).toEqual({ link: undefined })
  })

  it('uses the username when there is no display name', async () => {
    const notify = vi.fn()
    await followPlayer(client({ upserted: [{ follower_id: 'a' }], me: { display_name: null, username: 'ada' } }), 'a', 'b', { notify })
    expect(notify.mock.calls[0][1]).toEqual({ type: 'new_follower', followerName: 'ada' })
  })
})

describe('unfollowPlayer', () => {
  it('ok on success, error on failure', async () => {
    expect(await unfollowPlayer(client({}), 'a', 'b')).toEqual({ ok: true })
    expect(await unfollowPlayer(client({ error: { code: 'x' } }), 'a', 'b')).toEqual({ ok: false, code: 'error' })
  })
})
