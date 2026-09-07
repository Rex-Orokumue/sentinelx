# Follows — Design

**Date:** 2026-09-07 · **Piece 3 of 4** — see `2026-09-07-community-system-overview.md`

## What it is

An asymmetric follow graph: you follow whoever you like without their approval,
and a "Following" filter on the feed shows only their posts.

## Why not reuse friends

`023_friends_and_friendly_matches` already exists, but it is **symmetric and
consent-based**: a request, an acceptance, a mutual relationship — the right
model for arranging a friendly match, which is what it was built for.

Following is a different thing. It needs no permission, it flows one way, and it
is about what you want to read rather than who you play. Overloading friends
with it would break the friendly-match flow, which relies on both parties having
agreed. So this is a second, separate graph, and both keep their own meaning.

## Schema

Migration `<timestamp>_player_follows.sql`.

**`player_follows`** — `follower_id`, `following_id`, `created_at`, unique per
pair, with a check that they differ so nobody follows themselves.

Two indexes: `(follower_id)` for "who I follow", `(following_id)` for follower
counts and "who follows me".

**RLS:** the graph is public — follower counts are shown on profiles, as on any
social product. You may insert and delete only rows where you are the follower.
No UPDATE; a follow either exists or does not.

**Counts are derived, not stored.** No `follower_count` column on `profiles`:
a denormalised counter drifts the moment anything writes outside the one path
that maintains it, and this codebase has already had one score-drift incident
that broke player stats for ten days. Counting rows is fast at this scale.

## Blocking interaction

If direct messages ship first, a block should also sever a follow in both
directions and prevent re-following. If follows ship first, that rule is added
when messages land. Whichever order, the rule belongs in one place, not
duplicated across two features.

## Surfaces

- **Profile** — Follow / Following button, follower and following counts, each
  opening a list.
- **Feed** — a "Following" tab beside the existing filters, showing posts by
  people you follow. Empty state when you follow nobody yet, pointing at the
  community rather than showing a blank page.
- **Suggestions** — deliberately out of scope. "Who to follow" is a ranking
  problem and a separate piece of work.

## Scope for v1

**In:** follow, unfollow, counts, follower/following lists, feed filter.

**Out:** suggestions, mutual-follow indicators, notifications on being followed,
private accounts with approval.

**The cuttable corner:** the follower/following list pages. Counts on the
profile and the feed filter are the feature; browsable lists can follow.

## Testing

Pure logic: the follow predicate, count derivation, and self-follow rejection.
The feed filter is verified by following an account and confirming its posts
appear under the tab while a non-followed account's do not.
