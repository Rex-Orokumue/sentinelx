import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// jsdom is not configured for this project's vitest (environment: 'node'),
// so navigator/window are stubbed by hand — enough surface for
// registerServiceWorker, which only touches navigator.serviceWorker.
const register = vi.fn().mockResolvedValue({})

// getFirebaseApp reads the NEXT_PUBLIC_* config and returns null when it is
// absent; mirror that here rather than booting a real Firebase app.
vi.mock('@/lib/firebase/client', () => ({
  getFirebaseApp: () => (process.env.NEXT_PUBLIC_FIREBASE_API_KEY ? {} : null),
}))
// Self-contained: vi.mock factories are hoisted above module-level consts, so
// referencing one from inside throws a TDZ error — which refreshPushToken's
// own try/catch would swallow, silently turning a broken mock into a passing
// "returns false" result.
vi.mock('firebase/messaging', () => ({
  getMessaging: () => ({}),
  getToken: vi.fn().mockResolvedValue('fresh-token-123'),
  onMessage: vi.fn(),
}))

// The code guards with `'Notification' in window` and then reads the global
// `Notification.permission`, so both have to be stubbed — putting it only on
// globalThis makes the guard fail and the function return false for the wrong
// reason, which looks exactly like a real failure.
function grantPermission(permission: 'granted' | 'denied' | 'default'): void {
  const stub = { permission, requestPermission: vi.fn() }
  vi.stubGlobal('window', { Notification: stub })
  vi.stubGlobal('Notification', stub)
}

beforeEach(() => {
  vi.resetModules()
  register.mockClear()
  vi.stubGlobal('window', {})
  vi.stubGlobal('navigator', { serviceWorker: { register } })
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_API_KEY', 'test-api-key')
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN', 'test.firebaseapp.com')
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_PROJECT_ID', 'test-project')
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID', '123')
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_APP_ID', 'app-1')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('registerServiceWorker', () => {
  // THE BUG: service worker registrations are keyed by scope, not script
  // URL. This runs on every page load and previously registered '/sw.js'
  // with no query string, replacing the '/sw.js?apiKey=...' registration
  // that requestPushPermission() had installed. sw.js gates its whole
  // Firebase block on params.get('apiKey'), so the worker actually
  // controlling the page ended up with no onBackgroundMessage handler and
  // silently dropped every push.
  it('registers with the Firebase config params, matching requestPushPermission', async () => {
    const { registerServiceWorker } = await import('./useFCM')
    registerServiceWorker()
    expect(register).toHaveBeenCalledOnce()
    const url = register.mock.calls[0][0] as string
    expect(url).toContain('apiKey=test-api-key')
  })

  it('registers exactly one scope so nothing can replace anything else', async () => {
    const { registerServiceWorker } = await import('./useFCM')
    registerServiceWorker()
    const url = register.mock.calls[0][0] as string
    expect(url.startsWith('/sw.js?')).toBe(true)
  })

  it('still passes every config key the worker reads', async () => {
    const { registerServiceWorker } = await import('./useFCM')
    registerServiceWorker()
    const url = register.mock.calls[0][0] as string
    for (const key of ['apiKey', 'authDomain', 'projectId', 'messagingSenderId', 'appId']) {
      expect(url).toContain(`${key}=`)
    }
  })

  // sw.js guards on a truthy apiKey, so an unconfigured project still gets a
  // working offline/PWA worker — it just skips push setup, as before.
  it('registers even when Firebase is unconfigured', async () => {
    vi.stubEnv('NEXT_PUBLIC_FIREBASE_API_KEY', '')
    const { registerServiceWorker } = await import('./useFCM')
    registerServiceWorker()
    expect(register).toHaveBeenCalledOnce()
  })

  it('does nothing when service workers are unsupported', async () => {
    vi.stubGlobal('navigator', {})
    const { registerServiceWorker } = await import('./useFCM')
    registerServiceWorker()
    expect(register).not.toHaveBeenCalled()
  })
})

// Token acquisition was a one-time manual button press while token loss was
// automatic and continuous — sign-out, FCM rotation, stale cleanup. A
// population that can only shrink is why coverage sat at 12 of 102 players.
// This makes it self-healing: any browser that already granted permission
// re-registers silently on load, with no prompt.
describe('refreshPushToken', () => {
  it('re-registers silently when permission is already granted', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    grantPermission('granted')
    const { refreshPushToken } = await import('./useFCM')
    const ok = await refreshPushToken()
    expect(ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith('/api/notifications/fcm-token', expect.anything())
  })

  // The critical constraint: this runs on every page load, so it must never
  // trigger a permission prompt. Prompting unasked is how sites get their
  // notifications permanently blocked.
  it('never calls requestPermission', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
    grantPermission('granted')
    const { refreshPushToken } = await import('./useFCM')
    await refreshPushToken()
    expect((Notification as unknown as { requestPermission: ReturnType<typeof vi.fn> }).requestPermission).not.toHaveBeenCalled()
  })

  it('does nothing when permission has not been granted', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    grantPermission('default')
    const { refreshPushToken } = await import('./useFCM')
    expect(await refreshPushToken()).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does nothing when permission was denied', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    grantPermission('denied')
    const { refreshPushToken } = await import('./useFCM')
    expect(await refreshPushToken()).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does nothing when Firebase is unconfigured', async () => {
    vi.stubEnv('NEXT_PUBLIC_FIREBASE_API_KEY', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    grantPermission('granted')
    const { refreshPushToken } = await import('./useFCM')
    expect(await refreshPushToken()).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
