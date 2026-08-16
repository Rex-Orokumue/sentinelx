# Community & Wallet Visual Redesign — Design Spec

**Date:** 2026-08-16
**Status:** Approved → ready for implementation planning
**Scope:** `/community` (public feed) and `/dashboard/wallet/*` (player wallet), plus a global header change.

**Concurrent work notice:** a separate agent session is actively building the coin-economy-extension (`docs/superpowers/specs/2026-08-15-coin-economy-extension.md` — entry-fee coin discount, community match wagering, post boost). This spec does not touch `lib/coins/*`, `sx_coins`/`sx_coin_transactions`, or any wagering/discount/boost surface. If a future change here needs to touch that surface, stop and check with the user first.

---

## 1. Reference mockups

Two screenshots supplied by the user define the target visual language: a dark/purple community page (hero banner, stat tiles, quick-action tiles, two-column feed + sidebar, community servers, gallery, CTA footer) and a dark/purple wallet overview (balance hero, quick actions, earnings grid, transactions + withdrawal panel, referral/rewards/security sidebar). The user wants layout, spacing, card treatment, and iconography matched closely — "no difference... exact replica" — using Sentinel X's **own real data**, not fabricated numbers. Where the mockup shows something we have no real data for, this spec calls out the substitution explicitly (§4, §6) rather than inventing fake stats.

The existing reaction buttons (`ReactionBar` — 🔥👑💪😮, one-per-player toggle) are retained as-is; they are explicitly called out by the user as better than the mockup's implied reactions.

---

## 2. Global header — balance chips

**Files:** `lib/nav/session.ts`, `components/shared/SiteHeader.tsx`, new `components/shared/BalanceChips.tsx`.

`NavSession` gains two fields:

```ts
walletBalance: number   // naira, wallets.balance
coinBalance: number     // sx_coins.balance
```

`getNavSession()` fetches both via `createAdminClient()` (same pattern the wallet page already uses to read `wallets`/`sx_coins`, which are not player-readable via the anon client) in the same `Promise.all` as the existing profile/notification queries. Both reads use `.maybeSingle()` and resolve with `data?.balance ?? 0` — this covers both cases that must never break the header: no row yet (new player, `data` is `null`) and a query-level error (`data` is also `null`, `error` is set — Supabase-js returns `{data, error}` rather than throwing, so this is a genuine runtime guard, not just a TypeScript-level assumption). The header must render with `0` balances rather than fail in either case.

`SiteHeader` renders a new `BalanceChips` component between the WhatsApp CTA and the notification bell, only when `session.isLoggedIn`:

- `₦12,500` pill (wallet icon, links to `/dashboard/wallet`)
- `🪙 1,450` pill (coin icon, links to `/store`)

Visible `sm:` and up, same breakpoint as the existing WhatsApp button (`hidden ... sm:flex`) — on phones narrower than that the header stays uncluttered; the balances are one tap away via `/dashboard/wallet` (bottom tab bar) regardless. No new page needed — this is header-only.

---

## 3. Wallet page (`/dashboard/wallet` + subpages)

This is primarily a **visual pass** — the existing component tree (`BalanceHeroCard`, `QuickActionsRow`, `EarningsOverview`, `RecentTransactionsList`, `RewardsProgressWidget`, `WalletSecurityBadges`, `WalletSidebar`) already maps closely to the mockup's sections and already carries real data (Deposit/Withdraw live, Transfer/Rewards nav items already correctly marked "coming soon," Tournament/Referral/Cashback earnings live, Community Rewards already correctly marked "coming soon"). No new data plumbing is required. Changes are restyling to match the mockup:

- **Balance hero card**: gradient hero treatment (purple glow, mascot art), large balance figure, hide/show toggle (already exists), "Available Balance" pill, pending-withdrawal note — restyle to match the mockup's card exactly.
- **Sidebar** (`WalletSidebar`): restyle to the mockup's left-rail nav look (icons per item, active-state highlight), keep the existing `WALLET_NAV_ITEMS`/locked-item behavior unchanged.
- **Quick actions row**: restyle the 4 tiles (Deposit/Withdraw/Transfer🔒/Rewards🔒) to the mockup's icon-tile look.
- **Earnings overview**: restyle the 4-card grid (Tournament Winnings / Referral Rewards / Community Rewards🔒 / Cashback) to match the mockup's card look, keep trend-% display.
- **Recent transactions + withdrawal panel**: two-column layout matching the mockup — transactions list on the left (restyle `RecentTransactionsList`/`TransactionRow`), a new compact withdrawal-status panel on the right showing the linked payment method (from `payment_methods`, already fetched in `/dashboard/wallet/payment-methods`) + available-to-withdraw amount + "Request Withdrawal" CTA (routes to `/dashboard/wallet/withdraw`, no new logic).
- **Right rail**: new compact `ReferralEarningsCard` (a sidebar-sized sibling to `ReferralPanel`, not a reuse of it — `ReferralPanel` is a full-width settings-page panel and, verified against its source, only ever renders a referral **count** + copyable link + a static "₦100 each" rate line; it does not compute a cumulative total, so it cannot be reused as-is for the mockup's "Total Earned: ₦2,500" figure). The new card sources:
  - **Total Referrals** — same `referrals` table count `ReferralPanel`/`/dashboard/referrals` already query (`COUNT(*) FROM referrals WHERE referrer_id = user.id`)
  - **Total Earned** — the wallet overview page's own `breakdown.referral` value (already computed server-side from real `wallet_transactions` rows, category `referral` — the same number the Earnings Overview grid shows), not a new/invented figure
  - **Referral link** — same construction as `ReferralPanel` (`${siteUrl}/signup?ref=${username}`), copy-to-clipboard
  `RewardsProgressWidget` (existing, restyled), `WalletSecurityBadges` (existing, restyled — Zolarux Escrow / Verified Account / Escrow Enabled).
- **"Your winnings are safe here" mascot card**: static content block (Zolarux escrow messaging + mascot art), no data.

No schema changes, no new Server Actions. Every number shown is already computed by the existing page.

---

## 4. Community page (`/community`)

**Files:** `app/(public)/community/page.tsx` (restructure), several new components under `components/community/`, new query helpers under `lib/community/`.

### 4.1 Hero
Purple/dark hero banner matching the mockup's layout (headline, subtext, mascot art, "Hey Gamer!" side card, primary/secondary CTA buttons). Static content, no data dependency, except the stat tiles below it.

### 4.2 Stats bar
Four tiles, all real:
- **Members** — `COUNT(*) FROM profiles`
- **Countries** — `COUNT(DISTINCT country) FROM profiles WHERE country IS NOT NULL`
- **Tournaments Hosted** — `COUNT(*) FROM tournaments` *(substitutes the mockup's "Active Teams," which has no backing concept — teams are a v4 roadmap item)*
- **"24/7 Active & Growing"** — static label, matches the mockup

New query function `lib/community/stats-query.ts::fetchCommunityStats()`.

### 4.3 Quick-action tiles
Five tiles, mapped to real destinations:

| Tile label | Destination |
|---|---|
| **Find Friends** *(relabeled from the mockup's "Find Teammates" — that destination is `/dashboard/friends`, your existing circle, not a stranger-discovery tool. Renaming the tile to match what it actually does avoids a bait-and-switch; a real teammate-finder is a Phase 3 roadmap item, not built yet)* | `/dashboard/friends` |
| Create Team | `/coming-soon?feature=Teams` |
| Join Discussions | anchors to the feed below |
| Share Content | opens the existing post composer (`NewPostLauncher`) |
| Get Help | `/coming-soon?feature=Help+Center` |

### 4.4 Feed (left column)
Reuses the existing stack (`BestPlayBanner`, `FeedFilters`, `FeedList`, `PostCard`, `ReactionBar`, `ShareButton`) restyled to the mockup's card look (avatar + name + tier badge + timestamp header, body, image, reaction bar + comment count + share footer). `FeedFilters` keeps the real tab set — **All / Results / Announcements / Achievements** — restyled as the mockup's pill tabs (the mockup's General/Looking For Team/Tournaments/Trading/Content taxonomy is not built; adding it is out of scope per the earlier decision). Avatars stay `HexAvatar` (the site's established brand shape) rather than switching to the mockup's circular avatars.

### 4.5 Sidebar (right column)
- **Top Community Members** — new widget, top 5 players by `profiles.xp` descending, showing rank (🥇🥈🥉 for top 3, plain number after), `HexAvatar` (xs), display name, our real tier label (Recruit/Guardian/Elite/Sentinel/Legend via `computeTier`/`TIER_LABEL`), and XP. New query `lib/community/top-members-query.ts::fetchTopCommunityMembers(limit)`.
- **Weekly Challenge** — reuses the existing `ChallengeWidget` (already multi-challenge, already has coin+XP rewards), restyled into the mockup's card container. No data change.
- **Upcoming Community Events → Upcoming Tournaments (adapter pattern)**: new component `UpcomingEventsWidget` renders a normalized shape:
  ```ts
  interface UpcomingEventItem { id: string; title: string; date: string; time: string; ctaLabel: string; ctaHref: string }
  ```
  New query `lib/community/upcoming-events-query.ts::fetchUpcomingCommunityEvents()` currently sources this from `tournaments` (`status IN ('registration_open','active')`, ordered by `tournament_start`, limit 3, `ctaHref` → the tournament's page). **This is a deliberate seam**: when a real events feature ships later (a `community_events` table, per the user's stated intent), only this query function's implementation changes — the widget component and its prop shape stay untouched.

### 4.6 Official Community Servers
Three cards: Discord (`NEXT_PUBLIC_DISCORD_URL`, already used in `SiteFooter`), WhatsApp (reuse the `whatsappUrl` prop already threaded into `SiteHeader`/community page), Telegram (new `NEXT_PUBLIC_TELEGRAM_URL` env var, defaults to `#` like the existing social env vars). Live member-count numbers from the mockup (5,610 / 3,214 / 2,145) are dropped — no honest source for them — cards show platform name + icon + Join button only.

### 4.7 Community Gallery
Grid of the most recent `community_posts` rows with a non-null `image_url` (any post type), each captioned with author name + a truncated snippet of `content`. Presented as photo cards (no play-button/duration overlay, since Sentinel X doesn't store video — YouTube embeds live only on Match Centre, unrelated to this feed). New query `lib/community/gallery-query.ts::fetchCommunityGallery(limit)`.

### 4.8 Footer CTA banner
Static content block matching the mockup ("Be active. Be positive. Be legendary." + Join CTA), no data.

---

## 5. Testing

- Unit tests for the four new query helpers (`stats-query`, `top-members-query`, `upcoming-events-query`, `gallery-query`) — happy path + empty-state (no profiles/tournaments/posts yet).
- `getNavSession()` test coverage extended for the two new balance fields, including the "no wallet/coins row yet → 0" case.
- No new Server Actions, so no new mutation tests; existing action tests (`toggleReaction`, `deletePost`, wallet actions) are untouched.
- Manual pass: logged-out community page (chips absent, guest reaction taps route to login per existing `ReactionBar` behavior — unchanged), logged-in community + wallet page against the two reference screenshots side by side, mobile (375px) layout check on both pages, header chip breakpoint check.

---

## 6. Out of scope

- Coin-economy-extension surface (wagering, entry-fee discount, post boost, `lib/coins/*`) — active concurrent work in another session; not touched by this spec.
- A real `community_events` table/admin UI — deferred; the adapter seam in §4.5 is the only preparation.
- Live per-platform (Discord/WhatsApp/Telegram) member counts.
- A General/Looking For Team/Tournaments/Trading/Content post-category taxonomy — the existing post-type-based filters are kept.
- A "teams" concept (Create Team tile routes to `/coming-soon`) — v4 roadmap item.
