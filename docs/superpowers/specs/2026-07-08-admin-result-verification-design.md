# Admin Result Verification — Design (#9 sub-project 5 of 6)

**Routes:** `/admin/results` (new), `/admin/matches/[id]/review` (new)
**Date:** 2026-07-08
**Status:** Approved, ready for implementation plan

## Context

Fifth of the six Admin Dashboard sub-projects, and the crux of the trust model. Players submit a
score + screenshot + recording on the Match Centre (already built). An admin reviews and either
**confirms** an official score — which updates group standings and advances the bracket — or
**disputes** it. Sentinel Score automation stays deferred (v2.0). Role: **`requireStaff`** (result
verification is not a financial action; moderators may verify).

This sub-project owns everything that happens **when a result is confirmed**, which includes the
two transitions flagged since #3:
- the **group → knockout** generation (when the last group match is confirmed), and
- the **knockout round advancement** (build round N+1 from round N's verified winners; byes are
  terminal and never re-resolved).
It also finishes the **`active → completed`** tournament transition deferred from #2 (auto, when
the final is confirmed).

## Migration `007_match_admin_note.sql`

Add `matches.admin_note text` (nullable) to store the mandatory dispute reason — no other column
fits. Nullable text add: lowest-risk migration, backwards compatible. Regenerate types.

## Pure engines (no Supabase, unit-tested)

**`lib/tournaments/results.ts`**
- `computeGroupStats(playerIds, completedGroupMatches)` → per-player
  `{ playerId, points, wins, draws, losses, goalsFor, goalsAgainst }`, recomputed from that group's
  **completed** matches (win 3 / draw 1 / loss 0). Idempotent — a full recompute, so corrections
  are safe.
- `collectAdvancers(standingsPerGroup)` → ordered `playerId[]`: all group **winners** first, then
  all **runners-up** (top-2 via the existing `sortStandings`, `advancing` flag). This ordering
  feeds `knockoutRound1` so winners tend to seed above runners-up.

**`lib/tournaments/advancement.ts`**
- `matchWinnerId(match)` → `completed` ⇒ the higher-scoring player (asserts a decisive score);
  `bye` ⇒ `player_a_id`; otherwise `null`.
- `roundResolved(matches)` → true only when **every** match is `completed` or `bye`.
  **`disputed`/`pending`/`scheduled`/`live` all count as unresolved** — the only update trigger is
  `completed` (plus terminal `bye`).
- `pairWinners(byeWinnerIds, matchWinnerIds)` → interleave byes with match-winners, chunk into
  pairs (bracket-correct for every bye case: n = 5, 6, 7).
- `nextRoundName(current)` → the next entry in `ROUND_ORDER`; `final` → `null`.

**`lib/matches/verify.ts`**
- `prefillScore(subA, subB)` → both submissions agree ⇒ that score; disagree ⇒ `null` (blank — no
  anchoring); exactly one ⇒ it; none ⇒ `null`.

**`lib/matches/review-queue.ts`**
- `bucketReviewQueue(matches, now)` → `{ needsReview, noSubmission, disputed }`. Per match (input
  is already limited to status `scheduled`/`live`/`disputed`):
  - `disputed` → **Disputed**.
  - `submissionCount ≥ 1` and status `scheduled`/`live` → **Needs review** (a submission is the
    strongest signal the match was played — included regardless of `scheduled_at`, which closes the
    gap where an unscheduled-but-played match would hide).
  - status `scheduled`, `submissionCount = 0`, `scheduled_at != null` and `≤ now` → **No submission**
    (past due, chase players or enter a walkover).
  - otherwise (future scheduled, live-no-submission) → excluded.
  `now` is injected for deterministic tests, matching `bucketFixtures`.

## Validation — `lib/matches/verify-schema.ts` (zod)

`confirmScoreSchema`: `scoreA`, `scoreB` — coerced int, 0–99 (same bounds as the player submission
schema).

## Actions — `lib/matches/verify-actions.ts` (`requireStaff`; service-role for the orchestrated multi-row writes)

- **`confirmResult(prev, formData)`** — parse `confirmScoreSchema`; load the match
  (`round, group_id, tournament_id`, tournament `status/slug`). If the match is a **knockout** round
  (`round != 'group'`), require `scoreA != scoreB` (no draws in knockout). **Atomic match update:**
  `{ score_a, score_b, status:'completed', completed_at: now }` in one row write; mark the match's
  `match_results` rows `verified`. Then, by branch:
  - **Group match:** `computeGroupStats` for that group → update its `group_memberships`. Then, if
    **all** of the tournament's group matches are now `completed` **and** no knockout matches exist
    yet, generate knockout round 1 from `collectAdvancers(...)` via `knockoutRound1` (reusing #3's
    helper + insert shape, byes as terminal `status='bye'` rows).
  - **Knockout match:** if `roundResolved(all matches of this round)` and the next round has no
    matches yet, create it via `pairWinners(...)` (`round = nextRoundName(current)`). If
    **`nextRoundName(current) === null`** (i.e. the final was just confirmed — checked via the
    helper, never a hardcoded `'final'`), set `tournaments.status = 'completed'`.
  - `revalidatePath` the results queue, the review page, `/matches/[id]`, and the public + admin
    bracket pages.
- **`disputeResult(prev, formData)`** — `note` required non-empty (else error); set the match
  `status='disputed'`, `admin_note=note`; set the match's `match_results` rows to `disputed`. **No
  standings/bracket change.** Revalidate as above.

Downstream idempotence: the match-row write is the atomic anchor; the standings recompute and
next-round generation are idempotent (full recompute / existence-guarded insert), so a retried
confirm converges.

## Review surfaces

- **`/admin/results`** — global queue rendered as the three buckets (Needs review / No submission /
  Disputed), each row grouped by tournament and linking to the review page. The Overview
  "pending results" `StatCard` gains `href="/admin/results"`. Add `{ label: 'Results',
  href: '/admin/results', adminOnly: false }` to `ADMIN_NAV`.
- **`/admin/matches/[id]/review`** — shows both players' submissions (score, screenshot via a
  **service-role signed URL**, recording link, submission status), a **confirm** form (official
  score pre-filled per `prefillScore`), and a **dispute** form (mandatory note). Component
  `components/admin/ResultReviewForms.tsx` (`"use client"`, `useFormState` per action). Staff can
  read both submissions (`mr_select` permits `is_staff`); screenshots need the service-role client
  for signed URLs (the Match Centre already does this for a participant's own).

The read side (`loadBracketView`, `sortStandings`) already reflects the writes — no bracket/standings
UI changes needed.

## Security

- All actions `requireStaff`; the confirm/dispute actions re-check match/tournament state
  server-side; orchestrated writes use the service-role client behind that gate (consistent with #3).
- Screenshot access is via short-lived signed URLs generated server-side; the raw storage path is
  never exposed.

## Testing

Vitest:
- `computeGroupStats`: points for win/draw/loss, goals tallied both directions, multiple matches,
  idempotent recompute.
- `collectAdvancers`: winners-before-runners-up ordering across groups.
- `advancement`: `matchWinnerId` (completed higher score, bye → player_a, else null),
  `roundResolved` (disputed/pending excluded), `pairWinners` interleave for n = 5/6/7,
  `nextRoundName` incl. `final → null`.
- `prefillScore`: agree / disagree / one / none.
- `bucketReviewQueue`: each bucket, future-scheduled excluded, submitted-but-unscheduled → Needs
  review, past-due-no-submission → No submission.

Actions/pages are I/O-bound — exercised via the build and manual admin testing on the seeded DLS
Test Cup.

## Consistency notes

- Mobile-first; the review page stacks submissions above the forms at 375px.
- Do NOT mark roadmap #9 done (sub-project 5 of 6; only the withdrawal queue remains).
- The `matches.player_a_id`/`player_b_id` nullable + `'bye'` handling from #3 applies: bye rows are
  terminal (their winner is `player_a_id`), never surfaced for review, and never re-resolved.
