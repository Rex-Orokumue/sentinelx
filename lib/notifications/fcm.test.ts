import { describe, it, expect, vi, beforeEach } from 'vitest'

const sendEachForMulticast = vi.fn()
vi.mock('firebase-admin/app', () => ({
  getApps: () => [],
  initializeApp: vi.fn(() => ({})),
  cert: vi.fn((c) => c),
}))
vi.mock('firebase-admin/messaging', () => ({
  getMessaging: () => ({ sendEachForMulticast }),
}))

const deleteIn = vi.fn().mockResolvedValue({ error: null })
const del = vi.fn(() => ({ in: deleteIn }))
const eq = vi.fn().mockResolvedValue({ data: [] })
const select = vi.fn(() => ({ eq }))
const from = vi.fn(() => ({ select, delete: del }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from }) }))

describe('sendToTokens', () => {
  beforeEach(() => {
    vi.stubEnv(
      'FIREBASE_SERVICE_ACCOUNT_JSON',
      JSON.stringify({
        project_id: 'sx-test',
        client_email: 'sa@sx-test.iam.gserviceaccount.com',
        private_key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
      }),
    )
    sendEachForMulticast.mockReset()
    deleteIn.mockClear()
  })

  it('deletes tokens FCM reports as unregistered', async () => {
    sendEachForMulticast.mockResolvedValueOnce({
      responses: [
        { success: true },
        { success: false, error: { code: 'messaging/registration-token-not-registered' } },
      ],
    })
    const { sendToTokens } = await import('./fcm')
    await sendToTokens(
      [{ id: 'row-1', token: 'tok-1' }, { id: 'row-2', token: 'tok-2' }],
      { title: 'Hi', body: 'There' },
      { url: '/x' },
    )
    expect(deleteIn).toHaveBeenCalledWith('id', ['row-2'])
  })

  it('does not call FCM when credentials are unset', async () => {
    vi.unstubAllEnvs()
    vi.resetModules()
    const { sendToTokens } = await import('./fcm')
    await sendToTokens([{ id: 'row-1', token: 'tok-1' }], { title: 'Hi', body: 'There' }, { url: '/x' })
    expect(sendEachForMulticast).not.toHaveBeenCalled()
  })

  it('does not call FCM when the JSON is malformed', async () => {
    vi.unstubAllEnvs()
    vi.stubEnv('FIREBASE_SERVICE_ACCOUNT_JSON', '{not valid json')
    vi.resetModules()
    const { sendToTokens } = await import('./fcm')
    await sendToTokens([{ id: 'row-1', token: 'tok-1' }], { title: 'Hi', body: 'There' }, { url: '/x' })
    expect(sendEachForMulticast).not.toHaveBeenCalled()
  })

  // A top-level `notification` field makes browsers auto-display the push
  // themselves, on top of the display our own onBackgroundMessage/onMessage
  // handlers already trigger — the player sees the same notification twice.
  // Sending data-only (title/body folded into `data`) leaves exactly one
  // code path in control of showNotification().
  it('sends title/body via data only, not a top-level notification field', async () => {
    sendEachForMulticast.mockResolvedValueOnce({ responses: [{ success: true }] })
    vi.resetModules()
    const { sendToTokens } = await import('./fcm')
    await sendToTokens([{ id: 'row-1', token: 'tok-1' }], { title: 'Hi', body: 'There' }, { url: '/x', type: 'result_confirmed' })
    const call = sendEachForMulticast.mock.calls[0][0]
    expect(call.notification).toBeUndefined()
    expect(call.data).toMatchObject({ title: 'Hi', body: 'There', url: '/x', type: 'result_confirmed' })
  })

  // Data-only web push defaults to normal urgency, which Android Doze batches
  // and defers — a Galaxy S22 received test pushes minutes to hours late while
  // a laptop got them instantly. Normal urgency is the correct default for
  // background sync; it is wrong for a notification a player is waiting on.
  it('marks pushes high urgency so Android Doze does not defer them', async () => {
    sendEachForMulticast.mockResolvedValueOnce({ responses: [{ success: true }] })
    vi.resetModules()
    const { sendToTokens } = await import('./fcm')
    await sendToTokens([{ id: 'r1', token: 't1' }], { title: 'Hi', body: 'There' }, { url: '/x' })
    const call = sendEachForMulticast.mock.calls[0][0]
    expect(call.webpush.headers.Urgency).toBe('high')
  })

  // Without a TTL a push is dropped if the device is unreachable at that
  // instant; a match assignment is still worth delivering when the phone
  // comes back.
  it('sets a TTL so an offline device still receives it later', async () => {
    sendEachForMulticast.mockResolvedValueOnce({ responses: [{ success: true }] })
    vi.resetModules()
    const { sendToTokens } = await import('./fcm')
    await sendToTokens([{ id: 'r1', token: 't1' }], { title: 'Hi', body: 'There' }, { url: '/x' })
    const call = sendEachForMulticast.mock.calls[0][0]
    expect(Number(call.webpush.headers.TTL)).toBeGreaterThan(0)
  })

  it('still passes the click-through link', async () => {
    sendEachForMulticast.mockResolvedValueOnce({ responses: [{ success: true }] })
    vi.resetModules()
    const { sendToTokens } = await import('./fcm')
    await sendToTokens([{ id: 'r1', token: 't1' }], { title: 'Hi', body: 'There' }, { url: '/match/1' })
    expect(sendEachForMulticast.mock.calls[0][0].webpush.fcmOptions.link).toBe('/match/1')
  })
})

// The send path reported nothing — not on success, not on failure. Only
// stale-token cleanup had any visible effect, so a credentials error, a quota
// rejection or a malformed payload vanished without trace. That is why "push
// never arrives" could not be told apart from "push was never attempted".
// These assertions exist so it stays observable.
describe('sendToTokens observability', () => {
  beforeEach(() => {
    vi.stubEnv(
      'FIREBASE_SERVICE_ACCOUNT_JSON',
      JSON.stringify({
        project_id: 'sx-test',
        client_email: 'sa@sx-test.iam.gserviceaccount.com',
        private_key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
      }),
    )
    sendEachForMulticast.mockReset()
    deleteIn.mockClear()
  })

  it('logs a summary of every send', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    sendEachForMulticast.mockResolvedValueOnce({ responses: [{ success: true }, { success: true }] })
    vi.resetModules()
    const { sendToTokens } = await import('./fcm')
    await sendToTokens(
      [
        { id: 'r1', token: 't1' },
        { id: 'r2', token: 't2' },
      ],
      { title: 'Hi', body: 'There' },
      { url: '/x', type: 'result_confirmed' },
    )
    expect(log).toHaveBeenCalled()
    const line = JSON.stringify(log.mock.calls[0])
    expect(line).toContain('[FCM]')
    expect(line).toContain('result_confirmed')
    log.mockRestore()
  })

  // The case that matters: FCM rejected the message for a reason that is NOT
  // a stale token, so nothing is cleaned up and nothing else notices.
  it('logs the error code when a send fails for a non-stale reason', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    sendEachForMulticast.mockResolvedValueOnce({
      responses: [
        { success: false, error: { code: 'messaging/authentication-error', message: 'bad creds' } },
      ],
    })
    vi.resetModules()
    const { sendToTokens } = await import('./fcm')
    await sendToTokens([{ id: 'r1', token: 't1' }], { title: 'Hi', body: 'There' }, { url: '/x' })
    expect(err).toHaveBeenCalled()
    expect(JSON.stringify(err.mock.calls)).toContain('messaging/authentication-error')
    err.mockRestore()
  })

  it('does not log a failure when every send succeeds', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    sendEachForMulticast.mockResolvedValueOnce({ responses: [{ success: true }] })
    vi.resetModules()
    const { sendToTokens } = await import('./fcm')
    await sendToTokens([{ id: 'r1', token: 't1' }], { title: 'Hi', body: 'There' }, { url: '/x' })
    expect(err).not.toHaveBeenCalled()
    err.mockRestore()
  })

  // A player with no tokens at all is the most common reason a push "doesn't
  // arrive" — 90 of 102 players were in that state — and it looked identical
  // to a successful send.
  it('logs when there are no tokens to send to', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.resetModules()
    const { sendToTokens } = await import('./fcm')
    await sendToTokens([], { title: 'Hi', body: 'There' }, { url: '/x', type: 'match_assigned' })
    expect(JSON.stringify(log.mock.calls)).toContain('no tokens')
    log.mockRestore()
  })
})

const CREDS = JSON.stringify({
  project_id: 'sx-test',
  client_email: 'sa@sx-test.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----' + String.fromCharCode(10) + 'abc' + String.fromCharCode(10) + '-----END PRIVATE KEY-----' + String.fromCharCode(10),
})
const N = { title: 'Hi', body: 'There' }
const ok = (n: number) => ({ responses: Array.from({ length: n }, () => ({ success: true })) })

describe('sendToTokens platform partition', () => {
  beforeEach(() => {
    vi.stubEnv('FIREBASE_SERVICE_ACCOUNT_JSON', CREDS)
    sendEachForMulticast.mockReset()
    deleteIn.mockClear()
    vi.resetModules()
  })

  // Byte-for-byte guard for the website: this exact object is what web tokens received before the
  // android/ios branches existed. If this fails, the web payload changed.
  it('web payload is exactly the legacy data-only message', async () => {
    sendEachForMulticast.mockResolvedValueOnce(ok(1))
    const { sendToTokens } = await import('./fcm')
    await sendToTokens([{ id: 'r1', token: 'tok-1', platform: 'web' }], N, { url: '/x', type: 'wager_settled' })
    expect(sendEachForMulticast.mock.calls[0][0]).toEqual({
      tokens: ['tok-1'],
      data: { url: '/x', type: 'wager_settled', title: 'Hi', body: 'There' },
      webpush: { headers: { Urgency: 'high', TTL: '86400' }, fcmOptions: { link: '/x' } },
    })
  })

  it('android gets a notification block, high priority, 24h ttl and the type channel', async () => {
    sendEachForMulticast.mockResolvedValueOnce(ok(1))
    const { sendToTokens } = await import('./fcm')
    await sendToTokens([{ id: 'r1', token: 'a1', platform: 'android' }], N, { url: '/m', type: 'match_assigned' })
    const msg = sendEachForMulticast.mock.calls[0][0]
    expect(msg.tokens).toEqual(['a1'])
    expect(msg.notification).toEqual({ title: 'Hi', body: 'There' })
    expect(msg.android).toEqual({ priority: 'high', ttl: 86_400_000, notification: { channelId: 'matches_v1' } })
    expect(msg.data).toEqual({ url: '/m', type: 'match_assigned', title: 'Hi', body: 'There' })
    expect(msg.webpush).toBeUndefined()
    expect(msg.apns).toBeUndefined()
  })

  it('android with an unknown type still sends, without a channel id', async () => {
    sendEachForMulticast.mockResolvedValueOnce(ok(1))
    const { sendToTokens } = await import('./fcm')
    await sendToTokens([{ id: 'r1', token: 'a1', platform: 'android' }], N, { url: '/m', type: 'something_new' })
    expect(sendEachForMulticast.mock.calls[0][0].android.notification).toEqual({})
  })

  it('ios gets an apns alert with sound and the type as thread id (shape only; delivery unverified)', async () => {
    sendEachForMulticast.mockResolvedValueOnce(ok(1))
    const { sendToTokens } = await import('./fcm')
    await sendToTokens([{ id: 'r1', token: 'i1', platform: 'ios' }], N, { url: '/m', type: 'match_assigned' })
    const msg = sendEachForMulticast.mock.calls[0][0]
    expect(msg.apns.payload.aps).toEqual({ alert: { title: 'Hi', body: 'There' }, sound: 'default', 'thread-id': 'match_assigned' })
    expect(msg.apns.headers['apns-priority']).toBe('10')
    expect(msg.webpush).toBeUndefined()
    expect(msg.android).toBeUndefined()
  })

  it('treats a null, missing or unrecognised platform as web', async () => {
    sendEachForMulticast.mockResolvedValueOnce(ok(3))
    const { sendToTokens } = await import('./fcm')
    await sendToTokens(
      [{ id: 'a', token: 't1', platform: null }, { id: 'b', token: 't2' }, { id: 'c', token: 't3', platform: 'weird' }],
      N,
      { url: '/x', type: 'wager_settled' },
    )
    expect(sendEachForMulticast).toHaveBeenCalledTimes(1)
    expect(sendEachForMulticast.mock.calls[0][0].tokens).toEqual(['t1', 't2', 't3'])
    expect(sendEachForMulticast.mock.calls[0][0].webpush).toBeDefined()
  })

  it('sends one multicast per platform and cleans up stale tokens by the right row id', async () => {
    sendEachForMulticast
      .mockResolvedValueOnce(ok(1)) // web
      .mockResolvedValueOnce({ responses: [{ success: false, error: { code: 'messaging/registration-token-not-registered' } }] }) // android
      .mockResolvedValueOnce(ok(1)) // ios
    const { sendToTokens } = await import('./fcm')
    const summary = await sendToTokens(
      [
        { id: 'w', token: 'tw', platform: 'web' },
        { id: 'a', token: 'ta', platform: 'android' },
        { id: 'i', token: 'ti', platform: 'ios' },
      ],
      N,
      { url: '/x', type: 'match_assigned' },
    )
    expect(sendEachForMulticast).toHaveBeenCalledTimes(3)
    expect(deleteIn).toHaveBeenCalledWith('id', ['a'])
    expect(summary).toEqual({ attempted: 3, succeeded: 2 })
  })

  it('one platform throwing does not stop the others', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    sendEachForMulticast
      .mockResolvedValueOnce(ok(1)) // web
      .mockRejectedValueOnce(new Error('boom')) // android
      .mockResolvedValueOnce(ok(1)) // ios
    const { sendToTokens } = await import('./fcm')
    const summary = await sendToTokens(
      [
        { id: 'w', token: 'tw', platform: 'web' },
        { id: 'a', token: 'ta', platform: 'android' },
        { id: 'i', token: 'ti', platform: 'ios' },
      ],
      N,
      { url: '/x', type: 'match_assigned' },
    )
    expect(sendEachForMulticast).toHaveBeenCalledTimes(3)
    expect(summary).toEqual({ attempted: 3, succeeded: 2 })
    err.mockRestore()
  })

  it('chunks each platform at 500', async () => {
    sendEachForMulticast.mockResolvedValue(ok(500))
    const { sendToTokens } = await import('./fcm')
    const tokens = Array.from({ length: 501 }, (_, i) => ({ id: `r${i}`, token: `t${i}`, platform: 'android' }))
    await sendToTokens(tokens, N, { url: '/x', type: 'match_assigned' })
    expect(sendEachForMulticast.mock.calls.map((c) => c[0].tokens.length)).toEqual([500, 1])
  })

  it('returns an empty summary when unconfigured or there are no tokens', async () => {
    const { sendToTokens } = await import('./fcm')
    expect(await sendToTokens([], N, { url: '/x' })).toEqual({ attempted: 0, succeeded: 0 })
    vi.unstubAllEnvs()
    vi.resetModules()
    const m = await import('./fcm')
    expect(await m.sendToTokens([{ id: 'r', token: 't' }], N, { url: '/x' })).toEqual({ attempted: 0, succeeded: 0 })
  })
})
