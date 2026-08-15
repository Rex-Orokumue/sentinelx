# Phase 3 — Social Feed — Implementation Plan

Spec: `docs/superpowers/specs/2026-08-15-phase3-social-feed-design.md`

## Pre-flight decision (resolved with user before starting)

The spec's `community_posts` collides with the already-shipped v3.6 Community
pillar (`016_community.sql` / `017_community_login_gate_and_images.sql`) —
per-game boards, login-gated read, `body`/`game_id`/replies model, same
`/community` route. Row counts checked live: 11 posts / 19 replies, all QA
test data (1 game). **Decision: replace v3.6 with the Phase 3 schema.**
Existing rows are migrated in place (`body`→`content` truncated to 500,
replies flattened into `post_comments` truncated to 280, `game_id` dropped)
rather than wiped. Read access flips from login-gated to public, matching the
spec intentionally.

## Step 1 — Migration `056_phase3_social_feed.sql`

- Stash old `community_posts` / `community_replies` / `community_post_images`
  rows into temp tables, drop the four old objects
  (`community_reply_images`, `community_post_images`, `community_replies`,
  `community_posts`), recreate `community_posts` with the Phase 3 schema
  (spec §3), add `post_reactions`, `post_comments`. Re-insert migrated rows.
- `community-images` storage bucket already exists with working RLS
  (public read, insert/delete own via `${user.id}/...` path) — reused as-is,
  no bucket changes needed.
- Add `community_challenges` + `player_challenge_progress` (spec §8), seed
  the 4 weekly challenges.
- Add `best_play_nominations` + `best_play_votes` (spec §9).
- Add `achievements.share_to_feed boolean NOT NULL DEFAULT false` (spec §2)
  and seed a `best_play_winner` achievement (category `community`, phase3) —
  referenced by §9 but missing from `053_achievements.sql`.
- Add `deleted_reason text` to `community_posts` for admin soft-delete
  (§11 "reason logged" — no column existed for it).
- RLS: spec §3 policies verbatim, plus a staff bypass UPDATE policy
  (`is_staff()`, mirrors the existing `016_community.sql` staff-delete
  pattern) so admin pin/unpin + soft-delete works through the user-scoped
  client; system posts (`match_result`/`achievement`) and admin
  announcements go through `createAdminClient()` (bypasses RLS entirely),
  matching every other system-write path in this codebase.
- Update `AdminCommunityList`/`AdminCommunityPostRow` (old v1 admin UI) —
  replaced by the new `/admin/community` in Step 9; delete the old
  components once the new page lands.

## Step 2-6 — Feed, cards, composer, reactions, detail page

Per spec §4-§7, using real codebase helpers rather than the spec's
illustrative names:
- `HexAvatar` (`components/shared/HexAvatar.tsx`) for author avatars —
  `membership_tier` for the frame, no `achievements` prop (matches
  `LeaderboardTable`'s existing usage — avoids an N+1 achievement fetch).
- `TierBadge` (`sentinel_tier`: 🟢/🔵/🟡/🔴) next to the author name, same
  as `LeaderboardTable`.
- `requireStaff()`/`getStaffContext()`/`is_staff()` for admin checks.
- New `formatRelativeTime()` in `lib/format.ts` ("2h ago") — no existing
  helper for this.
- Composer/lightbox follow the existing `VideoModal`/`ImageLightbox`
  fixed-inset-0 pattern (no Radix Dialog in this codebase).
- Reaction counts aggregated in the feed's own query (one `post_reactions`
  select grouped client-side per page), never N+1 per post (spec §14).

## Step 7 — Admin match-result hook

`lib/matches/verify-actions.ts` `confirmResult()` gets one added call,
wrapped in try/catch so a feed failure never blocks the result confirmation:
`lib/community/feed-hooks.ts#onMatchConfirmed(admin, matchId)` — creates the
`match_result` post, increments `weekly_grind` for both players and
`weekly_winner` for the winner, awards on threshold via the existing
`awardCoins`/`awardXP` (spec calls these `recordCoinTransaction`/
`recordXpEvent` — renamed to match what actually exists).

## Step 8 — Weekly challenges widget

`ChallengeWidget.tsx` Server Component, data pre-fetched on the feed page
alongside posts (spec §8). `weekly_post`/`weekly_react` increments wired into
the new post-composer and reaction Server Actions.

## Step 9 — Admin community page

Replaces the old `/admin/community` (v1 recent-posts list) with: create
announcement, pin/unpin, soft-delete any post (+ `deleted_reason`), nominate
Best Play, confirm Best Play winner (awards via `awardCoins`/`awardXP` +
unlocks `best_play_winner`, posts the winner announcement).

## Step 10 — Achievement auto-post (spec §2)

Hooked into `lib/achievements/unlock.ts#unlock()` — if
`achievement.share_to_feed`, create an `achievement` post. **Scope note:**
the spec also describes a per-achievement opt-out in account settings; that
settings UI is not one of the 9 requested build steps and is not built here.
Since `share_to_feed` defaults `false` with no UI to flip it yet, achievement
auto-posts won't actually fire until that follow-up ships — the mechanism is
in place and non-blocking either way.

## Verification

`npm test` (vitest) for new pure-logic modules (challenge progress,
content-migration truncation edge cases, feed-hook idempotency), `npm run
build` for the full app, then `superpowers:finishing-a-development-branch`.
