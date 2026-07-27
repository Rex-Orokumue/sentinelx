# Automatic Round Scheduling — Design

**Date:** 2026-07-27
**Status:** Approved, ready for implementation plan

## Context

Bracket generation (`lib/tournaments/bracket-admin-actions.ts`) and knockout advancement
(`lib/matches/verify-actions.ts`) both insert `matches` rows with `scheduled_at = null`. Every
match then needs its date/time hand-entered on the admin Matches page (`MatchRow` →
`updateMatch`), one at a time — for a 64-player bracket that's dozens of matches across several
rounds. This is the pain point: rounds are already grouped correctly in the UI (`ROUND_ORDER` /
`ROUND_LABELS`), the missing piece is that no date is ever pre-assigned.

Matches stream one at a time to the single Sentinel X YouTube channel, so there's no need for
per-match kickoff times — the existing **full-day scheduling** mode (#24,
`is_full_day`/`scheduled_at` = midnight WAT, "playable anytime that day") already fits this
perfectly. The fix: whenever a round's matches are generated, auto-assign them that round's date
using the full-day mode, computed from an admin-set start date and a fixed gap between rounds.
Admin can still hand-override any individual match afterward via the existing Timed/Full-day
toggle — this only removes the need to touch every match by default.

## Data model

**New migration**, columns on `tournaments`:

```sql
ALTER TABLE public.tournaments
  ADD COLUMN round_start_date date,
  ADD COLUMN round_gap_days   integer NOT NULL DEFAULT 1 CHECK (round_gap_days >= 1);
```

- `round_start_date` — nullable. The calendar date the tournament's first round is playable.
  `null` means auto-scheduling is off for this tournament (fully backward-compatible: existing
  tournaments default to `null`, so their matches keep inserting with `scheduled_at = null`
  exactly as today, until an admin sets a start date).
- `round_gap_days` — days between one round's date and the next. Defaults to 1.

No backfill needed — both columns are additive and inert until an admin sets
`round_start_date` through the new UI.

## Scheduling helper — `lib/tournaments/round-schedule.ts` (new file)

```ts
// Pure: add N calendar days to a stored UTC instant. Safe without timezone
// conversion because WAT (Africa/Lagos, UTC+1) has no DST — same reasoning
// migration 021 (full-day matches) already relies on.
export function addRoundGapDays(iso: string, days: number): string

// The scheduled_at (midnight WAT, full-day) for a round about to be generated
// for this tournament. Returns null if round_start_date is unset (auto-
// scheduling opted out — admin schedules manually, unchanged from today).
//
// Deliberately does NOT read any match's scheduled_at (a manually-edited
// match, or a bye sharing its round's date, could otherwise skew a MAX()-based
// calculation). Instead it counts how many *distinct rounds* already have
// matches for this tournament — every round is always inserted as a single
// atomic batch (recomputeGroupAndMaybeAdvance/advanceKnockout both refuse to
// insert into a round that already has rows), so that count is exactly how
// many round-dates have already been assigned:
//
//   next_date = round_start_date + (rounds_already_generated * round_gap_days)
export async function nextRoundScheduledAt(
  admin: Admin,
  tournamentId: string,
): Promise<string | null>
```

`nextRoundScheduledAt`:
1. Reads `round_start_date`/`round_gap_days` from `tournaments`; returns `null` immediately if
   `round_start_date` is unset.
2. Selects `round` for all of this tournament's `matches`, takes the count of distinct values.
3. Returns `addRoundGapDays(fromDateLocal(round_start_date), roundsGenerated * round_gap_days)`
   (`fromDateLocal` already exists in `lib/format.ts`, from the full-day-matches feature).

This one helper is called at all three places matches get inserted:

1. **`bracket-admin-actions.ts` → `generate()`** — called immediately after `clearBracket()`, so
   it always sees zero existing matches for this tournament and returns `round_start_date`
   unmodified. Covers both the initial "close registration & generate" and "re-roll draw".
2. **`verify-actions.ts` → `recomputeGroupAndMaybeAdvance()`** — group stage just finished; sees
   the `group` round already present (count 1) → returns `round_start_date + round_gap_days`.
3. **`verify-actions.ts` → `advanceKnockout()`** — sees however many rounds already exist →
   returns `round_start_date + (that count) * round_gap_days`.

Wherever the result is non-null, the newly-inserted `matches` rows (including bye rows, for
consistency — cosmetic only, byes never go through the scheduling form) get
`scheduled_at: <result>, is_full_day: true`.

## Admin UI — `components/admin/BracketActions.tsx`

Two new inputs added to **both** forms (Close registration & generate, Re-roll draw), alongside
the existing group-count picker:

- **Round start date** (`<input type="date" name="roundStartDate">`) — defaults to today (WAT)
  on first generation; defaults to the tournament's currently-stored `round_start_date` on
  re-roll. Can be cleared to opt out of auto-scheduling entirely.
- **Days between rounds** (`<input type="number" name="roundGapDays" min="1">`) — defaults to 1,
  or the stored value on re-roll.

`app/admin/tournaments/[id]/bracket/page.tsx` selects `round_start_date, round_gap_days` from
`tournaments` alongside its existing query and passes them to `BracketActions` as props.

`closeRegistration`/`generateBracket` (`bracket-admin-actions.ts`) parse these two fields from
`FormData` and persist them onto the `tournaments` row (in the same update that sets `status`)
**before** calling `generate()`, so `nextRoundScheduledAt` picks them up immediately and every
later automatic advancement (group→knockout, knockout round N→N+1) reuses them with no further
admin input ever required.

## Testing

Vitest on `lib/tournaments/round-schedule.ts`:
- `addRoundGapDays`: adding 0/1/N days lands on the correct UTC instant for a midnight-WAT input.
- `nextRoundScheduledAt` (with a stubbed/mocked admin client): `round_start_date` unset → `null`;
  no existing matches → returns `round_start_date` itself; existing matches spanning K distinct
  rounds → returns `round_start_date + K * round_gap_days`; a manually-edited outlier
  `scheduled_at` on an existing match does **not** change the result (proves the "distinct round
  count" approach is immune to the drift scenario that ruled out a `MAX(scheduled_at)` design).

Actions/pages are I/O-bound (Supabase + `revalidatePath`) — exercised via the build and manual
admin testing, consistent with how `bracket-admin-actions.ts`/`verify-actions.ts` are already
tested.

## Out of scope

- Per-match time-of-day scheduling remains manual (existing Timed/Full-day toggle on
  `MatchRow`) — this feature only auto-fills the full-day default per round.
- No change to `expire_full_day_matches()` cron or the review-queue bucketing (#24) — auto-filled
  rounds are ordinary full-day matches to that machinery.
- No backfill of `round_start_date`/`round_gap_days` on existing tournaments.
