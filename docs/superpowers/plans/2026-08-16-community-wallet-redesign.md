# Community & Wallet Visual Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign `/community` and `/dashboard/wallet` to match two reference mockups (dark/purple hero, stat tiles, sidebar widgets, card treatments) using Sentinel X's own real data, plus add wallet/coin balance chips to the global header.

**Architecture:** Mostly additive — new small query helpers (`lib/community/*-query.ts`) feeding new presentational components, wired into the existing `page.tsx` files alongside the feed/wallet components that already exist and don't need to change. `NavSession` gains two balance fields consumed by a new header component. No new tables, no new Server Actions, no schema changes.

**Tech Stack:** Next.js 14 App Router (Server Components + one `'use client'` copy button), Supabase (`@supabase/supabase-js`), Tailwind (`sx-*` design tokens from `tailwind.config.ts`), Vitest for pure-function unit tests.

**Spec:** `docs/superpowers/specs/2026-08-16-community-wallet-redesign-design.md`

## Global Constraints

- **Do not touch the coin-economy-extension surface.** Another session is actively building it: `docs/superpowers/specs/2026-08-15-coin-economy-extension.md`, `docs/superpowers/plans/2026-08-16-coin-economy-extension.md`, `lib/coins/*`, `sx_coins`/`sx_coin_transactions`, any wagering/entry-discount/post-boost code. If a task here appears to need any of that, stop and ask first.
- **"Exact replica, real data" rule** (project convention, see `project_phase1_visual_overhaul` memory): where a mockup shows an image asset Sentinel X doesn't have, reserve the exact layout slot via `findOptionalPublicImage('mascot', '<name>')` + `<ImagePlaceholder>` fallback (see `app/(public)/about/page.tsx` for the pattern) — never invent a substitute image or silently drop the slot.
- **Money formatting:** always `formatNaira()` from `lib/format.ts` (₦ + `en-NG` grouping) — never format currency inline.
- **Dates/times:** always the existing `lib/format.ts` helpers (`formatDate`, `formatDateTime`, `formatRelativeTime`) — WAT timezone handling lives there, don't reimplement it.
- **Avatars stay `HexAvatar`** (`components/shared/HexAvatar.tsx`) — the site's established brand shape — never circular avatars, even where a mockup shows circles.
- **No component snapshot/unit tests** — this codebase's convention (verified: zero `.test.tsx` files exist) is unit tests only for pure logic in `lib/**/*.test.ts`; components are verified via `npm run build` + manual dev-server check. Follow this convention, don't invent component tests.
- **RLS-respecting client by default.** Use the cookie-based `createClient()` (`lib/supabase/server.ts`) for anything the querying user is allowed to read under RLS (their own wallet/coins row, public profiles/tournaments/posts). Reserve `createAdminClient()` (`lib/supabase/admin.ts`) for cross-user admin reads, matching existing call sites — don't default to admin client out of habit.

---

## File Structure

**New library files (data layer):**
- `lib/community/stats-query.ts` — `fetchCommunityStats()`
- `lib/community/top-members-query.ts` — `fetchTopCommunityMembers()`, `rankIcon()`
- `lib/community/top-members-query.test.ts`
- `lib/community/upcoming-events-query.ts` — `fetchUpcomingCommunityEvents()`, `mapTournamentToEventItem()`
- `lib/community/upcoming-events-query.test.ts`
- `lib/community/gallery-query.ts` — `fetchCommunityGallery()`, `truncateCaption()`
- `lib/community/gallery-query.test.ts`

**Modified library files:**
- `lib/nav/session.ts` — add `walletBalance`, `coinBalance` to `NavSession`

**New components — community:**
- `components/community/CommunityHero.tsx`
- `components/community/CommunityStatsBar.tsx`
- `components/community/QuickActionTiles.tsx`
- `components/community/TopMembersWidget.tsx`
- `components/community/UpcomingEventsWidget.tsx`
- `components/community/CommunityServersCard.tsx`
- `components/community/CommunityGallery.tsx`
- `components/community/CommunityFooterCta.tsx`

**New components — wallet:**
- `components/wallet/ReferralEarningsCard.tsx`
- `components/wallet/WithdrawalStatusPanel.tsx`

**New components — shared:**
- `components/shared/BalanceChips.tsx`

**Modified components (visual restyle, no logic change):**
- `components/shared/SiteHeader.tsx` — mount `BalanceChips`
- `components/community/PostCard.tsx` — padding tweak
- `components/wallet/WalletSidebar.tsx` — icons + eyebrow label
- `lib/wallet/nav.ts` — add `icon` field

**Modified pages:**
- `app/(public)/community/page.tsx` — full restructure
- `app/dashboard/wallet/page.tsx` — restructure with new cards + queries

---

### Task 1: `NavSession` gains wallet + coin balance

**Files:**
- Modify: `lib/nav/session.ts`

**Interfaces:**
- Produces: `NavSession.walletBalance: number`, `NavSession.coinBalance: number` — every later task that reads `NavSession` (Task 2) relies on these two fields.

- [ ] **Step 1: Add the fields to the interface and the logged-out default**

```ts
// lib/nav/session.ts
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
  walletBalance: number
  coinBalance: number
}

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
  walletBalance: 0,
  coinBalance: 0,
}
```

- [ ] **Step 2: Fetch both balances in the same `Promise.all`, using the RLS-respecting client**

`wallets` and `sx_coins` both have a `player_id = auth.uid()` self-read RLS policy (`024_wallet_system.sql`, `052_sx_coins_store.sql`) — the same `supabase` client already used for the profile/notification reads in this function can read them directly, no admin client needed.

```ts
export async function getNavSession(): Promise<NavSession> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return LOGGED_OUT

  const [{ data: profile }, staff, { count: unreadCount }, { data: notifRows }, { data: walletRow }, { data: coinsRow }] =
    await Promise.all([
      supabase.from('profiles').select('username, display_name, avatar_url').eq('id', user.id).maybeSingle(),
      getStaffContext(),
      supabase
        .from('player_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('player_id', user.id)
        .eq('read', false),
      supabase
        .from('player_notifications')
        .select('id, type, title, body, link, read, created_at')
        .eq('player_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20),
      supabase.from('wallets').select('balance').eq('player_id', user.id).maybeSingle(),
      supabase.from('sx_coins').select('balance').eq('player_id', user.id).maybeSingle(),
    ])

  const recentNotifications: NotificationItem[] = (notifRows ?? []).map((n) => ({
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    link: n.link,
    read: n.read,
    createdAt: n.created_at,
  }))

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
    // .maybeSingle() + `?? 0` covers both "no row yet" (new player) and a
    // query-level error (Supabase-js returns {data:null, error}, never
    // throws) — the header must never break on either case.
    walletBalance: walletRow?.balance ?? 0,
    coinBalance: coinsRow?.balance ?? 0,
  }
}
```

- [ ] **Step 3: Verify the app still builds**

Run: `npm run build`
Expected: build succeeds (this file has no existing test suite — `lib/nav/*.test.ts` only covers `back-link.ts`, `links.ts`, `tabs.ts`, none of which changed).

- [ ] **Step 4: Commit**

```bash
git add lib/nav/session.ts
git commit -m "feat(nav): add walletBalance/coinBalance to NavSession"
```

---

### Task 2: Header balance chips

**Files:**
- Create: `components/shared/BalanceChips.tsx`
- Modify: `components/shared/SiteHeader.tsx`

**Interfaces:**
- Consumes: `NavSession.walletBalance`, `NavSession.coinBalance` (Task 1); `formatNaira` from `lib/format.ts`.
- Produces: `BalanceChips({ walletBalance, coinBalance }: { walletBalance: number; coinBalance: number })`.

- [ ] **Step 1: Create the component**

```tsx
// components/shared/BalanceChips.tsx
import Link from 'next/link'
import { formatNaira } from '@/lib/format'

// Two compact pills next to the notification bell — wallet (real Naira,
// withdrawable) and SX Coins (in-platform points, non-cash). Only rendered
// when logged in (SiteHeader gates that). Hidden below `sm:` — same
// breakpoint as the header's WhatsApp CTA — to avoid crowding the smallest
// screens; both balances are one tap away via /dashboard/wallet regardless.
export function BalanceChips({ walletBalance, coinBalance }: { walletBalance: number; coinBalance: number }) {
  return (
    <div className="hidden items-center gap-1.5 sm:flex">
      <Link
        href="/dashboard/wallet"
        className="flex items-center gap-1 rounded-full border border-sx-border bg-sx-surface px-3 py-1.5 text-xs font-bold text-white transition-colors hover:border-sx-purple/40"
      >
        <span aria-hidden>👛</span>
        {formatNaira(walletBalance)}
      </Link>
      <Link
        href="/store"
        className="flex items-center gap-1 rounded-full border border-sx-border bg-sx-surface px-3 py-1.5 text-xs font-bold text-white transition-colors hover:border-sx-purple/40"
      >
        <span aria-hidden>🪙</span>
        {coinBalance.toLocaleString()}
      </Link>
    </div>
  )
}
```

- [ ] **Step 2: Mount it in `SiteHeader`, between the WhatsApp CTA and the bell**

```tsx
// components/shared/SiteHeader.tsx
// add to imports:
import { BalanceChips } from '@/components/shared/BalanceChips'
```

```tsx
            {/* Notifications — every breakpoint, never in the bottom tab bar */}
            {session.isLoggedIn && (
              <>
                <BalanceChips walletBalance={session.walletBalance} coinBalance={session.coinBalance} />
                <NotificationBell
                  initialNotifications={session.recentNotifications}
                  initialUnreadCount={session.unreadNotificationCount}
                />
              </>
            )}
```

(This replaces the existing `{session.isLoggedIn && <NotificationBell .../>}` block — same condition, `BalanceChips` added as a sibling before it.)

- [ ] **Step 3: Build check**

Run: `npm run build`
Expected: succeeds, no type errors (`NavSession` now has the fields `BalanceChips` consumes).

- [ ] **Step 4: Commit**

```bash
git add components/shared/BalanceChips.tsx components/shared/SiteHeader.tsx
git commit -m "feat(header): add wallet + SX Coins balance chips next to the bell"
```

---

### Task 3: Community stats query + stats bar

**Files:**
- Create: `lib/community/stats-query.ts`
- Create: `components/community/CommunityStatsBar.tsx`

**Interfaces:**
- Produces: `CommunityStats { memberCount: number; countryCount: number; tournamentCount: number }`, `fetchCommunityStats(): Promise<CommunityStats>`, `CommunityStatsBar({ stats: CommunityStats })`.

- [ ] **Step 1: Write the query**

```ts
// lib/community/stats-query.ts
import { createClient } from '@/lib/supabase/server'

export interface CommunityStats {
  memberCount: number
  countryCount: number
  tournamentCount: number
}

// All three numbers are real (spec §4.2) — "Active Teams" from the mockup
// has no backing concept (teams are a v4 roadmap item) and is replaced with
// Tournaments Hosted. countryCount pulls every non-null `country` value and
// dedupes client-side — supabase-js has no COUNT(DISTINCT ...) shorthand;
// acceptable for a single text column at current scale, revisit with an RPC
// if the profiles table grows large enough for this to matter.
export async function fetchCommunityStats(): Promise<CommunityStats> {
  const supabase = createClient()
  const [{ count: memberCount }, { data: countryRows }, { count: tournamentCount }] = await Promise.all([
    supabase.from('profiles').select('id', { count: 'exact', head: true }),
    supabase.from('profiles').select('country').not('country', 'is', null),
    supabase.from('tournaments').select('id', { count: 'exact', head: true }),
  ])
  const countryCount = new Set((countryRows ?? []).map((r) => r.country)).size
  return {
    memberCount: memberCount ?? 0,
    countryCount,
    tournamentCount: tournamentCount ?? 0,
  }
}
```

- [ ] **Step 2: Write the stats bar component**

```tsx
// components/community/CommunityStatsBar.tsx
import type { CommunityStats } from '@/lib/community/stats-query'

export function CommunityStatsBar({ stats }: { stats: CommunityStats }) {
  const tiles = [
    { icon: '👥', value: `${stats.memberCount.toLocaleString()}+`, label: 'Members' },
    { icon: '🌍', value: `${stats.countryCount}+`, label: 'Countries' },
    { icon: '🏆', value: `${stats.tournamentCount}+`, label: 'Tournaments Hosted' },
    { icon: '🕒', value: '24/7', label: 'Active & Growing' },
  ]
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-xl border border-sx-border bg-sx-surface p-4 text-center">
          <p className="text-lg">{t.icon}</p>
          <p className="font-display text-xl font-black text-white">{t.value}</p>
          <p className="text-xs text-sx-gray">{t.label}</p>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Build check**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add lib/community/stats-query.ts components/community/CommunityStatsBar.tsx
git commit -m "feat(community): add community stats bar (members/countries/tournaments)"
```

---

### Task 4: Top Community Members widget

**Files:**
- Create: `lib/community/top-members-query.ts`
- Test: `lib/community/top-members-query.test.ts`
- Create: `components/community/TopMembersWidget.tsx`

**Interfaces:**
- Consumes: `MembershipTier` from `lib/membership/tiers.ts`, `HexAvatar` from `components/shared/HexAvatar.tsx`.
- Produces: `TopMemberView { rank: number; id: string; username: string | null; displayName: string | null; avatarUrl: string | null; membershipTier: MembershipTier; xp: number }`, `rankIcon(rank: number): string`, `fetchTopCommunityMembers(limit?: number): Promise<TopMemberView[]>`, `TopMembersWidget({ members: TopMemberView[] })`.

- [ ] **Step 1: Write the failing test for `rankIcon`**

```ts
// lib/community/top-members-query.test.ts
import { describe, it, expect } from 'vitest'
import { rankIcon } from './top-members-query'

describe('rankIcon', () => {
  it('returns a medal emoji for the top 3 ranks', () => {
    expect(rankIcon(1)).toBe('🥇')
    expect(rankIcon(2)).toBe('🥈')
    expect(rankIcon(3)).toBe('🥉')
  })

  it('returns the plain rank number past 3rd place', () => {
    expect(rankIcon(4)).toBe('4')
    expect(rankIcon(5)).toBe('5')
    expect(rankIcon(10)).toBe('10')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/community/top-members-query.test.ts`
Expected: FAIL — `./top-members-query` doesn't exist yet.

- [ ] **Step 3: Write the query module (implementation makes the test pass)**

```ts
// lib/community/top-members-query.ts
import { createClient } from '@/lib/supabase/server'
import type { MembershipTier } from '@/lib/membership/tiers'

export interface TopMemberView {
  rank: number
  id: string
  username: string | null
  displayName: string | null
  avatarUrl: string | null
  membershipTier: MembershipTier
  xp: number
}

// 🥇🥈🥉 for the podium, plain rank number after — spec §4.5.
export function rankIcon(rank: number): string {
  if (rank === 1) return '🥇'
  if (rank === 2) return '🥈'
  if (rank === 3) return '🥉'
  return String(rank)
}

// Top players by XP (profiles.xp, descending). Real tier labels
// (Recruit/Guardian/Elite/Sentinel/Legend) are used, not the mockup's
// fictional ones (spec §4.5).
export async function fetchTopCommunityMembers(limit = 5): Promise<TopMemberView[]> {
  const supabase = createClient()
  const { data } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url, membership_tier, xp')
    .order('xp', { ascending: false })
    .limit(limit)

  return (data ?? []).map((row, i) => ({
    rank: i + 1,
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    membershipTier: (row.membership_tier ?? 'recruit') as MembershipTier,
    xp: row.xp,
  }))
}
```

- [ ] **Step 4: Run the test again to verify it passes**

Run: `npx vitest run lib/community/top-members-query.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the widget component**

```tsx
// components/community/TopMembersWidget.tsx
import Link from 'next/link'
import { HexAvatar } from '@/components/shared/HexAvatar'
import { rankIcon, type TopMemberView } from '@/lib/community/top-members-query'
import type { MembershipTier } from '@/lib/membership/tiers'

const TIER_LABEL: Record<MembershipTier, string> = {
  recruit: 'Recruit',
  guardian: 'Guardian',
  elite: 'Elite',
  sentinel: 'Sentinel',
  legend: 'Legend',
}

export function TopMembersWidget({ members }: { members: TopMemberView[] }) {
  if (members.length === 0) return null
  return (
    <div className="rounded-2xl border border-sx-border bg-sx-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-black uppercase tracking-widest text-sx-white">Top Community Members</h2>
        <Link href="/rankings" className="text-[11px] font-semibold text-sx-purple-text hover:text-sx-purple-light">
          View All →
        </Link>
      </div>
      <div className="space-y-3">
        {members.map((m) => {
          const name = m.displayName ?? m.username ?? 'Player'
          return (
            <div key={m.id} className="flex items-center gap-2.5">
              <span className="w-5 shrink-0 text-center text-sm font-bold text-sx-gray">{rankIcon(m.rank)}</span>
              <HexAvatar src={m.avatarUrl} username={name} tier={m.membershipTier} size="xs" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-white">{name}</p>
                <p className="text-[11px] text-sx-gray">{TIER_LABEL[m.membershipTier]}</p>
              </div>
              <p className="shrink-0 text-xs font-bold text-sx-purple-text">{m.xp.toLocaleString()} XP</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Build check**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 7: Commit**

```bash
git add lib/community/top-members-query.ts lib/community/top-members-query.test.ts components/community/TopMembersWidget.tsx
git commit -m "feat(community): add Top Community Members widget"
```

---

### Task 5: Upcoming Tournaments widget (events adapter seam)

**Files:**
- Create: `lib/community/upcoming-events-query.ts`
- Test: `lib/community/upcoming-events-query.test.ts`
- Create: `components/community/UpcomingEventsWidget.tsx`

**Interfaces:**
- Consumes: `formatDate`, `formatDateTime` from `lib/format.ts`.
- Produces: `UpcomingEventItem { id: string; title: string; date: string; time: string; ctaLabel: string; ctaHref: string }`, `mapTournamentToEventItem(row): UpcomingEventItem`, `fetchUpcomingCommunityEvents(limit?: number): Promise<UpcomingEventItem[]>`, `UpcomingEventsWidget({ events: UpcomingEventItem[] })`.

- [ ] **Step 1: Write the failing test for the mapper**

```ts
// lib/community/upcoming-events-query.test.ts
import { describe, it, expect } from 'vitest'
import { mapTournamentToEventItem } from './upcoming-events-query'

describe('mapTournamentToEventItem', () => {
  it('maps a registration_open tournament to a Register CTA', () => {
    const item = mapTournamentToEventItem({
      id: 't1',
      title: 'DLS Community Club #4',
      slug: 'dls-community-club-4',
      tournament_start: '2026-08-25T19:00:00Z',
      status: 'registration_open',
    })
    expect(item).toEqual({
      id: 't1',
      title: 'DLS Community Club #4',
      date: '25 Aug 2026',
      time: '25 Aug, 20:00',
      ctaLabel: 'Register',
      ctaHref: '/tournaments/dls-community-club-4',
    })
  })

  it('maps a non-registration-open tournament to a View CTA', () => {
    const item = mapTournamentToEventItem({
      id: 't2',
      title: 'Season 2 Finals',
      slug: 'season-2-finals',
      tournament_start: '2026-09-01T18:00:00Z',
      status: 'active',
    })
    expect(item.ctaLabel).toBe('View')
  })

  it('falls back to TBD copy when tournament_start is null', () => {
    const item = mapTournamentToEventItem({
      id: 't3',
      title: 'Draft Cup',
      slug: 'draft-cup',
      tournament_start: null,
      status: 'registration_open',
    })
    expect(item.date).toBe('Date TBD')
    expect(item.time).toBe('Time TBD')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/community/upcoming-events-query.test.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Write the query module**

```ts
// lib/community/upcoming-events-query.ts
import { createClient } from '@/lib/supabase/server'
import { formatDate, formatDateTime } from '@/lib/format'

export interface UpcomingEventItem {
  id: string
  title: string
  date: string
  time: string
  ctaLabel: string
  ctaHref: string
}

interface TournamentRow {
  id: string
  title: string
  slug: string
  tournament_start: string | null
  status: string
}

// Adapter seam (spec §4.5): the mockup's "Upcoming Community Events" widget
// has no backing data source yet, so this sources it from real tournaments
// instead. The widget component only ever sees UpcomingEventItem — when a
// real `community_events` table ships later, only this function's body
// changes, not the widget or its prop shape.
export function mapTournamentToEventItem(row: TournamentRow): UpcomingEventItem {
  const dateTime = formatDateTime(row.tournament_start)
  return {
    id: row.id,
    title: row.title,
    date: formatDate(row.tournament_start) ?? 'Date TBD',
    time: dateTime ?? 'Time TBD',
    ctaLabel: row.status === 'registration_open' ? 'Register' : 'View',
    ctaHref: `/tournaments/${row.slug}`,
  }
}

export async function fetchUpcomingCommunityEvents(limit = 3): Promise<UpcomingEventItem[]> {
  const supabase = createClient()
  const { data } = await supabase
    .from('tournaments')
    .select('id, title, slug, tournament_start, status')
    .in('status', ['registration_open', 'active'])
    .order('tournament_start', { ascending: true })
    .limit(limit)
  return (data ?? []).map(mapTournamentToEventItem)
}
```

- [ ] **Step 4: Run the test again to verify it passes**

Run: `npx vitest run lib/community/upcoming-events-query.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the widget component**

```tsx
// components/community/UpcomingEventsWidget.tsx
import Link from 'next/link'
import type { UpcomingEventItem } from '@/lib/community/upcoming-events-query'

export function UpcomingEventsWidget({ events }: { events: UpcomingEventItem[] }) {
  if (events.length === 0) return null
  return (
    <div className="rounded-2xl border border-sx-border bg-sx-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-black uppercase tracking-widest text-sx-white">Upcoming Tournaments</h2>
        <Link href="/tournaments" className="text-[11px] font-semibold text-sx-purple-text hover:text-sx-purple-light">
          View All →
        </Link>
      </div>
      <div className="space-y-3">
        {events.map((e) => {
          const [day, month] = e.date.split(' ')
          return (
            <div key={e.id} className="flex items-center gap-3">
              <div className="flex w-11 shrink-0 flex-col items-center rounded-lg border border-sx-purple/30 bg-sx-purple/10 py-1">
                <span className="text-[10px] font-bold uppercase text-sx-purple-text">{month ?? ''}</span>
                <span className="text-sm font-black text-white">{day}</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-white">{e.title}</p>
                <p className="text-[11px] text-sx-gray">{e.time}</p>
              </div>
              <Link
                href={e.ctaHref}
                className="shrink-0 rounded-lg bg-sx-green px-3 py-1.5 text-[11px] font-bold text-white hover:opacity-90"
              >
                {e.ctaLabel}
              </Link>
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Build check**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 7: Commit**

```bash
git add lib/community/upcoming-events-query.ts lib/community/upcoming-events-query.test.ts components/community/UpcomingEventsWidget.tsx
git commit -m "feat(community): add Upcoming Tournaments widget (events adapter seam)"
```

---

### Task 6: Community Gallery

**Files:**
- Create: `lib/community/gallery-query.ts`
- Test: `lib/community/gallery-query.test.ts`
- Create: `components/community/CommunityGallery.tsx`

**Interfaces:**
- Produces: `GalleryItem { id: string; imageUrl: string; caption: string; authorName: string }`, `truncateCaption(content: string, max?: number): string`, `fetchCommunityGallery(limit?: number): Promise<GalleryItem[]>`, `CommunityGallery({ items: GalleryItem[] })`.

- [ ] **Step 1: Write the failing test for `truncateCaption`**

```ts
// lib/community/gallery-query.test.ts
import { describe, it, expect } from 'vitest'
import { truncateCaption } from './gallery-query'

describe('truncateCaption', () => {
  it('returns short content unchanged', () => {
    expect(truncateCaption('Epic goal!')).toBe('Epic goal!')
  })

  it('truncates long content with an ellipsis at the max length', () => {
    const long = 'This is a really long post caption that goes well past the default limit'
    expect(truncateCaption(long, 20)).toBe('This is a really lo…')
  })

  it('trims trailing whitespace before adding the ellipsis', () => {
    expect(truncateCaption('word word word word', 10)).toBe('word word…')
  })

  it('trims surrounding whitespace on short content too', () => {
    expect(truncateCaption('  padded  ')).toBe('padded')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/community/gallery-query.test.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Write the query module**

```ts
// lib/community/gallery-query.ts
import { createClient } from '@/lib/supabase/server'

export interface GalleryItem {
  id: string
  imageUrl: string
  caption: string
  authorName: string
}

export function truncateCaption(content: string, max = 40): string {
  const trimmed = content.trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max).trimEnd()}…`
}

type AuthorRef =
  | { display_name: string | null; username: string | null }
  | { display_name: string | null; username: string | null }[]
  | null
function authorName(a: AuthorRef): string {
  const p = Array.isArray(a) ? (a[0] ?? null) : a
  return p?.display_name ?? p?.username ?? 'A player'
}

// Most recent posts (any post_type) that have an image, captioned by author +
// truncated content. No video overlay/duration badge — Sentinel X doesn't
// store video (spec §4.7); YouTube embeds live only on Match Centre.
export async function fetchCommunityGallery(limit = 8): Promise<GalleryItem[]> {
  const supabase = createClient()
  const { data } = await supabase
    .from('community_posts')
    .select('id, content, image_url, author:profiles!community_posts_author_id_fkey(display_name, username)')
    .eq('is_deleted', false)
    .not('image_url', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit)

  return (data ?? []).map((row) => ({
    id: row.id,
    imageUrl: row.image_url as string,
    caption: truncateCaption(row.content),
    authorName: authorName(row.author as AuthorRef),
  }))
}
```

- [ ] **Step 4: Run the test again to verify it passes**

Run: `npx vitest run lib/community/gallery-query.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the gallery component**

```tsx
// components/community/CommunityGallery.tsx
import type { GalleryItem } from '@/lib/community/gallery-query'

export function CommunityGallery({ items }: { items: GalleryItem[] }) {
  if (items.length === 0) return null
  return (
    <div className="rounded-2xl border border-sx-border bg-sx-surface p-5">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-white">Community Gallery</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {items.map((item) => (
          <div key={item.id} className="overflow-hidden rounded-xl border border-sx-border">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.imageUrl} alt={item.caption} className="h-28 w-full object-cover" />
            <div className="bg-sx-bg p-2">
              <p className="truncate text-[11px] font-semibold text-white">{item.caption}</p>
              <p className="text-[10px] text-sx-gray">By {item.authorName}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Build check**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 7: Commit**

```bash
git add lib/community/gallery-query.ts lib/community/gallery-query.test.ts components/community/CommunityGallery.tsx
git commit -m "feat(community): add Community Gallery (real posts with images)"
```

---

### Task 7: Quick-action tiles + Official Community Servers card

**Files:**
- Create: `components/community/QuickActionTiles.tsx`
- Create: `components/community/CommunityServersCard.tsx`

**Interfaces:**
- Produces: `QuickActionTiles()` (no props — anchors `#feed` and `#new-post-launcher` are wired by Task 9's page structure), `CommunityServersCard({ whatsappUrl: string })`.

- [ ] **Step 1: Write the quick-action tiles**

```tsx
// components/community/QuickActionTiles.tsx
import Link from 'next/link'

// "Find Teammates" (mockup) → relabeled "Find Friends" and points at the
// real /dashboard/friends flow — that destination is the player's existing
// circle, not a stranger-discovery tool, so the label is changed to match
// what it actually does rather than routing to a coming-soon page (spec
// review decision, 2026-08-16). "Create Team" has no backing feature (teams
// are a v4 roadmap item) and goes to /coming-soon.
const TILES = [
  { label: 'Find Friends', icon: '🤝', href: '/dashboard/friends' },
  { label: 'Create Team', icon: '👥', href: '/coming-soon?feature=Teams' },
  { label: 'Join Discussions', icon: '💬', href: '#feed' },
  { label: 'Share Content', icon: '📤', href: '#new-post-launcher' },
  { label: 'Get Help', icon: '❓', href: '/coming-soon?feature=Help+Center' },
]

export function QuickActionTiles() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {TILES.map((t) => (
        <Link
          key={t.label}
          href={t.href}
          className="flex flex-col items-center gap-1.5 rounded-xl border border-sx-border bg-sx-surface px-3 py-4 text-center transition-colors hover:border-sx-purple/40 hover:bg-sx-purple/10"
        >
          <span className="text-xl">{t.icon}</span>
          <span className="text-xs font-semibold text-white">{t.label}</span>
        </Link>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Write the community servers card**

```tsx
// components/community/CommunityServersCard.tsx
const DISCORD_URL = process.env.NEXT_PUBLIC_DISCORD_URL ?? '#'
const TELEGRAM_URL = process.env.NEXT_PUBLIC_TELEGRAM_URL ?? '#'

// Live per-platform member counts from the mockup (5,610 / 3,214 / 2,145)
// are dropped — no honest source for them (spec §4.6). Discord reuses the
// same env var as SiteFooter; WhatsApp reuses the whatsappUrl already
// threaded through the header/page; Telegram is a new env var following the
// same `?? '#'` fallback pattern as the other social links.
export function CommunityServersCard({ whatsappUrl }: { whatsappUrl: string }) {
  const servers = [
    { name: 'Discord Server', href: DISCORD_URL, icon: '🎮' },
    { name: 'WhatsApp Community', href: whatsappUrl, icon: '💬' },
    { name: 'Telegram Channel', href: TELEGRAM_URL, icon: '✈️' },
  ]
  return (
    <div className="rounded-2xl border border-sx-border bg-sx-surface p-5">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-white">Our Official Community Servers</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {servers.map((s) => (
          <div key={s.name} className="flex items-center justify-between rounded-xl border border-sx-border bg-sx-bg p-3">
            <span className="flex items-center gap-2 text-sm font-semibold text-white">
              <span className="text-lg" aria-hidden>
                {s.icon}
              </span>
              {s.name}
            </span>
            <a
              href={s.href}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 rounded-lg bg-sx-purple px-3 py-1.5 text-xs font-bold text-white hover:bg-sx-purple-light"
            >
              Join
            </a>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Build check**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add components/community/QuickActionTiles.tsx components/community/CommunityServersCard.tsx
git commit -m "feat(community): add quick-action tiles and community servers card"
```

---

### Task 8: Hero + footer CTA (static content, missing-asset placeholder)

**Files:**
- Create: `components/community/CommunityHero.tsx`
- Create: `components/community/CommunityFooterCta.tsx`

**Interfaces:**
- Consumes: `findOptionalPublicImage` from `lib/media/optional-image.ts`, `ImagePlaceholder` from `components/ui/ImagePlaceholder.tsx`.
- Produces: `CommunityHero()`, `CommunityFooterCta()`.

Sentinel X has no mascot pose matching the mockup's community hero (a hoodie'd character pointing at camera) — `public/mascot/` has named poses only for home/tournaments/games/leaderboards/about/bubble. Per the project's "exact replica" rule, this reserves the slot with `findOptionalPublicImage('mascot', 'mascot-community')` (auto-picks up the real file the moment it's dropped in, no code change needed) falling back to `ImagePlaceholder`.

- [ ] **Step 1: Write the hero component**

```tsx
// components/community/CommunityHero.tsx
import Image from 'next/image'
import Link from 'next/link'
import { findOptionalPublicImage } from '@/lib/media/optional-image'
import { ImagePlaceholder } from '@/components/ui/ImagePlaceholder'

export function CommunityHero() {
  const mascotUrl = findOptionalPublicImage('mascot', 'mascot-community')

  return (
    <div className="relative overflow-hidden rounded-2xl border border-sx-purple/30 bg-gradient-to-br from-sx-purple/25 via-sx-surface to-sx-bg p-6 sm:p-8">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-10 h-56 w-56 rounded-full bg-sx-purple/25 blur-[80px]"
      />
      <div className="relative grid gap-6 lg:grid-cols-[1fr_220px_260px]">
        <div className="lg:col-span-1">
          <p className="text-xs font-bold uppercase tracking-widest text-sx-purple-text">Community</p>
          <h1 className="mt-1 font-display text-3xl font-black uppercase leading-tight text-white sm:text-4xl">
            One Community.
            <br />
            <span className="text-sx-purple-text">Many Champions.</span>
          </h1>
          <p className="mt-2 max-w-md text-sm text-sx-gray">
            Connect. Compete. Grow together. Sentinel X is more than gaming, it&apos;s a family.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              href="#new-post-launcher"
              className="rounded-lg bg-sx-purple px-5 py-2.5 text-sm font-bold text-white hover:bg-sx-purple-light"
            >
              Join the Community
            </Link>
            <Link
              href="/coming-soon?feature=Community+Rules"
              className="rounded-lg border border-sx-border px-5 py-2.5 text-sm font-bold text-white hover:border-sx-purple/40"
            >
              Community Rules
            </Link>
          </div>
        </div>

        {mascotUrl ? (
          <Image
            src={mascotUrl}
            alt="Sentinel X mascot"
            width={220}
            height={260}
            className="mx-auto h-56 w-auto object-contain lg:mx-0 lg:h-full"
          />
        ) : (
          <ImagePlaceholder
            className="h-56 lg:h-full"
            label={'Sentinel mascot — pointing-at-camera pose\n(public/mascot/mascot-community.png)'}
          />
        )}

        <div className="rounded-xl border border-sx-purple/30 bg-sx-bg/60 p-4">
          <p className="text-sm font-bold text-white">Hey Gamer! 👋</p>
          <p className="mt-1 text-xs text-sx-gray">
            This is your space. Share, learn, compete and grow with gamers around the world.
          </p>
          <ul className="mt-3 space-y-1.5 text-xs text-sx-gray">
            <li>🤝 Make friends</li>
            <li>👥 Find teammates</li>
            <li>💬 Share strategies</li>
            <li>🔔 Stay updated</li>
            <li>🏆 Win together</li>
          </ul>
          <p className="mt-3 text-xs font-semibold text-sx-purple-text">Stronger together. Unstoppable forever. 💜</p>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Write the footer CTA component**

```tsx
// components/community/CommunityFooterCta.tsx
import Link from 'next/link'

export function CommunityFooterCta() {
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-sx-purple/30 bg-gradient-to-r from-sx-purple/20 via-sx-surface to-sx-purple/10 p-6 text-center sm:flex-row sm:justify-between sm:text-left">
      <div>
        <p className="font-display text-lg font-black text-white">Be active. Be positive. Be legendary.</p>
        <p className="text-sm text-sx-gray">Your journey starts here. The community is waiting for you!</p>
      </div>
      <Link
        href="#new-post-launcher"
        className="shrink-0 rounded-lg bg-sx-purple px-5 py-2.5 text-sm font-bold text-white hover:bg-sx-purple-light"
      >
        Join the Community
      </Link>
    </div>
  )
}
```

- [ ] **Step 3: Build check**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add components/community/CommunityHero.tsx components/community/CommunityFooterCta.tsx
git commit -m "feat(community): add hero and footer CTA (mascot slot reserved, missing asset)"
```

---

### Task 9: Restructure `/community` page

**Files:**
- Modify: `app/(public)/community/page.tsx`
- Modify: `components/community/PostCard.tsx`

**Interfaces:**
- Consumes: everything produced by Tasks 3–8, plus the existing `fetchFeedPage`, `fetchChallengeWidget`, `fetchBestPlayBanner`, `NewPostLauncher`, `FeedList`, `ChallengeWidget`, `BestPlayBanner` (all unchanged).

- [ ] **Step 1: Rewrite the page**

```tsx
// app/(public)/community/page.tsx
import { createClient } from '@/lib/supabase/server'
import { fetchFeedPage } from '@/lib/community/feed-query'
import { fetchChallengeWidget } from '@/lib/community/challenge-query'
import { fetchBestPlayBanner } from '@/lib/community/best-play-query'
import { fetchCommunityStats } from '@/lib/community/stats-query'
import { fetchTopCommunityMembers } from '@/lib/community/top-members-query'
import { fetchUpcomingCommunityEvents } from '@/lib/community/upcoming-events-query'
import { fetchCommunityGallery } from '@/lib/community/gallery-query'
import { NewPostLauncher } from '@/components/community/NewPostLauncher'
import type { ViewerProfile as ComposerViewer } from '@/components/community/PostComposer'
import { FeedList } from '@/components/community/FeedList'
import { ChallengeWidget } from '@/components/community/ChallengeWidget'
import { BestPlayBanner } from '@/components/community/BestPlayBanner'
import { CommunityHero } from '@/components/community/CommunityHero'
import { CommunityStatsBar } from '@/components/community/CommunityStatsBar'
import { QuickActionTiles } from '@/components/community/QuickActionTiles'
import { TopMembersWidget } from '@/components/community/TopMembersWidget'
import { UpcomingEventsWidget } from '@/components/community/UpcomingEventsWidget'
import { CommunityServersCard } from '@/components/community/CommunityServersCard'
import { CommunityGallery } from '@/components/community/CommunityGallery'
import { CommunityFooterCta } from '@/components/community/CommunityFooterCta'
import { buildMetadata } from '@/lib/seo/metadata'
import { DEFAULT_OG_IMAGE } from '@/lib/seo/site'

const PAGE_SIZE = 20
const WHATSAPP_COMMUNITY = process.env.NEXT_PUBLIC_WHATSAPP_COMMUNITY_URL ?? '#'

export const revalidate = 60

export const metadata = buildMetadata({
  title: 'Community Feed — Sentinel X',
  description:
    "The heartbeat of SentinelX — match results, achievements, and banter from Nigeria's mobile esports community.",
  path: '/community',
  image: DEFAULT_OG_IMAGE,
})

export default async function CommunityPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const viewerId = user?.id ?? null

  const [
    { pinned, posts, hasMore },
    challengeWidget,
    bestPlay,
    viewerProfile,
    stats,
    topMembers,
    upcomingEvents,
    gallery,
  ] = await Promise.all([
    fetchFeedPage({ offset: 0, limit: PAGE_SIZE, viewerId }),
    fetchChallengeWidget(viewerId),
    fetchBestPlayBanner(viewerId),
    fetchComposerViewer(viewerId),
    fetchCommunityStats(),
    fetchTopCommunityMembers(5),
    fetchUpcomingCommunityEvents(3),
    fetchCommunityGallery(8),
  ])

  return (
    <div className="mx-auto max-w-6xl px-4 pb-20">
      <div className="py-6">
        <CommunityHero />
      </div>

      <div className="mb-6">
        <CommunityStatsBar stats={stats} />
      </div>

      <div className="mb-6">
        <QuickActionTiles />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div id="feed" className="min-w-0">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-xl font-black text-white">Community Feed</h2>
            <div id="new-post-launcher">
              <NewPostLauncher viewer={viewerProfile} />
            </div>
          </div>
          {bestPlay && (
            <BestPlayBanner
              nominations={bestPlay.nominations}
              myVoteNominationId={bestPlay.myVoteNominationId}
              loggedIn={!!viewerId}
            />
          )}
          <div className="mb-4 lg:hidden">
            {challengeWidget && <ChallengeWidget weekLabel={challengeWidget.weekLabel} challenges={challengeWidget.challenges} />}
          </div>
          <FeedList pinned={pinned} initialPosts={posts} initialHasMore={hasMore} loggedIn={!!viewerId} />
        </div>
        <div className="hidden space-y-4 lg:block">
          <TopMembersWidget members={topMembers} />
          {challengeWidget && <ChallengeWidget weekLabel={challengeWidget.weekLabel} challenges={challengeWidget.challenges} />}
          <UpcomingEventsWidget events={upcomingEvents} />
        </div>
      </div>

      <div className="mt-6">
        <CommunityServersCard whatsappUrl={WHATSAPP_COMMUNITY} />
      </div>
      <div className="mt-6">
        <CommunityGallery items={gallery} />
      </div>
      <div className="mt-6">
        <CommunityFooterCta />
      </div>
    </div>
  )
}

async function fetchComposerViewer(viewerId: string | null): Promise<ComposerViewer | null> {
  if (!viewerId) return null
  const supabase = createClient()
  const { data } = await supabase
    .from('profiles')
    .select('avatar_url, username, display_name, membership_tier')
    .eq('id', viewerId)
    .maybeSingle()
  if (!data) return null
  return { avatarUrl: data.avatar_url, username: data.username, displayName: data.display_name, membershipTier: data.membership_tier }
}
```

- [ ] **Step 2: Tighten `PostCard`'s outer padding to match the mockup's card density**

```tsx
// components/community/PostCard.tsx
// change the outer div's className from:
//   `rounded-2xl border bg-sx-surface p-4 ${isAchievement ? 'border-amber-500/30' : 'border-sx-border'}`
// to:
```

```tsx
    <div className={`rounded-2xl border bg-sx-surface p-4 sm:p-5 ${isAchievement ? 'border-amber-500/30' : 'border-sx-border'}`}>
```

- [ ] **Step 3: Build check**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Manual check**

Run: `npm run dev`, open `http://localhost:3000/community` logged out and logged in. Confirm: hero renders (placeholder box if no mascot asset), stats bar shows real numbers, quick tiles route correctly (`Find Friends` → `/dashboard/friends`, `Share Content` scroll-anchors to the New Post button), feed still works with reactions, sidebar shows Top Members / Challenges / Upcoming Tournaments, servers card + gallery + footer CTA render.

- [ ] **Step 5: Commit**

```bash
git add app/\(public\)/community/page.tsx components/community/PostCard.tsx
git commit -m "feat(community): restructure /community page with hero, stats, sidebar widgets"
```

---

### Task 10: Wallet — referral earnings card + withdrawal status panel

**Files:**
- Create: `components/wallet/ReferralEarningsCard.tsx`
- Create: `components/wallet/WithdrawalStatusPanel.tsx`

**Interfaces:**
- Consumes: `formatNaira` from `lib/format.ts`, `maskAccountNumber` from `lib/kyc/logic.ts`.
- Produces: `ReferralEarningsCard({ referralLink: string; totalReferrals: number; totalEarned: number })`, `WithdrawalStatusPanel({ linkedBankName: string | null; linkedAccountNumber: string | null; linkedAccountName: string | null; availableToWithdraw: number })`.

- [ ] **Step 1: Write the referral earnings card**

Verified against `components/dashboard/ReferralPanel.tsx`: it only ever renders a referral **count** + copyable link + a static "₦100 each" rate line — it does not compute a cumulative total, so it can't be reused as-is for the mockup's "Total Earned" figure (spec §3 review correction). This new sidebar card sources `totalEarned` from the wallet page's own `breakdown.referral` (real `wallet_transactions` sum, already computed by `summarizeEarningsByCategory` — see Task 11), not from `ReferralPanel`.

```tsx
// components/wallet/ReferralEarningsCard.tsx
'use client'
import { useState } from 'react'
import Link from 'next/link'
import { formatNaira } from '@/lib/format'

export function ReferralEarningsCard({
  referralLink,
  totalReferrals,
  totalEarned,
}: {
  referralLink: string
  totalReferrals: number
  totalEarned: number
}) {
  const [copied, setCopied] = useState(false)
  function copyLink() {
    navigator.clipboard.writeText(referralLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div className="rounded-2xl border border-sx-border bg-sx-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-black uppercase tracking-widest text-sx-white">Referral Earnings</h2>
        <Link href="/dashboard/referrals" className="text-[11px] font-semibold text-sx-purple-text hover:text-sx-purple-light">
          View All →
        </Link>
      </div>
      <div className="flex items-center justify-between text-sm">
        <div>
          <p className="text-[10px] uppercase text-sx-gray">Total Referrals</p>
          <p className="font-display text-lg font-black text-white">{totalReferrals}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase text-sx-gray">Total Earned</p>
          <p className="font-display text-lg font-black text-emerald-400">{formatNaira(totalEarned)}</p>
        </div>
      </div>
      <p className="mt-3 text-[11px] text-sx-gray">Your Referral Link</p>
      <div className="mt-1 flex items-center gap-2">
        <code className="flex-1 truncate rounded-lg bg-sx-bg px-2.5 py-1.5 text-[11px] text-sx-gray">{referralLink}</code>
        <button
          type="button"
          onClick={copyLink}
          className="shrink-0 rounded-lg bg-sx-purple px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-sx-purple-light"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <p className="mt-2 text-[11px] text-sx-gray">Earn ₦100 from every referral&apos;s tournament entry.</p>
    </div>
  )
}
```

- [ ] **Step 2: Write the withdrawal status panel**

Sourced from `player_kyc` (the actual table the payment-methods page reads — not a `payment_methods` table).

```tsx
// components/wallet/WithdrawalStatusPanel.tsx
import Link from 'next/link'
import { formatNaira } from '@/lib/format'
import { maskAccountNumber } from '@/lib/kyc/logic'

export function WithdrawalStatusPanel({
  linkedBankName,
  linkedAccountNumber,
  linkedAccountName,
  availableToWithdraw,
}: {
  linkedBankName: string | null
  linkedAccountNumber: string | null
  linkedAccountName: string | null
  availableToWithdraw: number
}) {
  return (
    <div className="rounded-2xl border border-sx-border bg-sx-surface p-5">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-white">Withdrawal</h2>
      {linkedBankName && linkedAccountNumber ? (
        <div className="rounded-xl border border-sx-border bg-sx-bg p-3 text-sm">
          <p className="text-white">
            🏦 {linkedBankName} {maskAccountNumber(linkedAccountNumber)}
          </p>
          <p className="text-xs text-sx-gray">{linkedAccountName}</p>
          <span className="mt-1 inline-block text-xs font-semibold text-emerald-400">Verified ✅</span>
        </div>
      ) : (
        <p className="rounded-xl border border-sx-border bg-sx-bg p-3 text-sm text-sx-gray">
          No linked account yet.{' '}
          <Link href="/dashboard/wallet/payment-methods" className="font-semibold text-sx-purple-text hover:text-sx-purple-light">
            Add one →
          </Link>
        </p>
      )}
      <p className="mt-3 text-xs text-sx-gray">Available to Withdraw</p>
      <p className="font-display text-2xl font-black text-white">{formatNaira(availableToWithdraw)}</p>
      <Link
        href="/dashboard/wallet/withdraw"
        className="mt-3 block rounded-lg bg-sx-purple px-4 py-2.5 text-center text-sm font-bold text-white hover:bg-sx-purple-light"
      >
        Request Withdrawal
      </Link>
      <p className="mt-2 text-[11px] text-sx-gray">Withdrawals are processed within 24 hours.</p>
    </div>
  )
}
```

- [ ] **Step 3: Build check**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add components/wallet/ReferralEarningsCard.tsx components/wallet/WithdrawalStatusPanel.tsx
git commit -m "feat(wallet): add referral earnings card and withdrawal status panel"
```

---

### Task 11: Restructure `/dashboard/wallet` page

**Files:**
- Modify: `app/dashboard/wallet/page.tsx`

**Interfaces:**
- Consumes: `ReferralEarningsCard`, `WithdrawalStatusPanel` (Task 10), all existing wallet components/queries unchanged.

- [ ] **Step 1: Rewrite the page to fetch `player_kyc` + referral count, and wire the two new cards**

```tsx
// app/dashboard/wallet/page.tsx
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { BalanceHeroCard } from '@/components/wallet/BalanceHeroCard'
import { QuickActionsRow } from '@/components/wallet/QuickActionsRow'
import { EarningsOverview } from '@/components/wallet/EarningsOverview'
import { RecentTransactionsList } from '@/components/wallet/RecentTransactionsList'
import { WalletSecurityBadges } from '@/components/wallet/WalletSecurityBadges'
import { RewardsProgressWidget } from '@/components/wallet/RewardsProgressWidget'
import { ReferralEarningsCard } from '@/components/wallet/ReferralEarningsCard'
import { WithdrawalStatusPanel } from '@/components/wallet/WithdrawalStatusPanel'
import { mapTransactionRows, type RawWalletTxnRow } from '@/lib/wallet/transactions'
import { monthOverMonthChange } from '@/lib/wallet/earnings-trend'
import { summarizeEarningsByCategory } from '@/lib/wallet/breakdown'

export const metadata: Metadata = {
  title: 'Wallet · SentinelX Esports',
  robots: { index: false, follow: false },
}

export default async function WalletOverviewPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/dashboard/wallet')

  const admin = createAdminClient()
  const [walletRes, allTxnRes, pendingWithdrawalsRes, profileRes, kycRes, referralsRes] = await Promise.all([
    admin.from('wallets').select('balance').eq('player_id', user.id).maybeSingle(),
    admin
      .from('wallet_transactions')
      .select('id, type, category, amount, reference_id, note, created_at')
      .eq('player_id', user.id)
      .order('created_at', { ascending: false }),
    admin.from('withdrawal_requests').select('id, amount, status').eq('player_id', user.id).eq('status', 'pending'),
    admin.from('profiles').select('xp, kyc_verified, username').eq('id', user.id).maybeSingle(),
    admin
      .from('player_kyc')
      .select('payout_bank_name, payout_account_number, payout_account_name')
      .eq('player_id', user.id)
      .maybeSingle(),
    admin.from('referrals').select('id', { count: 'exact', head: true }).eq('referrer_id', user.id),
  ])

  const allTxnRows = (allTxnRes.data ?? []) as RawWalletTxnRow[]
  const pendingWithdrawalTotal = (pendingWithdrawalsRes.data ?? []).reduce((sum, r) => sum + r.amount, 0)

  // Every withdrawal-status lookup this page needs is for the player's own
  // rows — fetch withdrawal_requests statuses by id for the recent-5 slice only.
  const recentRaw = allTxnRows.slice(0, 5)
  const withdrawalRequestIds = recentRaw.flatMap((r) => (r.type === 'withdrawal_request' && r.reference_id ? [r.reference_id] : []))
  const { data: wrRows } =
    withdrawalRequestIds.length > 0
      ? await admin.from('withdrawal_requests').select('id, status').in('id', withdrawalRequestIds)
      : { data: [] as { id: string; status: string }[] }
  const withdrawalStatusById = new Map((wrRows ?? []).map((r) => [r.id, r.status]))
  const recentTransactions = mapTransactionRows(recentRaw, withdrawalStatusById)

  const breakdown = summarizeEarningsByCategory(allTxnRows)
  const tournamentPrizeTrendPct = monthOverMonthChange(allTxnRows, 'tournament_prize', new Date())
  const balance = walletRes.data?.balance ?? 0
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sentinelx.gg'

  return (
    <>
      <BalanceHeroCard balance={balance} pendingWithdrawal={pendingWithdrawalTotal} />
      <QuickActionsRow />
      <EarningsOverview
        tournamentPrize={breakdown.tournament_prize ?? 0}
        tournamentPrizeTrendPct={tournamentPrizeTrendPct}
        referral={breakdown.referral ?? 0}
        bonus={breakdown.bonus ?? 0}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <RecentTransactionsList transactions={recentTransactions} />
        </div>
        <WithdrawalStatusPanel
          linkedBankName={kycRes.data?.payout_bank_name ?? null}
          linkedAccountNumber={kycRes.data?.payout_account_number ?? null}
          linkedAccountName={kycRes.data?.payout_account_name ?? null}
          availableToWithdraw={balance}
        />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <ReferralEarningsCard
          referralLink={`${siteUrl}/signup?ref=${profileRes.data?.username ?? ''}`}
          totalReferrals={referralsRes.count ?? 0}
          totalEarned={breakdown.referral ?? 0}
        />
        <RewardsProgressWidget xp={profileRes.data?.xp ?? 0} />
        <WalletSecurityBadges kycVerified={profileRes.data?.kyc_verified ?? false} />
      </div>
    </>
  )
}
```

- [ ] **Step 2: Build check**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Manual check**

Run: `npm run dev`, log in, open `/dashboard/wallet`. Confirm: balance hero, quick actions, earnings grid unchanged in behavior; new withdrawal panel shows the linked bank (or "Add one →" if none); referral card shows real count + real ₦ total + working copy button.

- [ ] **Step 4: Commit**

```bash
git add app/dashboard/wallet/page.tsx
git commit -m "feat(wallet): restructure overview page with referral + withdrawal cards"
```

---

### Task 12: Wallet visual pass — hero mascot slot, sidebar icons, card polish

**Files:**
- Modify: `components/wallet/BalanceHeroCard.tsx`
- Modify: `lib/wallet/nav.ts`
- Modify: `components/wallet/WalletSidebar.tsx`

**Interfaces:**
- Consumes: `findOptionalPublicImage`, `ImagePlaceholder` (same pattern as Task 8).
- Produces: `WalletNavItem.icon: string` (new field, consumed by `WalletSidebar`).

- [ ] **Step 1: Reserve the wallet hero mascot slot**

The mockup's wallet hero shows a mascot holding a phone/tablet — no matching pose exists in `public/mascot/`. Same missing-asset pattern as Task 8.

```tsx
// components/wallet/BalanceHeroCard.tsx
'use client'
import { useState } from 'react'
import Image from 'next/image'
import { formatNaira } from '@/lib/format'
import { findOptionalPublicImage } from '@/lib/media/optional-image'
import { ImagePlaceholder } from '@/components/ui/ImagePlaceholder'

// Balance = wallets.balance directly — already net of any pending
// withdrawal debit (debitWallet subtracts at request time, not at payout).
// See plan Global Constraints for why this isn't "Total − Pending".
export function BalanceHeroCard({ balance, pendingWithdrawal }: { balance: number; pendingWithdrawal: number }) {
  const [hidden, setHidden] = useState(false)
  const mascotUrl = findOptionalPublicImage('mascot', 'mascot-wallet')

  return (
    <div className="relative overflow-hidden rounded-2xl border border-sx-purple/50 bg-gradient-to-r from-sx-purple/30 via-sx-surface to-sx-purple/10 p-6">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-6 -bottom-6 h-40 w-40 rounded-full bg-sx-purple/20 blur-[60px]"
      />
      <div className="relative grid gap-4 sm:grid-cols-[1fr_120px]">
        <div>
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-widest text-sx-gray">Total Balance</p>
            <button
              type="button"
              onClick={() => setHidden((h) => !h)}
              className="text-sx-gray hover:text-white"
              aria-label={hidden ? 'Show balance' : 'Hide balance'}
            >
              {hidden ? '🙈' : '👁'}
            </button>
          </div>
          <p className="mt-1 font-display text-5xl font-black text-white">{hidden ? '••••••' : formatNaira(balance)}</p>
          <span className="mt-2 inline-block rounded-full border border-emerald-500/30 bg-emerald-500/20 px-2.5 py-0.5 text-[11px] font-bold text-emerald-400">
            Available Balance
          </span>
          {pendingWithdrawal > 0 && (
            <p className="mt-2 text-sm text-amber-400">
              ⏳ {formatNaira(pendingWithdrawal)} pending withdrawal — processed within 24 hours
            </p>
          )}
        </div>
        {mascotUrl ? (
          <Image src={mascotUrl} alt="Sentinel X mascot" width={120} height={140} className="hidden h-full w-auto object-contain sm:block" />
        ) : (
          <ImagePlaceholder
            className="hidden h-full sm:flex"
            label={'Sentinel mascot — holding phone/tablet pose\n(public/mascot/mascot-wallet.png)'}
          />
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add icons to the wallet nav items**

```ts
// lib/wallet/nav.ts
export interface WalletNavItem {
  label: string
  href: string
  locked: boolean
  icon: string
}

export const WALLET_NAV_ITEMS: WalletNavItem[] = [
  { label: 'Overview', href: '/dashboard/wallet', locked: false, icon: '📊' },
  { label: 'Transactions', href: '/dashboard/wallet/transactions', locked: false, icon: '🧾' },
  { label: 'Deposit', href: '/dashboard/wallet/deposit', locked: false, icon: '⬇' },
  { label: 'Withdraw', href: '/dashboard/wallet/withdraw', locked: false, icon: '⬆' },
  { label: 'Payment Methods', href: '/dashboard/wallet/payment-methods', locked: false, icon: '💳' },
  { label: 'Transfer', href: '/dashboard/wallet/transfer', locked: true, icon: '↔' },
  { label: 'Rewards', href: '/dashboard/wallet/rewards', locked: true, icon: '🎁' },
  { label: 'Referrals', href: '/dashboard/wallet/referrals', locked: true, icon: '👥' },
]
```

- [ ] **Step 3: Run the existing nav test to make sure the shape change doesn't break it**

Run: `npx vitest run lib/wallet/nav.test.ts`
Expected: PASS — inspect the file first; if it asserts on exact object equality including missing fields, it already reads `WALLET_NAV_ITEMS` by reference so the new `icon` field won't break `.label`/`.href`/`.locked` assertions.

- [ ] **Step 4: Render icons + an eyebrow label in the sidebar**

```tsx
// components/wallet/WalletSidebar.tsx
'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { WALLET_NAV_ITEMS } from '@/lib/wallet/nav'

export function WalletSidebar() {
  const pathname = usePathname()
  return (
    <div className="sm:w-48 sm:shrink-0">
      <p className="mb-2 hidden text-[11px] font-bold uppercase tracking-widest text-sx-purple-text sm:block">Wallet</p>
      <nav className="flex gap-2 overflow-x-auto scrollbar-hide sm:flex-col sm:gap-1">
        {WALLET_NAV_ITEMS.map((item) => {
          const active = pathname === item.href
          if (item.locked) {
            return (
              <span
                key={item.href}
                aria-disabled
                title="Coming in a future update"
                className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm text-sx-gray opacity-50"
              >
                <span aria-hidden>🔒</span> {item.label}
              </span>
            )
          }
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                active ? 'bg-sx-purple/20 text-sx-purple-text' : 'text-sx-gray hover:text-white'
              }`}
            >
              <span aria-hidden>{item.icon}</span> {item.label}
            </Link>
          )
        })}
        <Link
          href="/dashboard#profile"
          className="shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-sm text-sx-gray hover:text-white"
        >
          Settings
        </Link>
      </nav>
    </div>
  )
}
```

- [ ] **Step 5: Build check**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 6: Commit**

```bash
git add components/wallet/BalanceHeroCard.tsx lib/wallet/nav.ts components/wallet/WalletSidebar.tsx
git commit -m "feat(wallet): reserve hero mascot slot, add sidebar icons"
```

---

### Task 13: Final integration pass

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npm run test`
Expected: all existing tests plus the new ones from Tasks 4/5/6 pass.

- [ ] **Step 2: Full build**

Run: `npm run build`
Expected: succeeds with no type errors.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no new errors (existing `@next/next/no-img-element` disables already used elsewhere in the codebase, so `CommunityGallery`'s `<img>` follows the same established exception).

- [ ] **Step 4: Manual visual QA against both reference screenshots**

Run: `npm run dev`. Compare `/community` and `/dashboard/wallet` against the two supplied mockups at desktop width and at 375px (mobile). Confirm: header balance chips show/hide correctly logged out vs. in; reaction buttons on the feed still work exactly as before; every quick-action tile and sidebar CTA routes somewhere real (no dead links); gallery/servers card degrade gracefully with zero posts/zero env vars set.

- [ ] **Step 5: Commit (if the manual pass turned up any fixes)**

```bash
git add -A
git commit -m "fix: address visual QA findings from community/wallet redesign pass"
```

(Skip this commit if the manual pass found nothing to fix.)

---

## Self-Review Notes

**Spec coverage:** §2 header chips → Tasks 1–2. §3 wallet (mostly visual, referral/withdrawal cards) → Tasks 10–12. §4.1 hero → Task 8. §4.2 stats → Task 3. §4.3 quick tiles → Task 7. §4.4 feed → Task 9 (reuses existing components unchanged, PostCard padding tweak). §4.5 sidebar (top members, challenge widget reuse, upcoming events adapter) → Tasks 4, 5, 9. §4.6 servers → Task 7. §4.7 gallery → Task 6. §4.8 footer CTA → Task 8. §5 testing → pure-function tests included in Tasks 4/5/6, manual passes in Tasks 9/11/13. §6 out of scope → respected throughout (no coin-economy touches, no events table, no live server member counts, no new post-category taxonomy, no teams concept).

**Type consistency check:** `TopMemberView`, `UpcomingEventItem`, `GalleryItem`, `CommunityStats` are each defined once (Tasks 3/4/5/6) and consumed with matching field names in their respective widgets and in Task 9's page. `WalletNavItem.icon` (Task 12) is additive, doesn't break `lib/wallet/nav.test.ts`'s existing assertions on `label`/`href`/`locked`. `NavSession.walletBalance`/`coinBalance` (Task 1) are consumed with matching names in `BalanceChips` (Task 2).
