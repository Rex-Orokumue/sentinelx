# Unified Mobile Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace SentinelX's three overlapping phone-width nav surfaces (`BottomTabBar`, `SiteHeader`'s side drawer, `AdminSidebar`'s own mobile drawer) with a single bottom-sheet component (`MobileNavSheet`) opened by one hamburger trigger that already lives in `SiteHeader`, on every page including `/admin/*`.

**Architecture:** One new client component, `components/shared/MobileNavSheet.tsx`, follows the existing `VideoModal` bottom-sheet precedent (slide up from bottom, rounded top corners, backdrop-click + Escape to close, body scroll-lock while open). It renders three stacked sections — Admin (staff only), Site, Account — plus the WhatsApp CTA. `SiteHeader`'s existing hamburger button now opens this sheet instead of its old side drawer. `BottomTabBar` and `AdminSidebar`'s mobile-only trigger+drawer are deleted outright; their desktop counterparts (`AdminSidebar`'s `<aside>`) are untouched. `NavSession` gains `isAdmin: boolean`, and the root layout conditionally fetches admin nav data (items, badge counts, role) only when the signed-in user is staff, then threads it down to `SiteHeader` → `MobileNavSheet`.

**Tech Stack:** Next.js 14 App Router, TypeScript, React Server + Client Components, Tailwind CSS, Vitest.

## Global Constraints

- Bottom sheet, not a side drawer (confirmed via visual comparison — see spec §Decisions 1).
- One trigger everywhere: the hamburger already in `SiteHeader`'s sticky header, unchanged position, on every page including `/admin/*` (spec §Decisions 2).
- Admin content lives in the *same* sheet as Site content, not a separate sheet — Admin section above Site section, so staff always has one tap back to the public site and one tap into admin tools (spec §Decisions 3).
- `BottomTabBar` is deleted entirely, not just visually merged; its Account items move into the sheet's Account section (spec §Decisions 4).
- Site section is a deduplicated merge of `NAVBAR_LINKS` ∪ `PILLAR_LINKS` by href — this is what makes `/tv` reachable from mobile nav again (spec §Architecture 2).
- `AdminSidebar`'s desktop `<aside>` (`sm:` and up) is untouched — phone-width-only consolidation (spec §Decisions 2).
- No change to desktop/tablet navigation, to what's IN `NAVBAR_LINKS`/`PILLAR_LINKS`/`ADMIN_NAV` beyond the TV-inclusion fix, or to `FOOTER_SECTIONS` (spec §Out of Scope).
- Sheet closes on navigation — every link/button inside it calls the close handler before/alongside routing (spec §Edge Cases).
- Testing convention for this feature: the merge/dedupe helper is pure and gets real Vitest tests; everything else is verified via `npm run build` + `npm run lint` + manual DOM/route inspection, since true narrow-viewport rendering isn't reliable in this environment (spec §Testing).

---

## File Structure

- **Modify `lib/nav/links.ts`** — add `mergeNavLinks()` (pure, exported, tested) and `SHEET_SITE_LINKS` (the merged Site-section list the sheet renders).
- **Create `lib/nav/links.test.ts`** — tests for `mergeNavLinks()` and `SHEET_SITE_LINKS`.
- **Modify `lib/nav/session.ts`** — add `isAdmin: boolean` to `NavSession`.
- **Modify `lib/admin/nav.ts`** — add `AdminSheetData` interface (the shape `MobileNavSheet`'s Admin section consumes).
- **Create `components/shared/MobileNavSheet.tsx`** — the new bottom-sheet component.
- **Modify `components/shared/SiteHeader.tsx`** — replace the inline side-drawer JSX with `<MobileNavSheet>`; accept a new `adminNav` prop and thread it through.
- **Modify `components/admin/AdminSidebar.tsx`** — delete the mobile top bar + mobile drawer blocks; keep the desktop `<aside>` untouched.
- **Modify `app/layout.tsx`** — delete `BottomTabBar` usage and its `pb-16` spacer; conditionally build `adminNav` data when `navSession.isStaff` and pass it to `SiteHeader`.
- **Delete `components/shared/BottomTabBar.tsx`**.

---

### Task 1: Merge-and-dedupe helper for the sheet's Site section

**Files:**
- Modify: `lib/nav/links.ts`
- Test: `lib/nav/links.test.ts` (new file)

**Interfaces:**
- Consumes: existing `NavLink` interface, `NAVBAR_LINKS`, `PILLAR_LINKS` (all already exported from this file — see current file contents below).
- Produces:
  - `export function mergeNavLinks(...lists: NavLink[][]): NavLink[]` — dedupes by `href`; for each list in order, appends every link whose `href` hasn't been seen yet, in that list's own order. First list's order wins for shared hrefs.
  - `export const SHEET_SITE_LINKS: NavLink[] = mergeNavLinks(NAVBAR_LINKS, PILLAR_LINKS)` — the exact list `MobileNavSheet`'s Site section (Task 3) renders. `NAVBAR_LINKS` goes first so Home leads the list; `PILLAR_LINKS` contributes only `/tv`, since `Tournaments`/`Community`/`Exchange` already appear in `NAVBAR_LINKS` with identical labels.

Current end of `lib/nav/links.ts` (line 73) is the anchor point — append after it, don't reorder anything above.

- [ ] **Step 1: Write the failing tests**

Create `lib/nav/links.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mergeNavLinks, SHEET_SITE_LINKS, NAVBAR_LINKS, PILLAR_LINKS, type NavLink } from './links'

describe('mergeNavLinks', () => {
  it('keeps every link from the first list, in order', () => {
    const a: NavLink[] = [{ href: '/a', label: 'A' }, { href: '/b', label: 'B' }]
    expect(mergeNavLinks(a, [])).toEqual(a)
  })

  it('appends links from later lists whose href is not already present', () => {
    const a: NavLink[] = [{ href: '/a', label: 'A' }]
    const b: NavLink[] = [{ href: '/b', label: 'B' }]
    expect(mergeNavLinks(a, b)).toEqual([
      { href: '/a', label: 'A' },
      { href: '/b', label: 'B' },
    ])
  })

  it('drops a later-list link whose href already appeared, keeping the first occurrence', () => {
    const a: NavLink[] = [{ href: '/shared', label: 'First label' }]
    const b: NavLink[] = [{ href: '/shared', label: 'Second label' }, { href: '/only-b', label: 'Only B' }]
    expect(mergeNavLinks(a, b)).toEqual([
      { href: '/shared', label: 'First label' },
      { href: '/only-b', label: 'Only B' },
    ])
  })

  it('merges three or more lists', () => {
    const a: NavLink[] = [{ href: '/a', label: 'A' }]
    const b: NavLink[] = [{ href: '/a', label: 'A dup' }, { href: '/b', label: 'B' }]
    const c: NavLink[] = [{ href: '/c', label: 'C' }]
    expect(mergeNavLinks(a, b, c)).toEqual([
      { href: '/a', label: 'A' },
      { href: '/b', label: 'B' },
      { href: '/c', label: 'C' },
    ])
  })
})

describe('SHEET_SITE_LINKS', () => {
  it('includes /tv, the gap BottomTabBar used to be the only way to reach', () => {
    expect(SHEET_SITE_LINKS.some((l) => l.href === '/tv')).toBe(true)
  })

  it('has no duplicate hrefs', () => {
    const hrefs = SHEET_SITE_LINKS.map((l) => l.href)
    expect(new Set(hrefs).size).toBe(hrefs.length)
  })

  it('contains every NAVBAR_LINKS entry', () => {
    for (const link of NAVBAR_LINKS) {
      expect(SHEET_SITE_LINKS).toContainEqual(link)
    }
  })

  it('contains every PILLAR_LINKS entry (by href — PillarLink carries an extra `key` field NavLink does not)', () => {
    for (const pillar of PILLAR_LINKS) {
      expect(SHEET_SITE_LINKS.some((l) => l.href === pillar.href && l.label === pillar.label)).toBe(true)
    }
  })

  it('leads with Home, from NAVBAR_LINKS', () => {
    expect(SHEET_SITE_LINKS[0]).toEqual({ href: '/', label: 'Home' })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- lib/nav/links.test.ts`
Expected: FAIL — `mergeNavLinks` and `SHEET_SITE_LINKS` are not exported yet.

- [ ] **Step 3: Implement the helper**

Append to the end of `lib/nav/links.ts` (after the existing `FOOTER_SECTIONS` export on line 72-73):

```ts

// Deduped, ordered merge of any number of NavLink lists — first occurrence
// of each href wins, in that link's own list's order. Used to build the
// mobile nav sheet's Site section from NAVBAR_LINKS ∪ PILLAR_LINKS without
// dropping /tv, which today only appears in PILLAR_LINKS.
export function mergeNavLinks(...lists: NavLink[][]): NavLink[] {
  const seen = new Set<string>()
  const merged: NavLink[] = []
  for (const list of lists) {
    for (const link of list) {
      if (seen.has(link.href)) continue
      seen.add(link.href)
      merged.push(link)
    }
  }
  return merged
}

// The mobile nav sheet's Site section (components/shared/MobileNavSheet.tsx).
// NAVBAR_LINKS first so Home leads; PILLAR_LINKS only contributes /tv, since
// Tournaments/Community/Exchange already appear in NAVBAR_LINKS with the
// same labels.
export const SHEET_SITE_LINKS: NavLink[] = mergeNavLinks(NAVBAR_LINKS, PILLAR_LINKS)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- lib/nav/links.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/nav/links.ts lib/nav/links.test.ts
git commit -m "feat(nav): add mergeNavLinks helper and SHEET_SITE_LINKS for unified mobile nav"
```

---

### Task 2: Thread `isAdmin` onto `NavSession`, add `AdminSheetData`

**Files:**
- Modify: `lib/nav/session.ts`
- Modify: `lib/admin/nav.ts`

**Interfaces:**
- Consumes: `lib/admin/auth.ts`'s `StaffContext` (already has `isAdmin: boolean`, line 11 — no change needed there); `lib/admin/notification-copy.ts`'s `AdminNotificationItem` (already exported); `lib/admin/nav.ts`'s existing `AdminNavItem`.
- Produces:
  - `NavSession.isAdmin: boolean` — new field, `false` when logged out or staff-but-not-admin, `true` for admins. Read by Task 3 and Task 6.
  - `export interface AdminSheetData { items: AdminNavItem[]; isAdmin: boolean; notifications: AdminNotificationItem[] }` in `lib/admin/nav.ts` — the shape `MobileNavSheet`'s Admin section (Task 3) and `app/layout.tsx` (Task 6) both need. `null` means "not staff, don't render the Admin section."

This task has no new logic to unit test — it's type/field threading over an existing Supabase-backed async function that already has no test coverage (`lib/nav/session.ts` has none today). Verification is `npm run build` (full TypeScript typecheck) plus the existing test suite staying green, per this plan's Global Constraints testing convention.

- [ ] **Step 1: Add `isAdmin` to `NavSession`**

In `lib/nav/session.ts`, update the interface (currently lines 14-23):

```ts
export interface NavSession {
  isLoggedIn: boolean
  isStaff: boolean
  isAdmin: boolean
  id: string | null
  username: string | null
  displayName: string | null
  avatarUrl: string | null
  unreadNotificationCount: number
  recentNotifications: NotificationItem[]
}
```

Update `LOGGED_OUT` (currently lines 25-34):

```ts
const LOGGED_OUT: NavSession = {
  isLoggedIn: false,
  isStaff: false,
  isAdmin: false,
  id: null,
  username: null,
  displayName: null,
  avatarUrl: null,
  unreadNotificationCount: 0,
  recentNotifications: [],
}
```

Update the return object in `getNavSession()` (currently lines 69-78) to add `isAdmin` right after `isStaff`:

```ts
  return {
    isLoggedIn: true,
    isStaff: staff?.isStaff ?? false,
    isAdmin: staff?.isAdmin ?? false,
    id: user.id,
    username: profile?.username ?? null,
    displayName: profile?.display_name ?? null,
    avatarUrl: profile?.avatar_url ?? null,
    unreadNotificationCount: unreadCount ?? 0,
    recentNotifications,
  }
```

- [ ] **Step 2: Add `AdminSheetData` to `lib/admin/nav.ts`**

At the top of `lib/admin/nav.ts`, add the import (the file currently has none):

```ts
import type { AdminNotificationItem } from './notification-copy'
```

At the end of the file (after `isAdminNavActive`, currently ending line 36-37), append:

```ts

// What MobileNavSheet's Admin section (components/shared/MobileNavSheet.tsx)
// and the root layout (app/layout.tsx) pass around. null means "signed-in
// user is not staff — don't render the Admin section at all."
export interface AdminSheetData {
  items: AdminNavItem[]
  isAdmin: boolean
  notifications: AdminNotificationItem[]
}
```

- [ ] **Step 3: Run the full test suite and build to verify nothing broke**

Run: `npm run test`
Expected: PASS, same file/test counts as before this task (no new test files added in this task).

Run: `npm run build`
Expected: Compiles successfully — this is the real check for this task, since it's a type-level change. If any file destructures `NavSession` with an exhaustive object type (unlikely, but check `grep -rn "NavSession = {" --include=*.tsx --include=*.ts`), TypeScript will flag it here.

- [ ] **Step 4: Commit**

```bash
git add lib/nav/session.ts lib/admin/nav.ts
git commit -m "feat(nav): add NavSession.isAdmin and AdminSheetData type"
```

---

### Task 3: Build `MobileNavSheet`

**Files:**
- Create: `components/shared/MobileNavSheet.tsx`

**Interfaces:**
- Consumes:
  - `NavSession` from `@/lib/nav/session` (Task 2's `isAdmin` field not directly needed here — the component reads `session.isLoggedIn`, `session.username`).
  - `SHEET_SITE_LINKS` from `@/lib/nav/links` (Task 1).
  - `AdminSheetData`, `isAdminNavActive` from `@/lib/admin/nav` (Task 2 for the type; `isAdminNavActive` already exists).
  - `countByHref` from `@/lib/admin/notification-copy` (already exists — see `lib/admin/notification-copy.ts:99-105`).
  - `signOut` from `@/lib/auth/actions` (already exists, same import `AccountMenu`/`BottomTabBar` use today).
- Produces: `export function MobileNavSheet({ session, whatsappUrl, adminNav, onClose }: { session: NavSession; whatsappUrl: string; adminNav: AdminSheetData | null; onClose: () => void })`. Mounted only while shown — parent conditionally renders it (same contract as `VideoModal`, see `components/tv/VideoModal.tsx:6-14`), so there's no `open` prop.

- [ ] **Step 1: Create the component**

Create `components/shared/MobileNavSheet.tsx`:

```tsx
'use client'
import { useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { X } from 'lucide-react'
import { signOut } from '@/lib/auth/actions'
import { SHEET_SITE_LINKS } from '@/lib/nav/links'
import { isAdminNavActive, type AdminSheetData } from '@/lib/admin/nav'
import { countByHref } from '@/lib/admin/notification-copy'
import type { NavSession } from '@/lib/nav/session'

const activeLinkStyle = { background: 'rgba(124,58,237,0.15)' }

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <span className="mb-2 block text-xs font-bold uppercase tracking-widest text-sx-gray">{children}</span>
}

function SheetLink({
  href,
  active,
  onClose,
  children,
}: {
  href: string
  active: boolean
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      onClick={onClose}
      className={`rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors ${
        active ? 'text-white' : 'text-white/70 hover:text-white'
      }`}
      style={active ? activeLinkStyle : undefined}
    >
      {children}
    </Link>
  )
}

export function MobileNavSheet({
  session,
  whatsappUrl,
  adminNav,
  onClose,
}: {
  session: NavSession
  whatsappUrl: string
  adminNav: AdminSheetData | null
  onClose: () => void
}) {
  const pathname = usePathname()

  // Same lifecycle as components/tv/VideoModal.tsx: Escape closes, body
  // scroll locks while the sheet is mounted.
  useEffect(() => {
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onEsc)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onEsc)
      document.body.style.overflow = prev
    }
  }, [onClose])

  const badgeCounts = adminNav ? countByHref(adminNav.notifications) : {}

  return (
    <div role="dialog" aria-modal="true" aria-label="Menu" className="fixed inset-0 z-[70] flex items-end justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} aria-hidden />
      <div
        className="relative flex max-h-[85vh] w-full flex-col overflow-y-auto rounded-t-2xl border-t border-sx-border bg-sx-surface p-5"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1.25rem)' }}
      >
        <div className="mb-4 flex items-center justify-between">
          <span className="font-display text-lg font-bold uppercase tracking-wide text-white">Menu</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-white/80 transition hover:bg-white/10"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {adminNav && (
          <>
            <div className="mb-2 flex items-center justify-between">
              <SectionLabel>Admin</SectionLabel>
              <span className="rounded-full border border-sx-border px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest text-sx-gray">
                {adminNav.isAdmin ? 'Admin' : 'Moderator'}
              </span>
            </div>
            <div className="mb-4 flex flex-col gap-1">
              {adminNav.items.map((item) => {
                const active = isAdminNavActive(item.href, pathname)
                const count = badgeCounts[item.href] ?? 0
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onClose}
                    className={`flex items-center justify-between rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors ${
                      active ? 'text-white' : 'text-white/70 hover:text-white'
                    }`}
                    style={active ? activeLinkStyle : undefined}
                  >
                    <span>{item.label}</span>
                    {count > 0 && (
                      <span className="ml-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
                        {count > 9 ? '9+' : count}
                      </span>
                    )}
                  </Link>
                )
              })}
            </div>
            <div className="mb-4 h-px bg-sx-border" />
          </>
        )}

        <SectionLabel>Site</SectionLabel>
        <div className="mb-4 flex flex-col gap-1">
          {SHEET_SITE_LINKS.map((item) => {
            const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
            return (
              <SheetLink key={item.href} href={item.href} active={active} onClose={onClose}>
                {item.label}
              </SheetLink>
            )
          })}
        </div>

        <div className="mb-4 h-px bg-sx-border" />

        <SectionLabel>Account</SectionLabel>
        <div className="mb-4 flex flex-col gap-1">
          {session.isLoggedIn ? (
            <>
              <SheetLink
                href={session.username ? `/players/${session.username}` : '/dashboard'}
                active={false}
                onClose={onClose}
              >
                My Profile
              </SheetLink>
              <SheetLink href="/dashboard" active={pathname.startsWith('/dashboard') && pathname !== '/dashboard/friendlies'} onClose={onClose}>
                Dashboard
              </SheetLink>
              <SheetLink href="/dashboard/friendlies" active={pathname.startsWith('/dashboard/friendlies')} onClose={onClose}>
                Friendlies
              </SheetLink>
              <SheetLink href="/betting" active={pathname.startsWith('/betting')} onClose={onClose}>
                Betting
              </SheetLink>
              <form action={signOut}>
                <button
                  type="submit"
                  className="block w-full rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-white/70 transition-colors hover:text-white"
                >
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <div className="flex gap-2">
              <Link
                href="/login"
                onClick={onClose}
                className="flex-1 rounded-lg border border-sx-border py-2.5 text-center text-sm font-bold text-white transition-colors"
              >
                Login
              </Link>
              <Link
                href="/signup"
                onClick={onClose}
                className="flex-1 rounded-lg bg-sx-purple py-2.5 text-center text-sm font-bold text-white transition-colors"
              >
                Register
              </Link>
            </div>
          )}
        </div>

        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onClose}
          className="flex items-center justify-center gap-1.5 rounded-full bg-sx-green px-4 py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90"
        >
          <WhatsAppIcon className="h-4 w-4" />
          <span>Join WhatsApp Community</span>
        </a>
      </div>
    </div>
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

Note on the `Dashboard` active check above: it deliberately excludes `/dashboard/friendlies` (which gets its own `SheetLink` right below it) so the two links are never both highlighted at once — mirrors how `isAdminNavActive` treats `/admin` as exact-match-only for the same reason (`lib/admin/nav.ts:29-36`).

- [ ] **Step 2: Typecheck and lint the new file**

Run: `npm run build`
Expected: Compiles successfully. `MobileNavSheet` isn't imported anywhere yet (that's Task 4), so this only confirms the file itself is valid TypeScript/JSX — Next's build still type-checks every file in the project regardless of whether it's reachable from a route.

Run: `npm run lint`
Expected: No errors for `components/shared/MobileNavSheet.tsx`.

- [ ] **Step 3: Commit**

```bash
git add components/shared/MobileNavSheet.tsx
git commit -m "feat(nav): add MobileNavSheet bottom-sheet component"
```

---

### Task 4: Wire `SiteHeader` to open `MobileNavSheet`

**Files:**
- Modify: `components/shared/SiteHeader.tsx`

**Interfaces:**
- Consumes: `MobileNavSheet` from `@/components/shared/MobileNavSheet` (Task 3), `AdminSheetData` from `@/lib/admin/nav` (Task 2).
- Produces: `SiteHeader` now takes a third prop, `adminNav: AdminSheetData | null`. Callers (Task 6's `app/layout.tsx`) must pass it.

- [ ] **Step 1: Update imports and props**

In `components/shared/SiteHeader.tsx`, replace the import block (currently lines 1-10):

```tsx
'use client'
import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu } from 'lucide-react'
import { AccountMenu } from '@/components/shared/AccountMenu'
import { NotificationBell } from '@/components/shared/NotificationBell'
import { MobileNavSheet } from '@/components/shared/MobileNavSheet'
import type { NavSession } from '@/lib/nav/session'
import type { AdminSheetData } from '@/lib/admin/nav'
import { NAVBAR_LINKS } from '@/lib/nav/links'
```

(`X` is dropped — the drawer's own close button, the only place it was used, is deleted in Step 2. `MobileNavSheet` and `AdminSheetData` are added.)

Update the function signature (currently lines 12-18):

```tsx
export function SiteHeader({
  session,
  whatsappUrl,
  adminNav,
}: {
  session: NavSession
  whatsappUrl: string
  adminNav: AdminSheetData | null
}) {
```

- [ ] **Step 2: Replace the inline drawer with `MobileNavSheet`**

Delete the entire "Mobile nav drawer" block — everything from the comment `{/* ── Mobile nav drawer ... */}` through its closing `)}` (currently lines 97-179 inclusive, right before the closing `</>` of the component and the `WhatsAppIcon` helper function). Replace it with:

```tsx
      {drawerOpen && (
        <MobileNavSheet
          session={session}
          whatsappUrl={whatsappUrl}
          adminNav={adminNav}
          onClose={() => setDrawerOpen(false)}
        />
      )}
```

The `WhatsAppIcon` helper function that follows (currently lines 184-190) stays — it's still used by the desktop CTA at line 60-68 of the file.

The hamburger `<button>` (currently lines 84-92) and the `drawerOpen`/`setDrawerOpen` state (line 20) are unchanged — only what the button opens has changed.

- [ ] **Step 3: Typecheck and lint**

Run: `npm run build`
Expected: This will currently FAIL, because `app/layout.tsx` still calls `<SiteHeader session={...} whatsappUrl={...} />` without the new required `adminNav` prop. That's expected — Task 6 fixes the call site. Confirm the *only* error is the missing `adminNav` prop on that one call site (check the error output names `app/layout.tsx` and `adminNav`); if there's any other error, stop and investigate before continuing.

- [ ] **Step 4: Commit**

```bash
git add components/shared/SiteHeader.tsx
git commit -m "feat(nav): wire SiteHeader hamburger to open MobileNavSheet"
```

(Committing here is safe even though `npm run build` fails — the failure is a known, temporary cross-task wiring gap that Task 6 closes; nothing here is broken in isolation. Do not merge/ship between this commit and Task 6's.)

---

### Task 5: Strip `AdminSidebar`'s mobile trigger + drawer

**Files:**
- Modify: `components/admin/AdminSidebar.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `AdminSidebar`'s public props (`items`, `isAdmin`, `notifications`) and its rendered output are unchanged on `sm:` and up. It renders nothing (an empty subtree) below `sm:` — mobile admin nav now comes entirely from `MobileNavSheet`'s Admin section (Task 3), fed by `app/layout.tsx` (Task 6), not from this component.

- [ ] **Step 1: Remove the mobile-only blocks**

Replace the entire contents of `components/admin/AdminSidebar.tsx` with:

```tsx
'use client'
import { usePathname } from 'next/navigation'
import { isAdminNavActive, type AdminNavItem } from '@/lib/admin/nav'
import { countByHref, type AdminNotificationItem } from '@/lib/admin/notification-copy'
import { AdminNotificationBell } from './AdminNotificationBell'

function RoleBadge({ isAdmin }: { isAdmin: boolean }) {
  return (
    <span className="rounded-full border border-slate-700 px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest text-slate-400">
      {isAdmin ? 'Admin' : 'Moderator'}
    </span>
  )
}

function NavList({
  items,
  pathname,
  badgeCounts,
}: {
  items: AdminNavItem[]
  pathname: string
  badgeCounts: Record<string, number>
}) {
  return (
    <nav className="space-y-1">
      {items.map((item) => {
        const active = isAdminNavActive(item.href, pathname)
        const count = badgeCounts[item.href] ?? 0
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
              active ? 'bg-violet-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <span>{item.label}</span>
            {count > 0 && (
              <span className="ml-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
                {count > 9 ? '9+' : count}
              </span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}

export function AdminSidebar({
  items,
  isAdmin,
  notifications,
}: {
  items: AdminNavItem[]
  isAdmin: boolean
  notifications: AdminNotificationItem[]
}) {
  const pathname = usePathname()
  const badgeCounts = countByHref(notifications)

  return (
    <aside className="hidden w-52 shrink-0 sm:block">
      <div className="sticky top-20 py-6">
        <div className="mb-4 flex items-center justify-between gap-2">
          <span className="text-lg font-black text-white">Admin</span>
          <div className="flex items-center gap-2">
            <AdminNotificationBell items={notifications} />
            <RoleBadge isAdmin={isAdmin} />
          </div>
        </div>
        <NavList items={items} pathname={pathname} badgeCounts={badgeCounts} />
      </div>
    </aside>
  )
}
```

This drops the `useState`, `Menu`, `X` imports (no state or icons left to use — no more mobile button, no more mobile drawer) and adds the missing `Link` import from `next/link` that `NavList` needs (the original file relied on it transitively being fine because `NavList` was only ever called from inside the same file that already imported it at the top — reconfirm: the original file's line 3 already has `import Link from 'next/link'`, so this is unchanged, just calling it out since the whole file is being replaced).

`NavList`'s `onNavigate` prop is dropped since its only caller now (the desktop `<aside>`) never passed one — the removed mobile-drawer call site was the only one that did.

- [ ] **Step 2: Typecheck and lint**

Run: `npm run build`
Expected: Still shows the same single expected failure from Task 4 (missing `adminNav` prop on `app/layout.tsx`'s `<SiteHeader>` call) — nothing new. If this task introduces any *additional* error, stop and fix it before continuing.

Run: `npm run lint`
Expected: No errors for `components/admin/AdminSidebar.tsx`.

- [ ] **Step 3: Commit**

```bash
git add components/admin/AdminSidebar.tsx
git commit -m "feat(nav): remove AdminSidebar's mobile trigger and drawer"
```

---

### Task 6: Wire the root layout — delete `BottomTabBar`, feed `adminNav` through

**Files:**
- Modify: `app/layout.tsx`
- Delete: `components/shared/BottomTabBar.tsx`

**Interfaces:**
- Consumes: `SiteHeader`'s new `adminNav` prop (Task 4), `NavSession.isAdmin` (Task 2), `ADMIN_NAV`/`visibleNav` from `@/lib/admin/nav` (already exist, `lib/admin/nav.ts:8-27`), `getAdminNotificationQueue` from `@/lib/admin/notification-queue` (already exists, `lib/admin/notification-queue.ts:146-158`).
- Produces: nothing new — this is the final wiring point. After this task, `npm run build` must fully succeed with zero errors.

- [ ] **Step 1: Delete `BottomTabBar.tsx`**

```bash
git rm components/shared/BottomTabBar.tsx
```

- [ ] **Step 2: Update `app/layout.tsx`**

Replace the import block (currently lines 1-13):

```tsx
import type { Metadata } from 'next'
import { Suspense } from 'react'
import localFont from 'next/font/local'
import { Barlow_Condensed, Inter } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { SiteHeader } from '@/components/shared/SiteHeader'
import { SiteFooter } from '@/components/shared/SiteFooter'
import { getNavSession } from '@/lib/nav/session'
import { ADMIN_NAV, visibleNav, type AdminSheetData } from '@/lib/admin/nav'
import { getAdminNotificationQueue } from '@/lib/admin/notification-queue'
import { JsonLd } from '@/components/seo/JsonLd'
import { buildOrganizationJsonLd, buildWebsiteJsonLd } from '@/lib/seo/schema/site'
import { SITE_URL, SITE_NAME, SITE_SHORT_NAME, SITE_DESCRIPTION, DEFAULT_OG_IMAGE } from '@/lib/seo/site'
import './globals.css'
```

(`Suspense` and `BottomTabBar` are dropped — `Suspense` was only there to wrap `BottomTabBar`, which used `usePathname` and needed the boundary to avoid de-opting pages to CSR; `SiteHeader` already uses `usePathname` too and has never needed one, so no replacement boundary is needed.)

Replace the component body (currently lines 64-90):

```tsx
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const navSession = await getNavSession()
  const adminNav: AdminSheetData | null = navSession.isStaff
    ? {
        items: visibleNav(ADMIN_NAV, navSession.isAdmin),
        isAdmin: navSession.isAdmin,
        notifications: await getAdminNotificationQueue(navSession.isAdmin ? 'admin' : 'moderator'),
      }
    : null

  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${barlowCondensed.variable} ${inter.variable} bg-sx-bg font-sans text-white antialiased`}
      >
        <div className="flex min-h-screen flex-col">
          <SiteHeader session={navSession} whatsappUrl={WHATSAPP_COMMUNITY} adminNav={adminNav} />

          <main className="flex-1">{children}</main>

          <SiteFooter />
        </div>

        <Analytics />
        <JsonLd data={buildOrganizationJsonLd()} />
        <JsonLd data={buildWebsiteJsonLd()} />
      </body>
    </html>
  )
}
```

(`<main>` loses `pb-16 sm:pb-0` — that padding existed only to clear the fixed bottom tab bar, which no longer exists.)

- [ ] **Step 3: Run the full test suite**

Run: `npm run test`
Expected: PASS. No test in the suite imports `BottomTabBar` (confirmed by the earlier grep across the repo — its only references were `components/shared/BottomTabBar.tsx` itself and `app/layout.tsx`), so deleting it doesn't orphan any test file.

- [ ] **Step 4: Build and lint**

Run: `npm run build`
Expected: Compiles successfully — this closes out the "expected failure" carried since Task 4.

Run: `npm run lint`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add app/layout.tsx
git commit -m "feat(nav): remove BottomTabBar, wire adminNav through root layout"
```

---

### Task 7: Manual verification and final check

**Files:** none (verification only).

**Interfaces:** none — this task consumes the finished feature end-to-end.

- [ ] **Step 1: Run the full test suite one more time**

Run: `npm run test`
Expected: PASS, every file.

- [ ] **Step 2: Run the dev server and manually check each item below**

Run: `npm run dev`, open the app in a browser resized to ~375px width (or use DevTools device emulation).

Checklist — confirm each, per spec §Edge Cases and §Architecture:

- On a public page (e.g. `/`), tap the header hamburger → the bottom sheet slides up (not a side drawer). Backdrop click closes it. Escape key closes it.
- Logged-out visitor: sheet shows Site section + Login/Register in Account section, no Admin section.
- Log in as a **player** (no staff role): sheet shows Site + Account (My Profile, Dashboard, Friendlies, Betting, Sign out) — still no Admin section.
- Log in as a **moderator**: sheet's Admin section appears, badge reads "Moderator", and any `adminOnly: true` items from `ADMIN_NAV` (Buy requests, Store, Wallet, Friendlies) are absent — same filtering `visibleNav` already applied before this change.
- Log in as an **admin**: Admin section badge reads "Admin", all `ADMIN_NAV` items present, badge counts on items match what `/admin` itself shows (cross-check against the desktop `AdminNotificationBell` count).
- From `/admin` (any admin page) on a narrow viewport: the *old* mobile "Menu" button and its own drawer are gone; the *same* header hamburger opens the *same* sheet, and its Site section is tappable — confirms the "no way to exit admin to normal mode" gap is closed.
- Tap any link in any section → sheet closes and the page navigates.
- `/tv` is present in the Site section (previously only reachable via the deleted bottom bar).
- Resize back to desktop width (≥1024px, `lg`): header shows the full desktop link row + `AccountMenu`, no hamburger, no bottom sheet trigger. `/admin` desktop `<aside>` sidebar still renders and behaves exactly as before.
- Confirm no fixed bottom bar renders anywhere, at any width, on any page.

- [ ] **Step 3: Report results**

If every checklist item passes, the feature is complete — proceed to `superpowers:finishing-a-development-branch`. If any item fails, stop and fix it as part of this task (small targeted fix + re-run the relevant earlier task's build/lint) before proceeding; do not carry a known-broken checklist item into the finishing step.
