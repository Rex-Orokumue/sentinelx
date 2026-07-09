# Logged-in Navigation Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the platform's primary navigation — a mobile bottom tab bar (four pillars + account), a desktop avatar/account dropdown, and an admin sidebar/drawer — and fix the mobile header horizontal-scroll regression.

**Architecture:** Pure helpers (`lib/nav/*`) hold tab config, active-state logic, initials, and coming-soon copy (unit-tested). A server `getNavSession()` feeds auth/profile data to client nav components rendered from the layouts. Two-commit delivery: a minimal overflow hotfix first, then the full system that supersedes it.

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind, lucide-react icons, Vitest.

## Global Constraints

- **Mobile-first; no horizontal overflow** on any page at 375px. This is the whole point — verify it.
- Tailwind mobile breakpoint is `sm` (640px): mobile = below `sm`, desktop = `sm` and up.
- Reuse the existing `signOut` server action (`@/lib/auth/actions`) and `getStaffContext` (`@/lib/admin/auth`).
- Bottom tab bar is **global** (all visitors) but **not rendered on `/admin/*`** (admins use their sidebar/drawer).
- Coming-soon destinations use the query-param form `/coming-soon?feature=Watch`; shipping a real section is a one-line `href` swap on that tab.
- lucide-react icons used: `Trophy, Play, Users, ShoppingBag, User, Menu, X`. If any name isn't exported in lucide-react 1.23.0, substitute the nearest equivalent and note it.
- Tests: Vitest (`import { describe, it, expect } from 'vitest'`), colocated `*.test.ts`; run one file with `npx vitest run <path>`.

---

### Task 1: Overflow hotfix (Commit 1)

**Files:**
- Modify: `components/shared/SiteHeader.tsx`

**Interfaces:** none (self-contained minimal fix).

The logged-in header overflows because `{authNav}` (Admin/Dashboard/Sign out) renders in the always-visible row on mobile. Move it out of that row and into the existing mobile dropdown; keep it inline on desktop only.

- [ ] **Step 1: Hide the inline auth row on mobile**

In `components/shared/SiteHeader.tsx`, replace:

```tsx
          {/* Auth (always visible) */}
          {authNav}
```

with:

```tsx
          {/* Auth — desktop inline; mobile moves into the dropdown below */}
          <div className="hidden sm:block">{authNav}</div>
```

- [ ] **Step 2: Add the auth links into the mobile dropdown**

In the same file, in the mobile dropdown block, after the WhatsApp `</a>` and before the closing `</div>` of `{open && (...)}`, add:

```tsx
          <div className="mt-1 border-t border-slate-800 pt-2">{authNav}</div>
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: compiles; `/` builds without error.

- [ ] **Step 4: Commit**

```bash
git add components/shared/SiteHeader.tsx
git commit -m "fix: move header auth links out of the always-inline row on mobile

Stops the logged-in header from overflowing 375px (horizontal scroll).
Auth links now live in the mobile hamburger dropdown; unchanged on desktop.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 5: Push the hotfix so it ships now**

```bash
git push origin main
```

---

### Task 2: Coming-soon copy helper (Commit 2)

**Files:**
- Create: `lib/nav/coming-soon.ts`
- Test: `lib/nav/coming-soon.test.ts`

**Interfaces:**
- Produces: `ComingSoonFeature { title: string; blurb: string }`; `resolveComingSoon(feature: string | undefined): ComingSoonFeature`. Consumed by Task 5.

- [ ] **Step 1: Write the failing test**

Create `lib/nav/coming-soon.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolveComingSoon } from './coming-soon'

describe('resolveComingSoon', () => {
  it('returns branded copy for known features', () => {
    expect(resolveComingSoon('Watch').title).toBe('Watch')
    expect(resolveComingSoon('Watch').blurb).toMatch(/replays/i)
    expect(resolveComingSoon('Community').title).toBe('Community')
    expect(resolveComingSoon('Trade').title).toBe('Trade')
  })

  it('falls back for unknown or missing features', () => {
    expect(resolveComingSoon('Nope').title).toBe('Coming soon')
    expect(resolveComingSoon(undefined).title).toBe('Coming soon')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/nav/coming-soon.test.ts`
Expected: FAIL — cannot resolve `./coming-soon`.

- [ ] **Step 3: Write the implementation**

Create `lib/nav/coming-soon.ts`:

```ts
export interface ComingSoonFeature {
  title: string
  blurb: string
}

const FEATURES: Record<string, ComingSoonFeature> = {
  Watch: {
    title: 'Watch',
    blurb: 'Live streams, highlights, and match replays on Sentinel X TV. Coming soon.',
  },
  Community: {
    title: 'Community',
    blurb: 'Posts, discussions, and announcements from the arena. Coming soon.',
  },
  Trade: {
    title: 'Trade',
    blurb: 'The Gaming Exchange for accounts, coins, and gear, secured by escrow. Coming soon.',
  },
}

const FALLBACK: ComingSoonFeature = {
  title: 'Coming soon',
  blurb: 'This part of Sentinel X is on the way.',
}

export function resolveComingSoon(feature: string | undefined): ComingSoonFeature {
  if (!feature) return FALLBACK
  return FEATURES[feature] ?? FALLBACK
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/nav/coming-soon.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/nav/coming-soon.ts lib/nav/coming-soon.test.ts
git commit -m "feat: coming-soon feature copy helper (nav)"
```

---

### Task 3: Tab config + active-state + initials helpers

**Files:**
- Create: `lib/nav/tabs.ts`
- Test: `lib/nav/tabs.test.ts`

**Interfaces:**
- Produces: `TabDef { key, label, href, feature: string | null, match: string | null }`; `PILLAR_TABS: TabDef[]`; `isTabActive(tab, pathname, feature): boolean`; `initialsFrom(displayName, username): string`. Consumed by Tasks 4, 6.

- [ ] **Step 1: Write the failing test**

Create `lib/nav/tabs.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { isTabActive, initialsFrom, PILLAR_TABS } from './tabs'

const compete = PILLAR_TABS.find((t) => t.key === 'compete')!
const watch = PILLAR_TABS.find((t) => t.key === 'watch')!

describe('isTabActive', () => {
  it('marks a path-matched tab active on its route and subroutes', () => {
    expect(isTabActive(compete, '/tournaments', null)).toBe(true)
    expect(isTabActive(compete, '/tournaments/dls-cup', null)).toBe(true)
    expect(isTabActive(compete, '/rankings', null)).toBe(false)
  })

  it('marks a coming-soon tab active only for its feature', () => {
    expect(isTabActive(watch, '/coming-soon', 'Watch')).toBe(true)
    expect(isTabActive(watch, '/coming-soon', 'Trade')).toBe(false)
    expect(isTabActive(watch, '/tournaments', 'Watch')).toBe(false)
  })
})

describe('initialsFrom', () => {
  it('uses two-word display names', () => {
    expect(initialsFrom('Rex Orokumue', 'rexo')).toBe('RO')
  })
  it('falls back to the first two letters of a single token', () => {
    expect(initialsFrom(null, 'rexorokumue')).toBe('RE')
    expect(initialsFrom('Rex', null)).toBe('RE')
  })
  it('returns ? when nothing is available', () => {
    expect(initialsFrom(null, null)).toBe('?')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/nav/tabs.test.ts`
Expected: FAIL — cannot resolve `./tabs`.

- [ ] **Step 3: Write the implementation**

Create `lib/nav/tabs.ts`:

```ts
export interface TabDef {
  key: string
  label: string
  href: string
  // For coming-soon tabs: the ?feature= value that marks this tab active. Else null.
  feature: string | null
  // For real-page tabs: the pathname prefix that marks this tab active. Else null.
  match: string | null
}

// The four product pillars. The Account tab is auth-dependent and handled in the component.
export const PILLAR_TABS: TabDef[] = [
  { key: 'compete', label: 'Compete', href: '/tournaments', feature: null, match: '/tournaments' },
  { key: 'watch', label: 'Watch', href: '/coming-soon?feature=Watch', feature: 'Watch', match: null },
  { key: 'community', label: 'Community', href: '/coming-soon?feature=Community', feature: 'Community', match: null },
  { key: 'trade', label: 'Trade', href: '/coming-soon?feature=Trade', feature: 'Trade', match: null },
]

export function isTabActive(
  tab: { feature: string | null; match: string | null },
  pathname: string,
  feature: string | null,
): boolean {
  if (tab.match) return pathname === tab.match || pathname.startsWith(`${tab.match}/`)
  if (tab.feature) return pathname === '/coming-soon' && feature === tab.feature
  return false
}

export function initialsFrom(displayName: string | null, username: string | null): string {
  const source = (displayName ?? username ?? '').trim()
  if (!source) return '?'
  const parts = source.split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return source.slice(0, 2).toUpperCase()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/nav/tabs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/nav/tabs.ts lib/nav/tabs.test.ts
git commit -m "feat: nav tab config, active-state, and initials helpers"
```

---

### Task 4: Session helper + Avatar component

**Files:**
- Create: `lib/nav/session.ts`
- Create: `components/shared/Avatar.tsx`

**Interfaces:**
- Consumes: `initialsFrom` (Task 3), `getStaffContext` (`@/lib/admin/auth`), `createClient` (`@/lib/supabase/server`).
- Produces: `NavSession { isLoggedIn, isStaff, username, displayName, avatarUrl }`; `getNavSession(): Promise<NavSession>`; `<Avatar avatarUrl displayName username size? className? />`. Consumed by Tasks 6, 7.

- [ ] **Step 1: Write the session helper**

Create `lib/nav/session.ts`:

```ts
import { createClient } from '@/lib/supabase/server'
import { getStaffContext } from '@/lib/admin/auth'

export interface NavSession {
  isLoggedIn: boolean
  isStaff: boolean
  username: string | null
  displayName: string | null
  avatarUrl: string | null
}

const LOGGED_OUT: NavSession = {
  isLoggedIn: false,
  isStaff: false,
  username: null,
  displayName: null,
  avatarUrl: null,
}

export async function getNavSession(): Promise<NavSession> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return LOGGED_OUT

  const [{ data: profile }, staff] = await Promise.all([
    supabase.from('profiles').select('username, display_name, avatar_url').eq('id', user.id).maybeSingle(),
    getStaffContext(),
  ])

  return {
    isLoggedIn: true,
    isStaff: staff?.isStaff ?? false,
    username: profile?.username ?? null,
    displayName: profile?.display_name ?? null,
    avatarUrl: profile?.avatar_url ?? null,
  }
}
```

- [ ] **Step 2: Write the Avatar component**

Create `components/shared/Avatar.tsx`:

```tsx
import { initialsFrom } from '@/lib/nav/tabs'

// Renders the user's avatar image when set, otherwise initials on a neutral circle.
// A plain <img> avoids next/image remote-host config for Supabase storage URLs.
export function Avatar({
  avatarUrl,
  displayName,
  username,
  size = 28,
  className = '',
}: {
  avatarUrl: string | null
  displayName: string | null
  username: string | null
  size?: number
  className?: string
}) {
  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt=""
        width={size}
        height={size}
        className={`shrink-0 rounded-full object-cover ${className}`}
      />
    )
  }
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full bg-slate-700 font-bold text-white ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
    >
      {initialsFrom(displayName, username)}
    </span>
  )
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/nav/session.ts components/shared/Avatar.tsx
git commit -m "feat: getNavSession helper + Avatar (image or initials)"
```

---

### Task 5: Coming-soon page

**Files:**
- Create: `app/(public)/coming-soon/page.tsx`

**Interfaces:**
- Consumes: `resolveComingSoon` (Task 2).

- [ ] **Step 1: Write the page**

Create `app/(public)/coming-soon/page.tsx`:

```tsx
import type { Metadata } from 'next'
import Link from 'next/link'
import { resolveComingSoon } from '@/lib/nav/coming-soon'

type SearchParams = { feature?: string }

export function generateMetadata({ searchParams }: { searchParams: SearchParams }): Metadata {
  const f = resolveComingSoon(searchParams.feature)
  return { title: `${f.title} — SentinelX Esports` }
}

export default function ComingSoonPage({ searchParams }: { searchParams: SearchParams }) {
  const f = resolveComingSoon(searchParams.feature)
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 text-center">
      <span className="font-display text-2xl font-bold uppercase tracking-wide text-white">
        Sentinel<span className="text-violet-400">X</span>
      </span>
      <h1 className="mt-6 text-3xl font-black text-white">{f.title}</h1>
      <p className="mt-3 text-sm text-slate-400">{f.blurb}</p>
      <Link
        href="/tournaments"
        className="mt-8 rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-violet-500"
      >
        Back to Compete
      </Link>
    </div>
  )
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: compiles; `/coming-soon` appears in the route list.

- [ ] **Step 3: Commit**

```bash
git add "app/(public)/coming-soon/page.tsx"
git commit -m "feat: shared coming-soon page (feature from query param)"
```

---

### Task 6: Bottom tab bar + layout wiring

**Files:**
- Create: `components/shared/BottomTabBar.tsx`
- Modify: `app/layout.tsx`

**Interfaces:**
- Consumes: `PILLAR_TABS`, `isTabActive` (Task 3), `Avatar` (Task 4), `NavSession`/`getNavSession` (Task 4).
- Produces: `<BottomTabBar session={NavSession} />`.

- [ ] **Step 1: Write the bottom tab bar**

Create `components/shared/BottomTabBar.tsx`:

```tsx
'use client'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { Trophy, Play, Users, ShoppingBag, User } from 'lucide-react'
import { PILLAR_TABS, isTabActive } from '@/lib/nav/tabs'
import { Avatar } from '@/components/shared/Avatar'
import type { NavSession } from '@/lib/nav/session'

const ICONS: Record<string, typeof Trophy> = {
  compete: Trophy,
  watch: Play,
  community: Users,
  trade: ShoppingBag,
}

export function BottomTabBar({ session }: { session: NavSession }) {
  const pathname = usePathname()
  const feature = useSearchParams().get('feature')

  // The admin sidebar/drawer owns navigation on admin pages — one surface there.
  if (pathname.startsWith('/admin')) return null

  const accountHref = session.isLoggedIn ? '/dashboard' : '/login'
  const accountActive = pathname.startsWith('/dashboard')
  const cls = (active: boolean) =>
    `flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium ${
      active ? 'text-violet-400' : 'text-slate-400'
    }`

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-800 bg-slate-950/95 backdrop-blur-sm sm:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="mx-auto flex max-w-md items-stretch">
        {PILLAR_TABS.map((tab) => {
          const Icon = ICONS[tab.key]
          return (
            <Link key={tab.key} href={tab.href} className={cls(isTabActive(tab, pathname, feature))}>
              <Icon className="h-5 w-5" />
              {tab.label}
            </Link>
          )
        })}
        <Link href={accountHref} className={cls(accountActive)}>
          {session.isLoggedIn ? (
            <Avatar
              avatarUrl={session.avatarUrl}
              displayName={session.displayName}
              username={session.username}
              size={20}
              className={accountActive ? 'ring-2 ring-violet-400' : ''}
            />
          ) : (
            <User className="h-5 w-5" />
          )}
          Account
        </Link>
      </div>
    </nav>
  )
}
```

- [ ] **Step 2: Wire into the root layout**

In `app/layout.tsx`, add imports:

```tsx
import { Suspense } from 'react'
import { getNavSession } from '@/lib/nav/session'
import { BottomTabBar } from '@/components/shared/BottomTabBar'
```

Make the component async and fetch the session, then render the bar. Change the function signature and body:

```tsx
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const navSession = await getNavSession()
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${rajdhani.variable} bg-slate-950 font-sans text-white antialiased`}
      >
        <div className="flex min-h-screen flex-col">
          <SiteHeader authNav={<AuthNav />} whatsappUrl={WHATSAPP_COMMUNITY} />

          {/* pb-16 clears the fixed mobile tab bar; removed at sm+ */}
          <main className="flex-1 pb-16 sm:pb-0">{children}</main>

          <footer className="border-t border-slate-800 py-5 text-center text-xs text-slate-600">
            © {new Date().getFullYear()} SentinelX Esports · Nigeria&apos;s Home of Mobile Esports
          </footer>
        </div>

        {/* useSearchParams requires a Suspense boundary to avoid de-opting pages to CSR */}
        <Suspense fallback={null}>
          <BottomTabBar session={navSession} />
        </Suspense>
      </body>
    </html>
  )
}
```

(Note: `SiteHeader authNav={<AuthNav />}` stays as-is in this task; Task 7 replaces it.)

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: compiles with no "useSearchParams should be wrapped in a suspense boundary" error.

- [ ] **Step 4: Commit**

```bash
git add components/shared/BottomTabBar.tsx app/layout.tsx
git commit -m "feat: mobile bottom tab bar (four pillars + account)"
```

---

### Task 7: Account dropdown + header rework

**Files:**
- Create: `components/shared/AccountMenu.tsx`
- Modify: `components/shared/SiteHeader.tsx`
- Modify: `app/layout.tsx`
- Delete: `components/shared/AuthNav.tsx`

**Interfaces:**
- Consumes: `NavSession` (Task 4), `Avatar` (Task 4), `signOut` (`@/lib/auth/actions`).
- Produces: `<AccountMenu session={NavSession} />`. `SiteHeader` now takes `{ session, whatsappUrl }` instead of `{ authNav, whatsappUrl }`.

- [ ] **Step 1: Write the account dropdown**

Create `components/shared/AccountMenu.tsx`:

```tsx
'use client'
import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { signOut } from '@/lib/auth/actions'
import { Avatar } from '@/components/shared/Avatar'
import type { NavSession } from '@/lib/nav/session'

export function AccountMenu({ session }: { session: NavSession }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onEsc)
    }
  }, [])

  if (!session.isLoggedIn) {
    return (
      <Link
        href="/login"
        className="rounded-lg px-3 py-1.5 text-sm text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
      >
        Log in
      </Link>
    )
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Account menu"
        aria-expanded={open}
        className="flex items-center rounded-full ring-1 ring-slate-700 transition hover:ring-slate-500"
      >
        <Avatar
          avatarUrl={session.avatarUrl}
          displayName={session.displayName}
          username={session.username}
          size={30}
        />
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-44 rounded-xl border border-slate-800 bg-slate-900 py-1 shadow-xl">
          {/* My Profile → /players/[username] once #10b ships; /dashboard until then */}
          <MenuLink href="/dashboard" onNavigate={() => setOpen(false)}>My Profile</MenuLink>
          <MenuLink href="/dashboard" onNavigate={() => setOpen(false)}>Dashboard</MenuLink>
          {session.isStaff && (
            <MenuLink href="/admin" onNavigate={() => setOpen(false)}>Admin</MenuLink>
          )}
          <form action={signOut}>
            <button
              type="submit"
              className="block w-full px-4 py-2 text-left text-sm text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
            >
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  )
}

function MenuLink({
  href,
  onNavigate,
  children,
}: {
  href: string
  onNavigate: () => void
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className="block px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
    >
      {children}
    </Link>
  )
}
```

- [ ] **Step 2: Rework SiteHeader**

Replace the entire contents of `components/shared/SiteHeader.tsx` with:

```tsx
'use client'
import Image from 'next/image'
import Link from 'next/link'
import { AccountMenu } from '@/components/shared/AccountMenu'
import type { NavSession } from '@/lib/nav/session'

const NAV = [
  { href: '/tournaments', label: 'Tournaments' },
  { href: '/rankings', label: 'Rankings' },
]

export function SiteHeader({
  session,
  whatsappUrl,
}: {
  session: NavSession
  whatsappUrl: string
}) {
  return (
    <header className="sticky top-0 z-50 border-b border-slate-800 bg-slate-950/90 backdrop-blur-sm">
      <nav className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 py-3">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <Image src="/logo-icon.png" alt="SentinelX Esports" width={32} height={32} priority />
          <span className="flex flex-col leading-none">
            <span className="whitespace-nowrap font-display text-lg font-bold uppercase tracking-wide text-white sm:text-xl">
              Sentinel<span className="text-violet-400">X</span>
            </span>
            <span className="font-display text-[10px] font-semibold uppercase tracking-[0.25em] text-slate-400">
              Esports
            </span>
          </span>
        </Link>

        <div className="flex items-center gap-1 sm:gap-2">
          {/* Desktop-only primary links */}
          <div className="hidden items-center gap-1 sm:flex">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-lg px-3 py-1.5 text-sm text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
              >
                {item.label}
              </Link>
            ))}
          </div>

          {/* WhatsApp CTA — all breakpoints */}
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-full bg-[#25D366] px-3 py-1.5 text-xs font-bold text-white transition-opacity hover:opacity-90"
          >
            <WhatsAppIcon className="h-3.5 w-3.5" />
            <span className="hidden xs:inline sm:inline">Community</span>
          </a>

          {/* Account — desktop only; mobile uses the bottom tab bar */}
          <div className="hidden sm:block">
            <AccountMenu session={session} />
          </div>
        </div>
      </nav>
    </header>
  )
}

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  )
}
```

- [ ] **Step 3: Update the layout to pass session and drop AuthNav**

In `app/layout.tsx`, remove the `import { AuthNav } from '@/components/shared/AuthNav'` line, and change the header render from:

```tsx
          <SiteHeader authNav={<AuthNav />} whatsappUrl={WHATSAPP_COMMUNITY} />
```

to:

```tsx
          <SiteHeader session={navSession} whatsappUrl={WHATSAPP_COMMUNITY} />
```

- [ ] **Step 4: Delete the now-unused AuthNav**

```bash
git rm components/shared/AuthNav.tsx
```

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: compiles; no references to `AuthNav` remain (grep `AuthNav` returns nothing under `app/` and `components/`).

- [ ] **Step 6: Commit**

```bash
git add components/shared/AccountMenu.tsx components/shared/SiteHeader.tsx app/layout.tsx
git commit -m "feat: desktop account dropdown; header uses nav session, drops inline AuthNav"
```

---

### Task 8: Admin sidebar / drawer

**Files:**
- Create: `components/admin/AdminSidebar.tsx`
- Modify: `app/admin/layout.tsx`
- Delete: `components/admin/AdminNav.tsx`

**Interfaces:**
- Consumes: `AdminNavItem` (`@/lib/admin/nav`).
- Produces: `<AdminSidebar items={AdminNavItem[]} isAdmin={boolean} />` (renders desktop aside + mobile bar/drawer).

- [ ] **Step 1: Write the sidebar/drawer**

Create `components/admin/AdminSidebar.tsx`:

```tsx
'use client'
import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu, X } from 'lucide-react'
import type { AdminNavItem } from '@/lib/admin/nav'

function RoleBadge({ isAdmin }: { isAdmin: boolean }) {
  return (
    <span className="rounded-full border border-slate-700 px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest text-slate-400">
      {isAdmin ? 'Admin' : 'Moderator'}
    </span>
  )
}

function NavList({ items, pathname, onNavigate }: {
  items: AdminNavItem[]
  pathname: string
  onNavigate?: () => void
}) {
  return (
    <nav className="space-y-1">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={`block rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
              active ? 'bg-violet-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
            }`}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}

export function AdminSidebar({ items, isAdmin }: { items: AdminNavItem[]; isAdmin: boolean }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  return (
    <>
      {/* Mobile top bar */}
      <div className="flex items-center justify-between gap-3 py-4 sm:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open admin menu"
          className="flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-1.5 text-sm font-bold text-slate-200 hover:border-slate-500"
        >
          <Menu className="h-4 w-4" /> Menu
        </button>
        <RoleBadge isAdmin={isAdmin} />
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 sm:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-64 border-r border-slate-800 bg-slate-950 p-4">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-lg font-black text-white">Admin</span>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close admin menu" className="p-1 text-slate-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            <NavList items={items} pathname={pathname} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden w-52 shrink-0 sm:block">
        <div className="sticky top-20 py-6">
          <div className="mb-4 flex items-center justify-between gap-2">
            <span className="text-lg font-black text-white">Admin</span>
            <RoleBadge isAdmin={isAdmin} />
          </div>
          <NavList items={items} pathname={pathname} />
        </div>
      </aside>
    </>
  )
}
```

- [ ] **Step 2: Rework the admin layout**

Replace the contents of `app/admin/layout.tsx` with:

```tsx
import { requireStaff } from '@/lib/admin/auth'
import { ADMIN_NAV, visibleNav } from '@/lib/admin/nav'
import { AdminSidebar } from '@/components/admin/AdminSidebar'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireStaff()
  const items = visibleNav(ADMIN_NAV, ctx.isAdmin)
  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 sm:flex sm:gap-6">
      <AdminSidebar items={items} isAdmin={ctx.isAdmin} />
      <div className="min-w-0 flex-1 py-6">{children}</div>
    </div>
  )
}
```

`AdminSidebar` renders both the mobile bar/drawer (`sm:hidden` / fixed) and the desktop `<aside>` (`hidden sm:block`). As the first flex child it contributes the sidebar column beside the content on desktop, and the top bar on mobile (where the flex is inactive below `sm`).

- [ ] **Step 3: Delete the old AdminNav**

```bash
git rm components/admin/AdminNav.tsx
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: compiles; grep `AdminNav` returns nothing under `app/` and `components/`.

- [ ] **Step 5: Commit**

```bash
git add components/admin/AdminSidebar.tsx app/admin/layout.tsx
git commit -m "feat: admin sidebar (desktop) + drawer (mobile), replacing the tab strip"
```

---

### Task 9: Dashboard sign-out + Compete secondary links

**Files:**
- Modify: `app/dashboard/page.tsx`
- Modify: `app/(public)/tournaments/page.tsx`

**Interfaces:**
- Consumes: `signOut` (`@/lib/auth/actions`).

- [ ] **Step 1: Add a Sign out control to the dashboard**

In `app/dashboard/page.tsx`, add the import:

```tsx
import { signOut } from '@/lib/auth/actions'
```

Then, immediately after the `<DashboardHeader ... />` element in the returned JSX, add:

```tsx
      <form action={signOut} className="mb-4">
        <button
          type="submit"
          className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 transition-colors hover:border-slate-500 hover:text-white"
        >
          Sign out
        </button>
      </form>
```

(This keeps sign-out reachable on mobile, where auth left the header for the bottom bar's Account tab → dashboard.)

- [ ] **Step 2: Add Rankings / Hall of Fame links to the Compete page**

In `app/(public)/tournaments/page.tsx`, find the page heading area in the returned JSX (the first block after the outer wrapper `<div>`). Add this secondary link row as the first child inside that outer wrapper, before the tournament listing:

```tsx
      <div className="flex items-center gap-4 px-4 pt-6 text-sm">
        <Link href="/rankings" className="font-semibold text-violet-400 hover:text-violet-300">
          Rankings
        </Link>
        <Link href="/hall-of-fame" className="font-semibold text-violet-400 hover:text-violet-300">
          Hall of Fame
        </Link>
      </div>
```

`Link` is already imported in this file. If the outer wrapper has its own horizontal padding, drop the `px-4` from the row to avoid double padding — match the sibling content's padding.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: compiles.

- [ ] **Step 4: Commit**

```bash
git add app/dashboard/page.tsx "app/(public)/tournaments/page.tsx"
git commit -m "feat: dashboard sign-out (mobile) + Compete rankings/hall-of-fame links"
```

---

### Task 10: Full verification + push

**Files:** none.

- [ ] **Step 1: Full test + build gate**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: all tests pass (existing suite + new nav helper tests), no type errors, build succeeds, route list includes `/coming-soon`.

- [ ] **Step 2: Confirm no stale references**

Run: `git grep -n "AuthNav\|components/admin/AdminNav" -- app components` (Bash) or Grep for `AuthNav` and `AdminNav` under `app/` and `components/`.
Expected: no matches (both replaced).

- [ ] **Step 3: Mobile overflow check (public page, no auth needed)**

Start `npm run dev`, load `http://localhost:3000/tournaments` in a 375–390px viewport. Confirm: (a) no horizontal scroll (`document.documentElement.scrollWidth <= window.innerWidth`), (b) the bottom tab bar renders with five tabs, (c) `/coming-soon?feature=Watch` shows the branded "Watch" card and its tab is highlighted. If a logged-in session is available, also confirm the logged-in header no longer overflows and the Account tab shows the avatar/initials.

- [ ] **Step 4: Push**

```bash
git push origin main
```

---

## Self-Review

- **Spec coverage:** §3 model → Tasks 6–8; §4 bottom bar + avatar → Tasks 3,4,6; §5 Compete links → Task 9; §6 account dropdown → Task 7; §7 admin sidebar/drawer → Task 8; §8 coming-soon → Tasks 2,5; §9 session helper → Task 4; §10 files → all tasks; §11 testing → Tasks 2,3,10; §12 scope (hotfix first) → Task 1. Sign-out mobile reachability → Task 9. All covered.
- **Placeholder scan:** none — every code step has full code. (Task 8 Step 2 shows an initial layout then the corrected one and explicitly says "this is the version to use"; the corrected version is complete.)
- **Type consistency:** `NavSession` fields (`isLoggedIn, isStaff, username, displayName, avatarUrl`) are produced in Task 4 and consumed identically in Tasks 6/7. `Avatar` prop names match across BottomTabBar/AccountMenu. `TabDef`/`isTabActive`/`PILLAR_TABS` from Task 3 used unchanged in Task 6. `AdminNavItem` reused from existing `lib/admin/nav.ts`. `SiteHeader` prop change (`authNav` → `session`) is applied in both the component (Task 7 Step 2) and its caller (Task 7 Step 3).
- **Two-commit delivery:** Task 1 is the standalone hotfix (own commit + push); Tasks 2–9 are the full system; Task 7 removes the hotfix's mobile handling by rewriting `SiteHeader`. Consistent with spec §2/§12.
