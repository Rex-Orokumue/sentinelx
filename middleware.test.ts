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

describe('middleware matcher', () => {
  // Next.js's `config.matcher` strings are applied as regexes matched against
  // the pathname with a leading slash. This directly guards the bug that
  // shipped in 9a8b0fb: without an exclusion here, next-intl rewrites these
  // root-level special routes to a locale-prefixed path that doesn't exist,
  // 404ing them — which silently broke service worker registration (and so
  // background FCM push) in production for three days before anyone noticed.
  async function matches(pathname: string): Promise<boolean> {
    const { config } = await import('./middleware')
    return new RegExp(`^${config.matcher[0]}$`).test(pathname)
  }

  it.each([
    '/sw.js',
    '/manifest.webmanifest',
    '/robots.txt',
    '/sitemap.xml',
    '/opengraph-image',
    '/apple-icon',
    '/icon',
    // Non-localized route handlers under app/auth/. /auth/confirm was already
    // excluded; /auth/oauth/callback (Google sign-in) was missed and got
    // rewritten to /en/auth/oauth/callback — a 404 blank screen mid-login.
    '/auth/confirm',
    '/auth/oauth/callback',
  ])('excludes root-level special route %s from locale rewriting', async (pathname) => {
    expect(await matches(pathname)).toBe(false)
  })

  it.each(['/tournaments', '/en/dashboard', '/fr/store', '/players/someuser'])(
    'still matches a real page route %s',
    async (pathname) => {
      expect(await matches(pathname)).toBe(true)
    },
  )
})
