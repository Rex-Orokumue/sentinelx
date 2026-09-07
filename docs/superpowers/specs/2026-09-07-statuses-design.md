# Statuses (24-Hour Stories) — Design

**Date:** 2026-09-07 · **Piece 1 of 4** — see `2026-09-07-community-system-overview.md`
**Status:** schema and ring logic already built and committed; UI remains.

## What it is

A player posts an image, a short caption, or both. It appears as a ring on their
avatar at the top of `/community`, anyone signed in can tap through it, and it
disappears 24 hours later. WhatsApp statuses, essentially.

## Schema — built

`20260907120000_player_statuses.sql`, already applied.

**`player_statuses`** — `player_id`, `image_url`, `caption`, `created_at`,
`expires_at` (defaults to 24h after creation). A check constraint requires an
image or a non-blank caption, so an empty status cannot exist. Caption capped at
200 characters.

**`status_views`** — `status_id`, `viewer_id`, unique per pair, so watching twice
records once.

### Two rules worth stating

**Expiry is a query filter, not a job.** Every read filters `expires_at > now()`.
A status is invisible the instant it expires whether or not any cleanup ran.
Cleanup is housekeeping to reclaim rows and images; it is never what makes
expiry correct. This matters because this repo's cron schedules live outside it
and one is currently unwired.

**Statuses are immutable.** There is no UPDATE policy. Editing something people
have already watched is exactly what this format should not permit. Authors can
delete early; they cannot rewrite.

### Privacy of the "seen by" list

`status_views` is readable only by the status's author, or by the viewer for
their own rows. So the author sees who watched, a viewer knows what they have
watched (which drives the ring state), and nobody can see who watched anyone
else's status.

## Ring logic — built

`lib/community/statuses.ts`, 11 tests.

`groupIntoRings` turns a flat list into one ring per author, ordered as a story
tray is expected to read: **your own ring first**, then anyone with something
unwatched, then the rest — most recent first within each band. Each author's own
statuses are ordered **oldest first**, so playback runs forwards.

A ring counts as unseen until *every* status in it has been watched; a
half-watched ring still has something new in it.

## What remains

### Server actions — `lib/community/status-actions.ts`

- `postStatus({ imageUrl, caption })` — inserts for the signed-in user. Validated
  with zod mirroring the DB constraints, so the user sees a sentence rather than
  a constraint error.
- `deleteStatus(id)` — own statuses only; RLS enforces it, the action checks it
  too so the error is friendly.
- `recordStatusView(id)` — upsert, ignoring conflict. Must never throw into the
  render path: failing to record a view is not worth breaking playback over.

### Components

- **`StatusTray`** — the row of ringed avatars at the top of `/community`.
  Purple ring when unseen, grey when seen, and a "＋ Your status" entry first.
- **`StatusComposer`** — image picker plus caption. Reuses the exact upload path
  `PostComposer` already uses (client-side resize, `community-images` bucket)
  under a `statuses/` prefix, so there is no new bucket to configure.
- **`StatusViewer`** — full-screen tap-through. Segment progress bars along the
  top, tap right/left to advance and go back, auto-advance on a timer, swipe or
  Escape to close. Records a view on open of each segment. The author sees a
  viewer count that opens the "seen by" list.

### Page wiring

`/community` loads live statuses with their authors plus the viewer's own view
rows, builds rings, and renders the tray above the existing feed. Realtime is
already published for both tables, so a new status appears without a reload.

## Scope for v1

**In:** post, view, tap-through, 24h expiry, delete your own, seen-by list,
unseen rings, realtime.

**Out, deliberately:** replies to a status, reactions to a status, mentions,
music, text-only styled backgrounds, and "close friends" visibility. Each is a
feature in its own right.

**The cuttable corner, if the day runs short:** the seen-by list. Rings, posting
and playback are the feature; knowing exactly who watched is a nice-to-have.
Cutting it means not building the viewer-count UI — the view rows are still
recorded, so nothing is lost permanently.

## Moderation

A status is user-generated content shown to the whole community. It needs the
same reporting route as posts. If a report surface does not already exist for
posts, statuses use whatever posts use rather than inventing a parallel one —
this is checked during implementation, not assumed here.

## Testing

Ring grouping, ordering and expiry are pure and already tested. The actions and
components are verified by posting a status in the running app, watching it from
a second account, confirming the ring turns grey, and confirming an expired row
vanishes from the tray without any job running.
