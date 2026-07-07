# Player Dashboard — Design (v1.0 #8)

**Route:** `/dashboard`
**Date:** 2026-07-07
**Status:** Approved, ready for implementation plan

## Purpose

Replace the placeholder at `app/dashboard/page.tsx` with the real player dashboard. It is a
middleware-guarded, mobile-first **aggregation page**: it reads the signed-in player's data
and surfaces *actions*, reusing existing flows rather than duplicating them —

- **Result submission** already lives on the Match Centre page (`/matches/[id]`,
  `ResultSubmissionForm` + `submitMatchResult`, with Storage upload + RLS). The dashboard
  links players *into* those pages; it does not re-implement the form.
- **Registration + Paystack payment** already live on the tournament pages
  (`RegistrationPanel`). The dashboard shows registration status and links back.

Server Component throughout; the withdrawal request form is the only `"use client"` island.

## Scope

**In:** identity header, my fixtures, my tournaments, withdrawal requests.
**Out:** Sentinel Score / tier display and profile editing (v2.0 #10); KYC and automated
payouts via Paystack Transfer (v3.0 #14); the admin-side withdrawal queue (#9).

## Sections

### 1. Header — light identity

Initial-circle avatar (name's first letter, matching `LeaderboardTable`/home), display name
or username, and a **W – L – goals_scored** line, all from `profiles`. Zero new data.
Deliberately **no** Sentinel Score, tier badge, or profile editing — that is v1.0-excluded
scope. `goals_scored` (a personal achievement stat), never goal difference (a ranking
instrument).

### 2. My fixtures

Matches where the player is `player_a` or `player_b`, across all tournaments, bucketed
**Live / Upcoming / Completed**. Each card shows opponent name, tournament title, scheduled
time, and status, and links to the Match Centre `/matches/[id]`.

Fixtures **awaiting my result** get a highlighted "Submit result →" affordance (the affordance
is a link to the match page, where the existing form lives). The flag is player-initiated
with a time gate — no admin bottleneck, but it only appears once the match has actually
happened or is live:

```
status NOT IN ('completed', 'verified', 'cancelled', 'disputed')
AND (scheduled_at <= now() OR status = 'live')
AND no match_results row exists for this player
```

(`verified` is a `match_results` status, not a `matches` status; it is kept in the exclusion
set defensively. For `matches`, the surviving statuses are effectively `scheduled` and `live`.
A `scheduled` match with a null `scheduled_at` is not flagged unless `status = 'live'`, since
the `scheduled_at <= now()` comparison is false for null.)

Bucketing: **Live** = `status = 'live'`; **Upcoming** = `status = 'scheduled'` (sorted by
`scheduled_at` ascending, nulls last); **Completed** = everything else
(`completed`/`disputed`/`cancelled`, sorted by `scheduled_at` descending, nulls last).

### 3. My tournaments

The player's registrations with payment status (`paid` / `pending` / `refunded`), each linking
to its tournament page. Pending-payment registrations get a "Complete registration" nudge back
to the tournament page.

This section is **not** redundant with fixtures: a player who registered and paid but has not
yet been assigned matches (pre-bracket-generation) is invisible in fixtures. My tournaments is
the only surface where such a player sees their registration and — critically — a **pending
payment they still need to complete**.

### 4. Withdrawals

A request form (amount + bank name + account number + account name) and a list of the player's
past requests with status and timestamps.

There is **no wallet/balance ledger** in the schema (winnings are not tracked per player). So
the form captures a *claimed* amount plus bank details; the admin adjudicates it against real
results in #9. The UI shows **no "available balance"** — that would be fabricated. No KYC in
v1 (v3.0); bank details are entered directly.

## New backend

### Migration `005_withdrawal_requests.sql`

```sql
CREATE TABLE public.withdrawal_requests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount         integer NOT NULL CHECK (amount > 0),
  bank_name      text NOT NULL,
  account_number text NOT NULL,
  account_name   text NOT NULL,
  status         text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'paid', 'rejected')),
  admin_note     text,
  requested_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at    timestamptz
);
CREATE INDEX ON public.withdrawal_requests (player_id);
CREATE INDEX ON public.withdrawal_requests (status);

ALTER TABLE public.withdrawal_requests ENABLE ROW LEVEL SECURITY;

-- A player may file a request only for themselves, and only as pending.
CREATE POLICY "wr_own_insert" ON public.withdrawal_requests
  FOR INSERT WITH CHECK (player_id = auth.uid() AND status = 'pending');

-- A player sees their own requests; admins see all.
CREATE POLICY "wr_own_or_admin_read" ON public.withdrawal_requests
  FOR SELECT USING (player_id = auth.uid() OR public.is_admin());

-- Only admins resolve requests (financial action — moderators excluded).
CREATE POLICY "wr_admin_update" ON public.withdrawal_requests
  FOR UPDATE USING (public.is_admin());
```

Money is a plain naira `integer`, consistent with `tournaments.prize_pool` /
`registration_fee`. `amount > 0` is the only numeric guard; the admin adjudicates the value.
`is_admin()` is the existing SECURITY DEFINER helper from migration 001. No DELETE policy.

After applying the migration (via Supabase MCP, project `itxubrkbropttfdackmi`), regenerate
`lib/supabase/types.ts`.

### `requestWithdrawal` Server Action

- **`lib/withdrawals/schema.ts`** — zod schema, unit-tested:
  - `amount`: coerced integer, `> 0`, `<= 100_000_000` (a sanity ceiling, not a balance check).
  - `bankName`: non-empty (trimmed), max 100.
  - `accountName`: non-empty (trimmed), max 100.
  - `accountNumber`: exactly 10 digits (NUBAN) — regex `^\d{10}$`.
- **`lib/withdrawals/actions.ts`** — `requestWithdrawal(prev, formData)` server action mirroring
  the `lib/auth/actions.ts` pattern: validate with the schema, get the user, insert a `pending`
  row (`player_id = user.id`), `revalidatePath('/dashboard')`, and return a
  `{ success: true } | { error: string }` state. Never trusts client-supplied `player_id` or
  `status`.

## Pure, unit-tested helpers

**`lib/dashboard/fixtures.ts`** — no Supabase imports; takes plain inputs, returns buckets.

```ts
export interface DashboardMatchInput {
  id: string
  status: string
  scheduledAt: string | null
  round: string
  opponentName: string
  tournamentTitle: string
  tournamentSlug: string
}
export interface DashboardFixture extends DashboardMatchInput {
  awaitingMyResult: boolean
}
export function bucketFixtures(
  matches: DashboardMatchInput[],
  submittedMatchIds: Set<string>,
  now: Date,
): { live: DashboardFixture[]; upcoming: DashboardFixture[]; completed: DashboardFixture[] }
```

`now` is injected (not read from `Date.now()` inside) so the time gate is deterministically
testable. `awaitingMyResult` implements the heuristic above.

## Components (`components/dashboard/`)

- `DashboardHeader.tsx` — avatar + name + W–L–goals line.
- `FixtureCard.tsx` — one fixture row (opponent, tournament, time, status, optional
  "Submit result →"), plus a small list/section wrapper for the three buckets.
- `MyTournaments.tsx` — registration rows with payment status + nudges.
- `WithdrawalPanel.tsx` — `"use client"`: the request form (`useFormState` over
  `requestWithdrawal`) and the list of past requests with status + timestamps.
- Reuse `components/shared/EmptyState.tsx` and the initial-circle avatar convention.

## Page

`app/dashboard/page.tsx` (replaces the placeholder) — Server Component. Fetch the user, then
run five parallel RLS-scoped queries:

1. `profiles` (header stats) — the signed-in player's row.
2. `matches` where `player_a_id = me OR player_b_id = me`, joining **both** player profiles
   (username/display_name) via the `matches_player_a_id_fkey` / `matches_player_b_id_fkey`
   FK hints and the tournament (`title`, `slug`), mirroring the bracket page's embed pattern.
   The opponent is whichever player is not the signed-in user, derived in the page mapping.
3. `match_results` where `submitted_by = me` → build the `submittedMatchIds` set.
4. `tournament_registrations` where `player_id = me`, joining tournament
   (`title`, `slug`, `status`).
5. `withdrawal_requests` where `player_id = me` (RLS already scopes it), newest first.

Map rows into `bucketFixtures(...)` and the section components; render with real empty states.

## Security

- Middleware already guards `/dashboard` (redirect to `/login?next=/dashboard`). The page also
  redirects if `getUser()` returns no user.
- Every query is RLS-scoped to `auth.uid()`; the explicit `player_id = me` / `submitted_by = me`
  filters are belt-and-suspenders on top of RLS.
- The withdrawal insert is validated server-side with zod; `player_id` and `status` are set from
  the server, never from the client. No money value is trusted as a balance — it is a claim.

## Testing

Vitest:
- `lib/dashboard/fixtures.ts` — bucketing (live/upcoming/completed placement + sort order) and
  the `awaitingMyResult` flag, including the three mandated cases: future scheduled match (no
  flag), past unplayed match (flag), already-submitted match (no flag); plus live match (flag)
  and null `scheduled_at` (no flag unless live).
- `lib/withdrawals/schema.ts` — valid input passes; rejects amount ≤ 0, non-integer amount,
  amount over the ceiling, empty bank/account name, and account numbers that are not exactly
  10 digits.

## Consistency notes

- Removes the stale `app/(auth)/dashboard/.gitkeep` placeholder (the real dashboard is
  `app/dashboard/`, outside the `(auth)` form-card group, so it gets the normal wide site
  layout).
- Mobile-first: single-column sections at 375px; the fixture and tournament lists stack.
- No per-page WhatsApp share button (a dashboard is private).
