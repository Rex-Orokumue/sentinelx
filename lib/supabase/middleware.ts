import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import type { Database } from './types'
import { resolveOnboardingGate } from '@/lib/onboarding/gate'
import { withLocalePrefix } from '@/lib/i18n/locale-path'
import type { Locale } from '@/i18n/locales'

const PROTECTED = ['/dashboard', '/admin']
// Exact-match only — '/players/[username]' profile pages stay public (SEO,
// WhatsApp link previews per CLAUDE.md), just the '/players' directory/search
// listing requires login.
const PROTECTED_EXACT = ['/players']
const AUTH_PAGES = ['/login', '/signup']

export async function updateSession(
  request: NextRequest,
  pathname: string,
  locale: Locale,
): Promise<{ response: NextResponse; redirected: boolean }> {
  let response = NextResponse.next({ request })

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const redirectTo = (targetPath: string, search?: URLSearchParams) => {
    const url = request.nextUrl.clone()
    url.pathname = withLocalePrefix(targetPath, locale)
    url.search = ''
    if (search) search.forEach((value, key) => url.searchParams.set(key, value))
    return { response: NextResponse.redirect(url), redirected: true as const }
  }

  if (!user && (PROTECTED.some((p) => pathname.startsWith(p)) || PROTECTED_EXACT.includes(pathname))) {
    const search = new URLSearchParams({ next: pathname })
    return redirectTo('/login', search)
  }

  if (user && AUTH_PAGES.some((p) => pathname.startsWith(p))) {
    return redirectTo('/dashboard')
  }

  if (user && pathname.startsWith('/dashboard')) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('username, phone_verified_at')
      .eq('id', user.id)
      .maybeSingle()
    const gate = resolveOnboardingGate({
      username: profile?.username ?? null,
      phoneVerifiedAt: profile?.phone_verified_at ?? null,
    })
    if (gate) return redirectTo(gate)
  }

  return { response, redirected: false }
}
