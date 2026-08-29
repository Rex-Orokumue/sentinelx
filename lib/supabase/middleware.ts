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

// getSession() reads the JWT from the cookie locally and only touches the
// network when the access token actually needs refreshing — unlike
// getUser(), which makes a network round-trip on every single call. This
// middleware runs on nearly every route (see the matcher in middleware.ts),
// so getUser() here meant a mandatory external network call on every page
// load; when Supabase's Edge-reachable auth endpoint occasionally stalled,
// the whole site hung until Vercel's 25s function ceiling killed it
// (confirmed live via Vercel's runtime error data — 80+ occurrences, only
// ever on /middleware, never on /dashboard or /admin despite those making
// the identical getUser() call themselves).
//
// This is safe to loosen because middleware was never the real security
// boundary to begin with: /dashboard (app/[locale]/dashboard/page.tsx) and
// /admin (requireStaff/requireAdmin in lib/admin/auth.ts) already make
// their own independent, network-verified getUser() call — middleware's
// job is only a fast, friendly redirect (?next= param, avoiding a flash of
// protected content), not the authoritative check.
//
// Kept short — comfortably under Vercel's ceiling — and any failure
// (timeout or rejection) is treated the same: pass the request through
// completely unmodified, no redirect in either direction. Guessing
// "authenticated" on a failure would be a real security hole; guessing
// "unauthenticated" is exactly the wrongful-login-redirect this was meant
// to stop. Deferring entirely to the page-level check is the only safe
// choice, and it's already the real gate regardless.
const SESSION_CHECK_TIMEOUT_MS = 4000

type OnboardingProfile = { username: string | null; phone_verified_at: string | null }

// Same bound-and-fail-open treatment as sessionUser() above, one query
// later: this backs resolveOnboardingGate() and previously had no timeout
// or catch of its own, so a stalled or failing lookup could hang or throw
// out of updateSession() entirely on every /dashboard visit.
async function onboardingProfile(
  supabase: ReturnType<typeof createServerClient<Database>>,
  userId: string,
): Promise<OnboardingProfile | 'unresolved'> {
  try {
    const result = await Promise.race([
      supabase.from('profiles').select('username, phone_verified_at').eq('id', userId).maybeSingle(),
      new Promise<'unresolved'>((resolve) => setTimeout(() => resolve('unresolved'), SESSION_CHECK_TIMEOUT_MS)),
    ])
    if (result === 'unresolved') return 'unresolved'
    return result.data ?? { username: null, phone_verified_at: null }
  } catch {
    return 'unresolved'
  }
}

async function sessionUser(
  supabase: ReturnType<typeof createServerClient<Database>>,
): Promise<{ id: string } | null | 'unresolved'> {
  try {
    const result = await Promise.race([
      supabase.auth.getSession(),
      new Promise<'unresolved'>((resolve) => setTimeout(() => resolve('unresolved'), SESSION_CHECK_TIMEOUT_MS)),
    ])
    if (result === 'unresolved') return 'unresolved'
    return result.data.session?.user ?? null
  } catch {
    return 'unresolved'
  }
}

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

  const result = await sessionUser(supabase)
  if (result === 'unresolved') return { response, redirected: false }
  const user = result

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
    const profile = await onboardingProfile(supabase, user.id)
    if (profile !== 'unresolved') {
      const gate = resolveOnboardingGate({
        username: profile.username,
        phoneVerifiedAt: profile.phone_verified_at,
      })
      if (gate) return redirectTo(gate)
    }
  }

  return { response, redirected: false }
}
