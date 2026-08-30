import { type NextRequest } from 'next/server'
import createIntlMiddleware from 'next-intl/middleware'
import { routing } from '@/i18n/routing'
import { updateSession } from '@/lib/supabase/middleware'
import { splitLocaleFromPathname } from '@/lib/i18n/locale-path'

const intlMiddleware = createIntlMiddleware(routing)

export async function middleware(request: NextRequest) {
  const { locale, pathname } = splitLocaleFromPathname(request.nextUrl.pathname)

  const auth = await updateSession(request, pathname, locale)
  if (auth.redirected) return auth.response

  const intlResponse = intlMiddleware(request)
  // Carry over any session-refresh cookies updateSession set (e.g. a
  // refreshed Supabase auth token) onto the response next-intl actually
  // returns — intlResponse is what controls locale rewriting, so it must
  // be the one returned, but it must not silently drop the session cookies.
  auth.response.cookies.getAll().forEach((cookie) => intlResponse.cookies.set(cookie))
  return intlResponse
}

export const config = {
  // 'offline' excluded — app/offline/page.tsx deliberately lives outside
  // app/[locale] (spec §4, it's the locale-invariant PWA fallback sw.js
  // falls back to); letting next-intl's middleware process it rewrites it
  // to /en/offline internally, which doesn't exist and 404s.
  //
  // sw.js/manifest.webmanifest/robots.txt/sitemap.xml/opengraph-image/
  // apple-icon/icon are the same problem for every other root-level special
  // file (app/sw.js's public/ copy, app/manifest.ts, app/robots.ts,
  // app/sitemap.ts, app/opengraph-image.tsx, app/apple-icon.tsx, app/icon.tsx
  // — all deliberately outside app/[locale], none of them pages) — without
  // this exclusion next-intl rewrites them to /en/... too and 404s them.
  // This broke service worker registration in production (no FCM background
  // push could display) since this middleware was introduced.
  //
  // `auth/` covers EVERY route handler under app/auth/ — the email
  // confirm/recovery route (auth/confirm) and the OAuth callback
  // (auth/oauth/callback, Google sign-in). Both are outside app/[locale];
  // rewriting them to /en/auth/... 404s the callback and lands the user on a
  // blank page mid-login. No user-facing auth page lives at /auth/* (they're
  // /login, /signup, etc. under app/[locale]/(auth)), so excluding the whole
  // prefix is safe and covers any future callback route.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|auth/|api|offline|sw\\.js|manifest\\.webmanifest|robots\\.txt|sitemap\\.xml|opengraph-image|apple-icon|icon|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2)$).*)',
  ],
}
