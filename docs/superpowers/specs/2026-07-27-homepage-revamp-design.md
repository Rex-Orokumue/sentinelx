# Homepage & Nav Revamp — Design

**Routes:** `/` (redesign), `/games` (new), `/about` (new); modifies `components/shared/SiteHeader.tsx`
**Date:** 2026-07-27
**Status:** Approved, ready for implementation plan

## Context

The current homepage (`app/page.tsx`) is a plain centered hero (logo, tagline, two buttons) followed by
functional sections: featured/live tournament, upcoming tournaments, leaderboard preview, WhatsApp CTA,
FAQ. The user supplied a mockup for a fuller marketing-style hero — new nav layout, a mascot-led hero,
a "trusted by gamers" game strip, a dismissible onboarding guide, a "what you can do here" feature grid,
and a stats bar — and asked for the site to be revamped to match it.

Brainstorming settled the scope precisely: this is a **new top section** for the homepage (hero through
stats bar), not a replacement of the whole page — the existing live tournament / leaderboard / WhatsApp /
FAQ sections stay, restyled to match, below the new hero. Two new pages (`/games`, `/about`) and a nav
restructure are in scope; multi-game support and a real merch store are explicitly **not** — `Games` and
`Store` in the new nav point at, respectively, a new lightweight page built from the existing `games`
table and the existing `/exchange` page.

**Assets:** no mascot artwork or game-logo images exist yet. The mascot renders as a labeled placeholder
box in the hero's illustration slot (swappable later without restructuring). The "trusted by gamers" strip
and the new `/games` page use text badges (game name only) rather than logos, since `games.icon_url` is
null for every row today — both already read `icon_url` and will pick up real logos automatically once
someone sets it, no code change required later.

## Nav restructure — `components/shared/SiteHeader.tsx`

Replace the current six-link desktop nav with, in order: **Home** (`/`), **Tournaments** (`/tournaments`),
**Games** (`/games`), **Leaderboards** (`/rankings`), **Store** (`/exchange`), **Community** (`/community`),
**About Us** (`/about`). `TV`, `Players`, and `Hall of Fame` drop from the top nav — all three remain fully
reachable as pages (Rankings links to Players today; TV is linked from Community), they just lose their
top-level slot. This nav row keeps its existing `hidden sm:flex` — no change to mobile, which is owned by
the already-correct `BottomTabBar` (four-pillar tabs + account), untouched by this project.

Logged-out state changes from today's plain "Log in" text link to two buttons, matching the mockup:
**Login** (outlined, → `/login`) and **Register** (filled violet, → `/signup`). Logged-in state is
unchanged — `NotificationBell` + `AccountMenu` render exactly as they do today.

## Homepage — `app/page.tsx`

Restructures into, top to bottom:

1. **Hero** (new `components/home/Hero.tsx`) — replaces the current `<section className="py-12 text-center">`
   block entirely.
2. **Trusted-by strip** (new `components/home/TrustedByStrip.tsx`).
3. **Feature grid** ("What you can do here") (new `components/home/FeatureGrid.tsx`).
4. **Stats bar** (new `components/home/StatsBar.tsx`).
5. Everything from `PromoBanner` down — featured/live tournament, upcoming tournaments, leaderboard
   preview, WhatsApp CTA, FAQ — **stays, logic untouched**, restyled only (spacing/border/heading treatment)
   to read as one continuous page with the new sections above it.

### Hero — `components/home/Hero.tsx`

Server component. Renders:
- Headline "WELCOME TO SENTINEL X ESPORTS" (Rajdhani display font — already wired up via `--font-display`
  in `app/layout.tsx`, no new font needed) and tagline "Compete. Conquer. Become a Legend."
- Subtext (one line, mission-flavored — mirrors the existing tagline "Nigeria's Home of Mobile Esports").
- Two CTAs: **Register Now** (→ `/signup`) and **Explore** (→ `/tournaments`), styled as today's primary/
  secondary button pair.
- Mascot slot: a fixed-aspect placeholder box (dashed border, centered "Mascot artwork" label) positioned
  where the illustration sits in the mockup. Replacing it later means swapping this box for an `<Image>` —
  no layout change.
- `GuideBubble`, rendered inside Hero and passed the current session's logged-in state.

### Guide bubble — `components/home/GuideBubble.tsx`

`'use client'`. **Renders only when the visitor is logged out** — authenticated users are past the
onboarding moment; the bubble is noise for them, so `Hero` receives `isLoggedIn` from the page's existing
session lookup and doesn't mount `GuideBubble` at all when true (not just visually hidden — no DOM, no
localStorage check, for a logged-in user).

Content: welcome copy (per the mockup) plus three quick-action links:
- "Browse Tournaments" → `/tournaments`
- "How It Works" → `#how-it-works` (an in-page anchor — see Feature grid below, which the anchor targets;
  this is the exact ID, not a placeholder, since a mismatched anchor silently does nothing)
- "Join WhatsApp" → the existing `NEXT_PUBLIC_WHATSAPP_COMMUNITY_URL` used elsewhere on the page

Dismiss: an × button sets `localStorage['guide-bubble-dismissed'] = '1'` and hides the bubble; on mount,
the component checks that key and renders nothing if already dismissed (read in a `useEffect`/state-init
to avoid a hydration flash — render nothing until the check resolves, matching the pattern of other
client-only-state components in this codebase).

### Trusted-by strip — `components/home/TrustedByStrip.tsx`

Server component, takes a deduped game list as a prop (see dedupe helper below — shared with `/games`).
Renders one badge per game: name as text (no logo asset yet, `icon_url` used when present so real logos
"just work" later with no code change). Active games render normally; inactive games get a visually
subdued "Coming soon" tag — same distinction as the `/games` page.

### Feature grid — `components/home/FeatureGrid.tsx`

Static content, six cards per the mockup: **Compete** (Join exciting tournaments and win amazing prizes),
**Connect** (Meet gamers, build teams and grow your network), **Climb** (Climb the leaderboards and
become a legend), **Shop** (→ links to `/exchange`; copy changed from the mockup's "Get official
merchandise and gaming gear" to "Buy, sell and trade gaming accounts and gear safely" — the linked page is
the peer-to-peer Gaming Exchange, not an official merch store, and the mockup's copy would misdescribe
what a visitor actually finds there), **Earn Rewards** (Play, win and earn exclusive rewards), **Be Part
of the Community** (This is more than gaming. It's a family.). Icons from `lucide-react`
(already a dependency — `Trophy`, `Users`, `TrendingUp`, `ShoppingCart`, `Gift`, `ShieldCheck`), matching
icon usage already established elsewhere (e.g. `BottomTabBar.tsx`).

The section root carries `id="how-it-works"` — the exact anchor target the guide bubble's "How It Works"
link points to.

### Stats bar — `components/home/StatsBar.tsx`

Presentational component taking real numbers as props — **no "+" suffix, no rounding, no placeholder
inflation**: real counts build more trust with a verifiable audience than vanity numbers, and the counts
are small right now (a handful of tournaments, dozens of players) — that's fine and expected.

`app/page.tsx` fetches, alongside its existing queries:
- **Players** — `count` of all `profiles` rows.
- **Tournaments** — `count` of `tournaments` rows where `status != 'draft'` (drafts aren't public anywhere
  else on the site either, so they're excluded from a public-facing count).
- **Games** — the same deduped game list used by the trusted-by strip and `/games`, counted by length
  (distinct game names in the catalog — active *and* "coming soon" — not just currently-active ones; this
  mirrors what the trusted-by strip and `/games` page themselves show, so the number matches what a visitor
  can go verify by clicking through, which is the trust property being optimized for).
- **Mission** — the fourth tile is not a count; it stays the static "Building Africa's Biggest Esports
  Community" line from the mockup, styled to match the other three tiles.

## Game dedup — `lib/games/dedupe.ts`

The `games` table has duplicate rows for the same name (different slugs — leftover QA/test rows), so a
naive `select distinct` is wrong. Shared by the trusted-by strip, the stats bar's games count, and the new
`/games` page:

```ts
export interface DedupableGame {
  name: string
  slug: string
  icon_url: string | null
  active: boolean
  created_at: string
}

// One row per distinct name: prefer an active row if any exists for that name,
// otherwise the most recently created row. Duplicate rows are leftover QA data
// (same game, different slugs) — picking the active one keeps the link that
// actually has real tournaments; picking most-recent among inactive duplicates
// avoids surfacing a stale abandoned row.
export function dedupeGamesByName(games: DedupableGame[]): DedupableGame[]
```

Implementation: group by `name`, and within each group pick the row with the highest sort key of
`(active ? 1 : 0, created_at)` — i.e. any active row beats any inactive row regardless of date, and ties
break on most-recent `created_at`. Pure function, no Supabase — the query itself (`select('name, slug,
icon_url, active, created_at')`, no `.eq('active', ...)` filter, so both live and upcoming games are
visible) stays in each caller; only the grouping logic is shared.

## New page — `/games` (`app/(public)/games/page.tsx`)

Fetches all `games` rows, runs them through `dedupeGamesByName`, renders one card per distinct game:
active games are a link to `/tournaments?game={slug}` (the existing, already-working game filter on the
tournaments listing page); inactive games render the same "Coming soon" treatment as the trusted-by strip
(not a link). `generateMetadata` + Open Graph tags per the SEO rules already followed by every other public
page (e.g. `/tournaments`, `/players`).

## New page — `/about` (`app/(public)/about/page.tsx`)

Short, single-scroll page per CLAUDE.md's About outline: mission statement, brief story/Nigeria angle, and
a short line about the team — no partner logos or contact form (not in current scope, nothing in CLAUDE.md
or the mockup calls for them). Static content — no data fetching. `generateMetadata` + Open Graph tags,
matching every other public page.

## Testing

Vitest:
- `dedupeGamesByName` — the exact scenarios above: a name with one active + several inactive duplicates
  resolves to the active one regardless of creation order; a name with only inactive duplicates resolves
  to the most recently created; a name with a single row passes through unchanged.

`GuideBubble`'s dismiss/localStorage logic and the logged-in-hides-entirely behavior are UI-state only —
this codebase's convention (per `BracketActions.tsx`, `SiteHeader.tsx`) is to verify client-component
behavior via the build and manual testing, not component tests (no `@testing-library/react` in this repo).
Manual check: confirm the bubble never renders for a logged-in session, confirm dismiss persists across a
reload, confirm "How It Works" actually scrolls to the feature grid.

Page/nav wiring (stats counts, dedup call sites, new routes) is I/O-bound — exercised via the build and
manual verification, consistent with how the rest of `app/page.tsx` and `SiteHeader.tsx` are handled today.

## Consistency notes

- Mobile-first: every new component built mobile-first first, matching the rest of the codebase; the
  hero's mascot placeholder, trusted-by strip, and feature grid all need to look intentional at 375px
  before scaling up, not just at the mockup's desktop width.
- No new fonts, no new color tokens — reuses the existing violet/slate palette and the already-configured
  `--font-display` (Rajdhani).
- Does not touch roadmap scope (CLAUDE.md v1.0–v4.0) — `/games` and `/about` are both already-named future
  routes in CLAUDE.md's route table, just built now with minimal scope (list + link; short static page)
  rather than the fuller version implied there.
