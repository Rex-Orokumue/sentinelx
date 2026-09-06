# Multi-Language Support — Core Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up working `en`/`fr`/`pcm` locale routing, middleware, storage, and message-catalog infrastructure, and prove the translation pattern end-to-end on the header/footer/home page — a genuinely shippable, testable slice, not a full site translation.

**Architecture:** `next-intl` with locale-prefixed routing (`en` unprefixed, `fr`/`pcm` prefixed), the whole `app/` route tree moved under `app/[locale]/`, `profiles.locale` as the source of truth for logged-in players, and the existing Supabase auth middleware refactored to be locale-aware so it composes with next-intl's routing middleware instead of breaking under a locale prefix.

**Tech Stack:** Next.js 14.2 App Router, `next-intl` (new dependency), Supabase, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-23-multi-language-support-design.md` — read this first; this plan implements §3–6, §10 (partially), §11, and the middleware risk called out in §4. §7 (notification copy), §8/§9 boundary enforcement on every remaining page, and the rest of §10 are follow-on plans that repeat this plan's pattern.

## Global Constraints

- Locales: `en` (default, unprefixed), `fr`, `pcm` — exact codes, in this order, everywhere a locale list appears.
- `localePrefix: 'as-needed'` — English URLs never gain a prefix; existing `/tournaments/x`-style links must keep working unchanged.
- `app/api/**`, `middleware.ts`'s existing auth guard behavior (`/dashboard`, `/admin`, `/players` protection; `/login`,`/signup` bounce-when-authenticated), and `app/offline/page.tsx` are locale-invariant — see spec §4.
- Every new pure-logic module gets a unit test before implementation (TDD), per this repo's established convention (confirmed in `lib/notifications/fcm.test.ts` et al.).
- `npx tsc --noEmit -p .` and `npx vitest run` must stay clean after every task.

---

### Task 1: Add `next-intl` and scaffold the locale list as a single source of truth

**Files:**
- Modify: `package.json` (via `npm install`)
- Create: `i18n/locales.ts`

**Interfaces:**
- Produces: `export const LOCALES = ['en', 'fr', 'pcm'] as const`, `export type Locale = (typeof LOCALES)[number]`, `export const DEFAULT_LOCALE: Locale = 'en'` — every later task imports the locale list from here, never redeclares it.

- [ ] **Step 1: Install the dependency**

Run: `npm install next-intl`

- [ ] **Step 2: Create the locale constants file**

```ts
// i18n/locales.ts
export const LOCALES = ['en', 'fr', 'pcm'] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'en'
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors (this file has no consumers yet, so it just needs to compile standalone).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json i18n/locales.ts
git commit -m "feat(i18n): add next-intl dependency and locale constants"
```

---

### Task 2: Pure locale/pathname helpers (TDD)

These are the functions the composed middleware (Task 6) and `buildMetadata` (Task 9) both depend on — split out as pure, unit-testable functions rather than inlined in middleware, per this repo's established pattern of keeping route-handler files thin and logic in `lib/`.

**Files:**
- Create: `lib/i18n/locale-path.ts`
- Test: `lib/i18n/locale-path.test.ts`

**Interfaces:**
- Consumes: `LOCALES`, `Locale`, `DEFAULT_LOCALE` from `i18n/locales.ts` (Task 1)
- Produces: `splitLocaleFromPathname(pathname: string): { locale: Locale; pathname: string }`, `withLocalePrefix(pathname: string, locale: Locale): string` — Task 6 (middleware) and Task 9 (`buildMetadata`) both call these exact functions.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/i18n/locale-path.test.ts
import { describe, it, expect } from 'vitest'
import { splitLocaleFromPathname, withLocalePrefix } from './locale-path'

describe('splitLocaleFromPathname', () => {
  it('returns the default locale and unchanged path when there is no prefix', () => {
    expect(splitLocaleFromPathname('/tournaments/x')).toEqual({ locale: 'en', pathname: '/tournaments/x' })
  })

  it('strips a recognized locale prefix', () => {
    expect(splitLocaleFromPathname('/fr/tournaments/x')).toEqual({ locale: 'fr', pathname: '/tournaments/x' })
    expect(splitLocaleFromPathname('/pcm/dashboard')).toEqual({ locale: 'pcm', pathname: '/dashboard' })
  })

  it('treats a bare locale-prefixed root as "/"', () => {
    expect(splitLocaleFromPathname('/fr')).toEqual({ locale: 'fr', pathname: '/' })
  })

  it('does not strip a path segment that merely starts with a locale code', () => {
    // '/frankenstein' must not be misread as locale 'fr' + pathname 'ankenstein'
    expect(splitLocaleFromPathname('/frankenstein')).toEqual({ locale: 'en', pathname: '/frankenstein' })
  })
})

describe('withLocalePrefix', () => {
  it('adds no prefix for the default locale', () => {
    expect(withLocalePrefix('/tournaments/x', 'en')).toBe('/tournaments/x')
  })

  it('prefixes non-default locales', () => {
    expect(withLocalePrefix('/tournaments/x', 'fr')).toBe('/fr/tournaments/x')
    expect(withLocalePrefix('/', 'pcm')).toBe('/pcm')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/i18n/locale-path.test.ts`
Expected: FAIL — `./locale-path` does not exist yet.

- [ ] **Step 3: Implement**

```ts
// lib/i18n/locale-path.ts
import { LOCALES, DEFAULT_LOCALE, type Locale } from '@/i18n/locales'

export function splitLocaleFromPathname(pathname: string): { locale: Locale; pathname: string } {
  for (const locale of LOCALES) {
    if (locale === DEFAULT_LOCALE) continue
    const prefix = `/${locale}`
    if (pathname === prefix) return { locale, pathname: '/' }
    if (pathname.startsWith(`${prefix}/`)) return { locale, pathname: pathname.slice(prefix.length) }
  }
  return { locale: DEFAULT_LOCALE, pathname }
}

export function withLocalePrefix(pathname: string, locale: Locale): string {
  if (locale === DEFAULT_LOCALE) return pathname
  return pathname === '/' ? `/${locale}` : `/${locale}${pathname}`
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/i18n/locale-path.test.ts`
Expected: PASS, all 6 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/i18n/locale-path.ts lib/i18n/locale-path.test.ts
git commit -m "feat(i18n): add pure locale/pathname split and prefix helpers"
```

---

### Task 3: `profiles.locale` migration

**Files:**
- Create: `supabase/migrations/068_profile_locale.sql`

**Interfaces:**
- Produces: `profiles.locale text not null default 'en'` — Task 10 (switcher) and the follow-on notification-copy plan both read/write this column.

- [ ] **Step 1: Write the migration**

```sql
-- 068_profile_locale.sql
-- Adds the player's preferred site language. Source of truth for a
-- logged-in player's locale (spec: docs/superpowers/specs/2026-08-23-multi-language-support-design.md §5)
-- — the language switcher writes here, notification-copy builders read
-- from here (follow-on plan), same pattern as the existing
-- notification_prefs jsonb column on this table.
ALTER TABLE public.profiles ADD COLUMN locale text NOT NULL DEFAULT 'en'
  CHECK (locale IN ('en', 'fr', 'pcm'));
```

- [ ] **Step 2: Apply the migration**

Apply via the Supabase MCP `apply_migration` tool (or `supabase db push` if using the CLI locally) against the project.

- [ ] **Step 3: Regenerate types**

Run: `npx supabase gen types typescript --project-id <project-id> > lib/supabase/types.ts` (per this repo's existing documented command in CLAUDE.md).

- [ ] **Step 4: Verify**

Query `select column_name, column_default from information_schema.columns where table_name = 'profiles' and column_name = 'locale'` and confirm it returns one row with default `'en'::text`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/068_profile_locale.sql lib/supabase/types.ts
git commit -m "feat(i18n): add profiles.locale column"
```

---

### Task 4: Seed message catalogs + key-parity test

Only the `common` and `nav` namespaces are seeded here — enough for Task 11's header/footer/home-page proof of pattern. Every other namespace (`tournaments`, `dashboard`, `admin`, `notifications`, …) is added incrementally by whichever plan converts that area, following this same file/test structure.

**Files:**
- Create: `messages/en.json`, `messages/fr.json`, `messages/pcm.json`
- Test: `lib/i18n/message-parity.test.ts`

**Interfaces:**
- Produces: the `messages/*.json` catalog files — every `useTranslations()`/`getTranslations()` call site (Task 11 onward) reads from these.

- [ ] **Step 1: Write the failing parity test**

```ts
// lib/i18n/message-parity.test.ts
import { describe, it, expect } from 'vitest'
import { LOCALES } from '@/i18n/locales'
import en from '@/messages/en.json'
import fr from '@/messages/fr.json'
import pcm from '@/messages/pcm.json'

const CATALOGS: Record<string, unknown> = { en, fr, pcm }

// Flattens nested keys to dotted paths, e.g. { nav: { home: 'x' } } -> ['nav.home'],
// so a missing/extra key at any nesting depth in any locale fails the test.
function flattenKeys(obj: unknown, prefix = ''): string[] {
  if (typeof obj !== 'object' || obj === null) return [prefix]
  return Object.entries(obj as Record<string, unknown>).flatMap(([key, value]) =>
    flattenKeys(value, prefix ? `${prefix}.${key}` : key),
  )
}

describe('message catalog key parity', () => {
  const englishKeys = flattenKeys(en).sort()

  it('every locale defines exactly the same keys as en.json', () => {
    for (const locale of LOCALES) {
      if (locale === 'en') continue
      const keys = flattenKeys(CATALOGS[locale]).sort()
      expect(keys, `${locale}.json key set must match en.json`).toEqual(englishKeys)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/i18n/message-parity.test.ts`
Expected: FAIL — `messages/en.json` etc. don't exist yet.

- [ ] **Step 3: Create the catalogs**

These `nav` keys match `NAVBAR_LINKS`' actual hrefs in `lib/nav/links.ts` exactly (checked against the real file, not assumed) — Task 11 maps each href to one of these keys.

```json
// messages/en.json
{
  "common": {
    "siteName": "SentinelX",
    "viewAll": "View all"
  },
  "nav": {
    "home": "Home",
    "tournaments": "Tournaments",
    "games": "Games",
    "rankings": "Leaderboards",
    "seasons": "Seasons",
    "exchange": "Exchange",
    "store": "Store",
    "community": "Community",
    "about": "About Us"
  },
  "home": {
    "upcomingHeading": "Upcoming",
    "topPlayersHeading": "Top Players",
    "fullRankingsLink": "Full Rankings"
  }
}
```

```json
// messages/fr.json
{
  "common": {
    "siteName": "SentinelX",
    "viewAll": "Voir tout"
  },
  "nav": {
    "home": "Accueil",
    "tournaments": "Tournois",
    "games": "Jeux",
    "rankings": "Classements",
    "seasons": "Saisons",
    "exchange": "Échange",
    "store": "Boutique",
    "community": "Communauté",
    "about": "À propos"
  },
  "home": {
    "upcomingHeading": "À venir",
    "topPlayersHeading": "Meilleurs joueurs",
    "fullRankingsLink": "Classement complet"
  }
}
```

```json
// messages/pcm.json
{
  "common": {
    "siteName": "SentinelX",
    "viewAll": "See all"
  },
  "nav": {
    "home": "Home",
    "tournaments": "Tournaments",
    "games": "Games",
    "rankings": "Leaderboard",
    "seasons": "Seasons",
    "exchange": "Exchange",
    "store": "Store",
    "community": "Community",
    "about": "About Us"
  },
  "home": {
    "upcomingHeading": "Wetin dey come",
    "topPlayersHeading": "Top Players",
    "fullRankingsLink": "Full Ranking"
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/i18n/message-parity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add messages/ lib/i18n/message-parity.test.ts
git commit -m "feat(i18n): seed en/fr/pcm message catalogs with common/nav/home namespaces"
```

---

### Task 5: next-intl request config + navigation helpers

**Files:**
- Create: `i18n/routing.ts`, `i18n/request.ts`, `i18n/navigation.ts`

**Interfaces:**
- Consumes: `LOCALES`, `DEFAULT_LOCALE` (Task 1)
- Produces: `routing` (used by Task 6's middleware and Task 8's layout), `{ Link, redirect, usePathname, useRouter }` from `i18n/navigation.ts` — every converted component (Task 11 onward) imports `Link` from here instead of `next/link`, so internal links get the correct locale prefix automatically.

- [ ] **Step 1: Routing config**

```ts
// i18n/routing.ts
import { defineRouting } from 'next-intl/routing'
import { LOCALES, DEFAULT_LOCALE } from './locales'

export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: 'as-needed',
})
```

- [ ] **Step 2: Request config (server-side message loading)**

```ts
// i18n/request.ts
import { getRequestConfig } from 'next-intl/server'
import { hasLocale } from 'next-intl'
import { routing } from './routing'

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  }
})
```

- [ ] **Step 3: Navigation helpers**

```ts
// i18n/navigation.ts
import { createNavigation } from 'next-intl/navigation'
import { routing } from './routing'

export const { Link, redirect, usePathname, useRouter } = createNavigation(routing)
```

- [ ] **Step 4: Wire the request config into `next.config.js`**

Open `next.config.js` (or `.mjs`/`.ts`, whichever this repo uses) and wrap the existing config with next-intl's plugin:

```js
const createNextIntlPlugin = require('next-intl/plugin')
const withNextIntl = createNextIntlPlugin('./i18n/request.ts')

// ... existing nextConfig object unchanged ...

module.exports = withNextIntl(nextConfig)
```

(Adjust `require`/`module.exports` to `import`/`export default` if the existing file already uses ESM syntax — match whatever's there.)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add i18n/ next.config.js
git commit -m "feat(i18n): add next-intl routing, request config, and navigation helpers"
```

---

### Task 6: Make `updateSession` locale-aware

The existing auth guard matches on hardcoded paths (`/dashboard`, `/admin`, `/login`, …). Under locale-prefixed routing, an incoming request for a French visitor arrives as `/fr/dashboard`, which none of those checks would match — silently disabling the auth guard for every non-English visitor. This task fixes that at the source: `updateSession` takes the already-locale-stripped pathname and locale, and any redirect it issues gets the locale prefix re-applied.

**Files:**
- Modify: `lib/supabase/middleware.ts`
- Test: `lib/supabase/middleware.test.ts` (new)

**Interfaces:**
- Consumes: `splitLocaleFromPathname`, `withLocalePrefix` (Task 2), `Locale` (Task 1)
- Produces: `updateSession(request: NextRequest, pathname: string, locale: Locale): Promise<{ response: NextResponse; redirected: boolean }>` — Task 7's composed `middleware.ts` calls this exact signature.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/supabase/middleware.test.ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/supabase/middleware.test.ts`
Expected: FAIL — current `updateSession` signature is `(request)`, not `(request, pathname, locale)`, and does not return `{ response, redirected }`.

- [ ] **Step 3: Implement**

```ts
// lib/supabase/middleware.ts
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import type { Database } from './types'
import { resolveOnboardingGate } from '@/lib/onboarding/gate'
import { withLocalePrefix } from '@/lib/i18n/locale-path'
import type { Locale } from '@/i18n/locales'

const PROTECTED = ['/dashboard', '/admin']
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/supabase/middleware.test.ts`
Expected: PASS, all 3 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/supabase/middleware.ts lib/supabase/middleware.test.ts
git commit -m "fix(i18n): make updateSession locale-aware so the auth guard works under locale-prefixed URLs"
```

---

### Task 7: Compose `middleware.ts` (next-intl + auth guard)

**Files:**
- Modify: `middleware.ts`
- Test: `middleware.test.ts` (new)

**Interfaces:**
- Consumes: `updateSession` (Task 6), `splitLocaleFromPathname` (Task 2), `routing` (Task 5)

- [ ] **Step 1: Write the failing test**

```ts
// middleware.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run middleware.test.ts`
Expected: FAIL — `middleware.ts` doesn't yet call `updateSession` with 3 args or compose with next-intl.

- [ ] **Step 3: Implement**

```ts
// middleware.ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run middleware.test.ts`
Expected: PASS, both tests.

- [ ] **Step 5: Commit**

```bash
git add middleware.ts middleware.test.ts
git commit -m "feat(i18n): compose next-intl locale middleware with the existing auth guard"
```

---

### Task 8: Move routes under `app/[locale]/`, add the locale layout

This is a mechanical file move, not new logic — no new test, verified by `npm run build` per this repo's established convention for routing/config-only changes (confirmed in the PWA plan's testing section).

**Files:**
- Move: `app/(auth)/`, `app/(public)/`, `app/admin/`, `app/dashboard/`, `app/seasons/`, `app/store/`, `app/page.tsx` → same paths under `app/[locale]/`
- Create: `app/[locale]/layout.tsx`
- Modify: `app/layout.tsx` (slim to the `<html><body>` shell)
- Not moved: `app/api/`, `app/favicon.ico`, `app/icon.tsx`, `app/apple-icon.tsx`, `app/icon-192.png/`, `app/icon-512.png/`, `app/icon-512-maskable.png/`, `app/manifest.ts`, `app/robots.ts`, `app/sitemap.ts`, `app/opengraph-image.tsx`, `app/offline/`, `app/fonts/`, `app/globals.css` — see spec §4 for why each stays at root.

- [ ] **Step 1: Move the route folders**

```bash
mkdir -p "app/[locale]"
git mv "app/(auth)" "app/[locale]/(auth)"
git mv "app/(public)" "app/[locale]/(public)"
git mv app/admin "app/[locale]/admin"
git mv app/dashboard "app/[locale]/dashboard"
git mv app/seasons "app/[locale]/seasons"
git mv app/store "app/[locale]/store"
git mv app/page.tsx "app/[locale]/page.tsx"
```

- [ ] **Step 2: Create `app/[locale]/layout.tsx`**

Move everything from the current `app/layout.tsx` body (fonts, `SiteHeader`/`SiteFooter`, `NavTransitionProvider`, `ServiceWorkerRegistration`, `GuideLauncher`, `Analytics`, `JsonLd`, and the `metadata`/`viewport` exports) into this new file, with two changes: it receives `params: { locale }`, validates it against `routing.locales`, wraps children in `NextIntlClientProvider`, and sets `<html lang={locale}>` instead of the hardcoded `lang="en"`.

```tsx
// app/[locale]/layout.tsx
import type { Metadata, Viewport } from 'next'
import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { NextIntlClientProvider, hasLocale } from 'next-intl'
import { getMessages } from 'next-intl/server'
import localFont from 'next/font/local'
import { Barlow_Condensed, Inter } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { SiteHeader } from '@/components/shared/SiteHeader'
import { SiteFooter } from '@/components/shared/SiteFooter'
import { NavTransitionProvider } from '@/components/transitions/NavTransitionProvider'
import { ServiceWorkerRegistration } from '@/components/pwa/ServiceWorkerRegistration'
import { GuideLauncher } from '@/components/guide/GuideLauncher'
import { getNavSession } from '@/lib/nav/session'
import { ADMIN_NAV, visibleNav, type AdminSheetData } from '@/lib/admin/nav'
import { getAdminNotificationQueue } from '@/lib/admin/notification-queue'
import { JsonLd } from '@/components/seo/JsonLd'
import { buildOrganizationJsonLd, buildWebsiteJsonLd } from '@/lib/seo/schema/site'
import { SITE_URL, SITE_NAME, SITE_SHORT_NAME, SITE_DESCRIPTION, DEFAULT_OG_IMAGE } from '@/lib/seo/site'
import { routing } from '@/i18n/routing'
import '../globals.css'

const geistSans = localFont({ src: '../fonts/GeistVF.woff', variable: '--font-geist-sans', weight: '100 900' })
const geistMono = localFont({ src: '../fonts/GeistMonoVF.woff', variable: '--font-geist-mono', weight: '100 900' })
const barlowCondensed = Barlow_Condensed({ weight: ['700', '800', '900'], subsets: ['latin'], variable: '--font-display' })
const inter = Inter({ subsets: ['latin'], variable: '--font-body' })

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_SHORT_NAME} Esports — Nigeria's Home of Mobile Esports`,
    template: `%s — ${SITE_SHORT_NAME}`,
  },
  description: SITE_DESCRIPTION,
  openGraph: {
    title: `${SITE_SHORT_NAME} Esports`,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    siteName: SITE_NAME,
    type: 'website',
    images: [DEFAULT_OG_IMAGE],
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE_SHORT_NAME} Esports`,
    description: SITE_DESCRIPTION,
    images: [DEFAULT_OG_IMAGE],
  },
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: SITE_SHORT_NAME },
}

export const viewport: Viewport = { themeColor: '#0B0B0F' }

const WHATSAPP_COMMUNITY = process.env.NEXT_PUBLIC_WHATSAPP_COMMUNITY_URL ?? '#'

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  if (!hasLocale(routing.locales, locale)) notFound()

  const messages = await getMessages()
  const navSession = await getNavSession()
  const adminNav: AdminSheetData | null = navSession.isStaff
    ? {
        items: visibleNav(ADMIN_NAV, navSession.isAdmin),
        isAdmin: navSession.isAdmin,
        notifications: await getAdminNotificationQueue(navSession.isAdmin ? 'admin' : 'moderator'),
      }
    : null

  return (
    <html lang={locale} className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${barlowCondensed.variable} ${inter.variable} bg-sx-bg font-sans text-white antialiased`}
      >
        <NextIntlClientProvider messages={messages}>
          <Suspense fallback={null}>
            <NavTransitionProvider />
          </Suspense>
          <ServiceWorkerRegistration />
          <div className="flex min-h-screen flex-col">
            <SiteHeader session={navSession} whatsappUrl={WHATSAPP_COMMUNITY} adminNav={adminNav} />
            <main className="flex-1">{children}</main>
            <SiteFooter />
          </div>
          <GuideLauncher isLoggedIn={navSession.isLoggedIn} username={navSession.username} avatarUrl={navSession.avatarUrl} />
          <Analytics />
          <JsonLd data={buildOrganizationJsonLd()} />
          <JsonLd data={buildWebsiteJsonLd()} />
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
```

- [ ] **Step 3: Slim the root `app/layout.tsx`**

```tsx
// app/layout.tsx
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return children
}
```

(next-intl requires a root layout to exist but `app/[locale]/layout.tsx` owns the real `<html>`/`<body>`; this pass-through is the documented next-intl pattern for the App Router.)

- [ ] **Step 4: Build to verify routing resolves correctly**

Run: `npm run build`
Expected: builds cleanly; the route list includes `/`, `/[locale]`, `/[locale]/tournaments`, etc. with no duplicate or missing routes compared to before the move.

- [ ] **Step 5: Commit**

```bash
git add -A app/
git commit -m "feat(i18n): move page routes under app/[locale], add locale layout"
```

---

### Task 9: `buildMetadata` emits `alternates.languages` (hreflang)

Every page's `generateMetadata()` already funnels through this one shared helper (confirmed: `app/page.tsx` and others call `buildMetadata`) — updating it here gives every existing and future call site correct hreflang for free, with no per-page changes needed.

**Files:**
- Modify: `lib/seo/metadata.ts`
- Test: `lib/seo/metadata.test.ts` (new)

**Interfaces:**
- Consumes: `LOCALES`, `DEFAULT_LOCALE` (Task 1), `withLocalePrefix` (Task 2)
- Produces: `buildMetadata` gains a required `locale: Locale` field on its input — every existing caller needs updating to pass the locale from its page's `params`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/seo/metadata.test.ts
import { describe, it, expect } from 'vitest'
import { buildMetadata } from './metadata'

describe('buildMetadata', () => {
  it('includes hreflang alternates for every locale plus x-default', () => {
    const result = buildMetadata({ title: 'T', description: 'D', path: '/tournaments/x', locale: 'fr' })
    expect(result.alternates?.languages).toEqual({
      en: 'https://sentinelx.gg/tournaments/x',
      fr: 'https://sentinelx.gg/fr/tournaments/x',
      pcm: 'https://sentinelx.gg/pcm/tournaments/x',
      'x-default': 'https://sentinelx.gg/tournaments/x',
    })
  })

  it('canonical reflects the current locale', () => {
    const result = buildMetadata({ title: 'T', description: 'D', path: '/tournaments/x', locale: 'fr' })
    expect(result.alternates?.canonical).toBe('https://sentinelx.gg/fr/tournaments/x')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/seo/metadata.test.ts`
Expected: FAIL — `buildMetadata` doesn't accept/use `locale` yet.

- [ ] **Step 3: Implement**

```ts
// lib/seo/metadata.ts
import type { Metadata } from 'next'
import { SITE_URL, SITE_NAME } from './site'
import { LOCALES } from '@/i18n/locales'
import { withLocalePrefix } from '@/lib/i18n/locale-path'
import type { Locale } from '@/i18n/locales'

export type BuildMetadataInput = {
  title: string
  description: string
  path: string
  locale: Locale
  image?: string
  type?: 'website' | 'article'
}

export function buildMetadata({ title, description, path, locale, image, type = 'website' }: BuildMetadataInput): Metadata {
  const url = `${SITE_URL}${withLocalePrefix(path, locale)}`
  const languages = Object.fromEntries(
    LOCALES.map((l) => [l, `${SITE_URL}${withLocalePrefix(path, l)}`]),
  )
  languages['x-default'] = `${SITE_URL}${path}`

  return {
    title,
    description,
    alternates: { canonical: url, languages },
    openGraph: {
      title,
      description,
      url,
      siteName: SITE_NAME,
      type,
      ...(image ? { images: [image] } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      ...(image ? { images: [image] } : {}),
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/seo/metadata.test.ts`
Expected: PASS, both tests.

- [ ] **Step 5: Update every existing caller to pass `locale`**

Run: `grep -rl "buildMetadata(" app lib` to find every call site, and add `locale` (read from that page's `params.locale`, e.g. `app/[locale]/page.tsx`'s `generateMetadata` now takes `{ params }: { params: Promise<{ locale: string }> }` and passes `locale` through). Update each one — this is mechanical but must be done for the build to typecheck, since `locale` is a required field.

- [ ] **Step 6: Typecheck and build**

Run: `npx tsc --noEmit -p .` then `npm run build`
Expected: both clean — a missed call site shows up as a TypeScript error (missing required `locale` property), not a silent runtime bug.

- [ ] **Step 7: Commit**

```bash
git add lib/seo/metadata.ts lib/seo/metadata.test.ts app/ lib/
git commit -m "feat(i18n): buildMetadata emits hreflang alternates for every locale"
```

---

### Task 10: Language switcher + `profiles.locale`/cookie write

**Files:**
- Create: `components/shared/LanguageSwitcher.tsx`, `app/api/locale/route.ts`
- Modify: `components/shared/SiteHeader.tsx` (render the switcher)

**Interfaces:**
- Consumes: `LOCALES` (Task 1), `usePathname`/`useRouter` from `i18n/navigation.ts` (Task 5)

- [ ] **Step 1: API route to persist the choice**

```ts
// app/api/locale/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { LOCALES } from '@/i18n/locales'

export async function POST(req: Request) {
  const { locale } = (await req.json()) as { locale?: string }
  if (!locale || !LOCALES.includes(locale as (typeof LOCALES)[number])) {
    return NextResponse.json({ error: 'Invalid locale' }, { status: 400 })
  }

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    await supabase.from('profiles').update({ locale }).eq('id', user.id)
  }

  const res = NextResponse.json({ ok: true })
  res.cookies.set('NEXT_LOCALE', locale, { path: '/', maxAge: 60 * 60 * 24 * 365 })
  return res
}
```

- [ ] **Step 2: Switcher component**

```tsx
// components/shared/LanguageSwitcher.tsx
'use client'
import { LOCALES, type Locale } from '@/i18n/locales'
import { usePathname, useRouter } from '@/i18n/navigation'
import { useLocale } from 'next-intl'

const LABELS: Record<Locale, string> = { en: 'EN', fr: 'FR', pcm: 'Pidgin' }

export function LanguageSwitcher() {
  const locale = useLocale()
  const pathname = usePathname()
  const router = useRouter()

  async function switchTo(next: Locale) {
    await fetch('/api/locale', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locale: next }),
    })
    router.replace(pathname, { locale: next })
  }

  return (
    <div className="flex items-center gap-1 text-xs">
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => switchTo(l)}
          disabled={l === locale}
          className={l === locale ? 'font-bold text-white' : 'text-sx-gray hover:text-white'}
        >
          {LABELS[l]}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Render it in `SiteHeader`**

Add `<LanguageSwitcher />` to `components/shared/SiteHeader.tsx`'s existing header row (place alongside the other header controls — read the file to match its existing layout before inserting).

- [ ] **Step 4: Typecheck and build**

Run: `npx tsc --noEmit -p .` then `npm run build`
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add components/shared/LanguageSwitcher.tsx app/api/locale/route.ts components/shared/SiteHeader.tsx
git commit -m "feat(i18n): add language switcher, persist choice to cookie + profiles.locale"
```

---

### Task 11: Convert header nav labels + home page headings (proof of pattern)

This is the task that proves everything above actually works end-to-end. It deliberately does **not** cover every string on every page — `SiteFooter.tsx` in particular has its own separate, larger hardcoded label structure (`EXPANDED_SECTIONS`, distinct from `lib/nav/links.ts`'s `FOOTER_SECTIONS`) that's real full-sweep work, not proof-of-pattern-sized. The footer, every other page, and the admin dashboard are the follow-on "page conversion sweep" plan, repeating exactly this pattern.

**Files:**
- Modify: `components/shared/SiteHeader.tsx` (nav labels use `nav.*` keys)
- Modify: `app/[locale]/page.tsx` (the two hardcoded headings use `home.*` keys)

**Interfaces:**
- Consumes: `messages/*.json`'s `nav`/`home` namespaces (Task 4)

- [ ] **Step 1: Convert `SiteHeader`'s nav labels**

`SiteHeader.tsx` renders `NAVBAR_LINKS` from `lib/nav/links.ts`, whose `label` field is plain English — but that array is also consumed by `SiteFooter.tsx` (`FOOTER_SECTIONS`) and `MobileNavSheet.tsx` (`SHEET_SITE_LINKS`), so changing its shape would force converting those files too, which is exactly the full-sweep work this task is deliberately not doing yet. Instead, translate at render time in `SiteHeader.tsx` only, via a local href→key lookup, leaving `lib/nav/links.ts` itself untouched for now:

```tsx
// components/shared/SiteHeader.tsx — add these imports
import { useTranslations } from 'next-intl'

// Add inside SiteHeader, before the return statement:
const t = useTranslations('nav')
const NAV_LABEL_KEYS: Record<string, string> = {
  '/': 'home',
  '/tournaments': 'tournaments',
  '/games': 'games',
  '/rankings': 'rankings',
  '/seasons/season-1': 'seasons',
  '/exchange': 'exchange',
  '/store': 'store',
  '/community': 'community',
  '/about': 'about',
}
```

Then in the `NAVBAR_LINKS.map(...)` block, replace `{item.label}` with `{t(NAV_LABEL_KEYS[item.href] ?? 'tournaments')}` (the fallback only matters if `NAVBAR_LINKS` ever gains an href this lookup doesn't cover — none do today, per the file as read).

- [ ] **Step 2: Convert the home page's two headings**

In `app/[locale]/page.tsx`, add `const t = await getTranslations('home')` (from `next-intl/server`, since this is a server component) at the top of `HomePage`, and replace:
```tsx
<h2 className="text-base font-bold text-white">Upcoming</h2>
```
with
```tsx
<h2 className="text-base font-bold text-white">{t('upcomingHeading')}</h2>
```
and similarly for `"🏆 Top Players"` → `` {`🏆 ${t('topPlayersHeading')}`} `` and the `"View all →"`/`"Full Rankings →"` links using `common.viewAll`/`home.fullRankingsLink`.

Also update `generateMetadata` in this same file to pass `locale` to `buildMetadata` (from `params`, per Task 9's step 5) — it's one of the call sites that needed updating.

- [ ] **Step 3: Manual verification across all three locales**

Run: `npm run dev`, then visit `/`, `/fr`, `/pcm` and confirm: the nav labels and the two converted headings show the correct language on each; every other page/link still works (untranslated pages just show English text regardless of locale prefix, which is expected — they haven't been converted yet).

- [ ] **Step 4: Build and full test suite**

Run: `npm run build && npx vitest run`
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add components/shared/SiteHeader.tsx "app/[locale]/page.tsx"
git commit -m "feat(i18n): convert header nav and home page headings to translated strings (proof of pattern)"
```

---

### Task 12: Signup seeds `profiles.locale` from the `NEXT_LOCALE` cookie

Per spec §5 — a player who signs up while browsing the French site shouldn't silently default to English notifications later. `lib/auth/actions.ts` has no existing test file — this task adds the first one, covering just the new behavior (not a full retrofit of `login`/`requestReset`/etc., which is out of scope here).

The signup flow writes `username`/`ref` into `auth.signUp`'s metadata, consumed by the `handle_new_user()` DB trigger — reusing that path for `locale` would mean also editing the trigger's SQL, a bigger surface than this one field needs. Simpler and self-contained: `auth.signUp()`'s response includes the new user's id immediately (even pre-email-confirmation, since the `auth.users` row — and therefore the trigger-created `profiles` row — already exists by the time `signUp()` returns), so a direct follow-up `update` is enough.

**Files:**
- Modify: `lib/auth/actions.ts`
- Test: `lib/auth/actions.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```ts
// lib/auth/actions.test.ts
import { describe, it, expect, vi } from 'vitest'

const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
const update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }))
const signUp = vi.fn()
const from = vi.fn((table: string) =>
  table === 'profiles'
    ? { select: () => ({ eq: () => ({ maybeSingle }) }), update }
    : {},
)
vi.mock('@/lib/supabase/server', () => ({ createClient: () => ({ from, auth: { signUp } }) }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const cookieGet = vi.fn()
vi.mock('next/headers', () => ({ cookies: () => ({ get: cookieGet }) }))

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData()
  Object.entries(fields).forEach(([k, v]) => fd.set(k, v))
  return fd
}

describe('signup locale seeding', () => {
  it("writes the profile's locale from the NEXT_LOCALE cookie", async () => {
    cookieGet.mockReturnValueOnce({ value: 'fr' })
    signUp.mockResolvedValueOnce({ data: { user: { id: 'user-1' } }, error: null })
    const { signup } = await import('./actions')
    await signup(undefined, formData({ username: 'x', email: 'x@x.com', password: 'password123' }))
    expect(update).toHaveBeenCalledWith({ locale: 'fr' })
  })

  it('defaults to en when the cookie is absent or invalid', async () => {
    cookieGet.mockReturnValueOnce(undefined)
    signUp.mockResolvedValueOnce({ data: { user: { id: 'user-2' } }, error: null })
    const { signup } = await import('./actions')
    await signup(undefined, formData({ username: 'y', email: 'y@y.com', password: 'password123' }))
    expect(update).toHaveBeenCalledWith({ locale: 'en' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/auth/actions.test.ts`
Expected: FAIL — `signup` doesn't read the cookie or update `locale` yet.

- [ ] **Step 3: Implement**

```ts
// lib/auth/actions.ts — add these imports
import { cookies } from 'next/headers'
import { LOCALES } from '@/i18n/locales'
```

Replace the existing `signUp` call and its error handling in `signup` with:

```ts
  // The email link format (token_hash + type + next) is controlled by the
  // Supabase "Confirm signup" template, which routes to /auth/confirm.
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: ref ? { username, ref } : { username },
    },
  })
  if (error) {
    console.error('[signup] supabase.auth.signUp failed', {
      email,
      code: (error as { code?: string }).code,
      status: (error as { status?: number }).status,
      message: error.message,
    })
    return { error: mapSignupError(error) }
  }

  // Seeds the new player's language from whatever they were browsing in —
  // see docs/superpowers/specs/2026-08-23-multi-language-support-design.md §5.
  const cookieLocale = cookies().get('NEXT_LOCALE')?.value
  const locale = LOCALES.includes(cookieLocale as (typeof LOCALES)[number]) ? cookieLocale : 'en'
  if (data.user) {
    await supabase.from('profiles').update({ locale }).eq('id', data.user.id)
  }

  return { success: 'check-email' }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/auth/actions.test.ts`
Expected: PASS, both tests.

- [ ] **Step 5: Run the full suite (this file had zero prior coverage — confirm nothing else broke)**

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add lib/auth/actions.ts lib/auth/actions.test.ts
git commit -m "feat(i18n): seed new profile's locale from the NEXT_LOCALE cookie at signup"
```

---

### Task 13: `sitemap.ts` emits locale variants

**Files:**
- Modify: `app/sitemap.ts`

- [ ] **Step 1: Read the current sitemap generator**

Read `app/sitemap.ts` in full before editing — its exact shape (static list vs. DB-driven) determines how to apply the locale expansion.

- [ ] **Step 2: Expand every entry to 3 locale variants**

For each URL entry the sitemap currently emits, emit three entries (one per locale) using `withLocalePrefix` (Task 2), each with an `alternates.languages` block matching `buildMetadata`'s hreflang shape (Task 9) — Next.js's `MetadataRoute.Sitemap` type supports this directly via each entry's own `alternates` field.

- [ ] **Step 3: Build**

Run: `npm run build`, then check the built output serves `/sitemap.xml` with 3x the previous entry count.

- [ ] **Step 4: Commit**

```bash
git add app/sitemap.ts
git commit -m "feat(i18n): sitemap emits all three locale variants of every URL"
```

---

### Task 14: `sw.js` precaches all locale variants of shell pages

Per spec §4's addendum — `/about`, `/games`, `/coming-soon` now exist at 3 locale variants each.

**Files:**
- Modify: `public/sw.js`

- [ ] **Step 1: Update `SHELL_URLS`**

```js
const SHELL_URLS = [
  '/about', '/fr/about', '/pcm/about',
  '/games', '/fr/games', '/pcm/games',
  '/coming-soon', '/fr/coming-soon', '/pcm/coming-soon',
  '/offline',
  '/icon-192.png', '/icon-512.png', '/icon-512-maskable.png',
  '/manifest.webmanifest', '/logo.png',
]
```

(`/offline` and the icon/manifest assets stay unprefixed, per spec §4.)

- [ ] **Step 2: Build and manually verify**

Run: `npm run build`. In Chrome DevTools → Application → Service Workers, confirm the worker reinstalls and precaches all entries with no 404s.

- [ ] **Step 3: Commit**

```bash
git add public/sw.js
git commit -m "feat(i18n): precache all locale variants of the offline-capable shell pages"
```

---

## Final Verification

- [ ] `npx tsc --noEmit -p .` — clean
- [ ] `npx vitest run` — all tests pass
- [ ] `npm run build` — clean, route list shows `[locale]`-scoped pages
- [ ] Manual: `/`, `/fr`, `/pcm` all load; nav + home headings are in the correct language on each; `/dashboard` (unauthenticated) redirects to the correctly-prefixed `/login`; `/fr/dashboard` (unauthenticated) redirects to `/fr/login`
