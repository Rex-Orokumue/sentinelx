# No-show sweep: detect-and-alert, never auto-resolve — design

Date: 2026-07-29

This is sub-project 1 of a 5-part body of work (sweep fix → completed-matches page →
substitute/waitlist → bracket tree diagram → player check-in), sequenced in that order because
this is the only piece with an active data-integrity risk on the live `dls-26-pre-season-2-championship-tournament`
tournament. The other four get their own specs.

## Problem

`resolvePendingNoShowMatches` (`lib/matches/noshow-actions.ts:30-77`), run hourly via `pg_cron`
and also exposed as an admin "Resolve pending matches" button, auto-writes a result for *any*
match still `scheduled`/`live` once its WAT calendar day has elapsed — a group match becomes a
0-0 `no_show_draw`, a knockout match becomes `forfeited` — with **no check on whether anyone
actually played**. It doesn't look at `match_results` at all.

Two consequences, confirmed against the live database on 2026-07-29:

1. **Race condition:** if one player shows up, plays, and submits a result, but admin hasn't
   confirmed it before the next hourly sweep, the sweep overwrites the real submission with a
   blank 0-0 and penalizes *both* players −10 Sentinel Score — including the one who showed up
   and won. A live check (`select ... from matches where admin_note like 'Auto-resolved%'` joined
   to `match_results`) found the 6 matches resolved so far all had zero submissions from either
   player, and none of the 33 currently-scheduled matches have submissions or are past deadline
   yet — so no damage has occurred, but the race is real and will fire as soon as a genuinely
   contested case hits the deadline boundary.
2. **Wrong default assumption:** a *mutual* no-show (both players silently absent) is the rare
   case. The common case is one player shows up, can't reach the other, and has no in-app way to
   prove it (there's nothing to submit — no match was played to screenshot). Auto-writing 0-0
   for every zero-submission match punishes the player who showed up exactly as often as it
   correctly handles a genuine double no-show, and the system has no way to tell the two apart
   from submission data alone.

Decision (explicit user call): the system must never guess. It only detects that a match has
gone stale past its deadline and alerts admin — every resolution (walkover, double no-show, or
substitute replacement) is an explicit admin action, never automatic.

## A. Schema

```sql
ALTER TABLE public.matches ADD COLUMN noshow_flagged_at timestamptz;
```

- Set once, by the sweep, the first time it sees a match cross its deadline while still
  `scheduled`/`live`. Purely a detection marker — never implies a score or status change.
- Idempotency key: prevents re-alerting admin every hour for the same stale match, and is the
  query key for the review badge/banner (`WHERE noshow_flagged_at IS NOT NULL AND status IN
  ('scheduled','live')` — cleared implicitly once admin resolves the match, since resolution
  moves `status` out of that set).
- No change to `matches.status`/`resolution` check constraints — `no_show_draw`/`forfeited`
  remain valid values, just now only reachable through an explicit admin action instead of the
  automatic sweep.

New notification plumbing (mirrors the existing `player_disqualified` addition from the
no-show/substitution feature):
- `lib/notifications/templates.ts`: new `TemplateInput` case `{ type: 'noshow_needs_decision';
  tournament: string; round: string; playerA: string; playerB: string }`.
- `lib/notifications/keys.ts`: `noshowKey(matchId: string, staffId: string)`.
- `lib/notifications/inbox.ts`: add `'noshow_needs_decision'` to `NotificationType`.

## B. The sweep becomes detect-only

Rewrite `resolvePendingNoShowMatches` in `lib/matches/noshow-actions.ts`:

- Query: `status IN ('scheduled','live')`, `scheduled_at IS NOT NULL`, `noshow_flagged_at IS
  NULL` (tournament-scoped when called from the manual trigger, same as today).
- For each match where `noShowDeadlinePassed(scheduled_at, now)`: update **only**
  `noshow_flagged_at = now()`. No score, no status, no `admin_note` write.
- For every profile with `role IN ('admin','moderator')` (`user_roles` join `profiles`) that has
  a `whatsapp_number`, call `notify({ type: 'noshow_needs_decision', playerId: staffId,
  dedupeKey: noshowKey(match.id, staffId), ... })` plus `notifyInApp` for the in-app admin
  notification. Best-effort, matching `notify()`'s existing swallow-and-log behavior — this must
  never block the flagging write.
- Return `{ flagged: number }` (replaces `{ drawn, forfeited }`).

The cron route (`app/api/cron/resolve-noshow-matches/route.ts`) and the `pg_cron` schedule stay
exactly as wired (same path, same bearer-secret auth) — only the function body's effect changes,
from "resolve" to "flag and alert." Confirmed live against `cron.job` on 2026-07-29: the schedule
is `0 * * * *` (hourly), matching the deviation documented in the original
`2026-07-28-noshow-resolution-and-player-substitution-design.md` (Task 10 there retired a
conflicting hourly `expire-full-day-matches` job and moved this sweep into its slot) — this spec
doesn't change cadence, it inherits it.

**Return-shape change — two callers to update:**
`resolvePendingNoShowMatches`'s return changes from `{ drawn, forfeited }` to `{ flagged }`. Both
existing callers destructure the old shape and need updating in the same change:
- `app/api/cron/resolve-noshow-matches/route.ts:11` — `const { drawn, forfeited } = await
  resolvePendingNoShowMatches(admin)` → `const { flagged } = ...`, response body becomes `{
  flagged }`.
- `triggerResolvePendingMatches` (`lib/matches/noshow-actions.ts:186`) — same destructure, and
  its return shape `{ success: true, resolved: drawn + forfeited }` becomes `{ success: true,
  flagged }`. `ResolvePendingMatchesButton`'s success copy needs to read "N matches flagged for
  review" instead of implying anything was resolved.

The admin "Resolve pending matches" button (`components/admin/ResolvePendingMatchesButton.tsx`)
is relabeled **"Check for no-shows now"** — same underlying call, tournament-scoped, useful right
after a round closes rather than waiting for the next hourly tick. Its confirm copy changes from
"group → 0-0 draw, knockout → forfeit" to "flags stale matches for your review — nothing is
scored automatically."

## C. Admin review surface

- **Badge count**: `SELECT count(*) FROM matches WHERE noshow_flagged_at IS NOT NULL AND status
  IN ('scheduled','live')`, shown on the admin nav (next to "Results") and as a banner at the top
  of `app/admin/tournaments/[id]/matches/page.tsx` listing each flagged match (opponent names,
  round, days overdue) linking to its existing `/admin/matches/[id]/review` page.
- No change to `app/admin/results/page.tsx`'s existing `needsReview`/`noSubmission`/`disputed`
  buckets — a flagged match with a submission already surfaces there today; this banner adds
  visibility for flagged matches with **zero** submissions too, which today have nowhere to
  surface at all once the auto-sweep stops touching them.

## D. New "Mark both no-show" admin action

For the genuine rare case: both players confirmed silent, admin has tried to reach them, no
substitute makes sense (or none available yet).

- New action alongside the existing `declareNoShowWinner` on `/admin/matches/[id]/review`,
  usable only when `matches.noshow_flagged_at IS NOT NULL`, `status IN ('scheduled','live')`,
  **and no `match_results` row exists for this match**. Unlike `declareNoShowWinner` (which is
  safe to run regardless of what either player submitted, since it always credits a specific
  player), writing a *mutual* no-show when someone actually submitted a result would silently
  discard real evidence and wrongly penalize the player who showed up — exactly the failure mode
  this whole spec exists to prevent. If a submission exists, the action returns an error pointing
  admin at "Declare no-show winner" or the normal confirm-result flow instead.
- Required reason (same pattern as `declareNoShowWinner`'s reason field).
- Writes exactly what the old automatic sweep used to write — group: `status='completed'`,
  `resolution='no_show_draw'`, `score_a=0, score_b=0`; knockout: `status='forfeited'` — then
  reuses the same `recomputeGroupAndMaybeAdvance`/`advanceKnockout`/`syncMatchEvents` pipeline
  `declareNoShowWinner` already calls.
- `declareNoShowWinner` itself needs no change — it already accepts a still-`scheduled`/`live`
  match as eligible, so it's already the correct path for the common single-no-show case; this
  task only adds the deliberate-double-no-show sibling action.

## E. Relationship to the rest of the body of work

- Replacing a no-show player with a substitute (rather than just eliminating them via a walkover
  loss) is sub-project 2 (disqualify + substitute, extending the flow already shipped in PR #2)
  — out of scope here. This spec only stops the silent auto-write and gets the decision in front
  of admin; sub-project 2 gives admin a better option once they're looking at it.
- Detecting a no-show via player check-in (sub-project 5) is a future input into the same
  flagging query, not a blocker for this fix — the deadline-based detection here stands on its
  own regardless of whether check-in ships later.

## F. Data already affected — verified, no backfill needed

Checked live on 2026-07-29 against the `dls-26-pre-season-2-championship-tournament` tournament:
all 6 matches the old auto-sweep already resolved (`admin_note = 'Auto-resolved: no result
submitted by the match deadline.'`) had **zero** `match_results` rows from either player — every
one was a genuine double no-show, correctly scored 0-0 under both the old and new rules. No
knockout matches were forfeited. All 33 currently-`scheduled` matches also have zero submissions
and none are past deadline yet. No corrective/undo migration is needed for existing data.

## G. Testing

- `lib/matches/noshow.test.ts` — unchanged (deadline boundary logic untouched).
- `lib/matches/noshow-actions.ts` tests (new/updated) — the rewritten
  `resolvePendingNoShowMatches` asserts: `noshow_flagged_at` is set, `status`/`score_a`/`score_b`
  are untouched, and a `notify`/`notifyInApp` call fires per staff profile. A new
  `markBothNoShow` action gets the same integration-test treatment as `declareNoShowWinner`,
  plus an explicit case asserting it's rejected with no mutation when a `match_results` row
  exists for the match.
- `lib/notifications/keys.test.ts` / `templates.test.ts` — add cases for `noshowKey` and
  `noshow_needs_decision` rendering, following the existing per-type pattern.
- Cron route manual verification: stage a past-deadline match, POST to the route, confirm
  `noshow_flagged_at` is set and the match is otherwise unchanged, and confirm a second POST
  does not re-notify (dedupe via `noshow_flagged_at IS NULL` filter).

## Scope boundaries

**In:** `noshow_flagged_at` column; rewriting the sweep to flag-and-alert instead of
auto-resolve; WhatsApp + in-app alert to admin/moderator staff; badge/banner on the admin matches
page; new explicit "Mark both no-show" action; renaming the manual trigger button; verifying no
existing data needs correction.

**Out:** substitute/waitlist enhancements (sub-project 2); a dedicated completed-matches page
(sub-project 3); the visual bracket tree diagram (sub-project 4); player check-in (sub-project
5) — each gets its own spec. Also out: changing `declareNoShowWinner`'s existing eligibility
rules or the knockout-bye-lock behavior documented in the original
`2026-07-28-noshow-resolution-and-player-substitution-design.md` — both are unchanged by this
spec.
