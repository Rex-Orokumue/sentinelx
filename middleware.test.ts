import { describe, it, expect, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const updateSession = vi.fn()
vi.mock('@/lib/supabase/middleware', () => ({ updateSession }))
vi.mock('next-intl/middleware', () => ({
  default: () => () => NextResponse.next(),
}))

describe('middleware composition', () => {
  it('returns the auth redirect directly when updateSession redirects, without invoking intl rewriting', async () => {
    const redirectResponse = NextResponse.redirect('https://sentinelx.gg/fr/login')
    updateSession.mockResolvedValueOnce({ response: redirectResponse, redirected: true })
    const { middleware } = await import('./middleware')
    const result = await middleware(new NextRequest('https://sentinelx.gg/fr/dashboard'))
    expect(result.headers.get('location')).toBe('https://sentinelx.gg/fr/login')
  })

  it('passes the locale-stripped pathname and detected locale to updateSession', async () => {
    updateSession.mockResolvedValueOnce({ response: NextResponse.next(), redirected: false })
    const { middleware } = await import('./middleware')
    await middleware(new NextRequest('https://sentinelx.gg/fr/dashboard'))
    expect(updateSession).toHaveBeenCalledWith(expect.anything(), '/dashboard', 'fr')
  })
})
