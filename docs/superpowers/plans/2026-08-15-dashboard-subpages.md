# Dashboard Subpage Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/dashboard` from a single long list-page into a lean Overview + a set of focused subpages, per `docs/superpowers/specs/2026-08-15-dashboard-subpages-design.md`.

**Architecture:** A shared `DashboardShell` component (sidebar + content area) that every dashboard page — Overview and the six new subpages, plus the existing Friendlies list page — wraps itself in explicitly. Each page keeps its own `Promise.all` scoped to only what it renders. Existing components move unchanged; only the query slicing and page shells are new.

**Tech Stack:** Next.js 14 App Router (Server Components by default), TypeScript, Tailwind, Supabase, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-15-dashboard-subpages-design.md` — read alongside this plan; the one deviation from it is explained below.

## Global Constraints

- **`DashboardShell` is a plain React component, not a Next.js `layout.tsx`.** The spec's §2/§3 describe "`app/dashboard/layout.tsx` — shared shell," but a real layout file at that path would apply to *every* nested route under `/dashboard`, including `app/dashboard/wallet/*` — which already has its own `app/dashboard/wallet/layout.tsx` with `WalletSidebar`. That would nest the new Dashboard sidebar around the existing Wallet sidebar on every wallet page. Building the shell as a component each page imports and wraps around its own content sidesteps this entirely: Overview, the six new subpages, and the existing `/dashboard/friendlies` list page all opt in; `/dashboard/wallet/*` and `/dashboard/friendlies/[id]` (a focused match-room UI, not a browsing page — same reasoning as why Match Centre pages don't carry a dashboard sidebar) are untouched.
- **`hasSubmittableMatch`** (drives the Quick Actions "Submit Result" vs "My Matches" label) needs its own minimal query on Overview, not the full fixtures fetch (now on `/dashboard/matches`) and not just the single next-match row (a player can have more than one live/upcoming fixture across different tournaments). Query only `id, status, scheduled_at`, then reuse `bucketFixtures`/`awaitingMyResult` from `lib/dashboard/fixtures.ts` unchanged — no new pure-logic file needed for this.
- **`FriendliesPanel.tsx` becomes fully dead code** once its only caller (Overview's inline summary) is removed — confirmed via repo-wide grep, `/dashboard/friendlies/page.tsx` builds its own rendering and never imported it. Delete it.
- **`CollapsibleSection.tsx` stays** — still used by `components/seasons/SeasonSchedule.tsx`. Only its usage inside the dashboard is removed, not the component itself.
- Every relocated query/component keeps its exact existing logic, comments, and prop shape — this is a move, not a rewrite. Where a task's code block below reproduces logic from the current `app/dashboard/page.tsx`, it is verbatim except for the imports/data it no longer needs.
- `middleware.ts`'s `/dashboard` guard is prefix-based and already covers every new subpath — no change needed there.
- Mobile: the sidebar collapses to the same horizontal scrollable tab row pattern as `WalletSidebar` (`overflow-x-auto scrollbar-hide`). Per the spec review, **Friendlies is ordered early in the nav list** (3rd, right after Overview and My Matches) so it isn't scrolled out of the initially-visible tab row on narrow screens.

---

### Task D1: `lib/dashboard/nav.ts` — nav model + active-route logic

**Files:**
- Create: `lib/dashboard/nav.ts`
- Test: `lib/dashboard/nav.test.ts`

**Interfaces:**
- Produces: `DashboardNavItem`, `DASHBOARD_NAV_ITEMS: DashboardNavItem[]`, `isDashboardNavActive(item, pathname): boolean` — consumed by D2 (`DashboardSidebar`).

- [ ] **Step 1: Write the failing test**

```ts
// lib/dashboard/nav.test.ts
import { describe, it, expect } from 'vitest'
import { DASHBOARD_NAV_ITEMS, isDashboardNavActive } from './nav'

describe('DASHBOARD_NAV_ITEMS', () => {
  it('orders Friendlies early (3rd) so it stays visible on the mobile tab row', () => {
    expect(DASHBOARD_NAV_ITEMS[2].href).toBe('/dashboard/friendlies')
  })
  it('every item has a unique href', () => {
    const hrefs = DASHBOARD_NAV_ITEMS.map((i) => i.href)
    expect(new Set(hrefs).size).toBe(hrefs.length)
  })
})

describe('isDashboardNavActive', () => {
  const overview = { label: 'Overview', href: '/dashboard' }
  const matches = { label: 'My Matches', href: '/dashboard/matches' }
  const friendlies = { label: 'Friendlies', href: '/dashboard/friendlies' }

  it('Overview is active only on the exact /dashboard path', () => {
    expect(isDashboardNavActive(overview, '/dashboard')).toBe(true)
    expect(isDashboardNavActive(overview, '/dashboard/matches')).toBe(false)
  })
  it('a subpage is active on its own path and any nested path beneath it', () => {
    expect(isDashboardNavActive(matches, '/dashboard/matches')).toBe(true)
    expect(isDashboardNavActive(friendlies, '/dashboard/friendlies/abc123')).toBe(true)
  })
  it('a subpage is not active on an unrelated path', () => {
    expect(isDashboardNavActive(matches, '/dashboard/tournaments')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/dashboard/nav.test.ts`
Expected: FAIL — `Cannot find module './nav'`

- [ ] **Step 3: Write the implementation**

```ts
// lib/dashboard/nav.ts
export interface DashboardNavItem {
  label: string
  href: string
}

// Friendlies is 3rd (not last) so it isn't scrolled out of view on the
// mobile horizontal tab row — see plan Global Constraints.
export const DASHBOARD_NAV_ITEMS: DashboardNavItem[] = [
  { label: 'Overview', href: '/dashboard' },
  { label: 'My Matches', href: '/dashboard/matches' },
  { label: 'Friendlies', href: '/dashboard/friendlies' },
  { label: 'My Tournaments', href: '/dashboard/tournaments' },
  { label: 'Marketplace', href: '/dashboard/marketplace' },
  { label: 'Friends', href: '/dashboard/friends' },
  { label: 'Referrals', href: '/dashboard/referrals' },
  { label: 'Profile', href: '/dashboard/profile' },
]

// '/dashboard' is a literal prefix of every other item's href, so Overview
// needs an exact match — otherwise it would show active on every dashboard
// subpage simultaneously with that subpage's own nav item.
export function isDashboardNavActive(item: DashboardNavItem, pathname: string): boolean {
  if (item.href === '/dashboard') return pathname === '/dashboard'
  return pathname === item.href || pathname.startsWith(`${item.href}/`)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/dashboard/nav.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard/nav.ts lib/dashboard/nav.test.ts
git commit -m "feat(dashboard): add nav model and active-route logic for the sidebar"
```

---

### Task D2: `components/dashboard/DashboardSidebar.tsx`

**Files:**
- Create: `components/dashboard/DashboardSidebar.tsx`

**Interfaces:**
- Consumes: `DASHBOARD_NAV_ITEMS`, `isDashboardNavActive` (D1); `signOut` (`lib/auth/actions.ts`).
- Produces: `DashboardSidebar` — consumed by D3 (`DashboardShell`).

- [ ] **Step 1: Write the component**

```tsx
// components/dashboard/DashboardSidebar.tsx
'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from '@/lib/auth/actions'
import { DASHBOARD_NAV_ITEMS, isDashboardNavActive } from '@/lib/dashboard/nav'

// 'use client' for usePathname to highlight the active tab — same pattern as
// components/wallet/WalletSidebar.tsx.
export function DashboardSidebar() {
  const pathname = usePathname()
  return (
    <nav className="flex gap-2 overflow-x-auto scrollbar-hide sm:w-48 sm:shrink-0 sm:flex-col sm:gap-1">
      {DASHBOARD_NAV_ITEMS.map((item) => {
        const active = isDashboardNavActive(item, pathname)
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
              active ? 'bg-sx-purple/20 text-sx-purple-text' : 'text-sx-gray hover:text-white'
            }`}
          >
            {item.label}
          </Link>
        )
      })}
      <form action={signOut}>
        <button
          type="submit"
          className="w-full shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm font-semibold text-sx-gray transition-colors hover:text-white"
        >
          Sign out
        </button>
      </form>
    </nav>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/DashboardSidebar.tsx
git commit -m "feat(dashboard): add DashboardSidebar"
```

---

### Task D3: `components/dashboard/DashboardShell.tsx`

**Files:**
- Create: `components/dashboard/DashboardShell.tsx`

**Interfaces:**
- Consumes: `DashboardSidebar` (D2).
- Produces: `DashboardShell` — consumed by every task from D4 onward.

- [ ] **Step 1: Write the component**

```tsx
// components/dashboard/DashboardShell.tsx
import { DashboardSidebar } from './DashboardSidebar'

// A plain component, not a Next.js layout.tsx — see plan Global Constraints
// for why (it would otherwise nest around app/dashboard/wallet's own shell).
// Every dashboard page wraps its own content in this explicitly.
export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-4xl px-4 pb-20">
      <div className="flex flex-col gap-6 py-4 sm:flex-row">
        <DashboardSidebar />
        <div className="min-w-0 flex-1 space-y-6">{children}</div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/DashboardShell.tsx
git commit -m "feat(dashboard): add DashboardShell wrapper"
```

---

### Task D4: `app/dashboard/matches/page.tsx`

**Files:**
- Create: `app/dashboard/matches/page.tsx`

**Interfaces:**
- Consumes: `DashboardShell` (D3); `bucketFixtures`, `isTournamentPublished`, `type DashboardMatchInput` (`lib/dashboard/fixtures.ts`); `computeTournamentStatus`, `type KnockoutMatchInput`, `type TournamentBanner` (`lib/dashboard/tournament-status.ts`); `type MembershipInput` (`lib/tournaments/standings.ts`); `computeDataSupportEligibility` (`lib/dashboard/data-support.ts`); `TournamentStatusBanners`, `ActiveFixtures`/`CompletedFixtures`, `DataSupportPanel` (existing components, unchanged).

This is the full fixtures/banners/data-support logic block from the current `app/dashboard/page.tsx`, moved verbatim — only the surrounding query set and imports shrink to exactly what this page needs.

- [ ] **Step 1: Write the page**

```tsx
// app/dashboard/matches/page.tsx
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { bucketFixtures, isTournamentPublished, type DashboardMatchInput } from '@/lib/dashboard/fixtures'
import { ActiveFixtures, CompletedFixtures } from '@/components/dashboard/FixtureCard'
import { TournamentStatusBanners } from '@/components/dashboard/TournamentStatusBanner'
import { DataSupportPanel } from '@/components/dashboard/DataSupportPanel'
import {
  computeTournamentStatus,
  type KnockoutMatchInput,
  type TournamentBanner,
} from '@/lib/dashboard/tournament-status'
import type { MembershipInput } from '@/lib/tournaments/standings'
import { computeDataSupportEligibility } from '@/lib/dashboard/data-support'
import { DashboardShell } from '@/components/dashboard/DashboardShell'

export const metadata: Metadata = { title: 'My Matches · SentinelX Esports', robots: { index: false, follow: false } }

type ProfileRef = { id?: string; username: string | null; display_name: string | null; country?: string | null } | null
type TournamentRef =
  | { title: string; slug: string; status: string; data_support_text: string | null; data_support_whatsapp: string | null }
  | { title: string; slug: string; status: string; data_support_text: string | null; data_support_whatsapp: string | null }[]
  | null

function nameOf(p: ProfileRef): string {
  return p?.display_name ?? p?.username ?? 'TBD'
}
function countryOf(p: ProfileRef): string | null {
  return p?.country ?? null
}
function firstTournament(t: TournamentRef): {
  title: string; slug: string; status: string; data_support_text: string | null; data_support_whatsapp: string | null
} | null {
  if (Array.isArray(t)) return t[0] ?? null
  return t
}

export default async function DashboardMatchesPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/dashboard/matches')

  const [profileRes, matchesRes, resultsRes, myGroupMembershipsRes] = await Promise.all([
    supabase.from('profiles').select('username').eq('id', user.id).maybeSingle(),
    supabase
      .from('matches')
      .select(
        'id, status, scheduled_at, is_full_day, round, tournament_id, player_a_id, player_b_id, score_a, score_b, ' +
          'player_a:profiles!matches_player_a_id_fkey(id, username, display_name, country), ' +
          'player_b:profiles!matches_player_b_id_fkey(id, username, display_name, country), ' +
          'tournament:tournaments(title, slug, status, data_support_text, data_support_whatsapp)',
      )
      .or(`player_a_id.eq.${user.id},player_b_id.eq.${user.id}`),
    supabase.from('match_results').select('match_id').eq('submitted_by', user.id),
    supabase.from('group_memberships').select('group_id, groups(tournament_id)').eq('player_id', user.id),
  ])

  const submittedMatchIds = new Set((resultsRes.data ?? []).map((r) => r.match_id))

  const rawMatches = ((matchesRes.data as unknown[] | null) ?? []) as {
    id: string; status: string; scheduled_at: string | null; is_full_day: boolean; round: string
    tournament_id: string; player_a_id: string; player_b_id: string; score_a: number | null; score_b: number | null
    player_a: ProfileRef; player_b: ProfileRef; tournament: TournamentRef
  }[]

  // A bracket generated at registration close (status 'registration_closed') is a
  // staff-only preview until admin publishes it — hide those fixtures from the player
  // dashboard the same way the public bracket page hides them from the public.
  const visibleMatches = rawMatches.filter((mm) => isTournamentPublished(firstTournament(mm.tournament)?.status))

  // Opponent WhatsApp numbers are per-tournament registration data, not
  // profile data. tournament_registrations RLS only lets a player read their
  // OWN row (auth.uid() = player_id) — an opponent's number is invisible to
  // the regular client, so this narrow lookup uses the service-role client,
  // scoped to exactly the opponents in this player's own visible matches
  // (never a blanket read of every registration).
  const matchTournamentIds = Array.from(new Set(visibleMatches.map((mm) => mm.tournament_id)))
  const opponentIds = Array.from(
    new Set(visibleMatches.map((mm) => (mm.player_a_id === user.id ? mm.player_b_id : mm.player_a_id))),
  )
  const { data: regRows } =
    matchTournamentIds.length > 0 && opponentIds.length > 0
      ? await createAdminClient()
          .from('tournament_registrations')
          .select('tournament_id, player_id, reg_whatsapp')
          .in('tournament_id', matchTournamentIds)
          .in('player_id', opponentIds)
      : { data: [] as { tournament_id: string; player_id: string; reg_whatsapp: string | null }[] }
  const whatsappByKey = new Map((regRows ?? []).map((r) => [`${r.tournament_id}:${r.player_id}`, r.reg_whatsapp]))

  const matches: DashboardMatchInput[] = visibleMatches.map((mm) => {
    const opponentId = mm.player_a_id === user.id ? mm.player_b_id : mm.player_a_id
    const opponent = mm.player_a_id === user.id ? mm.player_b : mm.player_a
    const t = firstTournament(mm.tournament)
    return {
      id: mm.id,
      status: mm.status,
      scheduledAt: mm.scheduled_at,
      isFullDay: mm.is_full_day,
      round: mm.round,
      opponentName: nameOf(opponent),
      opponentWhatsapp: whatsappByKey.get(`${mm.tournament_id}:${opponentId}`) ?? null,
      opponentCountry: countryOf(opponent),
      tournamentTitle: t?.title ?? 'Tournament',
      tournamentSlug: t?.slug ?? '',
    }
  })
  const fixtures = bucketFixtures(matches, submittedMatchIds, new Date())

  type GroupTournamentRef = { tournament_id: string } | { tournament_id: string }[] | null
  function firstGroupTournamentId(g: GroupTournamentRef): string | null {
    const row = Array.isArray(g) ? g[0] ?? null : g
    return row?.tournament_id ?? null
  }

  const myGroupRows = ((myGroupMembershipsRes.data as unknown[] | null) ?? []) as {
    group_id: string; groups: GroupTournamentRef
  }[]
  const groupIdByTournamentId = new Map<string, string>()
  for (const r of myGroupRows) {
    const tId = firstGroupTournamentId(r.groups)
    if (tId) groupIdByTournamentId.set(tId, r.group_id)
  }
  const myGroupIds = Array.from(new Set(myGroupRows.map((r) => r.group_id)))

  const [groupStandingsRes, groupMatchesRes] =
    myGroupIds.length > 0
      ? await Promise.all([
          supabase
            .from('group_memberships')
            .select('group_id, player_id, wins, draws, losses, goals_for, goals_against, points')
            .in('group_id', myGroupIds),
          supabase.from('matches').select('group_id, status').in('group_id', myGroupIds).eq('round', 'group'),
        ])
      : [
          { data: [] as { group_id: string; player_id: string; wins: number; draws: number; losses: number; goals_for: number; goals_against: number; points: number }[] },
          { data: [] as { group_id: string; status: string }[] },
        ]

  const groupCompleteById = new Map<string, boolean>()
  const groupStandingsById = new Map<string, MembershipInput[]>()
  for (const groupId of myGroupIds) {
    const matchRows = (groupMatchesRes.data ?? []).filter((m) => m.group_id === groupId)
    groupCompleteById.set(groupId, matchRows.length > 0 && matchRows.every((m) => m.status === 'completed'))
    groupStandingsById.set(
      groupId,
      (groupStandingsRes.data ?? [])
        .filter((r) => r.group_id === groupId)
        .map((r) => ({
          playerId: r.player_id, name: '', wins: r.wins, draws: r.draws, losses: r.losses,
          goalsFor: r.goals_for, goalsAgainst: r.goals_against, points: r.points,
        })),
    )
  }

  const knockoutMatchesByTournament = new Map<string, KnockoutMatchInput[]>()
  for (const mm of visibleMatches) {
    if (mm.round === 'group') continue
    const list = knockoutMatchesByTournament.get(mm.tournament_id) ?? []
    list.push({
      round: mm.round, status: mm.status, score_a: mm.score_a, score_b: mm.score_b,
      player_a_id: mm.player_a_id, player_b_id: mm.player_b_id,
    })
    knockoutMatchesByTournament.set(mm.tournament_id, list)
  }

  // Built from rawMatches (not visibleMatches) so an unpublished tournament's
  // title/status is still resolvable here — but such a tournament is then
  // deliberately skipped below via isTournamentPublished, same privacy rule
  // the rest of this page already applies to fixtures.
  const tournamentRefById = new Map<string, { title: string; slug: string; status: string }>()
  for (const mm of rawMatches) {
    const t = firstTournament(mm.tournament)
    if (t) tournamentRefById.set(mm.tournament_id, { title: t.title, slug: t.slug, status: t.status })
  }

  const tournamentIdsToEvaluate = Array.from(
    new Set<string>([...Array.from(knockoutMatchesByTournament.keys()), ...Array.from(groupIdByTournamentId.keys())]),
  )

  const tournamentBanners: NonNullable<TournamentBanner>[] = []
  for (const tournamentId of tournamentIdsToEvaluate) {
    const ref = tournamentRefById.get(tournamentId)
    if (!ref || !isTournamentPublished(ref.status)) continue
    const groupId = groupIdByTournamentId.get(tournamentId) ?? null
    const banner = computeTournamentStatus(user.id, {
      tournamentId, tournamentTitle: ref.title, tournamentSlug: ref.slug, tournamentStatus: ref.status,
      groupId, groupComplete: groupId ? groupCompleteById.get(groupId) ?? false : false,
      groupStandings: groupId ? groupStandingsById.get(groupId) ?? [] : [],
      knockoutMatches: knockoutMatchesByTournament.get(tournamentId) ?? [],
    })
    if (banner) tournamentBanners.push(banner)
  }

  const dataSupportEligibility = computeDataSupportEligibility(
    visibleMatches.map((mm) => {
      const t = firstTournament(mm.tournament)
      return {
        round: mm.round, tournamentId: mm.tournament_id, tournamentTitle: t?.title ?? 'Tournament',
        dataSupportText: t?.data_support_text ?? null, dataSupportWhatsapp: t?.data_support_whatsapp ?? null,
      }
    }),
  )

  return (
    <DashboardShell>
      <h1 className="text-lg font-bold text-white">My Matches</h1>

      {dataSupportEligibility.length > 0 && (
        <DataSupportPanel username={profileRes.data?.username ?? ''} eligibility={dataSupportEligibility} />
      )}

      <section>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-sx-gray">Active</h2>
        <TournamentStatusBanners banners={tournamentBanners} />
        <ActiveFixtures fixtures={{ live: fixtures.live, upcoming: fixtures.upcoming }} />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-sx-gray">Completed</h2>
        <CompletedFixtures fixtures={fixtures.completed} />
      </section>
    </DashboardShell>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/dashboard/matches/page.tsx
git commit -m "feat(dashboard): add My Matches subpage"
```

---

### Task D5: `app/dashboard/tournaments/page.tsx`

**Files:**
- Create: `app/dashboard/tournaments/page.tsx`

**Interfaces:**
- Consumes: `DashboardShell` (D3); `MyTournaments`, `type RegistrationRow` (existing, unchanged).

- [ ] **Step 1: Write the page**

```tsx
// app/dashboard/tournaments/page.tsx
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { MyTournaments, type RegistrationRow } from '@/components/dashboard/MyTournaments'
import { DashboardShell } from '@/components/dashboard/DashboardShell'

export const metadata: Metadata = { title: 'My Tournaments · SentinelX Esports', robots: { index: false, follow: false } }

type TournamentRef = { title: string; slug: string; status: string } | { title: string; slug: string; status: string }[] | null
function firstTournament(t: TournamentRef) {
  return Array.isArray(t) ? t[0] ?? null : t
}

export default async function DashboardTournamentsPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/dashboard/tournaments')

  const { data: regsRes } = await supabase
    .from('tournament_registrations')
    .select('id, payment_status, registered_at, tournament:tournaments(title, slug, status)')
    .eq('player_id', user.id)
    .order('registered_at', { ascending: false })

  const registrations: RegistrationRow[] = ((regsRes as unknown[] | null) ?? []).map((raw) => {
    const r = raw as { id: string; payment_status: string; tournament: TournamentRef }
    const t = firstTournament(r.tournament)
    return {
      id: r.id,
      paymentStatus: r.payment_status,
      tournamentTitle: t?.title ?? 'Tournament',
      tournamentSlug: t?.slug ?? '',
    }
  })

  return (
    <DashboardShell>
      <h1 className="text-lg font-bold text-white">My Tournaments</h1>
      <MyTournaments registrations={registrations} />
    </DashboardShell>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/dashboard/tournaments/page.tsx
git commit -m "feat(dashboard): add My Tournaments subpage"
```

---

### Task D6: `app/dashboard/marketplace/page.tsx`

**Files:**
- Create: `app/dashboard/marketplace/page.tsx`

**Interfaces:**
- Consumes: `DashboardShell` (D3); `MyListings`, `MyBuyRequests`, `MyOrders`, `MySales` (existing, unchanged); `latestPerListing`, `type OrderRow` (`lib/exchange/orders.ts`).

- [ ] **Step 1: Write the page**

```tsx
// app/dashboard/marketplace/page.tsx
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { MyListings, type MyListing } from '@/components/dashboard/MyListings'
import { MyBuyRequests, type MyBuyRequest } from '@/components/dashboard/MyBuyRequests'
import { MyOrders } from '@/components/dashboard/MyOrders'
import { MySales } from '@/components/dashboard/MySales'
import { latestPerListing, type OrderRow } from '@/lib/exchange/orders'
import { DashboardShell } from '@/components/dashboard/DashboardShell'

export const metadata: Metadata = { title: 'Marketplace · SentinelX Esports', robots: { index: false, follow: false } }

export default async function DashboardMarketplacePage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/dashboard/marketplace')

  const [listingsRes, buyRequestsRes, ordersRes, salesRes] = await Promise.all([
    supabase
      .from('marketplace_listings')
      .select('id, title, price, status')
      .eq('seller_id', user.id)
      .neq('status', 'removed')
      .order('created_at', { ascending: false }),
    supabase
      .from('buy_requests')
      .select('id, title, budget, status')
      .eq('buyer_id', user.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('marketplace_orders')
      .select('id, listing_id, listing_title, amount, status')
      .eq('buyer_id', user.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('marketplace_orders')
      .select('id, listing_id, listing_title, amount, status')
      .eq('seller_id', user.id)
      .order('created_at', { ascending: false }),
  ])

  const myListings: MyListing[] = (listingsRes.data ?? []).map((l) => ({
    id: l.id, title: l.title, price: l.price, status: l.status,
  }))
  const myBuyRequests: MyBuyRequest[] = (buyRequestsRes.data ?? []).map((r) => ({
    id: r.id, title: r.title, budget: r.budget, status: r.status as MyBuyRequest['status'],
  }))
  const toOrderRow = (r: { id: string; listing_id: string; listing_title: string; amount: number; status: string }): OrderRow => ({
    id: r.id, listingId: r.listing_id, title: r.listing_title, amount: r.amount, status: r.status,
  })
  // Both queries are already newest-first — collapse abandoned retries of the
  // same listing down to just the latest attempt.
  const myOrders: OrderRow[] = latestPerListing((ordersRes.data ?? []).map(toOrderRow))
  const mySales: OrderRow[] = latestPerListing((salesRes.data ?? []).map(toOrderRow))

  return (
    <DashboardShell>
      <h1 className="text-lg font-bold text-white">Marketplace</h1>
      <MyListings listings={myListings} />
      <MyBuyRequests requests={myBuyRequests} />
      <MyOrders orders={myOrders} />
      <MySales sales={mySales} />
    </DashboardShell>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/dashboard/marketplace/page.tsx
git commit -m "feat(dashboard): add Marketplace subpage"
```

---

### Task D7: `app/dashboard/friends/page.tsx`

**Files:**
- Create: `app/dashboard/friends/page.tsx`

**Interfaces:**
- Consumes: `DashboardShell` (D3); `FriendsPanel`, `type FriendRequestRow`, `type FriendRow` (existing, unchanged).

- [ ] **Step 1: Write the page**

```tsx
// app/dashboard/friends/page.tsx
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { FriendsPanel, type FriendRequestRow, type FriendRow } from '@/components/dashboard/FriendsPanel'
import { DashboardShell } from '@/components/dashboard/DashboardShell'

export const metadata: Metadata = { title: 'Friends · SentinelX Esports', robots: { index: false, follow: false } }

type FriendProfileRef =
  | { username: string | null; display_name: string | null; avatar_url: string | null }
  | { username: string | null; display_name: string | null; avatar_url: string | null }[]
  | null
function friendProfileName(p: FriendProfileRef): { name: string; username: string | null; avatarUrl: string | null } {
  const r = Array.isArray(p) ? p[0] ?? null : p
  return { name: r?.display_name ?? r?.username ?? 'Player', username: r?.username ?? null, avatarUrl: r?.avatar_url ?? null }
}

export default async function DashboardFriendsPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/dashboard/friends')

  const { data: friendsRes } = await supabase
    .from('friends')
    .select(
      'id, requester_id, recipient_id, status, ' +
        'requester:profiles!friends_requester_id_fkey(username, display_name, avatar_url), ' +
        'recipient:profiles!friends_recipient_id_fkey(username, display_name, avatar_url)',
    )
    .or(`requester_id.eq.${user.id},recipient_id.eq.${user.id}`)

  const rawFriends = ((friendsRes as unknown[] | null) ?? []) as {
    id: string; requester_id: string; recipient_id: string; status: string
    requester: FriendProfileRef; recipient: FriendProfileRef
  }[]
  const incomingRequests: FriendRequestRow[] = rawFriends
    .filter((f) => f.status === 'pending' && f.recipient_id === user.id)
    .map((f) => {
      const p = friendProfileName(f.requester)
      return { id: f.id, requesterName: p.name, requesterUsername: p.username, requesterAvatarUrl: p.avatarUrl }
    })
  const friendsList: FriendRow[] = rawFriends
    .filter((f) => f.status === 'accepted')
    .map((f) => {
      const otherIsRequester = f.recipient_id === user.id
      const p = friendProfileName(otherIsRequester ? f.requester : f.recipient)
      return { id: f.id, friendName: p.name, friendUsername: p.username, friendAvatarUrl: p.avatarUrl }
    })

  return (
    <DashboardShell>
      <h1 className="text-lg font-bold text-white">Friends</h1>
      <FriendsPanel incoming={incomingRequests} friends={friendsList} />
    </DashboardShell>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/dashboard/friends/page.tsx
git commit -m "feat(dashboard): add Friends subpage"
```

---

### Task D8: `app/dashboard/referrals/page.tsx`

**Files:**
- Create: `app/dashboard/referrals/page.tsx`

**Interfaces:**
- Consumes: `DashboardShell` (D3); `ReferralPanel` (existing, unchanged).

- [ ] **Step 1: Write the page**

```tsx
// app/dashboard/referrals/page.tsx
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ReferralPanel } from '@/components/dashboard/ReferralPanel'
import { DashboardShell } from '@/components/dashboard/DashboardShell'

export const metadata: Metadata = { title: 'Referrals · SentinelX Esports', robots: { index: false, follow: false } }

type ReferredRef =
  | { username: string | null; display_name: string | null }
  | { username: string | null; display_name: string | null }[]
  | null
function referredName(r: ReferredRef): string {
  const p = Array.isArray(r) ? r[0] ?? null : r
  return p?.display_name ?? p?.username ?? 'Player'
}

export default async function DashboardReferralsPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/dashboard/referrals')

  const [profileRes, referralsRes] = await Promise.all([
    supabase.from('profiles').select('username').eq('id', user.id).maybeSingle(),
    supabase
      .from('referrals')
      .select('referred:profiles!referrals_referred_id_fkey(username, display_name)')
      .eq('referrer_id', user.id),
  ])

  const referredPlayers = ((referralsRes.data as unknown[] | null) ?? []).map((raw) =>
    referredName((raw as { referred: ReferredRef }).referred),
  )

  return (
    <DashboardShell>
      <h1 className="text-lg font-bold text-white">Referrals</h1>
      <ReferralPanel username={profileRes.data?.username ?? ''} referredPlayers={referredPlayers} />
    </DashboardShell>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/dashboard/referrals/page.tsx
git commit -m "feat(dashboard): add Referrals subpage"
```

---

### Task D9: `app/dashboard/profile/page.tsx`

**Files:**
- Create: `app/dashboard/profile/page.tsx`

**Interfaces:**
- Consumes: `DashboardShell` (D3); `ProfileEditForm` (existing, unchanged).

- [ ] **Step 1: Write the page**

```tsx
// app/dashboard/profile/page.tsx
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ProfileEditForm } from '@/components/dashboard/ProfileEditForm'
import { DashboardShell } from '@/components/dashboard/DashboardShell'

export const metadata: Metadata = { title: 'Profile Settings · SentinelX Esports', robots: { index: false, follow: false } }

export default async function DashboardProfilePage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/dashboard/profile')

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, username, avatar_url, whatsapp_number, country, bio, phone_verified_at')
    .eq('id', user.id)
    .maybeSingle()

  return (
    <DashboardShell>
      <h1 className="text-lg font-bold text-white">Profile Settings</h1>
      <ProfileEditForm
        profile={{
          displayName: profile?.display_name ?? null,
          username: profile?.username ?? null,
          avatarUrl: profile?.avatar_url ?? null,
          whatsapp: profile?.whatsapp_number ?? null,
          country: profile?.country ?? null,
          bio: profile?.bio ?? null,
          phoneVerifiedAt: profile?.phone_verified_at ?? null,
        }}
      />
    </DashboardShell>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/dashboard/profile/page.tsx
git commit -m "feat(dashboard): add Profile Settings subpage"
```

---

### Task D10: Fold `app/dashboard/friendlies/page.tsx` into `DashboardShell`

**Files:**
- Modify: `app/dashboard/friendlies/page.tsx`

**Interfaces:**
- Consumes: `DashboardShell` (D3).

Only the outer wrapper changes — every query, the `Group` helper, and all rendering logic inside stay exactly as they are today.

- [ ] **Step 1: Replace the wrapper**

```tsx
import { DashboardShell } from '@/components/dashboard/DashboardShell'
```

Replace:

```tsx
  return (
    <div className="mx-auto max-w-2xl px-4 pb-20 pt-6">
      <h1 className="mb-6 text-xl font-black text-white">Friendlies</h1>
      <Group title="Pending" rows={pending} viewerId={user.id} empty="No pending challenges." />
      <Group title="Active" rows={active} viewerId={user.id} empty="No active friendlies." />
      <Group title="Completed" rows={completed} viewerId={user.id} empty="No completed friendlies yet." />
    </div>
  )
```

with:

```tsx
  return (
    <DashboardShell>
      <h1 className="text-lg font-bold text-white">Friendlies</h1>
      <Group title="Pending" rows={pending} viewerId={user.id} empty="No pending challenges." />
      <Group title="Active" rows={active} viewerId={user.id} empty="No active friendlies." />
      <Group title="Completed" rows={completed} viewerId={user.id} empty="No completed friendlies yet." />
    </DashboardShell>
  )
```

Note: `app/dashboard/friendlies/[id]/page.tsx` (the match-room page) is deliberately **not** touched — see plan Global Constraints.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/dashboard/friendlies/page.tsx
git commit -m "feat(dashboard): fold Friendlies list page into DashboardShell"
```

---

### Task D11: Rewrite `app/dashboard/page.tsx` (Overview)

**Files:**
- Modify: `app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `DashboardShell` (D3); every Overview component already built in the earlier command-centre plan (`HeroIdentityPanel`, `NextMatchCard`, `StatsRow`, `ProgressCard`, `SeasonStandingCard`, `RecentMatchesCard`, `QuickActions` — all unchanged by this task, `QuickActions` itself is redesigned in D12); `bucketFixtures`, `type DashboardMatchInput` (`lib/dashboard/fixtures.ts`, reused only for the narrow `hasSubmittableMatch` check).

- [ ] **Step 1: Rewrite the page**

```tsx
// app/dashboard/page.tsx
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { bucketFixtures, type DashboardMatchInput } from '@/lib/dashboard/fixtures'
import { recordDailyLogin } from '@/lib/login/actions'
import { getCoinBalance } from '@/lib/coins/service'
import type { RecentAchievement } from '@/components/dashboard/RecentAchievements'
import { HeroIdentityPanel } from '@/components/dashboard/HeroIdentityPanel'
import { NextMatchCard, type NextMatchData } from '@/components/dashboard/NextMatchCard'
import { StatsRow } from '@/components/dashboard/StatsRow'
import { SeasonStandingCard } from '@/components/dashboard/SeasonStandingCard'
import { ProgressCard } from '@/components/dashboard/ProgressCard'
import { RecentMatchesCard } from '@/components/dashboard/RecentMatchesCard'
import { QuickActions } from '@/components/dashboard/QuickActions'
import { DashboardShell } from '@/components/dashboard/DashboardShell'
import { mapRecentMatches } from '@/lib/dashboard/recent-matches'
import { getSeasonLeaderboard, getMonthlyLeaderboard } from '@/lib/seasons/data'
import type { MembershipTier } from '@/lib/membership/tiers'

export const metadata: Metadata = {
  title: 'Dashboard · SentinelX Esports',
  robots: { index: false, follow: false },
}

export default async function DashboardPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/dashboard')

  await recordDailyLogin(createAdminClient(), user.id)

  const [
    profileRes,
    resultsRes,
    walletRes,
    coinBalance,
    achievementsRes,
    nextMatchRes,
    recentMatchesRes,
    achievementSlugsRes,
    activeSeasonRes,
    myOpenMatchesRes,
  ] = await Promise.all([
    supabase
      .from('profiles')
      .select(
        'username, display_name, avatar_url, wins, goals_scored, xp, membership_tier, login_streak, sx_score, total_matches',
      )
      .eq('id', user.id)
      .maybeSingle(),
    supabase.from('match_results').select('match_id').eq('submitted_by', user.id),
    supabase.from('wallets').select('balance').eq('player_id', user.id).maybeSingle(),
    getCoinBalance(createAdminClient(), user.id),
    supabase
      .from('player_achievements')
      .select('unlocked_at, achievements(name)')
      .eq('player_id', user.id)
      .order('unlocked_at', { ascending: false })
      .limit(3),
    supabase
      .from('matches')
      .select(
        'id, status, round, scheduled_at, is_full_day, ' +
          'tournament:tournaments(title), ' +
          'opponent_a:profiles!matches_player_a_id_fkey(id, display_name, username, avatar_url, membership_tier), ' +
          'opponent_b:profiles!matches_player_b_id_fkey(id, display_name, username, avatar_url, membership_tier)',
      )
      .or(`player_a_id.eq.${user.id},player_b_id.eq.${user.id}`)
      .in('status', ['scheduled', 'live'])
      .order('scheduled_at', { ascending: true })
      .limit(1),
    supabase
      .from('matches')
      .select(
        'id, player_a_id, player_b_id, score_a, score_b, updated_at, ' +
          'tournament:tournaments(title), ' +
          'player_a:profiles!matches_player_a_id_fkey(username, display_name), ' +
          'player_b:profiles!matches_player_b_id_fkey(username, display_name)',
      )
      .or(`player_a_id.eq.${user.id},player_b_id.eq.${user.id}`)
      .eq('status', 'completed')
      .order('updated_at', { ascending: false })
      .limit(5),
    supabase.from('player_achievements').select('achievements(slug)').eq('player_id', user.id),
    supabase.from('seasons').select('id, name').eq('status', 'active').maybeSingle(),
    // Narrow — see plan Global Constraints on why this isn't the full
    // /dashboard/matches fetch or just the single next-match row.
    supabase
      .from('matches')
      .select('id, status, scheduled_at')
      .or(`player_a_id.eq.${user.id},player_b_id.eq.${user.id}`)
      .in('status', ['scheduled', 'live']),
  ])

  const profile = profileRes.data
  type AchievementNameRef = { name: string } | { name: string }[] | null
  const recentAchievements: RecentAchievement[] = ((achievementsRes.data as unknown[] | null) ?? []).map((raw) => {
    const row = raw as { unlocked_at: string; achievements: AchievementNameRef }
    const ref = Array.isArray(row.achievements) ? row.achievements[0] ?? null : row.achievements
    return { name: ref?.name ?? 'Achievement', unlockedAt: row.unlocked_at }
  })

  const submittedMatchIds = new Set((resultsRes.data ?? []).map((r) => r.match_id))

  const openMatches: DashboardMatchInput[] = (myOpenMatchesRes.data ?? []).map((m) => ({
    id: m.id,
    status: m.status,
    scheduledAt: m.scheduled_at,
    isFullDay: false,
    round: '',
    opponentName: '',
    tournamentTitle: '',
    tournamentSlug: '',
  }))
  const openFixtures = bucketFixtures(openMatches, submittedMatchIds, new Date())
  const hasSubmittableMatch = openFixtures.live.length > 0 || openFixtures.upcoming.some((f) => f.awaitingMyResult)

  const walletBalance = walletRes.data?.balance ?? 0
  const displayName = profile?.display_name ?? profile?.username ?? user.email ?? 'Player'

  const { data: pendingInvitations } = await supabase
    .from('tournament_invitations')
    .select('id, rank_at_invite, expires_at, tournament:tournaments(title, registration_fee)')
    .eq('player_id', user.id)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .order('expires_at', { ascending: true })
    .limit(1)
  const pendingInvitationRow = pendingInvitations?.[0] ?? null
  const pendingInvitationTournament = pendingInvitationRow
    ? Array.isArray(pendingInvitationRow.tournament)
      ? pendingInvitationRow.tournament[0]
      : pendingInvitationRow.tournament
    : null

  // ── Season standing ─────────────────────────────────────────────────────
  const activeSeason = activeSeasonRes.data

  let seasonRank: number | null = null
  let seasonPoints = 0
  let pointsAtRankSixteen = 0
  let monthlyRank: number | null = null
  let monthlyPoints = 0
  if (activeSeason) {
    const [seasonBoard, monthlyBoard] = await Promise.all([
      getSeasonLeaderboard(createAdminClient(), activeSeason.id),
      getMonthlyLeaderboard(createAdminClient(), activeSeason.id, new Date()),
    ])
    const seasonIdx = seasonBoard.findIndex((r) => r.playerId === user.id)
    seasonRank = seasonIdx >= 0 ? seasonIdx + 1 : null
    seasonPoints = seasonIdx >= 0 ? seasonBoard[seasonIdx].points : 0
    pointsAtRankSixteen = seasonBoard[15]?.points ?? 0
    const monthlyIdx = monthlyBoard.findIndex((r) => r.playerId === user.id)
    monthlyRank = monthlyIdx >= 0 ? monthlyIdx + 1 : null
    monthlyPoints = monthlyIdx >= 0 ? monthlyBoard[monthlyIdx].points : 0
  }

  // ── Next match ───────────────────────────────────────────────────────────
  type NextMatchOpponentRef = {
    id: string; display_name: string | null; username: string | null; avatar_url: string | null; membership_tier: string | null
  }
  type NextMatchRow = {
    id: string; status: string; round: string; scheduled_at: string | null; is_full_day: boolean
    tournament: { title: string } | { title: string }[] | null
    opponent_a: NextMatchOpponentRef | NextMatchOpponentRef[] | null
    opponent_b: NextMatchOpponentRef | NextMatchOpponentRef[] | null
  }
  const nextMatchRow = (nextMatchRes.data as unknown as NextMatchRow[] | null)?.[0] ?? null
  const nextMatch: NextMatchData | null = nextMatchRow
    ? (() => {
        const a = Array.isArray(nextMatchRow.opponent_a) ? nextMatchRow.opponent_a[0] : nextMatchRow.opponent_a
        const b = Array.isArray(nextMatchRow.opponent_b) ? nextMatchRow.opponent_b[0] : nextMatchRow.opponent_b
        const t = Array.isArray(nextMatchRow.tournament) ? nextMatchRow.tournament[0] : nextMatchRow.tournament
        const opponent = a?.id === user.id ? b : a
        return {
          id: nextMatchRow.id,
          status: nextMatchRow.status,
          round: nextMatchRow.round,
          scheduledAt: nextMatchRow.scheduled_at,
          isFullDay: nextMatchRow.is_full_day,
          tournamentTitle: t?.title ?? 'Tournament',
          myAvatarUrl: profile?.avatar_url ?? null,
          myDisplayName: displayName,
          myTier: (profile?.membership_tier ?? 'recruit') as MembershipTier,
          opponentAvatarUrl: opponent?.avatar_url ?? null,
          opponentDisplayName: opponent?.display_name ?? opponent?.username ?? 'Opponent',
          opponentTier: (opponent?.membership_tier ?? 'recruit') as MembershipTier,
          submitted: submittedMatchIds.has(nextMatchRow.id),
        }
      })()
    : null

  // ── Recent matches ──────────────────────────────────────────────────────
  type RecentRawRef = { username: string | null; display_name: string | null } | { username: string | null; display_name: string | null }[] | null
  type RecentTournamentRef = { title: string } | { title: string }[] | null
  const recentMatchRows = ((recentMatchesRes.data as unknown[] | null) ?? []).map((raw) => {
    const r = raw as {
      id: string; player_a_id: string | null; player_b_id: string | null; score_a: number | null; score_b: number | null
      updated_at: string | null; tournament: RecentTournamentRef; player_a: RecentRawRef; player_b: RecentRawRef
    }
    const isA = r.player_a_id === user.id
    const opp = isA ? r.player_b : r.player_a
    const oppRow = Array.isArray(opp) ? opp[0] ?? null : opp
    const t = Array.isArray(r.tournament) ? r.tournament[0] : r.tournament
    return {
      id: r.id, player_a_id: r.player_a_id, player_b_id: r.player_b_id, score_a: r.score_a, score_b: r.score_b,
      updated_at: r.updated_at,
      opponentName: oppRow?.display_name ?? oppRow?.username ?? 'Opponent',
      opponentUsername: oppRow?.username ?? null,
      tournamentTitle: t?.title ?? 'Tournament',
    }
  })
  const recentMatches = mapRecentMatches(recentMatchRows, user.id)

  const achievementSlugs = ((achievementSlugsRes.data as unknown[] | null) ?? []).flatMap((raw) => {
    const r = raw as { achievements: { slug: string } | { slug: string }[] | null }
    const ref = Array.isArray(r.achievements) ? r.achievements[0] : r.achievements
    return ref?.slug ? [ref.slug] : []
  })

  return (
    <DashboardShell>
      <HeroIdentityPanel
        avatarUrl={profile?.avatar_url ?? null}
        displayName={displayName}
        achievements={achievementSlugs}
        xp={profile?.xp ?? 0}
        sxScore={profile?.sx_score ?? 700}
        seasonRank={seasonRank}
        loginStreak={profile?.login_streak ?? 0}
      />
      <NextMatchCard
        match={nextMatch}
        invitation={
          pendingInvitationRow && pendingInvitationTournament
            ? {
                id: pendingInvitationRow.id,
                rank: pendingInvitationRow.rank_at_invite,
                deadline: pendingInvitationRow.expires_at,
                tournamentTitle: pendingInvitationTournament.title,
                fee: pendingInvitationTournament.registration_fee,
              }
            : null
        }
      />
      <StatsRow
        wins={profile?.wins ?? 0}
        totalMatches={profile?.total_matches ?? 0}
        goalsScored={profile?.goals_scored ?? 0}
        coinBalance={coinBalance}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <ProgressCard
          xp={profile?.xp ?? 0}
          coinBalance={coinBalance}
          loginStreak={profile?.login_streak ?? 0}
          recentAchievements={recentAchievements}
        />
        <SeasonStandingCard
          seasonRank={seasonRank}
          seasonPoints={seasonPoints}
          pointsAtRankSixteen={pointsAtRankSixteen}
          monthlyRank={monthlyRank}
          monthlyPoints={monthlyPoints}
        />
      </div>
      <RecentMatchesCard matches={recentMatches} username={profile?.username ?? null} />
      <QuickActions walletBalance={walletBalance} hasSubmittableMatch={hasSubmittableMatch} />
    </DashboardShell>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (`QuickActions`'s `hasSubmittableMatch`/`walletBalance` props are unchanged by this task — D12 only changes the tile hrefs/labels inside the component, not its prop signature.)

- [ ] **Step 3: Commit**

```bash
git add app/dashboard/page.tsx
git commit -m "feat(dashboard): trim Overview to highlights, split data fetch per subpage"
```

---

### Task D12: Redesign `components/dashboard/QuickActions.tsx`

**Files:**
- Modify: `components/dashboard/QuickActions.tsx`

**Interfaces:**
- Unchanged prop signature (`walletBalance: number`, `hasSubmittableMatch: boolean`) — only the tile set changes.

- [ ] **Step 1: Replace the tile set**

Replace the current 4-tile logic (Enter Tournament / conditional Submit Result / conditional Withdraw Prize / `#profile` anchor) with:

```tsx
  const tiles = [
    { href: '/tournaments', icon: '🎮', label: 'Enter a Tournament' },
    {
      href: '/dashboard/matches',
      icon: '📤',
      label: hasSubmittableMatch ? 'Submit Result' : 'My Matches',
    },
    {
      href: '/dashboard/wallet',
      icon: '💰',
      label: walletBalance > 0 ? 'Withdraw Prize' : 'Wallet',
      sub: walletBalance > 0 ? formatNaira(walletBalance) : undefined,
    },
    { href: '/dashboard/profile', icon: '⚙', label: 'Profile' },
  ]
```

`#profile` was pointing at a section that no longer exists on this page (moved to `/dashboard/profile` in D9) — this replaces it with the real destination.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/QuickActions.tsx
git commit -m "feat(dashboard): redesign Quick Actions tiles to link into the new subpages"
```

---

### Task D13: Retire dead code

**Files:**
- Delete: `components/dashboard/FriendliesPanel.tsx`

- [ ] **Step 1: Confirm no remaining references**

Run: `grep -rn "FriendliesPanel" app components`
Expected: no matches (its only caller, the old Overview's inline summary, was removed in D11).

- [ ] **Step 2: Delete and verify**

```bash
rm components/dashboard/FriendliesPanel.tsx
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add -A -- components/dashboard/FriendliesPanel.tsx
git commit -m "chore(dashboard): remove FriendliesPanel, superseded by the Friendlies subpage"
```

---

### Task D14: Full verification

- [ ] **Step 1: Run the full check**

Run: `npx vitest run && npx tsc --noEmit && npm run build 2>&1 | tail -80`
Expected: all green; `/dashboard`, `/dashboard/matches`, `/dashboard/tournaments`, `/dashboard/marketplace`, `/dashboard/friends`, `/dashboard/referrals`, `/dashboard/profile`, `/dashboard/friendlies` all appear as generated routes.

- [ ] **Step 2: Manual verification (via the `run` skill)**

As a logged-in test player:
- `/dashboard` — confirm it's short: Hero, Next Match, Stats, Progress/Season grid, Recent Matches preview, 4 Quick Action tiles. No Referrals/Friends/Friendlies/Active-matches/marketplace lists anywhere on this page.
- Click every sidebar item (desktop) — confirm each subpage renders its content with the sidebar still visible and the correct item highlighted.
- Resize to mobile width — confirm the sidebar collapses to a horizontal scrollable tab row, and **Friendlies is visible without scrolling** (the specific concern raised in spec review).
- Visit `/dashboard/wallet` — confirm it still shows only `WalletSidebar` (not doubled with `DashboardSidebar`).
- Visit `/dashboard/friendlies/[id]` for an existing friendly — confirm it renders without the new sidebar (unchanged, focused match-room view).
- Confirm Quick Actions' "My Matches"/"Submit Result" label matches whether you actually have an awaiting-result match, and its href lands on `/dashboard/matches`.

---

## Self-Review Notes (for the executor, not a task)

- Spec §2 (routes), §3 (sidebar + shell), §4 (Overview + `hasSubmittableMatch`), §5 (Quick Actions), §6 (every subpage's data/component reuse), §8 (file list) are all covered above.
- The one deviation from the spec as written — `DashboardShell` as a component instead of a real `app/dashboard/layout.tsx` — is disclosed in Global Constraints along with the concrete reason (Wallet's existing layout would otherwise double-nest).
- The reviewer's mobile-visibility note on Friendlies is addressed structurally (nav ordering, D1) rather than just mentioned — verify it in D14's manual pass.
