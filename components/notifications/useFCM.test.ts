import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// jsdom is not configured for this project's vitest (environment: 'node'),
// so navigator/window are stubbed by hand — enough surface for
// registerServiceWorker, which only touches navigator.serviceWorker.
const register = vi.fn().mockResolvedValue({})

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
