# Score Mismatch Flagging — Design

**Date:** 2026-07-27
**Status:** Approved, ready for implementation plan

## Context

Both players in a match can independently submit their own result row (`match_results`, unique on
`(match_id, submitted_by)`) — this isn't "the winner submits," either player can. When their
reported scores disagree (e.g. player A reports 2–0, player B reports 2–1), that's a signal of a
possible forged/misreported score.

The system already *detects* this in one narrow place: `prefillScore` (`lib/matches/verify.ts`)
refuses to pre-fill the admin's confirm form when two submissions disagree, returning `null`
instead of silently anchoring on one. But that's invisible — an admin skimming the review queue or
the per-match review page sees two "Reported X–Y" cards with no explicit call-out that they
conflict. Nothing stops a rushed review from missing the mismatch. This feature surfaces that
existing detection as an explicit, visible warning, in the two places an admin actually looks:

1. The results queue list (`/admin/results`), so a mismatch is visible before an admin even opens
   the match.
2. The per-match review page (`/admin/matches/[id]/review`), where they decide.

This is detection/surfacing only — per the existing dispute flow (CLAUDE.md: "admin reviews both
players' recordings → rules → Sentinel Scores update accordingly"), Sentinel Score changes and
status transitions stay entirely admin-driven through the existing Confirm/Dispute actions. A
flagged mismatch does not auto-dispute or auto-penalize anything.

## Shared detection — `lib/matches/verify.ts`

Extract the equality check `prefillScore` already has into a named, reusable predicate, and add
the multi-submission check on top of it:

```ts
export interface SubmittedScore {
  scoreA: number
  scoreB: number
}

function scoresMatch(a: SubmittedScore, b: SubmittedScore): boolean {
  return a.scoreA === b.scoreA && a.scoreB === b.scoreB
}

// Pre-fill the official score from up to two submissions:
// both agree -> that score; disagree -> null (no anchoring); exactly one -> it; none -> null.
export function prefillScore(a: SubmittedScore | null, b: SubmittedScore | null): SubmittedScore | null {
  if (a && b) return scoresMatch(a, b) ? a : null
  return a ?? b ?? null
}

// True when there are 2+ submissions and at least one disagrees with another —
// a signal of a possible forged/misreported score. False for 0 or 1 submissions
// (nothing to compare yet).
export function hasScoreMismatch(submissions: SubmittedScore[]): boolean {
  if (submissions.length < 2) return false
  return submissions.some((s) => !scoresMatch(s, submissions[0]))
}
```

(`hasScoreMismatch` is written generally — for >2 submissions, which can't happen today since a
match only ever has two players, but costs nothing to get right.)

## Results queue — flag before the admin even opens the match

`app/admin/results/page.tsx`'s select changes from `match_results(count)` to `match_results(score_a,
score_b)` (still one query, just returns the actual scores instead of a count). `ReviewMatchInput`
(`lib/matches/review-queue.ts`) gains `hasMismatch: boolean`, computed by the page via
`hasScoreMismatch` on the fetched submissions and passed straight through — `bucketReviewQueue`'s
bucketing logic itself doesn't change, the flag just rides along with each row into whichever
bucket it already lands in (almost always `needsReview`, since `submissionCount >= 1` routes it
there regardless of agreement).

`AdminResultsQueue`'s `Bucket` (`components/admin/AdminResultsQueue.tsx`) renders a small "⚠️
Score mismatch" badge on any row where `hasMismatch` is true.

## Per-match review page — explicit banner

`app/admin/matches/[id]/review/page.tsx` already fetches all of a match's `match_results` rows and
computes `prefill` from the first two. Add `hasScoreMismatch(submissions.map(...))` alongside that
and render a prominent warning banner above the submissions list when true: "⚠️ Players reported
different scores — review the evidence carefully before confirming." This is purely additive to
the existing submissions list and `ResultReviewForms` — no change to how the admin actually
confirms or disputes.

## Testing

- `lib/matches/verify.test.ts`: add cases for `hasScoreMismatch` — agreeing pair → false;
  disagreeing pair → true; single submission → false; no submissions → false. Existing
  `prefillScore` tests must still pass unchanged (the extraction is behavior-preserving).
- `lib/matches/review-queue.test.ts`: `ReviewMatchInput`'s test helper gains a `hasMismatch`
  default; existing tests need no behavior changes since bucketing doesn't depend on it — the flag
  just needs to be threaded through and assertable.
- Page-level changes (`app/admin/results/page.tsx`, `app/admin/matches/[id]/review/page.tsx`) and
  the `AdminResultsQueue`/review-page banner are exercised via the build and manual admin testing,
  matching how this codebase already treats these files.

## Out of scope

- No automatic Sentinel Score penalty or status change when a mismatch is flagged — admin still
  makes the call via the existing Confirm/Dispute buttons, per the established dispute flow.
- No change to `prefillScore`'s actual return behavior — it already refuses to anchor on a
  mismatch; this feature only makes that fact visible.
- No retroactive flagging/backfill for already-resolved matches.
