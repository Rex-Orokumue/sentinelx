# Phase 2 Post-Ship Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the real bugs and gaps found after the Phase 2 Economy merge — mobile overflow on two pages, a visibility bug on the player profile sidebar, a missing admin player list, a missing Hall of Fame link, three unfinished economy features (cosmetics rendering, inactive-item RLS, Masters placement rewards) — and correctly *decline* the items in the original report that turned out not to be bugs.

**Architecture:** Nine independent, mostly-unrelated fixes across the existing Next.js/Supabase codebase. No new subsystems — every task touches an existing page or component, or completes a feature Phase 2 already started (cosmetics equip, store RLS, season points). Ordered by the product owner's stated priority (2 → 5); Priority 1 required no code (see Part 0).

**Tech Stack:** Next.js 14 App Router, Supabase (Postgres + RLS), Tailwind CSS, Vitest.

## Global Constraints

- Mobile-first, design for 375px width, scale up (CLAUDE.md).
- Server Components by default, `"use client"` only for interactivity (CLAUDE.md).
- RLS enabled on every table; no client write policy where writes should be service-role-only (CLAUDE.md, established Phase 2 pattern).
- Never fabricate data or invent values not backed by a real spec — show an honest placeholder/dash instead (established project convention, see `docs/superpowers/plans/2026-08-05-phase2-economy.md`'s own Global Constraints and the Phase 1 "Exact replica" rule in memory `project_phase1_visual_overhaul`).
- Migrations are additive — never edit an existing `supabase/migrations/*.sql` file. Next number: check `supabase/migrations/` at task time (055 as of this plan's writing).
- Test runner is Vitest (`npm run test` = `vitest run`); tests are colocated `*.test.ts` files.
- Two tier badges (`TierBadge`/`sentinel_tier`, `MembershipBadge`/`membership_tier`) are INTENTIONALLY separate, independently-real concepts per the Phase 2 plan's own Global Constraints #5 — do not merge or remove either without a task explicitly saying so (none in this plan do).

---

## Part 0 — Declined / already-resolved items (no task — read before touching anything)

Investigated directly against the current codebase and live database before writing any task below. Documented here so nobody re-opens these without cause.

**Priority 1 ("recompute is broken"): not a bug, already resolved.** Confirmed via live DB query (2026-08-15): `sx_score_events` has 310 rows including fresh entries using the correct new delta values (`match_completed: +10`, `win_no_dispute: +90`), and `profiles.sx_score`/`total_matches`/`wins` reflect real, updated match history. `recomputeAllScoring()` ran successfully. The season leaderboard being empty is separately explained below — no task needed for "fix recompute."

**"Career stats not calculating" (part of Priority 3): not reproducible, no task.** `app/(public)/players/[username]/page.tsx`'s `PROFILE_COLS` already selects `sx_score` (not the stale `sentinel_score`) and every downstream type in `lib/players/profile.ts` is correctly typed. Given Part 0's first finding — player aggregates were confirmed stale-then-fixed by the recompute that ran today — this was very likely a snapshot of the pre-recompute state, not a current code bug. If it reproduces after this plan ships, it needs a fresh bug report with a specific username, not a blind fix here.

**"Rank and SX Score under 'Games You Play' not calculating" (part of Priority 3): not a bug — a deliberate, documented placeholder. No task.** Read `components/player/ProfileGamesRow.tsx:10-13`: the per-game "#1 Rank" / "1,250 SX Score" fields are intentionally rendered as `"— Rank"` / `"— SX Score"` because the schema has no per-game score column — SentinelX is currently single-game (DLS only), and per-game stats require roadmap **#21 multi-game support**, the one item left on the whole roadmap (`project_current_phase` memory) and explicitly out of scope here. Building this now would mean fabricating data the schema can't back, which is the exact thing the project's own "Exact replica" rule forbids. Leave the honest dash in place.

**"Two simultaneous tier badges" (part of Priority 3): not a duplication bug — by-design pairing, needs UX clarity instead.** Read `components/rankings/LeaderboardTable.tsx:98-99`: `TierBadge` reads `pl.sentinelTier` (SX-Score reliability tier: Elite/Trusted/Developing/At Risk) and `MembershipBadge` reads `pl.membershipTier` (XP level: Recruit/Guardian/Elite/Sentinel/Legend) — two different real columns, no fallback, no accidental double-render (grepped the whole file, one call site each). Both are meant to render together per the Phase 2 plan's Global Constraints #5. The likely trigger for the complaint: **"Elite" is a valid value on both scales independently**, so a player who is Elite on both reads "Elite Elite" with nothing distinguishing which badge means what. Task 3.3 below fixes the actual problem — visual/label clarity — not removal.

**Masters/Champions Cup placement rewards: both real, both fixed in Task 4.3.** `lib/tournaments/season-placement.ts` already has a complete `MASTERS_PLACEMENT`/`MASTERS_POINTS` table (`SeasonTournamentType = 'community_club' | 'masters'`) — but `lib/matches/season-points.ts`'s coin/XP loop hardcodes `placementForBand('community_club', band)` for every tournament type, so a Masters tournament's players got Community Club's coin/XP amounts instead of Masters'. Champions Cup had no placement table anywhere in the codebase — confirmed with the product owner 2026-08-15, who supplied real values (below), scaled above Masters' own champion reward (+500 coins/+1000 XP per the original Phase 2 design doc) since Champions Cup is the higher-stakes event:

| Placement | Coins | XP |
|---|---|---|
| 1st | 2,000 | 3,000 |
| 2nd | 1,200 | 2,000 |
| 3rd–4th | 800 | 1,200 |
| 5th–8th | 400 | 600 |
| 9th–16th | 150 | 250 |

Champions Cup does **not** gain a `season_ranking_points` entry either way — Global Constraints #3 from the original Phase 2 plan deliberately keeps that table scoped to `community_club`/`masters` only, and this table doesn't change that. Task 4.3 implements Champions Cup's reward table as its own standalone mapping in `season-points.ts` (not by extending `SeasonTournamentType`, which specifically represents "types that earn season ranking points" and must stay that way).

---

## Part 1 — Mobile responsiveness (Priority 2)

### Task 1.1: `/admin/store` — stop the whole page scrolling sideways on mobile

**Files:**
- Modify: `app/admin/store/page.tsx`

**Interfaces:** None — pure markup change, no new exports.

- [ ] **Step 1: Reproduce structurally**

Read the current file. Confirm the `<table>` (currently `className="mt-8 w-full text-sm text-slate-300"`) has no `overflow-x-auto` wrapper — so when the row content (item name + category + price input + two action forms per `components/admin/StoreItemForm.tsx`'s edit mode) is wider than the viewport, the whole `<div className="mx-auto max-w-5xl px-4 py-8">` page scrolls horizontally instead of just the table.

- [ ] **Step 2: Wrap the table in its own horizontal-scroll container**

In `app/admin/store/page.tsx`, change:

```tsx
      <table className="mt-8 w-full text-sm text-slate-300">
```

to:

```tsx
      <div className="mt-8 overflow-x-auto">
      <table className="w-full text-sm text-slate-300">
```

and close the new wrapper `</div>` right after the existing `</table>`. Read the current file first to get the exact surrounding indentation and the exact line the `</table>` closes on — this is a two-line structural change (open the wrapper before `<table>`, close it after `</table>`), not a full rewrite.

- [ ] **Step 3: Manual verification**

Run `npm run build` (confirms no JSX syntax error from the wrapper). A true mobile-width visual check isn't possible in this sandbox (Chrome automation can't emulate <640px viewports here — confirmed earlier this project) — note in your report that this was a structural fix verified by build only, consistent with how every UI task in the Phase 2 plan handled this same limitation.

- [ ] **Step 4: Run tests + build**

Run: `npm run test && npm run build`.

- [ ] **Step 5: Commit**

```bash
git add app/admin/store/page.tsx
git commit -m "fix(admin): scope /admin/store's horizontal scroll to the table, not the page"
```

---

### Task 1.2: `/players/[username]` — audit and fix mobile horizontal overflow

**Files:**
- Modify: whichever of the following are found to actually overflow (audit first, this is not a blind find-and-replace): `app/(public)/players/[username]/page.tsx`, `components/player/ProfileHeader.tsx`, `components/player/ProfileStats.tsx`, `components/player/AchievementsGrid.tsx`, `components/player/ProfileGamesRow.tsx`, `components/player/ProfileMatchHistory.tsx`, `components/player/ProfileRecentActivity.tsx`, `components/player/CareerStatsRadar.tsx`

**Interfaces:** None — markup-only changes, no signature changes to any component.

- [ ] **Step 1: Audit for real overflow sources first**

A sampling pass during planning (grep for `w-[`, `min-w-[`, `whitespace-nowrap` across the main profile components) found **no obvious fixed-width culprit** in `ProfileStats.tsx` (responsive grid, no fixed widths), `AchievementsGrid.tsx` (responsive grid), or `CareerStatsRadar.tsx` (SVG already uses `viewBox` + `w-full max-w-[220px]`). `ProfileGamesRow.tsx`'s `overflow-x-auto` horizontal scroll strip is intentional (a "Games You Play" carousel), not a bug. This means the actual overflow source — if it's real and not from a component fixed since this plan was written — is likely in a file not yet sampled (`ProfileHeader.tsx`, `ProfileMatchHistory.tsx`, `ProfileRecentActivity.tsx`, or the page's own top-level layout), or in markup added by a component this plan's author didn't have visibility into.

Do this audit yourself, from scratch, before changing anything:
1. `grep -rn "w-\[[0-9]\|min-w-\[[0-9]\|whitespace-nowrap" app/(public)/players components/player` — anything with a fixed pixel width or forced nowrap is a candidate.
2. Read `components/player/ProfileHeader.tsx` in full (it wasn't sampled during planning) — this is the most likely remaining culprit given it renders the avatar, username, country flag, tier badges, and (as of Task 3.3 below, if that task lands first) a coin balance chip, all in one row that could force width on narrow screens if it isn't wrapping.
3. Use `javascript_tool` against the **deployed** site (not localhost — confirmed unreliable for width emulation in this project) if browser tools are available, checking `document.body.scrollWidth > window.innerWidth` at a real narrow viewport, per the pattern documented in this project's own memory for verifying mobile layout without live screenshots. If browser tools aren't available in your environment, do the static audit only and say so in your report.

- [ ] **Step 2: Fix what you find**

For each real overflow source: replace any fixed `w-[Npx]`/`min-w-[Npx]` that isn't inside an intentionally-horizontal-scrolling strip (like `ProfileGamesRow`'s carousel) with `w-full` or a responsive `max-w-*`, add `flex-wrap` to any single-row flex layout that doesn't already have it, and add `truncate` or `break-words` to any text node that could overflow its container at 375px (this also covers the "words are also being cut off" half of the original Priority 3 career-stats report — that's a truncation/overflow issue, addressed here, not a data-fetching issue per Part 0).

- [ ] **Step 3: Run tests + build**

Run: `npm run test && npm run build`.

- [ ] **Step 4: Commit**

```bash
git add <files you actually changed>
git commit -m "fix(profile): resolve mobile horizontal overflow on /players/[username]"
```

Report exactly what you found and fixed — if the audit genuinely finds nothing (page is already responsive as sampled), say so explicitly rather than making a cosmetic change to justify the task.

---

## Part 2 — Logic bugs (Priority 3, minus the declined items in Part 0)

### Task 2.1: Gate the Settings/Wallet sidebar links to the profile's own owner

**Files:**
- Modify: `components/player/ProfileSidebarNav.tsx`
- Modify: `app/(public)/players/[username]/page.tsx`

**Interfaces:**
- Produces: `ProfileSidebarNav({ isOwner }: { isOwner: boolean })` — breaking change to this component's props (currently takes none); its one call site is updated in the same task.

- [ ] **Step 1: Confirm the bug**

`components/player/ProfileSidebarNav.tsx` renders a fixed `ITEMS` array including `{ href: '/dashboard', label: 'Wallet & Rewards', ... }` and `{ href: '/dashboard', label: 'Settings', ... }` unconditionally, for every visitor. Both route to `/dashboard` — the *viewer's own* dashboard, not the profile owner's. A visitor looking at someone else's profile who clicks "Settings" lands on their own dashboard (or gets redirected to login if logged out), which reads as broken/misleading. `app/(public)/players/[username]/page.tsx:378` calls `<ProfileSidebarNav />` with no props, even though the page already computes `user?.id === p.id` earlier (for the owner-only coin balance chip) — the ownership check exists, it just isn't threaded through to this component.

- [ ] **Step 2: Add the `isOwner` prop**

In `components/player/ProfileSidebarNav.tsx`, change the component to:

```tsx
import Link from 'next/link'
import { User, BarChart3, Medal, ListChecks, Wallet, Settings } from 'lucide-react'

// In-page section jumps for the sections that actually exist on this page;
// Wallet & Settings route to the real Dashboard panels that already own that
// functionality rather than duplicating them here — shown ONLY to the
// profile's own owner, since both links point at the viewer's own /dashboard,
// which is meaningless (and misleading) for anyone viewing someone else's profile.
const BASE_ITEMS = [
  { href: '#top', label: 'Profile Overview', Icon: User, active: true },
  { href: '#stats', label: 'Stats & Games', Icon: BarChart3, active: false },
  { href: '#achievements', label: 'Achievements', Icon: Medal, active: false },
  { href: '#match-history', label: 'Match History', Icon: ListChecks, active: false },
]
const OWNER_ONLY_ITEMS = [
  { href: '/dashboard', label: 'Wallet & Rewards', Icon: Wallet, active: false },
  { href: '/dashboard', label: 'Settings', Icon: Settings, active: false },
]

export function ProfileSidebarNav({ isOwner }: { isOwner: boolean }) {
  const items = isOwner ? [...BASE_ITEMS, ...OWNER_ONLY_ITEMS] : BASE_ITEMS
  return (
    <nav className="rounded-xl border border-sx-border bg-sx-surface p-2">
      {items.map((item) => (
        <Link
          key={item.label}
          href={item.href}
          className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
            item.active
              ? 'border-l-2 border-sx-purple bg-sx-purple/15 text-white'
              : 'text-sx-gray hover:bg-sx-purple/10 hover:text-white'
          }`}
        >
          <item.Icon className="h-4 w-4 shrink-0" />
          {item.label}
        </Link>
      ))}
    </nav>
  )
}
```

Leave `ProfileTournamentsPromo` in this same file untouched — copy it forward exactly as it already is.

- [ ] **Step 3: Wire the prop at the call site**

In `app/(public)/players/[username]/page.tsx`, read the file first to find the exact variable name already in scope for the owner check (it's used for the coin-balance gate — likely `user?.id === p.id`, confirm the real names). Change:

```tsx
          <ProfileSidebarNav />
```

to:

```tsx
          <ProfileSidebarNav isOwner={!!user && user.id === p.id} />
```

using whatever the real `user`/`p` (or equivalent) variable names are in that file — do not introduce a second lookup, reuse the existing check.

- [ ] **Step 4: Run tests + build**

Run: `npm run test && npm run build`.

- [ ] **Step 5: Commit**

```bash
git add components/player/ProfileSidebarNav.tsx "app/(public)/players/[username]/page.tsx"
git commit -m "fix(profile): hide Wallet/Settings sidebar links from non-owner visitors"
```

---

### Task 2.2: Distinguish the two tier badges so they don't read as a contradiction

**Files:**
- Modify: `components/rankings/LeaderboardTable.tsx`
- Modify: `components/player/ProfileHeader.tsx` (wherever it also renders both badges together, per Task 6.1 of the Phase 2 plan — read the file to find the exact spot)

**Interfaces:** None — presentational only, no prop/type changes.

- [ ] **Step 1: Confirm there is no actual duplication bug**

Already confirmed during planning (Part 0) — do not re-litigate this, just apply the fix below. `TierBadge` and `MembershipBadge` read two different real columns and are called exactly once each, in both files. The fix is presentational clarity, not deduplication.

- [ ] **Step 2: Add a distinguishing `title` attribute (tooltip) to each badge**

The cheapest, least invasive fix that doesn't touch either badge component's own styling: wrap each badge render in a `title` attribute explaining what it measures, so hovering (desktop) or long-pressing (mobile) clarifies the two scales without changing the visual layout. In `components/rankings/LeaderboardTable.tsx`, change:

```tsx
                          <TierBadge tier={pl.sentinelTier} />
                          <MembershipBadge tier={pl.membershipTier} />
```

to:

```tsx
                          <span title="SX Score reliability tier">
                            <TierBadge tier={pl.sentinelTier} />
                          </span>
                          <span title="XP membership level">
                            <MembershipBadge tier={pl.membershipTier} />
                          </span>
```

Apply the identical pattern (same two `title` strings, same wrapping structure) to the equivalent spot in `components/player/ProfileHeader.tsx` — read the file first to find its exact `<TierBadge .../>` / `<MembershipBadge .../>` call site (added in Phase 2 Task 6.1) and match the surrounding JSX indentation/structure there rather than copy-pasting LeaderboardTable's exact whitespace.

- [ ] **Step 3: Run tests + build**

Run: `npm run test && npm run build`.

- [ ] **Step 4: Commit**

```bash
git add components/rankings/LeaderboardTable.tsx components/player/ProfileHeader.tsx
git commit -m "fix(ui): distinguish SX tier vs membership tier badges with tooltips"
```

---

### Task 2.3: Season leaderboard — show every registered player, not just those with a points/penalty row

**Files:**
- Modify: `lib/seasons/data.ts`
- Modify: `lib/seasons/data.test.ts` (create if it doesn't exist yet — check first)

**Interfaces:**
- Consumes: existing `sumPointsByPlayer`, `playerProfiles`, `toRows` helpers already in `lib/seasons/data.ts` — read the file in full before editing, this task extends `getSeasonLeaderboard`, it does not rewrite the file's other exports (`getMonthlyLeaderboard` is untouched).
- Produces: `getSeasonLeaderboard(admin, seasonId)` keeps its exact existing signature and return type (`Promise<SeasonLeaderboardRow[]>`) — only its internal player set changes, from "players with a points/penalty row" to "every player registered in a community_club/masters tournament in this season."

- [ ] **Step 1: Understand the current gap precisely**

Read `lib/seasons/data.ts`'s current `getSeasonLeaderboard` (lines ~59-71 as of this plan's writing — confirm the real current lines). It already correctly **sums** `season_ranking_points` and `season_noshow_penalties` together per player (via `sumPointsByPlayer` over the concatenation of both) — the "must also sum season_noshow_penalties alongside placement points" half of the original request is **already implemented**, no change needed there. The real gap: `totals.keys()` (used to build the row set) only contains players who have at least one row in one of those two tables. A player registered in a season tournament who simply hasn't had a match resolve yet — or, right now, a player in the still-in-progress Community Cup, since `season_ranking_points` only populates at tournament completion (see Part 0) — never appears at all, at 0 points, even though they're a real season participant.

- [ ] **Step 2: Write the failing test**

Check whether `lib/seasons/data.test.ts` exists; if not, create it. Add (alongside whatever existing tests are already there — do not replace the file, extend it):

```ts
import { describe, it, expect, vi } from 'vitest'
import { getSeasonLeaderboard } from './data'

function fakeAdmin(opts: {
  registeredPlayerIds: string[]
  pointsRows: { player_id: string; points: number }[]
  penaltyRows: { player_id: string; points: number }[]
  profiles: { id: string; username: string; display_name: string | null; avatar_url: string | null }[]
}) {
  return {
    from(table: string) {
      if (table === 'season_ranking_points') {
        return { select: () => ({ eq: async () => ({ data: opts.pointsRows }) }) }
      }
      if (table === 'season_noshow_penalties') {
        return { select: () => ({ eq: async () => ({ data: opts.penaltyRows }) }) }
      }
      if (table === 'tournament_registrations') {
        return {
          select: () => ({
            eq: () => ({
              eq: async () => ({ data: opts.registeredPlayerIds.map((player_id) => ({ player_id })) }),
            }),
          }),
        }
      }
      if (table === 'tournaments') {
        return {
          select: () => ({
            eq: () => ({
              in: async () => ({ data: [{ id: 't1' }] }),
            }),
          }),
        }
      }
      if (table === 'profiles') {
        return { select: () => ({ in: async () => ({ data: opts.profiles }) }) }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

describe('getSeasonLeaderboard', () => {
  it('includes a registered player with zero points, not just players with a points/penalty row', async () => {
    const admin = fakeAdmin({
      registeredPlayerIds: ['p1', 'p2'],
      pointsRows: [{ player_id: 'p1', points: 500 }],
      penaltyRows: [],
      profiles: [
        { id: 'p1', username: 'winner', display_name: null, avatar_url: null },
        { id: 'p2', username: 'still-competing', display_name: null, avatar_url: null },
      ],
    })
    const rows = await getSeasonLeaderboard(admin as never, 's1')
    const usernames = rows.map((r) => r.username).sort()
    expect(usernames).toEqual(['still-competing', 'winner'])
    const zero = rows.find((r) => r.username === 'still-competing')
    expect(zero?.points).toBe(0)
  })
})
```

Adjust the mock's exact chain shapes (`.eq()` vs `.eq().eq()` etc.) to match whatever the real `tournament_registrations`/`tournaments` query in Step 3 actually issues — write the implementation first if the exact query shape isn't obvious from reading the file alone, then come back and align the mock, rather than guessing the chain depth blind. The point of this test is the **assertion** (zero-point registered player appears), not the mock's exact plumbing.

- [ ] **Step 2b: Run to verify it fails**

Run: `npx vitest run lib/seasons/data.test.ts` — expect FAIL (the player with no points row currently doesn't appear).

- [ ] **Step 3: Implement — fetch the registered player set and LEFT JOIN it in**

Modify `getSeasonLeaderboard` in `lib/seasons/data.ts`. The season's community_club/masters tournaments need to be found first (to know which `tournament_registrations` rows are "in this season"), then every active registration in those tournaments becomes a guaranteed row, defaulting to 0 points if they have no points/penalty entry yet:

```ts
export async function getSeasonLeaderboard(admin: Admin, seasonId: string): Promise<SeasonLeaderboardRow[]> {
  const { data: seasonTournaments } = await admin
    .from('tournaments')
    .select('id')
    .eq('season_id', seasonId)
    .in('tournament_type', ['community_club', 'masters'])
  const tournamentIds = (seasonTournaments ?? []).map((t) => t.id)

  const [{ data: registrations }, { data: pointsRows }, { data: penaltyRows }] = await Promise.all([
    tournamentIds.length > 0
      ? admin.from('tournament_registrations').select('player_id').in('tournament_id', tournamentIds).eq('status', 'active')
      : Promise.resolve({ data: [] as { player_id: string }[] }),
    admin.from('season_ranking_points').select('player_id, points').eq('season_id', seasonId),
    admin.from('season_noshow_penalties').select('player_id, points').eq('season_id', seasonId),
  ])

  const rows: PointsRow[] = [
    ...(pointsRows ?? []).map((r) => ({ playerId: r.player_id, points: r.points })),
    ...(penaltyRows ?? []).map((r) => ({ playerId: r.player_id, points: r.points })),
  ]
  const totals = sumPointsByPlayer(rows)

  // Guarantee every actively-registered season player appears, even at 0.
  for (const reg of registrations ?? []) {
    if (!totals.has(reg.player_id)) totals.set(reg.player_id, 0)
  }

  const profiles = await playerProfiles(admin, Array.from(totals.keys()))
  return toRows(totals, profiles)
}
```

Read `sumPointsByPlayer`'s real signature first (does it return a `Map<string, number>`? confirm before assuming `.has`/`.set` work directly on its return value — adjust if it's a plain object instead) and adjust the "guarantee" loop to match whatever data structure it actually returns.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/seasons/data.test.ts` — expect PASS.

- [ ] **Step 5: Run the full seasons suite + build**

Run: `npx vitest run lib/seasons && npm run build`.

- [ ] **Step 6: Commit**

```bash
git add lib/seasons/data.ts lib/seasons/data.test.ts
git commit -m "fix(seasons): season leaderboard shows every registered player, not just those with points"
```

---

## Part 3 — Navigation gaps (Priority 4)

### Task 3.1: `/admin/players` — searchable player list linking to each player's detail page

**Files:**
- Create: `app/admin/players/page.tsx`
- Modify: `lib/admin/nav.ts`

**Interfaces:**
- Consumes: `requireStaff` (`lib/admin/auth.ts`), `createAdminClient` (`lib/supabase/admin.ts`) — same auth pattern as every other `/admin/*` page in this codebase.
- Produces: nothing consumed by a later task — this is a leaf page.

- [ ] **Step 1: Read an existing admin list page for the real pattern**

Read `app/admin/store/page.tsx` (simple list+table) and, for search specifically, read `lib/admin/search.ts` (`matchesPlayerQuery`, already used by `components/admin/RegistrationsTable.tsx`) — reuse that exact helper rather than writing new search logic. This is a Server Component with a `?q=` search param, following the same `searchParams` convention already used elsewhere in `/admin` (check `app/admin/tournaments/[id]/registrations/page.tsx` for the exact `searchParams` prop shape this Next.js version expects).

- [ ] **Step 2: Build the page**

```tsx
// app/admin/players/page.tsx
import type { Metadata } from 'next'
import Link from 'next/link'
import { requireStaff } from '@/lib/admin/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { matchesPlayerQuery } from '@/lib/admin/search'

export const metadata: Metadata = { title: 'Players · Admin · SentinelX' }

export default async function AdminPlayersPage({
  searchParams,
}: {
  searchParams: { q?: string }
}) {
  await requireStaff()
  const admin = createAdminClient()
  const { data: players } = await admin
    .from('profiles')
    .select('id, username, display_name, sx_score, membership_tier, total_matches')
    .order('username')

  const q = searchParams.q?.trim() ?? ''
  const filtered = (players ?? []).filter(
    (p) => !q || matchesPlayerQuery(q, { username: p.username, displayName: p.display_name }),
  )

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-black text-white">Players</h1>
      <form className="mb-6" method="get">
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="Search by username or display name…"
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
        />
      </form>
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-slate-300">
          <thead className="text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="py-2">Player</th>
              <th>SX Score</th>
              <th>Tier</th>
              <th>Matches</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.id} className="border-t border-slate-800">
                <td className="py-2">{p.display_name ?? p.username}</td>
                <td>{p.sx_score}</td>
                <td className="capitalize">{p.membership_tier}</td>
                <td>{p.total_matches}</td>
                <td className="py-2 text-right">
                  <Link
                    href={`/admin/players/${p.id}`}
                    className="rounded-lg border border-slate-700 px-2 py-1 text-xs font-bold text-slate-300 hover:border-slate-500"
                  >
                    Manage
                  </Link>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-slate-500">
                  No players match "{q}".
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

Confirm `matchesPlayerQuery`'s real signature by reading `lib/admin/search.ts` first — the call above assumes `matchesPlayerQuery(query, { username, displayName })`; adjust the call to match whatever the real signature is (parameter order, field names) rather than assuming this plan guessed it exactly right.

- [ ] **Step 3: Add "Players" to the admin sidebar nav**

Read `lib/admin/nav.ts` in full. Add a new entry — match the existing entries' exact shape (`{ label, href, adminOnly? }`); this page uses `requireStaff` (not `requireAdmin`) so it should NOT be marked `adminOnly: true` — moderators should be able to look players up too, same as the registrations list they already have access to. Place it near "Registrations" or "Wallet" in the existing order, matching whatever grouping logic the file already uses.

- [ ] **Step 4: Run tests + build**

Run: `npm run test && npm run build`. Confirm `/admin/players` and `/admin/players/[id]` (already existing) both appear in the route list.

- [ ] **Step 5: Commit**

```bash
git add app/admin/players/page.tsx lib/admin/nav.ts
git commit -m "feat(admin): add searchable /admin/players list page"
```

---

### Task 3.2: Link `/rankings` to `/hall-of-fame`

**Files:**
- Modify: `app/(public)/rankings/page.tsx` (or `components/rankings/LeaderboardTabs.tsx` if the tab bar is the better home for it — read both first and pick the one that already renders the page's top-level navigation controls)

**Interfaces:** None.

- [ ] **Step 1: Find the right spot**

Read `app/(public)/rankings/page.tsx` and `components/rankings/LeaderboardTabs.tsx`. Confirmed during planning: neither currently links to `/hall-of-fame` anywhere. Find wherever the page's own tab/section controls live (e.g., near the Wins/Score/Goals tab switcher) and add a same-style link/button next to it — match the existing tab buttons' exact class names so the new link doesn't look visually distinct from a real tab, unless the existing controls are clearly a different kind of element (in which case style it as a clearly-separate "Hall of Fame →" link instead of a fake tab).

- [ ] **Step 2: Add the link**

Exact markup depends on what Step 1 finds — this is not a blind snippet to copy, read the surrounding JSX and match its structure. At minimum it must be a real `<Link href="/hall-of-fame">Hall of Fame</Link>` (import `Link` from `next/link`, not a raw `<a>`), visible without scrolling on both mobile and desktop.

- [ ] **Step 3: Run tests + build**

Run: `npm run test && npm run build`.

- [ ] **Step 4: Commit**

```bash
git add <the file(s) you changed>
git commit -m "feat(rankings): add Hall of Fame link to the leaderboard page"
```

---

## Part 4 — Close known Phase 2 gaps (Priority 5)

### Task 4.1: Render equipped cosmetics on the player profile

**Files:**
- Create: `lib/store/cosmetics.ts`
- Create: `lib/store/cosmetics.test.ts`
- Modify: `app/(public)/players/[username]/page.tsx`
- Modify: `components/player/ProfileHeader.tsx`

**Interfaces:**
- Produces: `AVATAR_BORDER_CLASSES: Record<string, string>`, `PROFILE_THEME_CLASSES: Record<string, string>`, `USERNAME_COLOUR_CLASSES: Record<string, string>` (all keyed by `store_items.slug`), plus a pure helper `equippedCosmeticsBySlug(rows: { item_id: string; equipped: boolean; store_items: { slug: string; category: string } }[]): { avatarBorder: string | null; profileTheme: string | null; usernameColour: string | null }` — consumed by the profile page, which passes the three resolved values into `ProfileHeader` as new optional props.

Scope note: the product owner's request named exactly three categories — `avatar_border`, `profile_theme`, `username_colour`. `bubble_skin` (the fourth store category) was not requested here and is NOT part of this task; it affects the global mascot bubble component, not the profile page, and is a separate, larger piece of work. Leave it unimplemented and say so in your report.

- [ ] **Step 1: Write the failing test for the pure mapping function**

```ts
// lib/store/cosmetics.test.ts
import { describe, it, expect } from 'vitest'
import { equippedCosmeticsBySlug } from './cosmetics'

describe('equippedCosmeticsBySlug', () => {
  it('resolves one equipped item per category, ignoring unequipped ones', () => {
    const result = equippedCosmeticsBySlug([
      { item_id: 'a', equipped: true, store_items: { slug: 'avatar_border_gold_crown', category: 'avatar_border' } },
      { item_id: 'b', equipped: false, store_items: { slug: 'avatar_border_bronze', category: 'avatar_border' } },
      { item_id: 'c', equipped: true, store_items: { slug: 'theme_neon_grid', category: 'profile_theme' } },
      { item_id: 'd', equipped: true, store_items: { slug: 'username_gold', category: 'username_colour' } },
      { item_id: 'e', equipped: true, store_items: { slug: 'bubble_gold_mascot', category: 'bubble_skin' } },
    ])
    expect(result).toEqual({
      avatarBorder: 'avatar_border_gold_crown',
      profileTheme: 'theme_neon_grid',
      usernameColour: 'username_gold',
    })
  })

  it('returns all-null when nothing is equipped', () => {
    expect(equippedCosmeticsBySlug([])).toEqual({ avatarBorder: null, profileTheme: null, usernameColour: null })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/store/cosmetics.test.ts` — expect FAIL, module doesn't exist.

- [ ] **Step 3: Implement**

```ts
// lib/store/cosmetics.ts

// Visual mapping for each of the 13 seeded store items (supabase/migrations/052_sx_coins_store.sql).
// bubble_skin is deliberately excluded — out of scope, see plan Task 4.1.
export const AVATAR_BORDER_CLASSES: Record<string, string> = {
  avatar_border_bronze: 'ring-4 ring-amber-700',
  avatar_border_purple_glow: 'ring-4 ring-sx-purple shadow-[0_0_16px_2px_rgba(124,58,237,0.55)]',
  avatar_border_gold_crown: 'ring-4 ring-amber-400 shadow-[0_0_16px_2px_rgba(251,191,36,0.5)]',
}

export const PROFILE_THEME_CLASSES: Record<string, string> = {
  theme_dark_void: 'bg-black',
  theme_neon_grid:
    'bg-[linear-gradient(rgba(124,58,237,0.12)_1px,transparent_1px),linear-gradient(90deg,rgba(124,58,237,0.12)_1px,transparent_1px)] bg-[size:22px_22px] bg-slate-950',
  theme_lagos_skyline: 'bg-gradient-to-b from-orange-950 via-slate-900 to-slate-950',
}

export const USERNAME_COLOUR_CLASSES: Record<string, string> = {
  username_purple: 'text-sx-purple-text',
  username_gold: 'text-amber-400',
  username_red: 'text-red-400',
  username_teal: 'text-teal-400',
}

interface EquippedRow {
  item_id: string
  equipped: boolean
  store_items: { slug: string; category: string } | { slug: string; category: string }[] | null
}

export interface EquippedCosmetics {
  avatarBorder: string | null
  profileTheme: string | null
  usernameColour: string | null
}

// Pure — unit tested directly. Resolves the *slug* of the one equipped item
// per relevant category (bubble_skin excluded, see plan). Callers look the
// slug up in the *_CLASSES maps above to get the actual Tailwind classes;
// an equipped slug with no map entry (e.g. a future item added to the store
// without a matching visual yet) resolves to no visual change, not a crash.
export function equippedCosmeticsBySlug(rows: EquippedRow[]): EquippedCosmetics {
  const result: EquippedCosmetics = { avatarBorder: null, profileTheme: null, usernameColour: null }
  for (const row of rows) {
    if (!row.equipped) continue
    const item = Array.isArray(row.store_items) ? row.store_items[0] : row.store_items
    if (!item) continue
    if (item.category === 'avatar_border') result.avatarBorder = item.slug
    else if (item.category === 'profile_theme') result.profileTheme = item.slug
    else if (item.category === 'username_colour') result.usernameColour = item.slug
  }
  return result
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/store/cosmetics.test.ts` — expect PASS.

- [ ] **Step 5: Fetch equipped items on the profile page and pass them through**

Read `app/(public)/players/[username]/page.tsx` in full first to find its existing `Promise.all` (already fetching `player_achievements`, coin balance, etc. per the Phase 2 merge) and its existing `<ProfileHeader ... />` call site. Add one more query to the same `Promise.all`:

```ts
admin
  .from('player_store_items')
  .select('item_id, equipped, store_items(slug, category)')
  .eq('player_id', p.id)
  .eq('equipped', true),
```

using whichever client (`admin`/`supabase`, `p.id`/`profile.id`) the file already uses for the equivalent achievements query — match its exact variable names, don't introduce new ones. Then:

```ts
import { equippedCosmeticsBySlug, AVATAR_BORDER_CLASSES, PROFILE_THEME_CLASSES, USERNAME_COLOUR_CLASSES } from '@/lib/store/cosmetics'
// ...
const cosmetics = equippedCosmeticsBySlug(equippedItemsRes.data ?? [])
```

(name `equippedItemsRes` to match whatever destructuring pattern the file's existing `Promise.all` results already use). Pass three new values into the existing `<ProfileHeader ... />` call:

```tsx
avatarBorderClass={cosmetics.avatarBorder ? AVATAR_BORDER_CLASSES[cosmetics.avatarBorder] : undefined}
profileThemeClass={cosmetics.profileTheme ? PROFILE_THEME_CLASSES[cosmetics.profileTheme] : undefined}
usernameColourClass={cosmetics.usernameColour ? USERNAME_COLOUR_CLASSES[cosmetics.usernameColour] : undefined}
```

- [ ] **Step 6: Apply the three visuals in `ProfileHeader`**

Read `components/player/ProfileHeader.tsx` in full. Add the three new optional props to its existing prop type (`avatarBorderClass?: string`, `profileThemeClass?: string`, `usernameColourClass?: string`), then:
- Find the avatar `<img>`/`<Avatar>` element and append `avatarBorderClass` (via `cn`/template-literal, matching however this file already composes conditional classNames) to its existing className.
- Find the outermost card/container `<div>` this header renders and append `profileThemeClass` to its existing className.
- Find the `<h1>`/username text node and append `usernameColourClass` to its existing className — if it already has a hardcoded text color class, the cosmetic class must come after it in the className string so Tailwind's later-wins-on-conflict ordering (or your existing `cn` merge utility, if one is used elsewhere in this codebase — check `lib/utils.ts` or similar before assuming plain string concatenation) makes the cosmetic win.

Do not guess these three element locations — read the file and find the real ones. If any of the three target elements don't exist in the shape this task assumes (e.g., no single avatar `<img>`, or the theme belongs on a different wrapping element), adapt to the real structure and note the adaptation in your report.

- [ ] **Step 7: Run tests + build**

Run: `npm run test && npm run build`.

- [ ] **Step 8: Commit**

```bash
git add lib/store/cosmetics.ts lib/store/cosmetics.test.ts "app/(public)/players/[username]/page.tsx" components/player/ProfileHeader.tsx
git commit -m "feat(store): render equipped avatar border, profile theme, and username colour"
```

---

### Task 4.2: Inactive store items must not be readable by non-staff

**Files:**
- Create: `supabase/migrations/0NN_store_items_active_rls.sql` (check `supabase/migrations/` at task time for the real next number)

**Interfaces:** None — pure RLS policy change, no application code changes (the public `/store` page already filters `.eq('active', true)` in its own query and is unaffected; `/admin/store` uses the service-role client and is also unaffected).

- [ ] **Step 1: Confirm the current gap**

Migration `052_sx_coins_store.sql` created `store_items` with `CREATE POLICY "store_items_read" ON public.store_items FOR SELECT USING (true)` — unconditional public read, including inactive rows. That policy's own comment says filtering was meant to happen "in the query layer, not RLS" for the public page — true for the app's own code, but it means anyone with the anon key can read an unreleased/inactive item's name, price, and description directly via the REST API, bypassing the app entirely.

- [ ] **Step 2: Write the migration**

```sql
-- 0NN_store_items_active_rls.sql
-- Restrict store_items read access to active items for anon/authenticated
-- clients; staff (via is_staff()) can still see inactive items directly,
-- matching what /admin/store already relies on via the service-role client
-- (service-role bypasses RLS entirely regardless, so this only tightens
-- what the anon/authenticated roles can see).
DROP POLICY IF EXISTS "store_items_read" ON public.store_items;
CREATE POLICY "store_items_read" ON public.store_items
  FOR SELECT USING (active = true OR public.is_staff());
```

Confirm `public.is_staff()` is the real, already-existing function name (used elsewhere, e.g. migration `001_initial_schema.sql`'s `sse_read` policy referenced it as `is_staff()` pre-Phase-2, and Phase 2's own migrations reference `public.is_staff()`) — use whichever the codebase's most recent migrations actually call it.

- [ ] **Step 3: Apply, verify, commit**

Apply via the Supabase CLI (global `supabase` install, confirmed working this session — do not use `npx supabase`). After applying, verify directly: an anon-key `GET /rest/v1/store_items?active=eq.false` should return an empty array (or only rows if a staff JWT were used, which anon isn't). No `lib/supabase/types.ts` regeneration is needed (RLS policy changes don't alter the generated schema shape).

```bash
git add supabase/migrations/0NN_store_items_active_rls.sql
git commit -m "fix(store): restrict inactive store_items to staff via RLS"
```

---

### Task 4.3: Award each tournament type its own placement coins/XP — Masters and Champions Cup

**Files:**
- Modify: `lib/matches/season-points.ts`
- Modify: `lib/matches/season-points.test.ts`

**Interfaces:**
- Consumes: `placementForBand`, `SeasonTournamentType`, `PlacementBand` (`lib/tournaments/season-placement.ts`, unchanged) — `SeasonTournamentType` stays `'community_club' | 'masters'` only (it specifically represents "types that earn a `season_ranking_points` row"; Champions Cup is intentionally NOT added to it — see Part 0).
- Produces: two new local (not exported) reward tables in `season-points.ts`: `CHAMPIONS_CUP_PLACEMENT: Record<PlacementBand, number>`, `CHAMPIONS_CUP_COINS: Record<number, number>`, `CHAMPIONS_CUP_XP: Record<number, number>`.

- [ ] **Step 1: Write the failing tests**

Read the current `lib/matches/season-points.test.ts` in full first (don't replace it, extend it). Read `lib/tournaments/season-placement.ts`'s real `MASTERS_PLACEMENT` table to confirm the divergent-band assertion below is accurate against the actual current values before trusting it verbatim. Add:

```ts
it('uses the Masters placement table for Masters coin/XP, not Community Club\'s', async () => {
  const { awardCoins } = await import('@/lib/coins/service')
  vi.mocked(awardCoins).mockClear()
  // Community Club: quarter_final -> placement 5 -> 75 coins.
  // Masters: quarter_final -> placement 5 too (same band->number here), so
  // use round_of_16 instead, where the two tables diverge in practice only
  // via which real matches reach that band — the coin/XP AMOUNT at a given
  // *placement number* (PLACEMENT_COINS/PLACEMENT_XP) is shared between
  // community_club and masters today (only Champions Cup gets a distinct
  // reward table in this task). This test therefore asserts Masters
  // resolves through placementForBand('masters', ...) rather than
  // ('community_club', ...) by checking the numeric placement value itself
  // matches MASTERS_PLACEMENT.quarter_final, not community_club's — if
  // your read of season-placement.ts shows the two tables produce an
  // identical number for every band (making this assertion untestable via
  // the coin AMOUNT), assert against a spy/mock call argument for the
  // `placement` value passed into checkAndUnlockAchievements's context
  // instead, which directly reveals which table resolved.
  const { client } = fakeAdmin({
    tournament: { id: 't3', tournament_type: 'masters', season_id: 's1' },
    registrations: [{ player_id: 'winner' }, { player_id: 'loser' }],
    matches: [{ ...championMatch, round: 'quarter_final', status: 'completed' }],
  })
  await awardSeasonPoints(client as never, 't3')
  // Confirm real MASTERS_PLACEMENT.quarter_final value from season-placement.ts
  // before finalizing this expectation — do not guess it.
})

it('awards Champions Cup its own, higher-value placement table', async () => {
  const { awardCoins } = await import('@/lib/coins/service')
  const { awardXP } = await import('@/lib/membership/xp')
  vi.mocked(awardCoins).mockClear()
  vi.mocked(awardXP).mockClear()
  const { client } = fakeAdmin({
    tournament: { id: 't4', tournament_type: 'champions_cup', season_id: null },
    registrations: [{ player_id: 'winner' }, { player_id: 'loser' }],
    matches: [championMatch],
  })
  await awardSeasonPoints(client as never, 't4')
  expect(awardCoins).toHaveBeenCalledWith(client, 'winner', 2000, 'tournament_placement', 't4')
  expect(awardXP).toHaveBeenCalledWith(client, 'winner', 3000, 'tournament_placement', 't4')
  expect(awardCoins).toHaveBeenCalledWith(client, 'loser', 1200, 'tournament_placement', 't4')
  expect(awardXP).toHaveBeenCalledWith(client, 'loser', 2000, 'tournament_placement', 't4')
})
```

- [ ] **Step 2: Run to verify both fail**

Run: `npx vitest run lib/matches/season-points.test.ts` — expect FAIL (current code always uses `'community_club'`'s shared reward table for every tournament type, including Champions Cup which today gets Community Club's 500/500 champion reward instead of 2000/3000).

- [ ] **Step 3: Implement — Champions Cup's own placement + reward tables**

In `lib/matches/season-points.ts`, add alongside the existing `PLACEMENT_COINS`/`PLACEMENT_XP`:

```ts
// Champions Cup — higher-stakes invitational, own reward scale entirely
// (values confirmed with product owner 2026-08-15, scaled above Masters'
// own +500 coins/+1000 XP champion reward per the original Phase 2 design
// doc). Band->placement mapping mirrors COMMUNITY_CLUB_PLACEMENT/
// MASTERS_PLACEMENT in lib/tournaments/season-placement.ts, but is defined
// here rather than there since SeasonTournamentType specifically means
// "earns a season_ranking_points row," which Champions Cup still doesn't
// (Global Constraints #3, original Phase 2 plan) — this table is ONLY ever
// used for the coin/XP loop below, never for season points.
// round_of_32/non_advancer default to round_of_16's tier (9th-16th) since
// Champions Cup, like Masters, is a capped invitational bracket that
// shouldn't realistically reach those bands.
const CHAMPIONS_CUP_PLACEMENT: Record<PlacementBand, number> = {
  champion: 1,
  runner_up: 2,
  semi_final: 3,
  quarter_final: 5,
  round_of_16: 9,
  round_of_32: 9,
  non_advancer: 9,
}
const CHAMPIONS_CUP_COINS: Record<number, number> = { 1: 2000, 2: 1200, 3: 800, 5: 400, 9: 150 }
const CHAMPIONS_CUP_XP: Record<number, number> = { 1: 3000, 2: 2000, 3: 1200, 5: 600, 9: 250 }
```

`PlacementBand` needs importing from `lib/tournaments/season-placement.ts` alongside the existing `bandsForPlacements`/`pointsForBand`/`placementForBand`/`SeasonTournamentType` import — check whether it's already imported before adding a duplicate import line.

Then change the coin/XP loop:

```ts
  // Placement is only meaningful relative to *some* tournament type's bands
  // — reuse community_club's band->number mapping for coin/XP tiers since
  // it's the finer-grained one (masters collapses several bands to the same
  // number); the coin/XP table keys off the numeric placement, not the band.
  for (const { playerId, band } of placements) {
    const placement = placementForBand('community_club', band)
    const coins = PLACEMENT_COINS[placement]
    if (coins) await awardCoins(admin, playerId, coins, 'tournament_placement', tournamentId)
    const xp = PLACEMENT_XP[placement]
    if (xp) await awardXP(admin, playerId, xp, 'tournament_placement', tournamentId)
```

to:

```ts
  // Coin/XP tiers key off each tournament type's OWN placement table.
  // Champions Cup gets its own reward scale entirely (CHAMPIONS_CUP_*
  // above); Community Club and Masters share PLACEMENT_COINS/PLACEMENT_XP
  // but resolve through their own band->number mapping via placementForBand
  // (masters collapses several bands to the same number community_club
  // doesn't, so the two must NOT share one hardcoded 'community_club' call
  // — that was the pre-existing bug this fixes). Any other/future
  // tournament type falls back to community_club's numbers.
  const isChampionsCup = tournament.tournament_type === 'champions_cup'
  const coinXpTournamentType = tournament.tournament_type === 'masters' ? 'masters' : 'community_club'
  for (const { playerId, band } of placements) {
    const placement = isChampionsCup ? CHAMPIONS_CUP_PLACEMENT[band] : placementForBand(coinXpTournamentType, band)
    const coins = isChampionsCup ? CHAMPIONS_CUP_COINS[placement] : PLACEMENT_COINS[placement]
    if (coins) await awardCoins(admin, playerId, coins, 'tournament_placement', tournamentId)
    const xp = isChampionsCup ? CHAMPIONS_CUP_XP[placement] : PLACEMENT_XP[placement]
    if (xp) await awardXP(admin, playerId, xp, 'tournament_placement', tournamentId)
```

Leave everything else in the function (the `season_ranking_points` write, the `checkAndUnlockAchievements` call immediately below this loop, which already receives `placement` and is unaffected by this change) exactly as-is.

- [ ] **Step 4: Run to verify both pass**

Run: `npx vitest run lib/matches/season-points.test.ts` — expect PASS, including the pre-existing tests (community_club behavior must be unchanged).

- [ ] **Step 5: Run the full matches + tournaments suite + build**

Run: `npx vitest run lib/matches lib/tournaments && npm run build`.

- [ ] **Step 6: Commit**

```bash
git add lib/matches/season-points.ts lib/matches/season-points.test.ts
git commit -m "fix(coins): give Masters and Champions Cup their own placement coin/XP tables"
```

---

## Part 5 — Final verification

### Task 5.1: Full regression pass

**Files:** none (verification only).

- [ ] **Step 1: Run the entire test suite**

Run: `npm run test` — every test file, not just the ones touched in this plan.

- [ ] **Step 2: Run the production build**

Run: `npm run build`.

- [ ] **Step 3: Run lint**

Run: `npm run lint`.

- [ ] **Step 4: Re-verify Part 0's declined items are still correctly declined**

Spot check: `components/player/ProfileGamesRow.tsx` still shows honest dashes (Task 4.1 must not have accidentally started fabricating per-game data while touching the profile page). `TierBadge`/`MembershipBadge` are still both present in `LeaderboardTable.tsx` and `ProfileHeader.tsx` (Task 2.2 must not have removed either).

- [ ] **Step 5: Commit any final fixups, then stop**

```bash
git status # confirm clean tree
```

---

## Self-Review Notes

- **Spec coverage:** every numbered bullet in the product owner's message maps to a task or to a Part 0 entry explaining why it doesn't need one. Priority 1 → Part 0. Priority 2 → Part 1 (2 tasks). Priority 3 → Part 0 (3 declined) + Part 2 (3 tasks). Priority 4 → Part 3 (2 tasks). Priority 5 → Part 4 (3 tasks, one explicitly partial — Champions Cup).
- **Known, documented gaps** (not oversights — explicit scope decisions): per-game rank/SX Score (blocked on roadmap #21, not attempted); `bubble_skin` cosmetic rendering (not requested, not attempted); Champions Cup's own placement coin/XP table (no spec exists, needs a product decision, not attempted — current community_club fallback preserved unchanged).
- **Type/signature consistency check:** `ProfileSidebarNav`'s new `isOwner` prop (Task 2.1) and `ProfileHeader`'s three new cosmetic-class props (Task 4.1) are each introduced and consumed within the same task — no cross-task signature drift risk. `equippedCosmeticsBySlug`'s return shape (`{ avatarBorder, profileTheme, usernameColour }`) is used identically in its test and in Task 4.1 Step 5's consumption.
