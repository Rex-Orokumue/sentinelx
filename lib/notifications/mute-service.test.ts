import { describe, it, expect } from 'vitest'
import { fakeAdmin, argsOf, methods } from './fake-admin'
import { ALWAYS_MUTED_UNTIL } from './mutes'
import { listMutes, setTypeMute, setPostMute, clearTypeMute, clearPostMute } from './mute-service'

const POST = '5b1c1f6e-2f4a-4c1e-9d55-1f0b6f5a1111'

describe('setTypeMute', () => {
  it('a timed mute upserts one row keyed on player+type with a future expiry', async () => {
    const { admin, calls, rpcCalls } = fakeAdmin()
    const before = Date.now()
    expect(await setTypeMute(admin, 'u1', 'post_reaction', '1h')).toEqual({ ok: true })
    const [row, opts] = argsOf(calls[0], 'upsert') as [Record<string, unknown>, Record<string, unknown>]
    expect(calls[0].table).toBe('notification_mutes')
    expect(row).toMatchObject({ player_id: 'u1', notification_type: 'post_reaction', post_id: null })
    expect(new Date(row.muted_until as string).getTime()).toBeGreaterThan(before + 59 * 60 * 1000)
    expect(opts).toEqual({ onConflict: 'player_id,notification_type' })
    expect(rpcCalls).toEqual([])
  })
  it('always flips push[type]=false through the atomic RPC and removes any timed row', async () => {
    const { admin, calls, rpcCalls } = fakeAdmin()
    expect(await setTypeMute(admin, 'u1', 'post_reaction', 'always')).toEqual({ ok: true })
    expect(rpcCalls).toEqual([['jsonb_merge_notification_prefs', { p_id: 'u1', p_key: 'push', p_patch: { post_reaction: false } }]])
    expect(calls.some((c) => c.table === 'notification_mutes' && methods(c).includes('delete'))).toBe(true)
  })
  it('reports failure instead of throwing', async () => {
    const { admin } = fakeAdmin(() => ({ error: { message: 'x' } }))
    expect(await setTypeMute(admin, 'u1', 'post_reaction', '1w')).toEqual({ ok: false, error: 'failed' })
    const { admin: a2 } = fakeAdmin(() => ({}), { error: { message: 'x' } })
    expect(await setTypeMute(a2, 'u1', 'post_reaction', 'always')).toEqual({ ok: false, error: 'failed' })
  })
})

describe('setPostMute', () => {
  it('upserts keyed on player+post; always uses the far-future sentinel', async () => {
    const { admin, calls } = fakeAdmin()
    await setPostMute(admin, 'u1', POST, 'always')
    const [row, opts] = argsOf(calls[0], 'upsert') as [Record<string, unknown>, Record<string, unknown>]
    expect(row).toEqual({ player_id: 'u1', post_id: POST, notification_type: null, muted_until: ALWAYS_MUTED_UNTIL })
    expect(opts).toEqual({ onConflict: 'player_id,post_id' })
  })
  it('reports failure when the upsert errors', async () => {
    const { admin } = fakeAdmin(() => ({ error: { message: 'x' } }))
    expect(await setPostMute(admin, 'u1', POST, '1h')).toEqual({ ok: false, error: 'failed' })
  })
})

describe('clearTypeMute', () => {
  it('deletes the row and re-enables the pref only when it was stored as exactly false', async () => {
    const { admin, rpcCalls, calls } = fakeAdmin((op) =>
      op.table === 'profiles' ? { data: { notification_prefs: { push: { post_reaction: false } } } } : {},
    )
    await clearTypeMute(admin, 'u1', 'post_reaction')
    expect(calls.some((c) => c.table === 'notification_mutes' && methods(c).includes('delete'))).toBe(true)
    expect(rpcCalls).toEqual([['jsonb_merge_notification_prefs', { p_id: 'u1', p_key: 'push', p_patch: { post_reaction: true } }]])
  })
  it('does not touch prefs when the type was not muted always', async () => {
    const { admin, rpcCalls } = fakeAdmin((op) => (op.table === 'profiles' ? { data: { notification_prefs: { push: {} } } } : {}))
    await clearTypeMute(admin, 'u1', 'post_reaction')
    expect(rpcCalls).toEqual([])
  })
})

describe('clearPostMute', () => {
  it('deletes only the caller row for that post', async () => {
    const { admin, calls } = fakeAdmin()
    await clearPostMute(admin, 'u1', POST)
    const eqs = calls[0].ops.filter(([m]) => m === 'eq').map(([, a]) => a)
    expect(eqs).toEqual([['player_id', 'u1'], ['post_id', POST]])
  })
})

describe('listMutes', () => {
  it('returns only live rows, split by scope, in camelCase', async () => {
    const { admin, calls } = fakeAdmin(() => ({
      data: [
        { notification_type: 'post_reaction', post_id: null, muted_until: '2099-01-01T00:00:00.000Z' },
        { notification_type: null, post_id: POST, muted_until: ALWAYS_MUTED_UNTIL },
      ],
    }))
    const out = await listMutes(admin, 'u1', new Date('2026-10-03T00:00:00Z'))
    expect(argsOf(calls[0], 'gt')).toEqual(['muted_until', '2026-10-03T00:00:00.000Z'])
    expect(out).toEqual({
      types: [{ type: 'post_reaction', mutedUntil: '2099-01-01T00:00:00.000Z' }],
      posts: [{ postId: POST, mutedUntil: ALWAYS_MUTED_UNTIL }],
    })
  })
})
