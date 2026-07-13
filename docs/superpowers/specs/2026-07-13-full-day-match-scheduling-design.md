# Full-Day Match Scheduling (#24) — Design Spec

**Date:** 2026-07-13
**Status:** Approved design → ready for implementation plan
**Depends on:** #9 sub-project 4 (match management — `lib/matches/admin-actions.ts`, `matchEditSchema`), #9 sub-project 5 (result verification — `bucketReviewQueue`, `confirmResult`).

---

## 1. Goal

Admin can schedule a match to a calendar date instead of a precise kickoff time — playable anytime that day. If the day ends with no result submitted, the match auto-cancels and the existing admin walkover-override flow picks it up from there. Works alongside the existing time-based scheduling; admin chooses per-match.

## 2. Schema

**Migration `021_full_day_matches.sql`:**

```sql
ALTER TABLE public.matches
  ADD COLUMN is_full_day  boolean NOT NULL DEFAULT false,
  ADD COLUMN auto_expired boolean NOT NULL DEFAULT false;

-- Runs periodically (see §5) to cancel full-day matches whose day has
-- passed with no result. scheduled_at stores midnight WAT (see §3) for a
-- full-day match; adding 1 day to a UTC instant that represents midnight
-- WAT lands exactly on the following midnight WAT (Nigeria has no DST, so
-- this interval arithmetic is safe without an explicit AT TIME ZONE
-- conversion) — i.e. this fires the moment that calendar day, WAT, ends.
CREATE FUNCTION public.expire_full_day_matches() RETURNS void
LANGUAGE sql
AS $$
  UPDATE public.matches
  SET status = 'cancelled', auto_expired = true
  WHERE is_full_day = true
    AND status = 'scheduled'
    AND scheduled_at + interval '1 day' <= now();
$$;
```

`scheduled_at` continues to be the single "when is this match" field for both scheduling modes — a full-day match just stores midnight WAT of the chosen date there. `is_full_day` is the only thing distinguishing that from a genuine 00:00 kickoff. `auto_expired` marks specifically the matches the cron cancelled (as opposed to any other future reason a match might carry `status = 'cancelled'`) — this is what lets the admin queue find exactly the right rows again, without over-matching.

## 3. Admin scheduling form — server-side WAT conversion

`matchEditSchema` (`lib/matches/edit-schema.ts`) gains a `schedulingMode: 'timed' | 'full_day'` field. In `full_day` mode the form renders a plain `<input type="date">` instead of the existing `datetime-local` input; in `timed` mode nothing changes from today.

**WAT→UTC conversion happens server-side**, inside `updateMatch` (`lib/matches/admin-actions.ts`), mirroring the existing `fromDateTimeLocal` boundary pattern in `lib/format.ts` exactly — never client-side, so it's correct regardless of which timezone the admin's browser is in. A new helper is added alongside the existing ones:

```typescript
/**
 * "YYYY-MM-DD" (from an `<input type="date">`) → UTC ISO instant for
 * midnight WAT that date, for storage. Returns null for empty/invalid input.
 */
export function fromDateLocal(value: string | null | undefined): string | null {
  if (!value) return null
  const d = new Date(`${value}T00:00:00${WAT_OFFSET}`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
```

`updateMatch` picks `fromDateTimeLocal` or `fromDateLocal` based on `schedulingMode`, and sets `is_full_day` accordingly. Switching a match between modes on a later edit just re-derives both fields from whatever the form currently submits — no backfill/migration needed for existing rows (all default to `is_full_day = false`, i.e. today's exact behavior, unchanged).

## 4. Review queue — no date math, timing enforced by when the cron fires

The existing `noSubmission` bucket in `bucketReviewQueue` (`lib/matches/review-queue.ts`) fires on `status === 'scheduled' && submissionCount === 0 && scheduledAt <= now`. Naively reusing this for full-day matches would flag them the instant the day *starts* (since `scheduled_at` is midnight), not when it *ends* — wrong.

Instead: `is_full_day` matches are **excluded** from that condition entirely (they stay invisible to the admin queue all day — correct, since they're still playable), and a second, independent condition is added: `status === 'cancelled' && auto_expired === true`. Since `expire_full_day_matches()` is the only writer of `auto_expired = true`, and it only ever runs once the day has genuinely passed, the "has the day ended" timing constraint lives entirely in *when the cron fires* — `bucketReviewQueue` itself needs zero date arithmetic, zero timezone awareness, and zero new bucket. An auto-expired match lands in the same `noSubmission` bucket, behind the same existing "No submission — enter the official score below (e.g. a walkover)" UI.

`app/admin/results/page.tsx`'s query widens from `.in('status', ['scheduled', 'live', 'disputed'])` to also include `'cancelled'` rows, filtered in the row-mapping step to only those with `auto_expired === true` (defensive — in case `cancelled` is ever used for an unrelated reason in the future, that shouldn't spam this queue).

## 5. Admin override — already exists, nothing new to build

`confirmResult` (`lib/matches/verify-actions.ts`) never checks a match's current status before updating it — it fetches by ID and unconditionally writes `score_a`/`score_b`/`status = 'completed'`, then runs the normal group-recompute / knockout-advancement logic. So once an auto-expired match surfaces in the queue via §4, admin enters a score through the **exact same form** already used for any other walkover today. No new code path for "admin decides the winner."

## 6. Cron activation — out-of-band, same pattern as #12

`cron.schedule(...)` calls live outside this repo (Supabase dashboard / `execute_sql`, not a migration — the same constraint that applies to the existing fixture-reminder job). This is a plain SQL function with no external API call (unlike fixture-reminders, which calls Termii's WhatsApp API and therefore needs an app route + secret) — so activation is a single one-time statement, run manually against the live project after the migration lands:

```sql
select cron.schedule(
  'expire-full-day-matches',
  '0 * * * *',  -- hourly
  $$ select public.expire_full_day_matches(); $$
);
```

Hourly rather than a single once-daily firing, as a robustness margin — a missed or delayed run isn't a silent multi-day gap.

## 7. Out of scope

- Player-facing notification when a match auto-expires (no `notify()` call added — not requested, and would need a new notification type/template).
- Any change to `toggleMatchLive` (scheduled↔live) — unaffected, works identically for full-day matches.
- Backfilling `is_full_day`/`auto_expired` on existing matches — both new columns default to `false`, so every existing match keeps today's exact behavior.
