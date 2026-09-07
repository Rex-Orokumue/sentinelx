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
