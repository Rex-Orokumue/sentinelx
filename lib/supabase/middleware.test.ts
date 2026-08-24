import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'

const getUser = vi.fn()
const maybeSingle = vi.fn()
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  }),
}))
vi.mock('@/lib/onboarding/gate', () => ({ resolveOnboardingGate: () => null }))

describe('updateSession locale-aware redirects', () => {
  it('redirects an unauthenticated /dashboard request to a locale-prefixed /login', async () => {
    getUser.mockResolvedValueOnce({ data: { user: null } })
    const { updateSession } = await import('./middleware')
    const request = new NextRequest('https://sentinelx.gg/fr/dashboard')
    const result = await updateSession(request, '/dashboard', 'fr')
    expect(result.redirected).toBe(true)
    expect(result.response.headers.get('location')).toBe('https://sentinelx.gg/fr/login?next=%2Fdashboard')
  })

  it('does not add a locale prefix for the default locale', async () => {
    getUser.mockResolvedValueOnce({ data: { user: null } })
    const { updateSession } = await import('./middleware')
    const request = new NextRequest('https://sentinelx.gg/dashboard')
    const result = await updateSession(request, '/dashboard', 'en')
    expect(result.response.headers.get('location')).toBe('https://sentinelx.gg/login?next=%2Fdashboard')
  })

  it('does not redirect an authenticated request to a protected path', async () => {
    getUser.mockResolvedValueOnce({ data: { user: { id: 'u1' } } })
    maybeSingle.mockResolvedValueOnce({ data: { username: 'x', phone_verified_at: '2026-01-01' } })
    const { updateSession } = await import('./middleware')
    const request = new NextRequest('https://sentinelx.gg/fr/dashboard')
    const result = await updateSession(request, '/dashboard', 'fr')
    expect(result.redirected).toBe(false)
  })
})
