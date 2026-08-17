# Homepage Redesign — Design Spec

**Date:** 2026-08-17
**Status:** Approved for planning
**Sub-project 1 of 3** (design replication → guide system → chatbot; see decomposition note below)

## Context

`sentinelx-homepage-mockup.html` (repo root) is a static HTML/CSS mockup built to guide a
visual rebuild of the homepage. It was dropped alongside a request to also add a chatbot
and a "comprehensive guide system," both very gamey. Those are independent subsystems and
are deliberately **out of scope here** — they'll each get their own brainstorm/spec once
this one ships, in this order: (1) design replication [this spec], (2) guide system,
(3) chatbot. The guide system and chatbot should build on top of whatever visual/motion
language this spec establishes.

The site already has a "Phase 1 visual overhaul" (dark/purple system, commit `31560f8`)
live in production. The mockup is not a from-scratch redesign — it's a closer, more
game-like evolution of that same system. Fonts (Barlow Condensed display / Inter body) and
core color tokens (`sx.bg`, `sx.purple.*`, etc.) already match the mockup; the gap is
homepage **structure** (which sections exist, in what order, in what shape) plus a push on
motion/animation and HUD-style chrome ("gamey" per the user's ask).

## Scope

- **In scope:** the homepage (`/`, `app/page.tsx`) body content only — everything between
  `SiteHeader` and `SiteFooter`.
- **Out of scope:** `SiteHeader`, `SiteFooter`, `SentinelBubble` internals (may get a token
  touch-up if something visually clashes, but no functional/copy changes), every other
  route. The mockup's nav/footer markup exists only as visual reference for what already
  ships in `SiteHeader`/`SiteFooter` — not a mandate to change them.

## Section structure (top to bottom)

1. **Nav** — unchanged (`SiteHeader`, out of scope)
2. **Hero** — rebuilt full-bleed (see below)
3. **Live/Open Tournament Strip** — new: `LiveTournamentStrip`
4. **Four Pillars** — new: `FourPillars`, replaces `FeatureGrid`
5. **Active & Upcoming Tournaments** — existing grid, `TournamentCard` restyled
6. **Leaderboard Preview** — rebuilt as hex-avatar rows, replaces the `<table>`
7. **Hall of Fame Teaser** — new: `HallOfFameTeaser`
8. **How It Works** — new: `HowItWorks`
9. **PromoBanner** — kept as-is, unchanged
10. **Final CTA** — new: `HomeFinalCta`, replaces the WhatsApp CTA block
11. **FAQ + JSON-LD** — kept as-is, unchanged
12. **SentinelBubble** — kept, `variant="home"`, restyled only if tokens clash

**Removed:** `TrustedByStrip`, `StatsBar` (folded into Hero's animated stats + Four
Pillars), the "One Guardian. Every Moment." tagline banner (redundant with the new hero's
tag line). The dedicated WhatsApp CTA section is removed; the WhatsApp community link
still lives in the footer (already there) — homepage no longer duplicates it as a full
section.

## Component-by-component

### Hero (`components/home/Hero.tsx`, rebuilt)

- Full-bleed (no card border), matching the mockup's `.hero`: hex-grid pattern overlay
  (`opacity: 0.045`, same SVG data-URI) + purple radial glow top, faint gold radial
  bottom-right.
- Three-line uppercase headline (`Barlow Condensed` 900), matching mockup's
  copy/structure: line 3 in `sx-purple-text`.
- Keep the existing Sentinel mascot illustration (`mascot-home.png`), repositioned to sit
  in the scene (right side at `lg+`, in-flow below the fold on mobile) rather than the
  mockup's text-only treatment — mascot stays as established brand identity.
- Hero stats row (3 stats, bottom, above a divider): Registered Players, Prizes Paid Out
  (gold), Tournaments Run — all **live data**, all **count up on scroll-into-view**
  (see Data section).
- CTAs: `Register Now` (primary) / `Explore Tournaments` (ghost) — copy carries over from
  current Hero, styled per mockup's `.btn-hero-primary` / `.btn-hero-ghost`.

### LiveTournamentStrip (`components/home/LiveTournamentStrip.tsx`, new)

Replaces `LiveTournamentCard`'s homepage slot. Same data source (first
`active`/`registration_open` tournament, newest first — already fetched in `page.tsx`).
Renders as a full-width strip banner directly under the hero:
- Left: status badge (`Registration Open` / `LIVE`, pulse-dot per existing
  `animate-pulse-dot` keyframe) + tournament title + prize pool + spots-left (or a `LIVE`
  variant with no spots-left).
- Right: `Register — ₦{fee}` button linking to `/tournaments/{slug}`.
- Empty state (no active/open tournament): strip is omitted entirely (not shown collapsed
  or with placeholder copy) — the Four Pillars section becomes the first thing after Hero.

### FourPillars (`components/home/FourPillars.tsx`, new — replaces `FeatureGrid`)

Exactly CLAUDE.md's four pillars, not `FeatureGrid`'s current six-item list (which had
drifted from the documented pillars). Static content:

| Pillar | Icon | Copy | Href |
|---|---|---|---|
| Compete | 🎮 (purple) | "Enter tournaments, get matched, and prove your rank. Every result admin-verified — no disputes go unresolved." | `/tournaments` |
| Watch | 📺 (gold) | "Sentinel X TV — live finals, match replays, and highlights. Every big match streamed on our YouTube channel." | `/tv` |
| Community | 🤝 (green) | "Connect with Nigeria's best mobile gamers. Share clips, discuss tactics, and stay updated on platform news." | `/community` |
| Trade | 🔒 (blue) | "Gaming Exchange powered by Zolarux escrow. Buy and sell gaming accounts with zero risk." | `/exchange` |

2-col grid on mobile, 4-col on desktop. Card hover: lift + purple border glow.

### Tournament cards (`components/tournament/TournamentCard.tsx`, restyled)

Restyle to match mockup's `.tc`: game tag + status pill top row, name, 2x2 stat grid,
block CTA button. Two variants:
- **Standard** (open/upcoming): Prize Pool / Format / Entry Fee / Spots-Left-or-Starts.
- **Champion** (season-championship/invitational, gated on `tournament_type` — already
  in the existing query select, no new column): gradient background wash, gold border,
  gold name text, gold ghost CTA, and the stat grid swaps to Prize Pool / Format /
  Eligibility / Qualifier, matching the mockup — these tournaments don't have a
  conventional entry fee or open spots count, so reusing the standard fields would show
  nonsensical data. `Eligibility`/`Qualifier` are static copy per tournament
  (`tournament_type`-driven), not new DB columns.

### Leaderboard Preview (in `page.tsx`, rebuilt inline or extracted)

Replace the `<table>` with row cards matching mockup's `.lb-row`: rank number
(gold/silver/bronze/dim per position), `HexAvatar` (reusing the existing component —
already has tier-based glow via `TIER_GLOW_CLASS`), name + tier-dot + tier name + win
count, SX Score right-aligned with count-up animation. Top-3 rows get a faint purple
background tint (`.top3`), matching mockup.

`HexAvatar` needs a `MembershipTier`; leaderboard query currently selects
`sentinel_tier` (a different, older tier stat — see CLAUDE.md's SX Score section) not
`membership_tier`. Resolve by adding `membership_tier` to the existing `profiles` select
in `page.tsx` and passing it to `HexAvatar` — no schema change, the column already backs
`/players/[username]`.

### HallOfFameTeaser (`components/home/HallOfFameTeaser.tsx`, new)

Gold-accented card: trophy emoji, "Season N Champion · {Game}" label, champion name,
one-line detail (tournament + record + prize), `View Hall of Fame →` link to
`/hall-of-fame`. Data: latest completed season's champion — reuse whatever query/helper
`/hall-of-fame` already uses to determine this (do not reimplement season-champion logic
from scratch). **Empty state:** if no season has completed yet, omit the section entirely.

### HowItWorks (`components/home/HowItWorks.tsx`, new)

Static 6-step grid (Create Account → Enter Tournament → Play Your Match → Submit Proof →
Admin Verifies → Withdraw Your Prize), copy per the mockup, large muted step numbers
(`01`–`06`) styled with the HUD-chrome treatment (see Motion/Gamey section). 3-col desktop,
2-col tablet, 1-col mobile.

### HomeFinalCta (`components/home/HomeFinalCta.tsx`, new)

Centered CTA band, purple radial glow behind text, `Ready to Compete?` headline, one-line
subcopy, single `Create Your Account →` primary button to `/signup`, small `Already
registered? Sign In` note. Replaces the current WhatsApp CTA section.

## Data changes

One new aggregate needed for the Hero's "Prizes Paid Out" stat:

```sql
SUM(prize_pool) WHERE status = 'completed'
```

Added as one more query in `page.tsx`'s existing `Promise.all`. No new tables, no new
migration. (If this later proves misleading — e.g. a completed tournament whose prize
wasn't fully paid out due to a dispute — that's a follow-up refinement, not a blocker for
this spec.)

`profiles` select in `page.tsx` gains `membership_tier` (see Leaderboard section above).

No other backend changes. Hall of Fame teaser and How-It-Works/Hall-of-Fame links point at
already-existing routes (`/hall-of-fame`, `/how-it-works`).

## Motion / "gamey" treatment

Priority order: **motion & feedback first, HUD chrome second** (per user direction).

**Motion & feedback:**
- Count-up animation on: hero stats (3), Prizes Paid Out, leaderboard SX Score values.
  Plain `requestAnimationFrame`-based hook triggered on scroll-into-view (IntersectionObserver),
  no new dependency. Respect `prefers-reduced-motion` — skip the count animation and render
  the final value immediately when set.
- Live/Open badges: reuse existing `animate-pulse-dot` keyframe (already in
  `tailwind.config.ts`) — no new keyframes needed.
- Card hover (pillars, tournament cards): lift (`translateY(-2px)`, mockup already has
  this) + subtle purple box-shadow glow on hover, extending the existing pattern used
  elsewhere on the site.
- Tier-based glow on leaderboard `HexAvatar`s: already built into the component
  (`TIER_GLOW_CLASS`) — no new work, just make sure `membership_tier` is actually passed
  through (see Data changes).

**HUD chrome (secondary, applied opportunistically):**
- Hero stat numbers and How-It-Works step numbers get slightly heavier treatment (e.g.
  subtle glow/opacity per mockup's `.step-num`) rather than a full angular/cut-corner
  redesign — the rounded-card language stays intact everywhere else so this doesn't fight
  the mockup's own aesthetic.

## Design tokens

No new Tailwind tokens required. Existing `sx.*` scale already covers the mockup's
palette (`bg`↔`sx.bg`, `purple`↔`sx.purple.DEFAULT`, `gold`↔`sx.amber`,
`green`↔`sx.green`). Mockup's `--bg-2`/`--bg-3` two-tier surface distinction collapses to
the existing single `sx.surface` — not worth a new token for a one-page difference.
Mockup's `--text-2`/`--text-3` secondary/muted split maps to `sx.gray` plus Tailwind's
existing `white/60` `white/40` opacity utilities where a third tier is needed (e.g. the
mockup's `.tc-stat-label` muted caption vs `.lb-name` secondary text) — no new color
token, just consistent opacity utility usage.

## Error handling / empty states

- No active/open tournament → `LiveTournamentStrip` omitted.
- No completed season → `HallOfFameTeaser` omitted.
- Empty leaderboard (no players with matches yet) → keep the existing `EmptyState`
  fallback, restyled to match the new row-card look instead of the table.
- `SUM(prize_pool)` with zero completed tournaments → render `₦0` (not hidden — it's one
  of three hero stats, hiding it would look broken).

## Testing / verification

- No new business logic beyond the prize-pool aggregate — spot-check that query's result
  against known completed-tournament data in Supabase before shipping.
- Manual responsive pass at 375px / 768px / 1280px (mobile-first per CLAUDE.md).
- Manual check of `prefers-reduced-motion` behavior on the count-up animation.
- No unit tests needed for the new static-content sections (`FourPillars`, `HowItWorks`,
  `HomeFinalCta`) — no logic to test. `HallOfFameTeaser`'s champion-lookup query gets a
  quick manual check since it's the one new data path beyond the aggregate.
