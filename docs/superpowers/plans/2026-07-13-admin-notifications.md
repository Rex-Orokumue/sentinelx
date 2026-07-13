# Admin Notifications (#27) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give admins/moderators a unified view of pending work — a notification bell in the admin header, per-item badge counts on the sidebar nav, and refactored Overview StatCards — all sourced from one shared live-aggregation query, with zero new database tables.

**Architecture:** `lib/admin/notification-copy.ts` holds pure, unit-tested types and formatting functions (no Supabase import). `lib/admin/notification-queue.ts` holds the async orchestrator `getAdminNotificationQueue(staffRole)`, which runs the same "pending" queries each admin page already runs, maps rows through the pure builders, and returns one sorted array — no automated test for this file, matching this codebase's existing convention that Supabase-orchestration code (e.g. `lib/exchange/admin-actions.ts`, the query blocks inside `app/admin/*/page.tsx`) isn't unit tested, only the pure logic it calls into (e.g. `bucketReviewQueue`) is. `app/admin/layout.tsx` calls the orchestrator once and passes the result to `AdminSidebar`, which renders the new `AdminNotificationBell` and computes its own per-nav-item badge counts via the pure `countByHref` helper. `app/admin/page.tsx` (Overview) calls the same orchestrator independently — **Next.js layouts cannot pass computed props down into a page's `children` slot**, so the page re-derives its StatCard counts from a second call to `getAdminNotificationQueue()` rather than receiving data from the layout. Both calls read live DB state, so there's no drift between them even though the query runs twice per Overview page load.

**Tech Stack:** Next.js 14 App Router (Server Components), Supabase (`@/lib/supabase/server` session client — **not** the service-role admin client, matching every existing admin page's pattern, since `withdrawal_requests`/`referral_withdrawal_requests`/`friendly_withdrawal_requests` already have `is_admin()` RLS SELECT policies and `matches`/`marketplace_listings` are already staff-readable via the session client in shipped code), TypeScript, Vitest (`.test.ts` only — this repo has no component-test setup, `vitest.config.ts` only includes `**/*.test.ts`).

## Global Constraints

- No new database migration — pure read-aggregation over existing tables (`marketplace_listings`, `matches`, `match_results`, `withdrawal_requests`, `referral_withdrawal_requests`, `friendly_withdrawal_requests`).
- Moderators (`staffRole === 'moderator'`) must never trigger the three withdrawal queries at all — not fetch-then-filter, skip the fetch entirely.
- No new "mark as read" or resolution state — a notification simply stops appearing once the underlying row's status changes (next render, since there's no Realtime anywhere in this codebase).
- Badge counts show nothing (not "0") when a nav item has zero matching pending items.
- Merge-dependency comment required at the top of `lib/admin/notification-queue.ts` per the approved spec (`docs/superpowers/specs/2026-07-13-admin-notifications-design.md`), covering the exact 3-to-1 collapse #28 will require.
- Work happens directly on `main` — every prior roadmap item (#22–#26) shipped as direct commits to `main`; #27 is small and self-contained, so it follows the same pattern rather than a feature branch.
- `formatNaira` (from `lib/format.ts`) is the single source of truth for currency display — reuse it, don't reimplement.

---

### Task 1: Pure notification copy module — types, builders, sort, badge counts

**Files:**
- Create: `lib/admin/notification-copy.ts`
- Test: `lib/admin/notification-copy.test.ts`

**Interfaces:**
- Consumes: `formatNaira` from `lib/format.ts` (signature: `(n: number) => string`, e.g. `formatNaira(5000)` → `"₦5,000"`).
- Produces (used by Task 2, 3, 4):
  - `export type AdminNotificationType = 'exchange_listing_pending' | 'result_needs_review' | 'result_disputed' | 'withdrawal_pending' | 'referral_withdrawal_pending' | 'friendly_withdrawal_pending'`
  - `export interface AdminNotificationItem { type: AdminNotificationType; title: string; body: string; link: string; createdAt: string }`
  - `export function exchangeListingNotification(row: { title: string; sellerName: string; createdAt: string }): AdminNotificationItem`
  - `export function resultNotification(row: { type: 'result_needs_review' | 'result_disputed'; tournamentTitle: string; playerAName: string; playerBName: string; createdAt: string }): AdminNotificationItem`
  - `export function withdrawalNotification(row: { type: 'withdrawal_pending' | 'referral_withdrawal_pending' | 'friendly_withdrawal_pending'; username: string; amount: number; createdAt: string }): AdminNotificationItem`
  - `export function sortByCreatedAtDesc(items: AdminNotificationItem[]): AdminNotificationItem[]`
  - `export function countByHref(items: AdminNotificationItem[]): Record<string, number>`

- [ ] **Step 1: Write the failing test file**

Create `lib/admin/notification-copy.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  exchangeListingNotification,
  resultNotification,
  withdrawalNotification,
  sortByCreatedAtDesc,
  countByHref,
  type AdminNotificationItem,
} from './notification-copy'

describe('exchangeListingNotification', () => {
  it('builds title/body/link from the listing row', () => {
    const item = exchangeListingNotification({
      title: 'PS5 Controller',
      sellerName: 'john123',
      createdAt: '2026-07-10T10:00:00Z',
    })
    expect(item).toEqual({
      type: 'exchange_listing_pending',
      title: 'Listing pending review',
      body: 'PS5 Controller — john123',
      link: '/admin/exchange',
      createdAt: '2026-07-10T10:00:00Z',
    })
  })
})

describe('resultNotification', () => {
  it('labels a needs-review result', () => {
    const item = resultNotification({
      type: 'result_needs_review',
      tournamentTitle: 'Lagos Cup',
      playerAName: 'Ade',
      playerBName: 'Bola',
      createdAt: '2026-07-10T11:00:00Z',
    })
    expect(item.title).toBe('Result needs review')
    expect(item.body).toBe('Lagos Cup — Ade vs Bola')
    expect(item.link).toBe('/admin/results')
    expect(item.type).toBe('result_needs_review')
  })

  it('labels a disputed result', () => {
    const item = resultNotification({
      type: 'result_disputed',
      tournamentTitle: 'Lagos Cup',
      playerAName: 'Ade',
      playerBName: 'Bola',
      createdAt: '2026-07-10T11:00:00Z',
    })
    expect(item.title).toBe('Result disputed')
    expect(item.link).toBe('/admin/results')
    expect(item.type).toBe('result_disputed')
  })
})

describe('withdrawalNotification', () => {
  it('builds a prize withdrawal notification with naira formatting', () => {
    const item = withdrawalNotification({
      type: 'withdrawal_pending',
      username: 'chi_baller',
      amount: 15000,
      createdAt: '2026-07-10T12:00:00Z',
    })
    expect(item.title).toBe('Withdrawal request')
    expect(item.body).toBe('chi_baller — ₦15,000')
    expect(item.link).toBe('/admin/withdrawals')
  })

  it('builds a referral withdrawal notification', () => {
    const item = withdrawalNotification({
      type: 'referral_withdrawal_pending',
      username: 'ref_king',
      amount: 500,
      createdAt: '2026-07-10T12:00:00Z',
    })
    expect(item.title).toBe('Referral withdrawal')
    expect(item.link).toBe('/admin/referrals')
  })

  it('builds a friendly withdrawal notification', () => {
    const item = withdrawalNotification({
      type: 'friendly_withdrawal_pending',
      username: 'staker99',
      amount: 2000,
      createdAt: '2026-07-10T12:00:00Z',
    })
    expect(item.title).toBe('Friendly withdrawal')
    expect(item.link).toBe('/admin/friendly-withdrawals')
  })
})

describe('sortByCreatedAtDesc', () => {
  it('sorts newest first', () => {
    const items: AdminNotificationItem[] = [
      { type: 'exchange_listing_pending', title: 'a', body: '', link: '/x', createdAt: '2026-07-01T00:00:00Z' },
      { type: 'exchange_listing_pending', title: 'b', body: '', link: '/x', createdAt: '2026-07-03T00:00:00Z' },
      { type: 'exchange_listing_pending', title: 'c', body: '', link: '/x', createdAt: '2026-07-02T00:00:00Z' },
    ]
    expect(sortByCreatedAtDesc(items).map((i) => i.title)).toEqual(['b', 'c', 'a'])
  })

  it('does not mutate the input array', () => {
    const items: AdminNotificationItem[] = [
      { type: 'exchange_listing_pending', title: 'a', body: '', link: '/x', createdAt: '2026-07-01T00:00:00Z' },
      { type: 'exchange_listing_pending', title: 'b', body: '', link: '/x', createdAt: '2026-07-03T00:00:00Z' },
    ]
    const copy = [...items]
    sortByCreatedAtDesc(items)
    expect(items).toEqual(copy)
  })
})

describe('countByHref', () => {
  it('groups items by link and counts them', () => {
    const items: AdminNotificationItem[] = [
      { type: 'exchange_listing_pending', title: '', body: '', link: '/admin/exchange', createdAt: '2026-07-01T00:00:00Z' },
      { type: 'exchange_listing_pending', title: '', body: '', link: '/admin/exchange', createdAt: '2026-07-01T00:00:00Z' },
      { type: 'result_disputed', title: '', body: '', link: '/admin/results', createdAt: '2026-07-01T00:00:00Z' },
    ]
    expect(countByHref(items)).toEqual({ '/admin/exchange': 2, '/admin/results': 1 })
  })

  it('returns an empty object for no items', () => {
    expect(countByHref([])).toEqual({})
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/admin/notification-copy.test.ts`
Expected: FAIL — `Cannot find module './notification-copy'` (the file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `lib/admin/notification-copy.ts`:

```typescript
import { formatNaira } from '@/lib/format'

export type AdminNotificationType =
  | 'exchange_listing_pending'
  | 'result_needs_review'
  | 'result_disputed'
  | 'withdrawal_pending'
  | 'referral_withdrawal_pending'
  | 'friendly_withdrawal_pending'

export interface AdminNotificationItem {
  type: AdminNotificationType
  title: string
  body: string
  link: string
  createdAt: string
}

// MERGE DEPENDENCY — #28 (feat/28-30-wallet-perks-recordings): when that
// branch merges, withdrawal_pending's link changes from '/admin/withdrawals'
// to '/admin/wallet' (withdrawal_requests survives with widened scope), and
// the referral_withdrawal_pending / friendly_withdrawal_pending entries below
// are deleted entirely (their source tables are dropped). See
// lib/admin/notification-queue.ts for the matching query-side change.
const TYPE_LINK: Record<AdminNotificationType, string> = {
  exchange_listing_pending: '/admin/exchange',
  result_needs_review: '/admin/results',
  result_disputed: '/admin/results',
  withdrawal_pending: '/admin/withdrawals',
  referral_withdrawal_pending: '/admin/referrals',
  friendly_withdrawal_pending: '/admin/friendly-withdrawals',
}

export function exchangeListingNotification(row: {
  title: string
  sellerName: string
  createdAt: string
}): AdminNotificationItem {
  return {
    type: 'exchange_listing_pending',
    title: 'Listing pending review',
    body: `${row.title} — ${row.sellerName}`,
    link: TYPE_LINK.exchange_listing_pending,
    createdAt: row.createdAt,
  }
}

const RESULT_TITLE: Record<'result_needs_review' | 'result_disputed', string> = {
  result_needs_review: 'Result needs review',
  result_disputed: 'Result disputed',
}

export function resultNotification(row: {
  type: 'result_needs_review' | 'result_disputed'
  tournamentTitle: string
  playerAName: string
  playerBName: string
  createdAt: string
}): AdminNotificationItem {
  return {
    type: row.type,
    title: RESULT_TITLE[row.type],
    body: `${row.tournamentTitle} — ${row.playerAName} vs ${row.playerBName}`,
    link: TYPE_LINK[row.type],
    createdAt: row.createdAt,
  }
}

const WITHDRAWAL_TITLE: Record<
  'withdrawal_pending' | 'referral_withdrawal_pending' | 'friendly_withdrawal_pending',
  string
> = {
  withdrawal_pending: 'Withdrawal request',
  referral_withdrawal_pending: 'Referral withdrawal',
  friendly_withdrawal_pending: 'Friendly withdrawal',
}

export function withdrawalNotification(row: {
  type: 'withdrawal_pending' | 'referral_withdrawal_pending' | 'friendly_withdrawal_pending'
  username: string
  amount: number
  createdAt: string
}): AdminNotificationItem {
  return {
    type: row.type,
    title: WITHDRAWAL_TITLE[row.type],
    body: `${row.username} — ${formatNaira(row.amount)}`,
    link: TYPE_LINK[row.type],
    createdAt: row.createdAt,
  }
}

export function sortByCreatedAtDesc(items: AdminNotificationItem[]): AdminNotificationItem[] {
  return [...items].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

export function countByHref(items: AdminNotificationItem[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const item of items) {
    counts[item.link] = (counts[item.link] ?? 0) + 1
  }
  return counts
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/admin/notification-copy.test.ts`
Expected: PASS — all 9 tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/admin/notification-copy.ts lib/admin/notification-copy.test.ts
git commit -m "feat: #27 admin notification copy builders (pure, unit tested)"
```

---

### Task 2: `getAdminNotificationQueue()` — the live-aggregation orchestrator

**Files:**
- Create: `lib/admin/notification-queue.ts`

**Interfaces:**
- Consumes:
  - `exchangeListingNotification`, `resultNotification`, `withdrawalNotification`, `sortByCreatedAtDesc`, `AdminNotificationItem`, `AdminNotificationType` from `./notification-copy` (Task 1).
  - `bucketReviewQueue`, `ReviewMatchInput` from `@/lib/matches/review-queue` (existing, `lib/matches/review-queue.ts`).
  - `createClient` from `@/lib/supabase/server` (existing session-based client — matches every existing admin page's read pattern, since these tables already have staff-readable RLS policies).
- Produces (used by Task 5, 6):
  - `export async function getAdminNotificationQueue(staffRole: 'admin' | 'moderator'): Promise<AdminNotificationItem[]>`
  - Re-exports `type { AdminNotificationType, AdminNotificationItem }` and `countByHref` from `./notification-copy` so Task 4/5 can import everything from one path if convenient (they may also import directly from `./notification-copy` — both work).

No automated test for this file — it's pure Supabase I/O orchestration, matching this codebase's convention that DB-fetching code (e.g. every `lib/*/admin-actions.ts`, every `app/admin/*/page.tsx` query block) isn't unit tested; only the pure logic it delegates to (`bucketReviewQueue`, and now `notification-copy.ts`) is. Verification happens via `npm run build` (Task 2 Step 2) and the manual smoke check in Task 7.

- [ ] **Step 1: Write the implementation**

Create `lib/admin/notification-queue.ts`:

```typescript
import { createClient } from '@/lib/supabase/server'
import { bucketReviewQueue, type ReviewMatchInput } from '@/lib/matches/review-queue'
import {
  exchangeListingNotification,
  resultNotification,
  withdrawalNotification,
  sortByCreatedAtDesc,
  type AdminNotificationItem,
} from './notification-copy'

export type { AdminNotificationType, AdminNotificationItem } from './notification-copy'
export { countByHref } from './notification-copy'

type SupabaseClient = ReturnType<typeof createClient>
type ProfileRef = { username: string | null; display_name: string | null } | { username: string | null; display_name: string | null }[] | null

function nameOf(p: ProfileRef): string {
  const row = Array.isArray(p) ? p[0] ?? null : p
  return row?.display_name ?? row?.username ?? 'Player'
}

// MERGE DEPENDENCY — #28 (feat/28-30-wallet-perks-recordings): when that
// branch merges:
//   1. Delete the referral_withdrawal_requests query below and its mapped
//      items (referral_withdrawal_requests is dropped).
//   2. Delete the friendly_withdrawal_requests query below and its mapped
//      items (friendly_withdrawal_requests is dropped).
//   3. withdrawal_requests survives with the same name but widened scope —
//      keep its query, but update the link in notification-copy.ts's
//      TYPE_LINK from '/admin/withdrawals' to '/admin/wallet'.
// Net effect: 3 withdrawal notification types collapse into 1.
async function fetchWithdrawalItems(supabase: SupabaseClient): Promise<AdminNotificationItem[]> {
  type Row = { id: string; amount: number; requested_at: string; profiles: ProfileRef }

  const [{ data: w }, { data: r }, { data: f }] = await Promise.all([
    supabase
      .from('withdrawal_requests')
      .select('id, amount, requested_at, profiles(username, display_name)')
      .in('status', ['pending', 'failed']),
    supabase
      .from('referral_withdrawal_requests')
      .select('id, amount, requested_at, profiles(username, display_name)')
      .eq('status', 'pending'),
    supabase
      .from('friendly_withdrawal_requests')
      .select('id, amount, requested_at, profiles(username, display_name)')
      .eq('status', 'pending'),
  ])

  function toItems(
    rows: unknown[] | null,
    type: 'withdrawal_pending' | 'referral_withdrawal_pending' | 'friendly_withdrawal_pending',
  ): AdminNotificationItem[] {
    return ((rows as Row[] | null) ?? []).map((row) =>
      withdrawalNotification({
        type,
        username: nameOf(row.profiles),
        amount: row.amount,
        createdAt: row.requested_at,
      }),
    )
  }

  return [
    ...toItems(w, 'withdrawal_pending'),
    ...toItems(r, 'referral_withdrawal_pending'),
    ...toItems(f, 'friendly_withdrawal_pending'),
  ]
}

async function fetchExchangeItems(supabase: SupabaseClient): Promise<AdminNotificationItem[]> {
  type Row = {
    id: string
    title: string
    created_at: string
    seller: { username: string | null } | { username: string | null }[] | null
  }
  const { data } = await supabase
    .from('marketplace_listings')
    .select('id, title, created_at, seller:profiles!marketplace_listings_seller_id_fkey(username)')
    .eq('status', 'pending')

  return ((data as unknown[] | null) ?? []).map((raw) => {
    const l = raw as Row
    const seller = Array.isArray(l.seller) ? l.seller[0] ?? null : l.seller
    return exchangeListingNotification({
      title: l.title,
      sellerName: seller?.username ?? 'seller',
      createdAt: l.created_at,
    })
  })
}

async function fetchResultItems(supabase: SupabaseClient): Promise<AdminNotificationItem[]> {
  type NameRef = ProfileRef
  type TournamentRef = { title: string } | { title: string }[] | null
  type Row = {
    id: string
    round: string
    status: string
    scheduled_at: string | null
    is_full_day: boolean
    auto_expired: boolean
    created_at: string
    player_a: NameRef
    player_b: NameRef
    tournament: TournamentRef
    match_results: { count: number }[]
  }

  const { data } = await supabase
    .from('matches')
    .select(
      'id, round, status, scheduled_at, is_full_day, auto_expired, created_at, ' +
        'player_a:profiles!matches_player_a_id_fkey(username, display_name), ' +
        'player_b:profiles!matches_player_b_id_fkey(username, display_name), ' +
        'tournament:tournaments(title), match_results(count)',
    )
    .in('status', ['scheduled', 'live', 'disputed', 'cancelled'])

  const rows = ((data as unknown[] | null) ?? []) as Row[]
  const createdAtById = new Map(rows.map((r) => [r.id, r.created_at]))

  const reviewInputs: ReviewMatchInput[] = rows.map((m) => {
    const t = Array.isArray(m.tournament) ? m.tournament[0] ?? null : m.tournament
    return {
      id: m.id,
      status: m.status,
      scheduledAt: m.scheduled_at,
      isFullDay: m.is_full_day,
      autoExpired: m.auto_expired,
      submissionCount: m.match_results?.[0]?.count ?? 0,
      round: m.round,
      playerAName: nameOf(m.player_a),
      playerBName: nameOf(m.player_b),
      tournamentTitle: t?.title ?? 'Tournament',
      tournamentSlug: '',
    }
  })

  const { needsReview, disputed } = bucketReviewQueue(reviewInputs, new Date())

  return [
    ...needsReview.map((m) =>
      resultNotification({
        type: 'result_needs_review',
        tournamentTitle: m.tournamentTitle,
        playerAName: m.playerAName,
        playerBName: m.playerBName,
        createdAt: createdAtById.get(m.id) ?? new Date().toISOString(),
      }),
    ),
    ...disputed.map((m) =>
      resultNotification({
        type: 'result_disputed',
        tournamentTitle: m.tournamentTitle,
        playerAName: m.playerAName,
        playerBName: m.playerBName,
        createdAt: createdAtById.get(m.id) ?? new Date().toISOString(),
      }),
    ),
  ]
}

export async function getAdminNotificationQueue(
  staffRole: 'admin' | 'moderator',
): Promise<AdminNotificationItem[]> {
  const supabase = createClient()

  const [exchangeItems, resultItems, withdrawalItems] = await Promise.all([
    fetchExchangeItems(supabase),
    fetchResultItems(supabase),
    staffRole === 'admin' ? fetchWithdrawalItems(supabase) : Promise.resolve([]),
  ])

  return sortByCreatedAtDesc([...exchangeItems, ...resultItems, ...withdrawalItems])
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors referencing `lib/admin/notification-queue.ts`. (Unrelated pre-existing errors elsewhere, if any, are out of scope — only confirm this new file is clean.)

- [ ] **Step 3: Commit**

```bash
git add lib/admin/notification-queue.ts
git commit -m "feat: #27 getAdminNotificationQueue live-aggregation orchestrator"
```

---

### Task 3: `AdminNotificationBell` component

**Files:**
- Create: `components/admin/AdminNotificationBell.tsx`

**Interfaces:**
- Consumes: `type { AdminNotificationItem }` from `@/lib/admin/notification-copy` (type-only import — matches the existing pattern in `components/shared/NotificationBell.tsx:6`, which imports `NotificationItem` from a server-only file the same way; type-only imports are erased and never pull server code into the client bundle).
- Produces: `export function AdminNotificationBell({ items }: { items: AdminNotificationItem[] })` — consumed by Task 4.

No automated test — this repo has no component-test setup (`vitest.config.ts` only includes `**/*.test.ts`, and `Glob **/*.test.tsx` found zero files). Verified manually in Task 7.

- [ ] **Step 1: Write the component**

Create `components/admin/AdminNotificationBell.tsx`:

```typescript
'use client'
import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Bell } from 'lucide-react'
import type { AdminNotificationItem } from '@/lib/admin/notification-copy'

export function AdminNotificationBell({ items }: { items: AdminNotificationItem[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const router = useRouter()

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

  function onSelect(item: AdminNotificationItem) {
    setOpen(false)
    router.push(item.link)
  }

  const visible = items.slice(0, 20)

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Admin notifications"
        aria-expanded={open}
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-slate-300 transition hover:bg-slate-800"
      >
        <Bell className="h-5 w-5" />
        {items.length > 0 && (
          <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {items.length > 9 ? '9+' : items.length}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 max-h-96 w-80 overflow-y-auto rounded-xl border border-slate-800 bg-slate-900 py-1 shadow-xl">
          {visible.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-500">Nothing needs attention.</p>
          ) : (
            visible.map((item, i) => (
              <button
                key={`${item.type}-${item.createdAt}-${i}`}
                type="button"
                onClick={() => onSelect(item)}
                className="block w-full px-4 py-3 text-left text-sm transition-colors hover:bg-slate-800"
              >
                <p className="font-semibold text-white">{item.title}</p>
                <p className="mt-0.5 text-xs text-slate-400">{item.body}</p>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors referencing `components/admin/AdminNotificationBell.tsx`.

- [ ] **Step 3: Commit**

```bash
git add components/admin/AdminNotificationBell.tsx
git commit -m "feat: #27 AdminNotificationBell component"
```

---

### Task 4: Wire the bell + per-item badges into `AdminSidebar`

**Files:**
- Modify: `components/admin/AdminSidebar.tsx`

**Interfaces:**
- Consumes: `countByHref`, `type { AdminNotificationItem }` from `@/lib/admin/notification-copy`; `AdminNotificationBell` from `./AdminNotificationBell` (Task 3).
- Produces: `AdminSidebar` now takes an additional required prop `notifications: AdminNotificationItem[]` — consumed by Task 5 (`app/admin/layout.tsx`).

No automated test (component file, see Task 3 rationale). Verified manually in Task 7.

- [ ] **Step 1: Replace the file contents**

Replace all of `components/admin/AdminSidebar.tsx` with:

```typescript
'use client'
import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu, X } from 'lucide-react'
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
  onNavigate,
}: {
  items: AdminNavItem[]
  pathname: string
  badgeCounts: Record<string, number>
  onNavigate?: () => void
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
            onClick={onNavigate}
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
  const [open, setOpen] = useState(false)
  const badgeCounts = countByHref(notifications)

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
        <div className="flex items-center gap-2">
          <AdminNotificationBell items={notifications} />
          <RoleBadge isAdmin={isAdmin} />
        </div>
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 sm:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-64 border-r border-slate-800 bg-slate-950 p-4">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-lg font-black text-white">Admin</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close admin menu"
                className="p-1 text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <NavList items={items} pathname={pathname} badgeCounts={badgeCounts} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}

      {/* Desktop sidebar */}
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
    </>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: errors in `app/admin/layout.tsx` only (missing the new required `notifications` prop) — that's expected and fixed by Task 5. No errors in `AdminSidebar.tsx` itself.

- [ ] **Step 3: Commit**

```bash
git add components/admin/AdminSidebar.tsx
git commit -m "feat: #27 AdminSidebar renders bell + per-nav-item badge counts"
```

---

### Task 5: Wire `getAdminNotificationQueue` into `app/admin/layout.tsx`

**Files:**
- Modify: `app/admin/layout.tsx`

**Interfaces:**
- Consumes: `getAdminNotificationQueue` from `@/lib/admin/notification-queue` (Task 2); `AdminSidebar`'s new `notifications` prop (Task 4).

- [ ] **Step 1: Replace the file contents**

Replace all of `app/admin/layout.tsx` with:

```typescript
import { requireStaff } from '@/lib/admin/auth'
import { ADMIN_NAV, visibleNav } from '@/lib/admin/nav'
import { AdminSidebar } from '@/components/admin/AdminSidebar'
import { getAdminNotificationQueue } from '@/lib/admin/notification-queue'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireStaff()
  const items = visibleNav(ADMIN_NAV, ctx.isAdmin)
  const notifications = await getAdminNotificationQueue(ctx.isAdmin ? 'admin' : 'moderator')
  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 sm:flex sm:gap-6">
      <AdminSidebar items={items} isAdmin={ctx.isAdmin} notifications={notifications} />
      <div className="min-w-0 flex-1 py-6">{children}</div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors in `app/admin/layout.tsx` or `components/admin/AdminSidebar.tsx`.

- [ ] **Step 3: Commit**

```bash
git add app/admin/layout.tsx
git commit -m "feat: #27 wire admin notification queue into admin layout"
```

---

### Task 6: Refactor Overview `StatCard`s to the shared queue

**Files:**
- Modify: `app/admin/page.tsx`

**Interfaces:**
- Consumes: `getAdminNotificationQueue`, `type { AdminNotificationType }` from `@/lib/admin/notification-queue`.

- [ ] **Step 1: Replace the file contents**

Replace all of `app/admin/page.tsx` with:

```typescript
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { StatCard } from '@/components/admin/StatCard'
import { RecomputeButton } from '@/components/admin/RecomputeButton'
import { getAdminNotificationQueue, type AdminNotificationType } from '@/lib/admin/notification-queue'

export const metadata: Metadata = { title: 'Admin · SentinelX Esports' }

export default async function AdminHomePage() {
  const ctx = await requireStaff()
  const supabase = createClient()

  const [notifications, activeTournaments, openRegs] = await Promise.all([
    getAdminNotificationQueue(ctx.isAdmin ? 'admin' : 'moderator'),
    supabase.from('tournaments').select('*', { count: 'exact', head: true }).eq('status', 'active'),
    supabase
      .from('tournaments')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'registration_open'),
  ])

  const countOf = (type: AdminNotificationType) => notifications.filter((n) => n.type === type).length
  const pendingResults = countOf('result_needs_review') + countOf('result_disputed')
  const pendingListings = countOf('exchange_listing_pending')
  const pendingWithdrawals = countOf('withdrawal_pending')
  const pendingReferralWithdrawals = countOf('referral_withdrawal_pending')
  const pendingFriendlyWithdrawals = countOf('friendly_withdrawal_pending')

  return (
    <section>
      <h2 className="mb-4 text-[11px] font-bold uppercase tracking-widest text-slate-500">
        Needs attention
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Pending results" count={pendingResults} href="/admin/results" />
        <StatCard label="Active tournaments" count={activeTournaments.count ?? 0} />
        <StatCard label="Open registrations" count={openRegs.count ?? 0} />
        <StatCard label="Pending listings" count={pendingListings} href="/admin/exchange" />
        {ctx.isAdmin && (
          <>
            <StatCard label="Pending withdrawals" count={pendingWithdrawals} href="/admin/withdrawals" />
            <StatCard
              label="Pending referral withdrawals"
              count={pendingReferralWithdrawals}
              href="/admin/referrals"
            />
            <StatCard
              label="Pending friendly withdrawals"
              count={pendingFriendlyWithdrawals}
              href="/admin/friendly-withdrawals"
            />
          </>
        )}
      </div>

      {ctx.isAdmin && (
        <div className="mt-8">
          <h2 className="mb-4 text-[11px] font-bold uppercase tracking-widest text-slate-500">
            Maintenance
          </h2>
          <RecomputeButton />
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors in `app/admin/page.tsx`.

- [ ] **Step 3: Commit**

```bash
git add app/admin/page.tsx
git commit -m "feat: #27 Overview StatCards read from shared notification queue"
```

---

### Task 7: Full verification, roadmap update, final commit

**Files:**
- Modify: `ROADMAP.md`

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including the 9 new tests from Task 1.

- [ ] **Step 2: Run the full build (typecheck + compile)**

Run: `npm run build`
Expected: build succeeds with no type errors.

- [ ] **Step 3: Manual smoke check**

Start the dev server (`npm run dev`), then in a browser:
1. Log in as an **admin** fixture user, visit `/admin`. Confirm: the bell icon appears in both the mobile top bar and desktop sidebar header; clicking it opens a dropdown listing pending items (exchange listings, results needing review/disputed, and — if any exist in QA data — withdrawals/referral withdrawals/friendly withdrawals); clicking an item navigates to its linked page. Confirm sidebar nav items (Exchange, Results, Withdrawals, Referrals, Friendly withdrawals) show numeric badges matching the dropdown counts, and items with zero pending show no badge. Confirm the Overview page's "Needs attention" grid shows all 5 StatCards with counts matching the bell.
2. Log in as a **moderator** fixture user, visit `/admin`. Confirm: the bell dropdown and sidebar badges show exchange/results items but **never** withdrawal/referral/friendly-withdrawal items, and the Overview grid does not render the three admin-only StatCards (matches the existing `ctx.isAdmin &&` guard already in place for those nav items and the withdrawals StatCard).
3. Resolve one pending item as admin (e.g. approve a pending exchange listing from `/admin/exchange`), then reload `/admin`. Confirm the corresponding bell/badge/StatCard count drops by one — proving the "auto-resolve for everyone, no persisted state" design actually works.

If any of these checks fail, fix the issue before proceeding — do not mark this task complete on a partial pass.

- [ ] **Step 4: Update ROADMAP.md**

In `ROADMAP.md`, change:
```
| 27 | Admin notifications | ⬜ |
```
to:
```
| 27 | Admin notifications | ✅ |
```

- [ ] **Step 5: Final commit**

```bash
git add ROADMAP.md
git commit -m "docs: mark #27 admin notifications complete in roadmap"
```
