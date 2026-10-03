import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Errors } from '../errors'

const { authenticate } = vi.hoisted(() => ({ authenticate: vi.fn() }))
vi.mock('../auth', () => ({ authenticate, optionalAuth: vi.fn() }))

const { getPrefs, patchPrefs } = vi.hoisted(() => ({ getPrefs: vi.fn(), patchPrefs: vi.fn() }))
vi.mock('@/lib/notifications/prefs-service', () => ({ getPrefs, patchPrefs }))

const { listMutes, setTypeMute, setPostMute, clearTypeMute, clearPostMute } = vi.hoisted(() => ({
  listMutes: vi.fn(), setTypeMute: vi.fn(), setPostMute: vi.fn(), clearTypeMute: vi.fn(), clearPostMute: vi.fn(),
}))
vi.mock('@/lib/notifications/mute-service', () => ({ listMutes, setTypeMute, setPostMute, clearTypeMute, clearPostMute }))

const { markRead, markAllRead } = vi.hoisted(() => ({ markRead: vi.fn(), markAllRead: vi.fn() }))
vi.mock('@/lib/notifications/inbox-service', () => ({ markRead, markAllRead }))

const { sendTestPushToPlayer } = vi.hoisted(() => ({ sendTestPushToPlayer: vi.fn() }))
vi.mock('@/lib/notifications/test-push-service', () => ({ sendTestPushToPlayer }))

import {
  getNotificationPrefsEndpoint, patchNotificationPrefsEndpoint,
  getNotificationMutesEndpoint, postNotificationMuteEndpoint, deleteNotificationMuteEndpoint,
  postNotificationReadEndpoint, postNotificationsReadAllEndpoint, postTestPushEndpoint,
} from './notifications'
import { effectivePrefs } from '@/lib/notifications/prefs'

const ctx = { userId: 'u1', admin: 'admin' }
const POST = '5b1c1f6e-2f4a-4c1e-9d55-1f0b6f5a1111'
const NID = '0b9f3c1a-7d2e-4b8a-8f10-2c3d4e5f6a7b'

function req(method: string, body?: unknown) {
  return new Request('https://x.test/api/mobile/v1/notifications/x', {
    method,
    headers: { 'content-type': 'application/json', authorization: 'Bearer t' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

beforeEach(() => {
  for (const m of [authenticate, getPrefs, patchPrefs, listMutes, setTypeMute, setPostMute, clearTypeMute, clearPostMute, markRead, markAllRead, sendTestPushToPlayer]) m.mockReset()
  authenticate.mockResolvedValue(ctx)
  getPrefs.mockResolvedValue(effectivePrefs({}))
  patchPrefs.mockResolvedValue(effectivePrefs({}))
})

describe('every notifications endpoint requires a signed-in user', () => {
  it.each([
    ['getNotificationPrefs', () => getNotificationPrefsEndpoint.handler(req('GET'))],
    ['patchNotificationPrefs', () => patchNotificationPrefsEndpoint.handler(req('PATCH', {}))],
    ['getNotificationMutes', () => getNotificationMutesEndpoint.handler(req('GET'))],
    ['postNotificationMute', () => postNotificationMuteEndpoint.handler(req('POST', { scope: 'type', type: 'post_reaction', duration: '1h' }))],
    ['deleteNotificationMute', () => deleteNotificationMuteEndpoint.handler(req('DELETE', { scope: 'type', type: 'post_reaction' }))],
    ['postNotificationRead', () => postNotificationReadEndpoint.handler(req('POST'), { params: { id: NID } })],
    ['postNotificationsReadAll', () => postNotificationsReadAllEndpoint.handler(req('POST'))],
    ['postTestPush', () => postTestPushEndpoint.handler(req('POST'))],
  ])('%s -> 401 without a session', async (_n, call) => {
    authenticate.mockRejectedValue(Errors.unauthorized())
    const res = await call()
    expect(res.status).toBe(401)
    expect((await res.json()).error.code).toBe('unauthorized')
  })
})

describe('prefs', () => {
  it('GET returns the effective prefs for the caller', async () => {
    const res = await getNotificationPrefsEndpoint.handler(req('GET'))
    expect(getPrefs).toHaveBeenCalledWith('admin', 'u1')
    const { data } = await res.json()
    expect(Object.keys(data.push)).toHaveLength(17)
    expect(Object.keys(data.whatsapp)).toHaveLength(6)
    expect(Object.keys(data.achievementSharing)).toHaveLength(5)
  })
  it('PATCH merges the sent sections and returns the full effective prefs', async () => {
    const res = await patchNotificationPrefsEndpoint.handler(req('PATCH', { push: { post_reaction: false } }))
    expect(res.status).toBe(200)
    expect(patchPrefs).toHaveBeenCalledWith('admin', 'u1', { push: { post_reaction: false } })
  })
  it('PATCH with an empty body is a no-op returning current prefs', async () => {
    const res = await patchNotificationPrefsEndpoint.handler(req('PATCH', {}))
    expect(res.status).toBe(200)
    expect(patchPrefs).toHaveBeenCalledWith('admin', 'u1', {})
  })
  it.each([
    ['unknown key', { push: { bogus: true } }],
    ['non-boolean', { push: { post_reaction: 'no' } }],
    ['status_removed', { push: { status_removed: false } }],
    ['unknown section', { extra: { a: true } }],
  ])('PATCH rejects %s with validation_failed and no write', async (_n, body) => {
    const res = await patchNotificationPrefsEndpoint.handler(req('PATCH', body))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error.code).toBe('validation_failed')
    expect(json.error.fields).toBeTruthy()
    expect(patchPrefs).not.toHaveBeenCalled()
  })
  it('PATCH with a body that is not JSON is a 400, not a 500', async () => {
    const res = await patchNotificationPrefsEndpoint.handler(
      new Request('https://x.test/x', { method: 'PATCH', headers: { authorization: 'Bearer t' }, body: 'nope' }),
    )
    expect(res.status).toBe(400)
  })
})

describe('mutes', () => {
  it('GET returns the live mutes', async () => {
    listMutes.mockResolvedValue({ types: [{ type: 'post_reaction', mutedUntil: '2099-01-01T00:00:00.000Z' }], posts: [] })
    const res = await getNotificationMutesEndpoint.handler(req('GET'))
    expect(listMutes).toHaveBeenCalledWith('admin', 'u1')
    expect((await res.json()).data.types).toHaveLength(1)
  })
  it('POST type mute calls setTypeMute for the caller', async () => {
    setTypeMute.mockResolvedValue({ ok: true })
    const res = await postNotificationMuteEndpoint.handler(req('POST', { scope: 'type', type: 'post_reaction', duration: 'always' }))
    expect(setTypeMute).toHaveBeenCalledWith('admin', 'u1', 'post_reaction', 'always')
    expect((await res.json()).data).toEqual({ ok: true })
  })
  it('POST post mute calls setPostMute for the caller', async () => {
    setPostMute.mockResolvedValue({ ok: true })
    const res = await postNotificationMuteEndpoint.handler(req('POST', { scope: 'post', postId: POST, duration: '1w' }))
    expect(setPostMute).toHaveBeenCalledWith('admin', 'u1', POST, '1w')
    expect(res.status).toBe(200)
  })
  it.each([
    ['status_removed', { scope: 'type', type: 'status_removed', duration: '1h' }],
    ['unknown type', { scope: 'type', type: 'nope', duration: '1h' }],
    ['bad duration', { scope: 'type', type: 'post_reaction', duration: '1d' }],
    ['non-uuid post id', { scope: 'post', postId: 'abc', duration: '1h' }],
    ['missing scope', { type: 'post_reaction', duration: '1h' }],
  ])('POST rejects %s', async (_n, body) => {
    const res = await postNotificationMuteEndpoint.handler(req('POST', body))
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('validation_failed')
    expect(setTypeMute).not.toHaveBeenCalled()
    expect(setPostMute).not.toHaveBeenCalled()
  })
  it('POST reports a failed write as a generic 500, not success', async () => {
    setTypeMute.mockResolvedValue({ ok: false, error: 'failed' })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await postNotificationMuteEndpoint.handler(req('POST', { scope: 'type', type: 'post_reaction', duration: '1h' }))
    expect(res.status).toBe(500)
    expect((await res.json()).error.code).toBe('internal')
    spy.mockRestore()
  })
  it('DELETE type and post unmute for the caller', async () => {
    const a = await deleteNotificationMuteEndpoint.handler(req('DELETE', { scope: 'type', type: 'post_reaction' }))
    expect(clearTypeMute).toHaveBeenCalledWith('admin', 'u1', 'post_reaction')
    expect((await a.json()).data).toEqual({ ok: true })
    const b = await deleteNotificationMuteEndpoint.handler(req('DELETE', { scope: 'post', postId: POST }))
    expect(clearPostMute).toHaveBeenCalledWith('admin', 'u1', POST)
    expect(b.status).toBe(200)
  })
  it('DELETE rejects an unknown type', async () => {
    const res = await deleteNotificationMuteEndpoint.handler(req('DELETE', { scope: 'type', type: 'nope' }))
    expect(res.status).toBe(400)
  })
})

describe('read and read-all', () => {
  it('marks the caller own notification read', async () => {
    markRead.mockResolvedValue('ok')
    const res = await postNotificationReadEndpoint.handler(req('POST'), { params: { id: NID } })
    expect(markRead).toHaveBeenCalledWith('admin', 'u1', NID)
    expect((await res.json()).data).toEqual({ ok: true })
  })
  it('404s for an unknown or someone else id', async () => {
    markRead.mockResolvedValue('not_found')
    const res = await postNotificationReadEndpoint.handler(req('POST'), { params: { id: NID } })
    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('not_found')
  })
  it('404s a malformed id without touching the database', async () => {
    const res = await postNotificationReadEndpoint.handler(req('POST'), { params: { id: 'abc' } })
    expect(res.status).toBe(404)
    expect(markRead).not.toHaveBeenCalled()
  })
  it('read-all returns how many rows it updated, for the caller only', async () => {
    markAllRead.mockResolvedValue(3)
    const res = await postNotificationsReadAllEndpoint.handler(req('POST'))
    expect(markAllRead).toHaveBeenCalledWith('admin', 'u1')
    expect((await res.json()).data).toEqual({ updated: 3 })
  })
})

describe('test push', () => {
  it('sends to the caller own devices', async () => {
    sendTestPushToPlayer.mockResolvedValue('ok')
    const res = await postTestPushEndpoint.handler(req('POST'))
    expect(sendTestPushToPlayer).toHaveBeenCalledWith('admin', 'u1')
    expect((await res.json()).data).toEqual({ ok: true })
  })
  it('404s when the caller has no registered device', async () => {
    sendTestPushToPlayer.mockResolvedValue('no_device')
    const res = await postTestPushEndpoint.handler(req('POST'))
    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('not_found')
  })
  it('surfaces an undelivered test as a generic 500, never as sent', async () => {
    sendTestPushToPlayer.mockRejectedValue(new Error('delivered to 0'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await postTestPushEndpoint.handler(req('POST'))
    expect(res.status).toBe(500)
    spy.mockRestore()
  })
})
