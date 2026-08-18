# Guide System — Design Spec

**Date:** 2026-08-18
**Status:** Approved for planning
**Sub-project 2 of 3** (design replication ✅ shipped → guide system [this spec] → chatbot)

## Context

The user asked for a "comprehensive guide system for visitors," very gamey. Investigation
found the *content* layer already comprehensively built (`2026-08-16-static-pages-content.md`
shipped all 12 routes: Help Center, Safety, Rules, Tournament Guide/FAQs, Terms, Contact,
etc.) — so this isn't about writing more help pages. What's missing is an **interactive,
persistent guidance layer**, synthesized from three angles the user asked for together:

1. A gamified onboarding quest for logged-in players
2. An interactive contextual tour that spotlights real UI
3. A smarter, site-wide mascot-guide launcher (replacing the existing `SentinelBubble`)

These aren't three separate builds — they compose into one system (see Architecture).

## Scope

- **In scope:** a new site-wide `GuideLauncher` + `GuidePanel` + `Spotlight` component set;
  removal of `SentinelBubble` (subsumed, not left running alongside); one new achievement
  row + claim action tied to the existing achievement-reward primitives.
- **Out of scope:** the chatbot (sub-project 3); any change to the already-shipped static
  help pages; any change to the automatic per-context achievement pipeline
  (`checkAndUnlockAchievements`) itself.

## Architecture

```
GuideLauncher (site-wide, mounted once in app/layout.tsx)
  └─ floating button, bottom-right, persistent on every page
  └─ opens →
GuidePanel (slide-in, client component)
  ├─ anonymous visitor → Visitor Tour (static 4-slide pitch, no account data)
  └─ logged-in player  → Quest Checklist (3 steps, derived from real account state)
       each step can trigger →
Spotlight (reusable overlay: dim + cutout + mascot callout, same-page only)
```

`SentinelBubble` is removed outright — its 4 hardcoded page mounts
(`app/page.tsx`, `app/(public)/tournaments/page.tsx`, `app/(public)/games/page.tsx`,
`app/(public)/rankings/page.tsx`) are deleted, and its role (a persistent mascot-voiced
helper) is fully absorbed by `GuideLauncher`, which is strictly more capable (site-wide,
not 4-page; stateful quest tracking, not a single static message) and avoids two floating
mascot widgets competing for the same bottom-right corner.

## Component-by-component

### `GuideLauncher` (`components/guide/GuideLauncher.tsx`, new, client component)

Mounted once in `app/layout.tsx`, sibling to `SiteHeader`/`SiteFooter` (outside `<main>`,
so it persists across client-side navigation without remounting). Receives
`isLoggedIn`, `username`, `avatarUrl` from the `navSession` root layout already computes
(`lib/nav/session.ts`) — **no new query added to the site-wide layout fetch**. A floating
button (mascot avatar, purple glow ring, matching `SentinelBubble`'s existing visual
language) that toggles `GuidePanel` open/closed. First-visit affordance: a small pulse/glow
animation (reusing the existing `idle-pulse` Tailwind keyframe already in
`tailwind.config.ts`) until the visitor opens it once, then a `localStorage` flag
(`sx-guide-seen`) suppresses the pulse on future visits — same dismiss-flag pattern
`SentinelBubble` already established.

### `GuidePanel` (`components/guide/GuidePanel.tsx`, new, client component)

Slide-in panel (bottom-right, mobile-first — full-width sheet on mobile, anchored panel on
desktop). Branches on `isLoggedIn`:

**Anonymous — Visitor Tour:** a fixed 4-slide sequence, mascot-voiced, no account data to
read so no spotlighting of real elements (nothing personalized exists pre-signup):
1. "What is SentinelX" — one-line pitch
2. "The Four Pillars" — Compete/Watch/Community/Trade, reusing the copy already
   established in the homepage's `FourPillars` component (sub-project 1) rather than
   writing new copy
3. "How tournaments work" — condensed version of the homepage's `HowItWorks` steps
4. Signup CTA → `/signup`

**Logged-in — Quest Checklist:** 3 steps (revised from an earlier 4-step draft — see
Data below for why), each showing done/pending, each pending step offering a "Take me
there" link (same-page steps additionally offer "Show me" → triggers `Spotlight`):

1. **Complete your profile** — username + avatar set → `/dashboard/settings`
2. **Enter your first tournament** — a `tournament_registrations` row with
   `payment_status = 'paid'` → `/tournaments`
3. **Complete your first match** — `profiles.total_matches >= 1` → `/dashboard`

When all 3 are true, a "Claim Your Badge" button appears (see Reward below).

### `Spotlight` (`components/guide/Spotlight.tsx`, new, client component)

Reusable dim-overlay + cutout-highlight + mascot callout, positioned via
`getBoundingClientRect()` on a target ref/selector, rendered through a portal so it can
sit above page content regardless of where in the tree it's invoked from. **Same-page
only** — a quest step's "Show me" spotlight only fires when its target element is already
present on the current page; if the relevant UI lives on a different route (e.g.
"Enter your first tournament" from the dashboard), the step offers plain navigation
("Take me there") instead of a fragile cross-page spotlight-after-navigate sequence.
Dismissible (click outside, Escape, or an explicit "Got it" button) — never blocks
underlying interaction longer than the visitor wants.

## Data: quest-status computation

### Why 3 steps, not 4

An earlier draft included "submit a match result" as its own step. The schema doesn't
support that distinction: per CLAUDE.md's match-verification flow, `profiles.total_matches`
only increments after **admin confirms** a completed match — result submission is a
precondition for confirmation, not a separately-observable milestone. "Played a match" and
"submitted its result" collapse into the same signal in this data model, so tracking them
as two checklist items would show a false gap. Three steps, each backed by one real,
independently-observable signal.

### `lib/guide/quest-status.ts` (new, pure logic, tested)

```ts
export interface QuestStatusInput {
  hasUsername: boolean
  hasAvatar: boolean
  hasPaidRegistration: boolean
  totalMatches: number
}

export interface QuestStatus {
  profileComplete: boolean
  firstTournamentEntered: boolean
  firstMatchCompleted: boolean
  allComplete: boolean
}

export function computeQuestStatus(input: QuestStatusInput): QuestStatus { /* ... */ }
```

Pure function — the caller (a server action, fetched lazily when `GuidePanel` opens for a
logged-in visitor, **not** added to the root-layout `navSession` fetch that runs on every
page load) does the Supabase reads (`profiles.username`/`avatar_url`/`total_matches`,
`tournament_registrations` existence check) and passes the raw booleans/count in. Keeping
the derivation itself as a pure function makes it directly unit-testable without mocking
Supabase.

## Reward: one new achievement, explicit claim (not the automatic pipeline)

`lib/achievements/unlock.ts`'s `checkAndUnlockAchievements()` fires from single-domain
contexts (`match_completed`, `tournament_completed`, `profile_updated`, etc.), each
evaluated against one category's candidates. This checklist spans three unrelated domains
(profile, registrations, matches) simultaneously — routing it through the existing
context-push model would mean adding a new hook call at 3+ unrelated call sites (profile
edit, registration-payment webhook, match-confirm flow) just to re-evaluate a condition
`GuidePanel` already has to compute anyway to render the checklist UI.

Instead: one new server action, callable only when `computeQuestStatus(...).allComplete`
is true (re-verified server-side, not trusted from the client), that unlocks a single new
achievement using the same reward primitives `unlock()` already calls
(`awardXP`, `recordCoinTransaction`, `notifyInApp`, `pushToPlayer`) — reusing those
primitives directly rather than duplicating their logic, and inserting into
`player_achievements` the same way. No changes to `checkAndUnlockAchievements` or its
existing call sites.

**New achievement row** (migration, no schema change — fits the existing `category` CHECK
constraint):

```sql
INSERT INTO public.achievements (slug, name, description, category, xp_reward, coin_reward, phase, sort_order)
VALUES ('ready_to_compete', 'Ready to Compete', 'Complete your profile, enter a tournament, and finish your first match', 'profile', 100, 50, 'phase2', <next>);
```

Name is **"Ready to Compete"**, not "Getting Started" — `matches_10` already owns that
name (`053_achievements.sql`); reusing it would be confusing on the profile's achievement
grid. ("Ready to Compete" also echoes the homepage's Final CTA headline from sub-project 1
— deliberate, not required, just a nice thematic thread.)

## Visual / "gamey" treatment

Same design language established in sub-project 1: `sx.*` tokens, Barlow Condensed
headers, purple glow, tier/rank-style badges. Specifically:
- Launcher pulse reuses the existing `idle-pulse` keyframe (no new animation needed)
- Quest steps use a progress-bar-style fill (0/3 → 3/3) matching the "Gamey Feel" concept
  already applied elsewhere on the site (glow + icon + oversized number + animated fill)
- Spotlight cutout uses the same purple glow (`rgba(124,58,237,...)`) as the rest of the
  Phase 1 system — no new color introduced
- Claim button, on success, shows the same achievement-unlock treatment already used
  elsewhere (XP/coin toast via `notifyInApp`) — no new celebration UI invented

## Error handling / empty states

- Anonymous visitor with `localStorage` unavailable (private browsing) → pulse just
  always shows; not a functional break, purely cosmetic degradation.
- Logged-in visitor whose quest-status fetch fails → panel shows a plain "couldn't load
  your progress, try again" state, never blocks the rest of the page.
- Claim action called when `allComplete` is false (stale client state, e.g. another tab) →
  server action re-checks and rejects; no partial/duplicate unlock (mirrors `unlock()`'s
  existing `UNIQUE(player_id, achievement_id)` race-safe insert).
- Visitor already holds `ready_to_compete` → checklist still shows 3/3 complete, but the
  claim button is replaced with a "Badge earned ✓" state, no re-claim attempt.

## Testing / verification

- `lib/guide/quest-status.ts` — real unit tests (pure function, several boolean
  combinations, matches this codebase's convention of testing extracted pure logic).
- New server action — no dedicated test file; verified manually (matches how
  `checkAndUnlockAchievements`'s own call sites are verified elsewhere in this codebase —
  no direct unit tests on server actions that touch Supabase, verified end-to-end instead).
- Components — no DOM tests (this codebase's Vitest config has no jsdom; see sub-project
  1's plan for the established convention). Typecheck + build + manual responsive pass.
- Manual check: Spotlight positions correctly at 375px/768px/1280px, dismiss (click
  outside / Escape / button) all work, claim flow round-trips correctly including the
  already-claimed state.
