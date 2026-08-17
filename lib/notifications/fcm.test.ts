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
})
