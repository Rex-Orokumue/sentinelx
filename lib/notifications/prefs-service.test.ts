import { describe, it, expect } from 'vitest'
import { fakeAdmin, argsOf } from './fake-admin'
import { getPrefs, patchPrefs } from './prefs-service'

describe('getPrefs', () => {
  it('reads the caller profile and returns the effective prefs', async () => {
    const { admin, calls } = fakeAdmin(() => ({ data: { notification_prefs: { push: { post_reaction: false } } } }))
    const p = await getPrefs(admin, 'u1')
    expect(calls[0].table).toBe('profiles')
    expect(argsOf(calls[0], 'eq')).toEqual(['id', 'u1'])
    expect(p.push.post_reaction).toBe(false)
    expect(p.push.match_reminder).toBe(true)
  })
  it('returns all defaults when the profile row is missing', async () => {
    const { admin } = fakeAdmin(() => ({ data: null }))
    expect((await getPrefs(admin, 'u1')).whatsapp.challenge_completed).toBe(false)
  })
})

describe('patchPrefs', () => {
  it('merges each present section through the RPC with the stored key names, then re-reads', async () => {
    const { admin, rpcCalls } = fakeAdmin(() => ({ data: { notification_prefs: { push: { post_comment: false } } } }))
    const out = await patchPrefs(admin, 'u1', { push: { post_comment: false }, achievementSharing: { social: true } })
    expect(rpcCalls).toEqual([
      ['jsonb_merge_notification_prefs', { p_id: 'u1', p_key: 'push', p_patch: { post_comment: false } }],
      ['jsonb_merge_notification_prefs', { p_id: 'u1', p_key: 'achievement_sharing', p_patch: { social: true } }],
    ])
    expect(out.push.post_comment).toBe(false)
  })
  it('skips absent sections and does not call the RPC for an empty patch', async () => {
    const { admin, rpcCalls } = fakeAdmin(() => ({ data: { notification_prefs: {} } }))
    await patchPrefs(admin, 'u1', {})
    await patchPrefs(admin, 'u1', { push: {} })
    expect(rpcCalls).toEqual([])
  })
  it('throws when the RPC fails', async () => {
    const { admin } = fakeAdmin(() => ({ data: null }), { error: { message: 'boom' } })
    await expect(patchPrefs(admin, 'u1', { push: { post_comment: true } })).rejects.toThrow()
  })
})
