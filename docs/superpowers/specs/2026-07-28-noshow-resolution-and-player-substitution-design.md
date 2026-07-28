# No-show match resolution & player disqualification/substitution — design

Date: 2026-07-28

## Problem

Two related gaps in the match/tournament lifecycle:

1. When one player is unreachable and the other has genuinely tried to reach them, there's
   no way to resolve the match other than admin hand-typing a score into `confirmResult` and
   hoping they remember to. When *both* players go dark, nothing resolves the match at all —
   it just sits `scheduled` forever, blocking group standings and knockout advancement.
2. There's no way to remove a chronically-inactive player from an in-progress tournament and
   hand their remaining fixtures to a substitute. Today the only related primitive is
   `refundRegistration` (`lib/tournaments/admin-actions.ts:229-267`), which only touches
   `payment_status` — it doesn't touch matches, groups, or the bracket.

These are treated as one connected feature: proactive removal (during group stage, while
there's still time to bring in a substitute) is the real fix for tournament quality; automatic
no-show resolution is the backstop for whatever slips through — including the case where a
double no-show reaches the knockout stage, which removal is meant to prevent.

## A. Data model

New migration, additive only:

```sql
ALTER TABLE public.matches DROP CONSTRAINT matches_status_check;
ALTER TABLE public.matches
  ADD CONSTRAINT matches_status_check
  CHECK (status IN ('scheduled', 'live', 'completed', 'disputed', 'cancelled', 'bye', 'forfeited'));

ALTER TABLE public.matches
  ADD COLUMN resolution text CHECK (resolution IN ('walkover', 'no_show_draw'));

ALTER TABLE public.tournament_registrations
  ADD COLUMN status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disqualified', 'withdrawn')),
  ADD COLUMN replaces_registration_id uuid REFERENCES public.tournament_registrations(id),
  ADD COLUMN disqualified_at timestamptz,
  ADD COLUMN disqualification_note text;
```

- `matches.status = 'forfeited'` — knockout double no-show. No score, no winner, both
  eliminated. Distinct from `completed` because `matchEventsFor` and `matchWinnerId`
  (`lib/tournaments/advancement.ts:12-17`) both key off status, and a forfeited match must
  never resolve a winner.
- `matches.resolution` — tags a `completed` match as no-show-driven, for audit/badges only.
  `NULL` for every normally-played/reviewed match (no change to existing rows or flows).
  `'walkover'` = single no-show, admin-declared winner. `'no_show_draw'` = group-stage double
  no-show, 0-0.
- `sentinel_score_events` needs **no** schema change — `no_show` is already a valid
  `event_type` (added in `001_initial_schema.sql:189`, confirmed live via
  `008_win_no_dispute_event.sql`), just never written by any code path today.
- `tournament_registrations.status` is a new axis, independent of `payment_status`. A
  disqualified player's `payment_status` is untouched unless admin separately runs
  `refundRegistration` (refund is opt-in, not automatic — disqualification is their fault).
- `fee_waived` (existing column, `031_tournament_fee_waivers.sql:33`, default `false`) is
  **not** set for a substitute's registration. `fee_waived=true` means admin comped a normal
  registration; a substitute isn't comped, they're inheriting a slot someone already paid for.
  The distinction is `payment_status='paid'` + `fee_waived=false` +
  `replaces_registration_id` pointing at the disqualified row as the audit trail. This keeps
  substitutions out of waiver financial reporting.

## B. Feature 1 — No-show resolution

### Single no-show (walkover)

Admin receives WhatsApp proof of contact attempts out-of-band (no in-app tracking of this —
consistent with WhatsApp v1 being share-links only, no inbound API). On the match, a new
**"Declare no-show winner"** admin action: pick which player showed up, required reason note.

Sets: `status='completed'`, `resolution='walkover'`, `score_a`/`score_b` = **3-0** oriented to
the declared winner, `admin_note`, `completed_at=now()`. Reuses the same post-processing
`confirmResult` already does (`lib/matches/verify-actions.ts:220-341`) — group recompute /
knockout advance / `syncMatchEvents` / notify — factored into a shared helper so the two admin
actions don't duplicate that pipeline.

Available any time before the deadline cron would otherwise resolve the match. If proof
arrives after the cron already ran, admin uses the same action to overwrite the
auto-resolution — but this override is only safe for group-stage `no_show_draw` matches
(update the match, re-run `recomputeGroupAndMaybeAdvance`, done) or a knockout `forfeited`
match that **hasn't yet produced a next-round bye row**. Once `advanceKnockout` has run and
inserted that bye, the match is locked — see the knockout override note below and the scope
boundaries.

### Double no-show — group stage

Cron (or the manual trigger) sets `status='completed'`, `resolution='no_show_draw'`,
`score_a=0, score_b=0`. No group-standings schema/logic change needed — `computeGroupStats`
(`lib/tournaments/results.ts:29-51`) already treats an equal score as a draw (1 point each).

### Double no-show — knockout

Cron sets `status='forfeited'`. **Neither player advances.** This is a deliberate rule (user
call): letting an inactive "winner" advance by tie-break just moves the ghost-player problem
one round deeper and knocks out a player who actually showed up. Two changes required:

1. `roundResolved` (`lib/tournaments/advancement.ts:20-22`) must treat `forfeited` as resolved,
   alongside `completed`/`bye`, or the round never lets the next round generate.
2. `pairWinners` (`advancement.ts:25-35`) currently pairs `byeWinners` + `matchWinners`
   sequentially and **silently drops a trailing unpaired entry** if the merged list is odd
   (`for (let i = 0; i + 1 < merged.length; i += 2)` skips the last item with no bye
   fallback). This never fires today because byes + real winners always sum to a power of two
   — `roundResolved` gates on full participation and `knockoutRound1`
   (`lib/tournaments/draw.ts:59-73`) pads round 1 to a power of two up front. A forfeited match
   breaks that invariant by contributing zero winners. Fix: `pairWinners` returns
   `{ pairs, leftover }`; `advanceKnockout` (`verify-actions.ts:164-218`) inserts a `bye` row
   for `leftover` instead of dropping them, so their next opponent auto-advances exactly like
   any other bye.

Known, accepted edge case: if the *two* matches that would have paired into the same next-round
slot are **both** forfeited, there are zero advancers for that slot and no automated fallback —
admin resolves manually. Expected to happen approximately never; not worth engineering around.

**Overriding a forfeit after the bye exists is out of scope.** `advanceKnockout` runs
synchronously as part of resolving the round, so by the time late WhatsApp proof shows up, the
leftover player's bye into the next round may already have been inserted. Reversing that
cleanly means cancelling the orphaned bye row *and* re-triggering advancement from that point —
correcting one match would otherwise leave two players credited with the same bracket slot.
Given how rare this is, "Declare no-show winner" is simply **disabled once a knockout
`forfeited` match's next-round bye row exists** (checked by looking for a `bye` row in the next
round referencing the surviving player from the paired forfeit). Admin resolves the rare
collision by hand: cancel the incorrect bye match, then re-run "Resolve pending matches" (or
`confirmResult`) to regenerate advancement correctly. Group-stage `no_show_draw` overrides have
no such lock — a group draw never generates downstream matches by itself, so it's always safe
to correct.

### Sentinel Score wiring

Extend `lib/scoring/events.ts`:
- Add `'no_show'` to `AUTO_MATCH_EVENT_TYPES` (currently `['match_completed', 'win_no_dispute']`,
  `events.ts:4`) so the existing delete-and-regenerate cycle in
  `regenerateMatchEvents`/`recomputeAllScoring` (`lib/scoring/apply.ts:47-56,112-130`) also
  owns no-show events tied to a `match_id` — no new cleanup path needed.
- `matchEventsFor` (`events.ts:27-46`) branches on `match.resolution` / `match.status`:
  - `resolution='walkover'`: winner → `match_completed` (+2) only, no `win_no_dispute` (no real
    match was adjudicated). Loser → `no_show` (−10) only.
  - `resolution='no_show_draw'`: both players → `no_show` (−10) each, no `match_completed`.
  - `status='forfeited'`: both players → `no_show` (−10) each. (Currently `matchEventsFor`
    short-circuits on `status !== 'completed'`; this needs a second branch for `forfeited`.)
- `apply.ts`'s `.eq('status', 'completed')` filters in `syncMatchEvents`/`recomputeAllScoring`
  broaden to `.in('status', ['completed', 'forfeited'])` so forfeited matches flow through the
  same event pipeline. `refreshPlayer`'s career-stats query stays scoped to `completed` only —
  a forfeit isn't a real result and shouldn't appear in win/loss record.

### Deadline cron + manual fallback

New `app/api/cron/resolve-noshow-matches/route.ts`, same bearer-secret pattern as
`app/api/cron/fixture-reminders/route.ts:32-36`. Finds `matches` where `status IN ('scheduled',
'live')` and the Africa/Lagos calendar date of `scheduled_at` has fully elapsed, and applies the
group-draw or knockout-forfeit rule per match. Scheduled via `pg_cron`/`pg_net` the same
out-of-band way as `fixture-reminders` (`docs/superpowers/specs/2026-07-10-whatsapp-notifications-design.md:101-113`).

**Runs hourly (`0 * * * *`), not daily as originally scoped.** Implementation discovered a
pre-existing `pg_cron` job, `expire-full-day-matches` (also hourly), calling a Postgres function
that sets `matches.status='cancelled', auto_expired=true` for any full-day match still
`scheduled` a day past `scheduled_at` — missed during this spec's research. Running the new
sweep only once daily would have let that hourly job win the race every time, flipping matches
to `cancelled` before the sweep ever saw them as `scheduled`/`live`, silently defeating the
feature. Resolved by retiring `expire-full-day-matches` (unscheduled; the function itself is
left in place, just unused) and running `resolve-noshow-matches` hourly in its place — one
mechanism now owns "what happens to a stale match," applying real rules (draw/forfeit/walkover)
instead of a blank cancellation. `auto_expired` is read by `lib/matches/review-queue.ts` /
`lib/admin/notification-queue.ts` / `app/admin/results/page.tsx` to route no-submission
full-day matches into an admin "needs review" queue; no change was needed there, since the new
sweep now resolves those matches directly and definitively before they'd ever need manual
review — the queue simply stops receiving new entries via that path going forward, and
historical rows are unaffected.

Also exposed as a **"Resolve pending matches"** button on the tournament-scoped
`app/admin/tournaments/[id]/matches/page.tsx` (not a global admin dashboard action — admin
needs to be looking at the right tournament), calling the same underlying function scoped to
that `tournament_id`. This is the explicit "system shouldn't fail silently" fallback.

### Group standings tiebreak

`sortStandings` (`lib/tournaments/standings.ts:32-52`) changes its primary sort key from raw
`points` to **points-per-game-played**: `points / played` (guard `played=0` → ranks last).
When every player in a group has played the same number of matches — true for every group with
no substitution, and true once a substituted group finishes its round-robin — this produces an
identical order to today, since `points/played` is monotonic with `points` for a fixed
denominator. It only changes behavior for a group where a substitute has played fewer matches
than the rest, which is exactly the case it needs to handle fairly.

## C. Feature 2 — Disqualify & substitute

On `app/admin/tournaments/[id]/registrations/page.tsx`, each `status='active'` registration
row gets a **"Disqualify"** action:
- Required reason (free text) → `tournament_registrations.status='disqualified'`,
  `disqualified_at=now()`, `disqualification_note`.
- Writes an `admin_flag_conduct` sentinel score event (−5) for the removed player by default —
  this is exactly the documented CLAUDE.md rule for conduct-flagged players.
- Sends the removed player a notification (new `player_disqualified` template in
  `lib/notifications/templates.ts`, new dedupe key in `lib/notifications/keys.ts`) carrying the
  reason — they should know they were removed and why, not just silently lose access.
- Refund is **not** automatic — admin separately runs the existing `refundRegistration` if they
  choose to.

A disqualified row then shows **"Add substitute"**:
- Admin searches an existing profile by username.
- New `tournament_registrations` row: `payment_status='paid'`, `fee_waived=false` (default,
  unchanged), `status='active'`, `replaces_registration_id` → the disqualified row's id.

Reassignment (same transaction as creating the substitute registration):
- Every `matches` row still `status IN ('scheduled', 'live')` with `player_a_id` or
  `player_b_id` equal to the removed player's id gets that column swapped to the substitute's
  id. Already-`completed`/`forfeited` matches are untouched — history stands as-played, per the
  "no retroactive anything" decision.
- If the removed player has a `group_memberships` row, its `player_id` is repointed to the
  substitute. No manual stat reset needed: `recomputeGroupAndMaybeAdvance`
  (`verify-actions.ts:43-118`) derives every player's stats purely from `matches` rows matching
  their *current* id, so the substitute automatically starts at 0 and only accrues points from
  matches they actually play — the reassignment alone produces the agreed behavior.

**Known limitation, accepted:** this only reassigns match rows that already exist. If a player
is disqualified in the brief window between their previous round completing and the next
round's matches being generated, there's nothing yet to reassign — admin should trigger/wait
for that generation first, then substitute. Not building speculative "reserve a future slot"
logic for a gap that's normally seconds-to-minutes wide (round generation happens synchronously
inside `confirmResult`'s post-processing).

## D. Testing

Pure-function changes get unit tests alongside their existing suites: `matchEventsFor`
(resolution branches), `pairWinners` (leftover → bye), `sortStandings` (PPG tiebreak, and that
equal-`played` groups sort identically to before), and the Lagos day-boundary check (mirroring
`isWithinReminderWindow`'s existing boundary tests). The cron route and the two new admin
actions (`declareNoShowWinner`, `disqualifyAndSubstitute`) get integration coverage the way
`confirmResult`/`disputeResult` are tested today.

## Scope boundaries

**In:** schema changes above; walkover + double-no-show resolution (group and knockout);
Sentinel Score wiring for all three outcomes; deadline cron + manual admin trigger; PPG
standings tiebreak; disqualify + substitute admin flow with match/group reassignment;
disqualification notification.

**Out:** in-app tracking of "contact attempts" (stays WhatsApp + admin judgment, per explicit
decision); reopening a *normally* confirmed/reviewed match (only no-show-resolved matches are
amendable via "Declare no-show winner"); automated resolution of the double-adjacent-forfeit
dead end; **overriding a knockout `forfeited` match once its next-round bye row already
exists** — locked, admin resolves by hand (cancel the bye, re-run advancement) rather than the
system reconciling it automatically; a waitlist/queue of pre-vetted substitutes (admin picks
any existing profile); non-full-day / time-slotted match deadline handling beyond the Lagos
calendar-day rule (all generated matches are `is_full_day=true` today per
`nextRoundScheduledAt` usage, so this covers the actual fixture set).
