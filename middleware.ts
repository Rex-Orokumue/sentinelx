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
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|auth/confirm|api|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2)$).*)',
  ],
}
