# Admin Shell + Role Gating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the role-gated `/admin` foundation — shared auth helpers, a role-aware layout and nav, and a live overview home — that the five later admin sub-projects sit on.

**Architecture:** All Server Components except the active-link nav (client). A single `lib/admin/auth.ts` derives the staff context and enforces access (`requireStaff` for the layout, `requireAdmin` for financial surfaces). A pure `lib/admin/nav.ts` drives role-aware navigation. The home page shows count-only overview cards. No DB migration — uses the existing `user_roles` table and `is_admin`/`is_staff` DB functions.

**Tech Stack:** Next.js 14 App Router (Server + one Client Component), TypeScript, Tailwind, Supabase server client, Vitest.

## Global Constraints

- Mobile-first, design for 375px and scale up.
- Server Components by default; only `AdminNav` is `"use client"` (needs `usePathname`).
- Two-tier gate: the layout uses `requireStaff()` (admin **and** moderator get in); admin-only surfaces use `requireAdmin()`. Both live only in `lib/admin/auth.ts` — single source of truth, never inlined.
- `getStaffContext()` returns **distinct shapes**: `null` (not authenticated); `{ ..., roles: [], isStaff: false, isAdmin: false }` (authenticated, no staff role); `{ ..., isStaff: true, isAdmin: <bool> }` (staff). Staff roles are `admin`/`moderator`; a `player` role row is ignored.
- Redirects: no session → `/login?next=/admin`; authenticated non-staff → `/dashboard`; staff-but-not-admin hitting an admin-only surface → `/admin`.
- Overview cards show a **count + human-readable label** and **always render, even at 0** (stable layout). The Pending-withdrawals card is **admin-only**.
- Cards are non-linking in this sub-project (later sub-projects pass an `href` to make each a link).
- Nav lists only built pages — `ADMIN_NAV` seeds with **Overview** only.
- The root layout already renders the global `SiteHeader` + footer for every route, so the admin layout is a light content wrapper (title bar + nav + children), NOT a second header.
- Do NOT mark roadmap #9 done — this is sub-project 1 of 6.
- Test command: `npx vitest run <path>`. Type check: `npx tsc --noEmit`. Lint: `npm run lint`. Build: `npm run build`.
- Each commit message ends with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

### Task 1: Nav registry (pure)

**Files:**
- Create: `lib/admin/nav.ts`
- Create: `lib/admin/nav.test.ts`

**Interfaces:**
- Produces: `interface AdminNavItem { label: string; href: string; adminOnly: boolean }`, `const ADMIN_NAV: AdminNavItem[]`, `visibleNav(items: AdminNavItem[], isAdmin: boolean): AdminNavItem[]` for Tasks 3 & 4.

- [ ] **Step 1: Write the failing test**

Create `lib/admin/nav.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { visibleNav, type AdminNavItem } from './nav'

const items: AdminNavItem[] = [
  { label: 'Overview', href: '/admin', adminOnly: false },
  { label: 'Withdrawals', href: '/admin/withdrawals', adminOnly: true },
  { label: 'Results', href: '/admin/results', adminOnly: false },
]

describe('visibleNav', () => {
  it('hides adminOnly items from a moderator', () => {
    expect(visibleNav(items, false).map((i) => i.label)).toEqual(['Overview', 'Results'])
  })

  it('shows all items to an admin', () => {
    expect(visibleNav(items, true).map((i) => i.label)).toEqual([
      'Overview',
      'Withdrawals',
      'Results',
    ])
  })

  it('preserves original order', () => {
    expect(visibleNav(items, true)).toEqual(items)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/admin/nav.test.ts`
Expected: FAIL — cannot find module `./nav`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/admin/nav.ts`:

```typescript
export interface AdminNavItem {
  label: string
  href: string
  adminOnly: boolean
}

// Nav lists only built pages. Later admin sub-projects append their entry here.
export const ADMIN_NAV: AdminNavItem[] = [{ label: 'Overview', href: '/admin', adminOnly: false }]

// Returns items in original order, dropping adminOnly items for non-admins.
export function visibleNav(items: AdminNavItem[], isAdmin: boolean): AdminNavItem[] {
  return items.filter((item) => isAdmin || !item.adminOnly)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/admin/nav.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/admin/nav.ts lib/admin/nav.test.ts
git commit -m "$(cat <<'EOF'
feat: admin nav registry with role-aware filtering

Declarative ADMIN_NAV + visibleNav (hides adminOnly items from
moderators). Seeded with Overview; later sub-projects append entries.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Auth helpers

**Files:**
- Create: `lib/admin/auth.ts`

**Interfaces:**
- Consumes: `createClient` from `@/lib/supabase/server`; `redirect` from `next/navigation`.
- Produces: `type StaffRole`, `interface StaffContext`, `getStaffContext()`, `requireStaff()`, `requireAdmin()` for Task 4 (and later sub-projects).

The codebase does not unit-test Supabase-backed / `redirect`-calling server helpers; this task is verified by `tsc`/`lint` and exercised by Task 4's build.

- [ ] **Step 1: Write the implementation**

Create `lib/admin/auth.ts`:

```typescript
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export type StaffRole = 'admin' | 'moderator'

export interface StaffContext {
  userId: string
  email: string | null
  roles: StaffRole[]
  isStaff: boolean
  isAdmin: boolean
}

const STAFF_ROLES: readonly string[] = ['admin', 'moderator']

// Distinct returns so callers never need a second auth check:
//   null                          -> not authenticated
//   { isStaff: false, roles: [] } -> authenticated, no staff role
//   { isStaff: true, ... }        -> authenticated staff
export async function getStaffContext(): Promise<StaffContext | null> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data: roleRows } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)

  const roles = (roleRows ?? [])
    .map((r) => r.role)
    .filter((r): r is StaffRole => STAFF_ROLES.includes(r))

  return {
    userId: user.id,
    email: user.email ?? null,
    roles,
    isStaff: roles.length > 0,
    isAdmin: roles.includes('admin'),
  }
}

// Layout gate: any staff role may pass.
export async function requireStaff(): Promise<StaffContext> {
  const ctx = await getStaffContext()
  if (ctx === null) redirect('/login?next=/admin')
  if (!ctx.isStaff) redirect('/dashboard')
  return ctx
}

// Admin-only surfaces (e.g. financial actions). Auth + staff already handled by requireStaff.
export async function requireAdmin(): Promise<StaffContext> {
  const ctx = await requireStaff()
  if (!ctx.isAdmin) redirect('/admin')
  return ctx
}
```

- [ ] **Step 2: Verify types and lint**

Run: `npx tsc --noEmit`
Expected: no errors. (`redirect` returns `never`, so `ctx` narrows to non-null after each guard.)
Run: `npm run lint`
Expected: clean for this file.

- [ ] **Step 3: Commit**

```bash
git add lib/admin/auth.ts
git commit -m "$(cat <<'EOF'
feat: admin auth helpers (requireStaff / requireAdmin)

Single source of truth for /admin access. getStaffContext returns
distinct shapes for unauth / non-staff / staff; two-tier redirects.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Nav + card components

**Files:**
- Create: `components/admin/AdminNav.tsx`
- Create: `components/admin/StatCard.tsx`

No unit tests (codebase tests only `lib/`); verified by `tsc`/`lint` and Task 4.

**Interfaces:**
- Consumes: `AdminNavItem` from `@/lib/admin/nav`; `usePathname` from `next/navigation`; `Link` from `next/link`.
- Produces: `AdminNav({ items })`, `StatCard({ label, count, href? })` for Task 4.

- [ ] **Step 1: Create `AdminNav.tsx`**

```tsx
'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { AdminNavItem } from '@/lib/admin/nav'

export function AdminNav({ items }: { items: AdminNavItem[] }) {
  const pathname = usePathname()
  return (
    <nav className="flex gap-1 overflow-x-auto">
      {items.map((item) => {
        const active = pathname === item.href
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
              active ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
```

- [ ] **Step 2: Create `StatCard.tsx`**

```tsx
import Link from 'next/link'

export function StatCard({
  label,
  count,
  href,
}: {
  label: string
  count: number
  href?: string
}) {
  const cls = 'rounded-2xl border border-slate-800 bg-slate-900 p-5'
  const inner = (
    <>
      <p className="text-3xl font-black text-white">{count}</p>
      <p className="mt-1 text-xs font-semibold uppercase tracking-widest text-slate-400">{label}</p>
    </>
  )
  if (href) {
    return (
      <Link href={href} className={`${cls} block transition-colors hover:border-slate-600`}>
        {inner}
      </Link>
    )
  }
  return <div className={cls}>{inner}</div>
}
```

- [ ] **Step 3: Verify types and lint**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npm run lint`
Expected: clean for these files.

- [ ] **Step 4: Commit**

```bash
git add components/admin/AdminNav.tsx components/admin/StatCard.tsx
git commit -m "$(cat <<'EOF'
feat: AdminNav + StatCard components

Active-link admin nav (client) and an always-rendered count/label card
with an optional href for progressive linking.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Admin layout + overview home

**Files:**
- Create: `app/admin/layout.tsx`
- Create: `app/admin/page.tsx`
- Delete: `app/admin/.gitkeep`

**Interfaces:**
- Consumes: `requireStaff` (Task 2), `ADMIN_NAV`/`visibleNav` (Task 1), `AdminNav`/`StatCard` (Task 3), `createClient` from `@/lib/supabase/server`.

- [ ] **Step 1: Create the layout**

Create `app/admin/layout.tsx`:

```tsx
import { requireStaff } from '@/lib/admin/auth'
import { ADMIN_NAV, visibleNav } from '@/lib/admin/nav'
import { AdminNav } from '@/components/admin/AdminNav'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireStaff()
  const items = visibleNav(ADMIN_NAV, ctx.isAdmin)
  return (
    <div className="mx-auto max-w-5xl px-4 pb-20">
      <div className="flex items-center justify-between gap-4 py-6">
        <h1 className="text-xl font-black text-white">Admin</h1>
        <span className="rounded-full border border-slate-700 px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest text-slate-400">
          {ctx.isAdmin ? 'Admin' : 'Moderator'}
        </span>
      </div>
      <AdminNav items={items} />
      <div className="mt-6">{children}</div>
    </div>
  )
}
```

- [ ] **Step 2: Create the overview home**

Create `app/admin/page.tsx`:

```tsx
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { StatCard } from '@/components/admin/StatCard'

export const metadata: Metadata = { title: 'Admin · SentinelX Esports' }

export default async function AdminHomePage() {
  const ctx = await requireStaff()
  const supabase = createClient()

  const [pendingResults, activeTournaments, openRegs, pendingWithdrawals] = await Promise.all([
    supabase.from('match_results').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('tournaments').select('*', { count: 'exact', head: true }).eq('status', 'active'),
    supabase
      .from('tournaments')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'registration_open'),
    ctx.isAdmin
      ? supabase
          .from('withdrawal_requests')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'pending')
      : Promise.resolve({ count: null as number | null }),
  ])

  return (
    <section>
      <h2 className="mb-4 text-[11px] font-bold uppercase tracking-widest text-slate-500">
        Needs attention
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Pending results" count={pendingResults.count ?? 0} />
        <StatCard label="Active tournaments" count={activeTournaments.count ?? 0} />
        <StatCard label="Open registrations" count={openRegs.count ?? 0} />
        {ctx.isAdmin && (
          <StatCard label="Pending withdrawals" count={pendingWithdrawals.count ?? 0} />
        )}
      </div>
    </section>
  )
}
```

- [ ] **Step 3: Remove the stale placeholder**

```bash
git rm app/admin/.gitkeep
```

- [ ] **Step 4: Verify types and lint**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npm run lint`
Expected: clean.

- [ ] **Step 5: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — all suites including the new `lib/admin/nav.test.ts`.

- [ ] **Step 6: Production build**

Run: `npm run build`
Expected: build succeeds; `/admin` appears in the route list as a dynamic `ƒ` route (it reads the session).

- [ ] **Step 7: Commit**

```bash
git add app/admin/layout.tsx app/admin/page.tsx
git commit -m "$(cat <<'EOF'
feat: admin shell layout + overview home (#9 sub-project 1)

requireStaff-gated /admin layout with role-aware nav, and an overview
home of always-rendered count cards (pending withdrawals admin-only).
Removes the stale app/admin placeholder.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- `lib/admin/auth.ts` with `getStaffContext` (distinct shapes), `requireStaff`, `requireAdmin` → Task 2. ✅
- Two-tier gate (`requireStaff` layout, `requireAdmin` financial) → Tasks 2, 4. ✅
- Redirects: no session → `/login?next=/admin`; non-staff → `/dashboard`; staff-non-admin → `/admin` → Task 2. ✅
- `lib/admin/nav.ts` pure `visibleNav` + `ADMIN_NAV` seeded with Overview → Task 1 (unit-tested). ✅
- Role-gated layout as a light wrapper below the global header → Task 4. ✅
- Role-aware nav (adminOnly hidden from moderators) → Tasks 1, 3, 4. ✅
- Overview cards: count + label, always render (even 0), pending-withdrawals admin-only, non-linking with optional `href` → Tasks 3, 4. ✅
- Count-only queries (`head: true`) → Task 4. ✅
- Remove stale `app/admin/.gitkeep` → Task 4. ✅
- No DB migration; do not mark #9 done → honored (no migration task, no ROADMAP edit). ✅

**Placeholder scan:** No "TBD"/"handle edge cases"/"similar to" — every code step has full code. ✅

**Type consistency:** `AdminNavItem`/`ADMIN_NAV`/`visibleNav` (Task 1) consumed by Tasks 3 & 4. `StaffContext.isAdmin` (Task 2) used by the layout and home (Task 4). `AdminNav({ items })` and `StatCard({ label, count, href? })` (Task 3) called exactly that way in Task 4. `requireStaff()` returns `StaffContext` with `isAdmin`, used for `visibleNav` and the admin-only card. Column/status values (`match_results.status='pending'`, `tournaments.status` in `active`/`registration_open`, `withdrawal_requests.status='pending'`) verified against `lib/supabase/types.ts`. ✅

Note: the home page calls `requireStaff()` again even though the layout already gated — this is a cheap, intentional belt-and-suspenders that also yields `ctx.isAdmin` for the admin-only card, and matches the pattern of guarding at the page as well as the layout.
