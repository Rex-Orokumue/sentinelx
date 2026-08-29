import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'

const getSession = vi.fn()
const maybeSingle = vi.fn()
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getSession },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  }),
}))
vi.mock('@/lib/onboarding/gate', () => ({ resolveOnboardingGate: () => null }))

describe('updateSession locale-aware redirects', () => {
  it('redirects an unauthenticated /dashboard request to a locale-prefixed /login', async () => {
    getSession.mockResolvedValueOnce({ data: { session: null } })
    const { updateSession } = await import('./middleware')
    const request = new NextRequest('https://sentinelx.gg/fr/dashboard')
    const result = await updateSession(request, '/dashboard', 'fr')
    expect(result.redirected).toBe(true)
    expect(result.response.headers.get('location')).toBe('https://sentinelx.gg/fr/login?next=%2Fdashboard')
  })

  it('does not add a locale prefix for the default locale', async () => {
    getSession.mockResolvedValueOnce({ data: { session: null } })
    const { updateSession } = await import('./middleware')
    const request = new NextRequest('https://sentinelx.gg/dashboard')
    const result = await updateSession(request, '/dashboard', 'en')
    expect(result.response.headers.get('location')).toBe('https://sentinelx.gg/login?next=%2Fdashboard')
  })

  it('does not redirect an authenticated request to a protected path', async () => {
    getSession.mockResolvedValueOnce({ data: { session: { user: { id: 'u1' } } } })
    maybeSingle.mockResolvedValueOnce({ data: { username: 'x', phone_verified_at: '2026-01-01' } })
    const { updateSession } = await import('./middleware')
    const request = new NextRequest('https://sentinelx.gg/fr/dashboard')
    const result = await updateSession(request, '/dashboard', 'fr')
    expect(result.redirected).toBe(false)
  })
})

describe('updateSession — bounded session check', () => {
  // The root cause of the production middleware timeouts: getUser() makes a
  // network round-trip on every single request with no bound on it, and
  // Edge middleware runs on nearly every route. getSession() is now used
  // instead (cookie-read, network only on an actual refresh), wrapped in a
  // short timeout — these tests cover what happens when that residual
  // network call still hangs. Fake timers so a "never resolves" mock
  // doesn't actually block the test suite for real wall-clock time.
  it('passes the request through unchanged (no redirect either way) when the session check times out on a protected path', async () => {
    vi.useFakeTimers()
    try {
      getSession.mockImplementationOnce(() => new Promise(() => {})) // never resolves
      const { updateSession } = await import('./middleware')
      const request = new NextRequest('https://sentinelx.gg/dashboard')
      const resultPromise = updateSession(request, '/dashboard', 'en')
      await vi.runAllTimersAsync()
      const result = await resultPromise
      expect(result.redirected).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('passes the request through unchanged when the session check rejects', async () => {
    getSession.mockRejectedValueOnce(new Error('network error'))
    const { updateSession } = await import('./middleware')
    const request = new NextRequest('https://sentinelx.gg/dashboard')
    const result = await updateSession(request, '/dashboard', 'en')
    expect(result.redirected).toBe(false)
  })

  it('does not treat a timeout as authenticated — an auth page stays reachable, not force-redirected to /dashboard', async () => {
    vi.useFakeTimers()
    try {
      getSession.mockImplementationOnce(() => new Promise(() => {})) // never resolves
      const { updateSession } = await import('./middleware')
      const request = new NextRequest('https://sentinelx.gg/login')
      const resultPromise = updateSession(request, '/login', 'en')
      await vi.runAllTimersAsync()
      const result = await resultPromise
      expect(result.redirected).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('updateSession — bounded onboarding gate check', () => {
  // Same failure mode as the session check above, one query later: the
  // profile lookup backing resolveOnboardingGate() had no timeout or catch
  // of its own. A stalled or failing lookup must not block or misroute an
  // otherwise-authenticated dashboard visit — fail open, same as the
  // session check does.
  it('does not redirect to onboarding when the profile lookup times out', async () => {
    vi.useFakeTimers()
    try {
      getSession.mockResolvedValueOnce({ data: { session: { user: { id: 'u1' } } } })
      maybeSingle.mockImplementationOnce(() => new Promise(() => {})) // never resolves
      const { updateSession } = await import('./middleware')
      const request = new NextRequest('https://sentinelx.gg/dashboard')
      const resultPromise = updateSession(request, '/dashboard', 'en')
      await vi.runAllTimersAsync()
      const result = await resultPromise
      expect(result.redirected).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not redirect to onboarding when the profile lookup rejects', async () => {
    getSession.mockResolvedValueOnce({ data: { session: { user: { id: 'u1' } } } })
    maybeSingle.mockRejectedValueOnce(new Error('network error'))
    const { updateSession } = await import('./middleware')
    const request = new NextRequest('https://sentinelx.gg/dashboard')
    const result = await updateSession(request, '/dashboard', 'en')
    expect(result.redirected).toBe(false)
  })
})
