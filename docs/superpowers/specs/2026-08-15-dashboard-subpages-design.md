# SentinelX Dashboard — Subpage Restructure Design Spec

**Date:** 2026-08-15
**Status:** Approved → ready for implementation
**Route:** `app/dashboard/*`

---

## 1. Vision

The command-centre overhaul (shipped earlier today — see `docs/superpowers/specs/2026-08-15-dashboard-overhaul-design.md`) built new Overview sections *on top of* the old dashboard's full content instead of restructuring it, on the reasoning that nothing should be deleted without approval. The result: a single long list-page with real duplication — the "Active matches" section overlaps with the new Next Match + Recent Matches cards, and the inline Friendlies summary panel duplicates the already-existing `/dashboard/friendlies` page.

This spec fixes that by applying the same shape the Wallet section (`app/dashboard/wallet/*`) already proved out today: **one lean Overview page that highlights what matters and links out, plus a set of focused subpages that each own their own slice of data.** A dashboard is not a list — it's a launch point.

**Primary goal:** `/dashboard` shows highlights only — identity, next match, stats, standing, a short recent-matches preview — every deeper list (fixtures, tournaments, marketplace, friends, referrals, profile editing) lives on its own page.
**Secondary goal:** Every subpage fetches only the data it needs, instead of the current single ~20-query `Promise.all` running on every dashboard load regardless of which section the player actually wants.
**Non-goal:** Rebuilding any of the moved components. This is almost entirely a *move*, not a rewrite — lower risk, and it's why the plan built from this spec should read as "cut here, paste there" for most sections.

---

## 2. Route Structure

```
app/dashboard/
  layout.tsx              ← NEW — shared shell + DashboardSidebar nav (mirrors app/dashboard/wallet/layout.tsx)
  page.tsx                ← REWRITE — Overview, trimmed to highlights only
  matches/page.tsx        ← NEW — fixtures (live/upcoming/completed), tournament status banners, data-support banner
  tournaments/page.tsx    ← NEW — my tournament registrations
  marketplace/page.tsx    ← NEW — my listings + buy requests + orders + sales
  friends/page.tsx        ← NEW — friends + incoming requests
  referrals/page.tsx      ← NEW — referral panel
  profile/page.tsx        ← NEW — profile edit form
  friendlies/             ← UNCHANGED — already its own route; just joins the sidebar nav
  wallet/                 ← UNCHANGED — already its own section with its own sidebar
```

Each new subpage is `app/dashboard/<name>/page.tsx` — a Server Component with its own `Promise.all`, wrapped by the shared `layout.tsx`. None of the new subpages need their own nested layout — one shell serves all of them, same as `app/dashboard/wallet/layout.tsx` serves every wallet route today.

---

## 3. `layout.tsx` + `DashboardSidebar`

Directly mirrors `app/dashboard/wallet/layout.tsx` / `components/wallet/WalletSidebar.tsx`:

```tsx
// app/dashboard/layout.tsx (shape)
<div className="mx-auto max-w-4xl px-4 pb-20">
  <div className="flex flex-col gap-6 sm:flex-row">
    <DashboardSidebar />
    <div className="min-w-0 flex-1 space-y-6">{children}</div>
  </div>
</div>
```

No page title/subtitle block in this layout the way the wallet layout has one — Overview's own Hero panel already serves that role, and a second "Your Dashboard" header above it would be redundant on the one page that needs it least.

**`DashboardSidebar`** (`components/dashboard/DashboardSidebar.tsx`), same `usePathname`-driven active-highlight pattern as `WalletSidebar`, collapsing to a horizontal scrollable tab row below `sm:` (same `scrollbar-hide` utility):

| Label | Href |
|-------|------|
| Overview | `/dashboard` |
| My Matches | `/dashboard/matches` |
| My Tournaments | `/dashboard/tournaments` |
| Marketplace | `/dashboard/marketplace` |
| Friends | `/dashboard/friends` |
| Friendlies | `/dashboard/friendlies` |
| Referrals | `/dashboard/referrals` |
| Profile | `/dashboard/profile` |

Sign out moves here too — a plain `<form action={signOut}>` button at the bottom of the sidebar list, exactly where `WalletSidebar` would put a final item. It stops floating as its own standalone element on the page.

**Wallet is deliberately not in this list.** It's a peer section with its own sidebar, already reachable from global nav (`AccountMenu`/`MobileNavSheet`, fixed earlier today) and from Overview's Quick Actions (below) — adding it here too would just be a third path to the same place.

---

## 4. Overview Page (`app/dashboard/page.tsx`)

Keeps exactly the highlight sections from the command-centre overhaul, unchanged in their own logic:

1. `HeroIdentityPanel`
2. `NextMatchCard`
3. `StatsRow`
4. `ProgressCard` + `SeasonStandingCard` (2-column grid on desktop)
5. `RecentMatchesCard` — same 5-row preview as today; its own "View All →" keeps pointing at `/players/[username]#match-history` (a different concern — completed match *history* — from the new `/dashboard/matches` page, which is live/upcoming *fixtures* + tournament progress. No change needed here.)
6. `QuickActions` — **redesigned**, see §5

**Removed from Overview** (moved to subpages, §6): `CollapsibleSection`-wrapped Referrals, Data support, Friends, Friendlies, Active matches, Completed matches, `MyTournaments`, `MyListings`, `MyBuyRequests`, `MyOrders`, `MySales`, `ProfileEditForm`, the sign-out form.

**Data:** Overview's `Promise.all` shrinks to exactly what sections 1–6 need: profile core fields, next-match query, recent-matches query, achievement slugs, season/monthly leaderboard, coin balance, pending invitation, wallet balance (for the Quick Actions Wallet tile's label). Every query this page no longer needs (marketplace, friends, friendlies, referrals, group standings, tournament banners) is deleted from it, not just unrendered.

`hasSubmittableMatch` (drives the Quick Actions "Submit Result" label, §5) needs its own minimal query rather than reusing the single next-match row or duplicating `/dashboard/matches`'s full fetch: a player can have more than one live/upcoming fixture at once (different tournaments), so checking only the single "soonest" match could miss one that's actually awaiting a result. Add one narrow query — `matches WHERE (player_a_id = me OR player_b_id = me) AND status IN ('live','scheduled') SELECT id, status, scheduled_at` (no joins, no opponent/tournament data) — and run it through the same `awaitingMyResult`/`bucketFixtures` pure logic (`lib/dashboard/fixtures.ts`, unchanged) that `/dashboard/matches` uses for its full view. Cheap, correct, and doesn't fetch anything Overview doesn't render.

---

## 5. Quick Actions Redesign (`components/dashboard/QuickActions.tsx`)

Today's tiles are ad hoc. The redesigned set is exactly "highlight the highest-frequency actions, dynamically labeled, single tile per destination" — it is **not** a second copy of the sidebar (the sidebar already lists every subpage):

| Tile | Href | Label logic |
|------|------|-------------|
| Enter a Tournament | `/tournaments` | Always shown |
| My Matches / Submit Result | `/dashboard/matches` | Label is "Submit Result" (urgent framing) when `hasSubmittableMatch`, else "My Matches" (browsing framing) — same destination either way, same pattern already used for the Wallet tile today |
| Wallet | `/dashboard/wallet` | Label is "Withdraw Prize" + balance when `walletBalance > 0`, else "Wallet" (fixed earlier today, unchanged by this spec) |
| Profile | `/dashboard/profile` | Always shown — replaces today's `href="#profile"` anchor, which pointed at a section that no longer exists on this page |

Four tiles, same `grid-cols-2 sm:grid-cols-4` layout as today.

---

## 6. Subpages — Data + Component Reuse

Every subpage below reuses its component(s) **unchanged** (same props, same file) — only the query that feeds it and the page shell around it are new. Each is a Server Component behind the existing `middleware.ts` `/dashboard` auth guard (already covers every path under `/dashboard`, no change needed there).

### `app/dashboard/matches/page.tsx`
- Reuses: `TournamentStatusBanners`, `ActiveFixtures`, `CompletedFixtures` (`components/dashboard/FixtureCard.tsx`), `DataSupportPanel` (folded in here per the confirmed design — it's about an active match/tournament, not a profile setting).
- Data: the full `matchesRes` fixtures query + `resultsRes` (submitted-match ids) + group-membership/standings queries + tournament-banner computation — i.e., everything `bucketFixtures`/`computeTournamentStatus`/`computeDataSupportEligibility` currently consume in the old `app/dashboard/page.tsx`, moved here verbatim.
- Layout: `TournamentStatusBanners` → `ActiveFixtures` (live + upcoming) → `CompletedFixtures`, each in its own labeled section (no `CollapsibleSection` wrapper needed — this page IS "active matches," it doesn't need to collapse itself away). `DataSupportPanel` renders conditionally above the fixtures, same `dataSupportEligibility.length > 0` guard as today.

### `app/dashboard/tournaments/page.tsx`
- Reuses: `MyTournaments` (`components/dashboard/MyTournaments.tsx`).
- Data: the existing `regsRes` query (`tournament_registrations` → `RegistrationRow[]`), moved verbatim.

### `app/dashboard/marketplace/page.tsx`
- Reuses: `MyListings`, `MyBuyRequests`, `MyOrders`, `MySales`.
- Data: `listingsRes`, `buyRequestsRes`, `ordersRes`, `salesRes` + `latestPerListing` dedup, moved verbatim. Stacked sections, same order as today (Listings → Buy Requests → Orders → Sales).

### `app/dashboard/friends/page.tsx`
- Reuses: `FriendsPanel`.
- Data: `friendsRes` query + the `incomingRequests`/`friendsList` derivation, moved verbatim.

### `app/dashboard/referrals/page.tsx`
- Reuses: `ReferralPanel`.
- Data: `referralsRes` query + `referredPlayers` derivation, moved verbatim.

### `app/dashboard/profile/page.tsx`
- Reuses: `ProfileEditForm`.
- Data: the profile-field subset `ProfileEditForm` actually consumes (`display_name`, `username`, `avatar_url`, `whatsapp_number`, `country`, `bio`, `phone_verified_at`) — a narrower select than Overview's, since this page doesn't need `xp`/`sx_score`/etc.

### `app/dashboard/friendlies/page.tsx`
No changes to this page's own content — it already exists and already works. The only change anywhere near it is removing the inline `FriendliesPanel` *summary* widget from Overview (§4) and adding "Friendlies" to the new sidebar, so there's exactly one place to see friendlies instead of two.

---

## 7. Out of Scope

- Badge/count indicators on sidebar items (e.g. "Friends (2)" for pending requests) — YAGNI for v1; every subpage already shows its own real counts once you're on it. A future pass can add these if it turns out players miss pending requests.
- Any change to `/dashboard/wallet/*`, `/dashboard/friendlies/*`, or global nav (`AccountMenu`/`MobileNavSheet`/`SiteHeader`) — all already correct as of today's earlier fix.
- Any change to the underlying data/queries' *behavior* — this is a pure relocation of existing, working queries and components. No new business logic anywhere in this spec.

---

## 8. File List

**Create:**
- `app/dashboard/layout.tsx`
- `app/dashboard/matches/page.tsx`
- `app/dashboard/tournaments/page.tsx`
- `app/dashboard/marketplace/page.tsx`
- `app/dashboard/friends/page.tsx`
- `app/dashboard/referrals/page.tsx`
- `app/dashboard/profile/page.tsx`
- `components/dashboard/DashboardSidebar.tsx`

**Rewrite:**
- `app/dashboard/page.tsx` (trim to Overview-only data + sections)
- `components/dashboard/QuickActions.tsx` (redesigned tile set, §5)

**Unchanged (reused as-is):**
- `components/dashboard/{TournamentStatusBanner,FixtureCard,DataSupportPanel,MyTournaments,MyListings,MyBuyRequests,MyOrders,MySales,FriendsPanel,ReferralPanel,ProfileEditForm}.tsx`
- `app/dashboard/friendlies/*`, `app/dashboard/wallet/*` (including whatever data fetching they already do internally — out of scope here)
- `lib/dashboard/{fixtures,tournament-status,data-support}.ts`, `lib/exchange/orders.ts`

**Deleted (dead once Overview's inline `FriendliesPanel` summary widget is removed per §3/§6 — nothing else in this spec's file list uses it):**
- The `friendliesRes` query and `bucketFriendlies` import currently in `app/dashboard/page.tsx`. `lib/friendly-matches/buckets.ts` itself is untouched — `app/dashboard/friendlies/page.tsx` still uses it for its own unrelated fetch.
