# No-show Resolution & Player Substitution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admin resolve matches where one or both players go unreachable (walkover win, group 0-0 draw, or knockout double-forfeit), automatically via a daily deadline cron with a manual fallback, and let admin disqualify a chronically-inactive registered player and substitute them in without disturbing already-played history.

**Architecture:** Additive schema changes (a `forfeited` match status, a `resolution` audit tag, and a `status`/audit-trail axis on `tournament_registrations`, independent of `payment_status`). No-show resolution reuses the existing `confirmResult` post-processing pipeline (group recompute / knockout advance / Sentinel Score sync) by exporting and calling the same functions rather than duplicating them. Player substitution reassigns only not-yet-played `matches` rows and repoints the `group_memberships` row — it does not touch history, so already-completed matches and Sentinel Score events for the removed player stand as-is.

**Tech Stack:** Next.js 14 App Router (Server Actions), Supabase (Postgres + RLS), Vitest, `pg_cron`/`pg_net` for the deadline sweep (matching the existing `fixture-reminders` cron).

## Global Constraints

- Nigeria observes no DST — Africa/Lagos (WAT) is UTC+1 year-round. Use `lib/format.ts`'s `fromDateLocal`/WAT helpers for any date-boundary logic; do not hand-roll timezone math.
- Walkover score is always **3-0** in the declared winner's favor — not admin-entered.
- `no_show` Sentinel Score event = **−10**; `match_completed` = **+2**; `win_no_dispute` = **+1**. These deltas already exist in `lib/scoring/events.ts` — do not change their values.
- Moderators may adjudicate match results (matches `confirmResult`'s `requireStaff` tier); disqualification/substitution and refunds are **admin-only** (`requireAdmin`) per CLAUDE.md's "moderator: no player bans" rule.
- A substitute's registration is `payment_status='paid'`, `fee_waived=false` (the default — never set `true`) — they inherit an already-paid slot, this is not a comp.
- Refund on disqualification is never automatic — admin runs the existing `refundRegistration` separately if they choose to.
- No new abstraction layer for "shared post-processing" — export the existing private functions in `lib/matches/verify-actions.ts` and call them directly from the new no-show action module.

---

## Task 1: Migration — schema changes

**Files:**
- Create: `supabase/migrations/035_noshow_resolution_and_substitution.sql`

**Interfaces:**
- Produces: `matches.status` now allows `'forfeited'`; `matches.resolution` (nullable text, `'walkover'` | `'no_show_draw'`); `tournament_registrations.status` (`'active'` default, `'disqualified'`, `'withdrawn'`), `.replaces_registration_id` (nullable FK to `tournament_registrations.id`), `.disqualified_at` (nullable timestamptz), `.disqualification_note` (nullable text); `player_notifications.type` now allows `'player_disqualified'`.

- [ ] **Step 1: Write the migration**

```sql
-- 035_noshow_resolution_and_substitution.sql
-- No-show match resolution (walkover win, group double-no-show draw, knockout
-- double-forfeit) and admin disqualify/substitute for a chronically-inactive
-- registered player. See docs/superpowers/specs/2026-07-28-noshow-resolution-
-- and-player-substitution-design.md.

ALTER TABLE public.matches DROP CONSTRAINT matches_status_check;
ALTER TABLE public.matches
  ADD CONSTRAINT matches_status_check
  CHECK (status IN ('scheduled', 'live', 'completed', 'disputed', 'cancelled', 'bye', 'forfeited'));

-- Tags a 'completed' match as no-show-driven rather than normally played and
-- reviewed. NULL for every existing/normal row — no backfill needed.
ALTER TABLE public.matches
  ADD COLUMN resolution text CHECK (resolution IN ('walkover', 'no_show_draw'));

-- Independent of payment_status: a player can be paid AND disqualified.
-- replaces_registration_id is the audit trail linking a substitute back to
-- who they replaced.
ALTER TABLE public.tournament_registrations
  ADD COLUMN status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disqualified', 'withdrawn')),
  ADD COLUMN replaces_registration_id uuid REFERENCES public.tournament_registrations(id),
  ADD COLUMN disqualified_at timestamptz,
  ADD COLUMN disqualification_note text;

ALTER TABLE public.player_notifications DROP CONSTRAINT player_notifications_type_check;
ALTER TABLE public.player_notifications
  ADD CONSTRAINT player_notifications_type_check
  CHECK (type IN (
    'listing_approved', 'listing_removed',
    'withdrawal_paid', 'withdrawal_rejected',
    'referral_withdrawal_paid', 'referral_withdrawal_rejected',
    'result_confirmed', 'referral_credited',
    'friend_request', 'player_disqualified'
  ));
```

- [ ] **Step 2: Apply the migration to the local/linked Supabase project and regenerate types**

Run: `npx supabase gen types typescript --project-id <project-id> > lib/supabase/types.ts` (per `CLAUDE.md`'s Development Commands — requires `SUPABASE_URL`/`SUPABASE_ANON_KEY`, or apply via the Supabase MCP `apply_migration` tool if working against the linked project directly).
Expected: `lib/supabase/types.ts` picks up `matches.resolution`, `matches.status` enum, and the four new `tournament_registrations` columns.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/035_noshow_resolution_and_substitution.sql lib/supabase/types.ts
git commit -m "feat: schema for no-show resolution and player substitution"
```

---

## Task 2: Knockout advancement — forfeited rounds and leftover-to-bye pairing

**Files:**
- Modify: `lib/tournaments/advancement.ts`
- Test: `lib/tournaments/advancement.test.ts`

**Interfaces:**
- Produces: `pairWinners(byeWinnerIds: string[], matchWinnerIds: string[]): { pairs: [string, string][]; leftover: string | null }` (signature change — previously returned `[string, string][]` directly). `roundResolved` now also treats `status === 'forfeited'` as resolved.
- Consumes: nothing new.

- [ ] **Step 1: Write the failing tests**

Replace the `pairWinners` describe block and extend `roundResolved`'s in `lib/tournaments/advancement.test.ts`:

```ts
describe('roundResolved', () => {
  it('is true only when every match is completed, bye, or forfeited', () => {
    expect(roundResolved([mk({}), mk({ status: 'bye' })])).toBe(true)
    expect(roundResolved([mk({}), mk({ status: 'forfeited' })])).toBe(true)
    expect(roundResolved([mk({}), mk({ status: 'disputed' })])).toBe(false)
    expect(roundResolved([mk({}), mk({ status: 'scheduled' })])).toBe(false)
    expect(roundResolved([])).toBe(false)
  })
})

describe('pairWinners', () => {
  it('interleaves byes with match-winners then pairs (n=6 case)', () => {
    expect(pairWinners(['bye1', 'bye2'], ['w1', 'w2'])).toEqual({
      pairs: [
        ['bye1', 'w1'],
        ['bye2', 'w2'],
      ],
      leftover: null,
    })
  })
  it('handles one bye + three winners (n=7)', () => {
    expect(pairWinners(['bye1'], ['w1', 'w2', 'w3'])).toEqual({
      pairs: [
        ['bye1', 'w1'],
        ['w2', 'w3'],
      ],
      leftover: null,
    })
  })
  it('handles no byes (later rounds)', () => {
    expect(pairWinners([], ['w1', 'w2', 'w3', 'w4'])).toEqual({
      pairs: [
        ['w1', 'w2'],
        ['w3', 'w4'],
      ],
      leftover: null,
    })
  })
  it('returns a leftover when a forfeit makes the winner count odd', () => {
    expect(pairWinners([], ['w1', 'w2', 'w3'])).toEqual({
      pairs: [['w1', 'w2']],
      leftover: 'w3',
    })
  })
  it('returns no pairs and the sole leftover when only one winner remains', () => {
    expect(pairWinners([], ['w1'])).toEqual({ pairs: [], leftover: 'w1' })
  })
  it('returns no pairs and no leftover when nobody advances', () => {
    expect(pairWinners([], [])).toEqual({ pairs: [], leftover: null })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/tournaments/advancement.test.ts`
Expected: FAIL — `pairWinners` still returns a bare array, `roundResolved` doesn't accept `forfeited`.

- [ ] **Step 3: Implement**

In `lib/tournaments/advancement.ts`, replace `roundResolved` and `pairWinners`:

```ts
// True only when every match in the round is completed, bye, or forfeited
// (a knockout double-no-show — resolved, but produces no advancer).
export function roundResolved(matches: AdvanceMatch[]): boolean {
  return (
    matches.length > 0 &&
    matches.every((m) => m.status === 'completed' || m.status === 'bye' || m.status === 'forfeited')
  )
}

// Interleave byes with match-winners (so a bye meets a played-match winner), then pair.
// A forfeited match contributes no winner, which can leave one advancer unpaired —
// that player is returned as `leftover` so the caller can give them a bye instead
// of silently dropping them.
export function pairWinners(
  byeWinnerIds: string[],
  matchWinnerIds: string[],
): { pairs: [string, string][]; leftover: string | null } {
  const merged: string[] = []
  const maxLen = Math.max(byeWinnerIds.length, matchWinnerIds.length)
  for (let i = 0; i < maxLen; i++) {
    if (i < byeWinnerIds.length) merged.push(byeWinnerIds[i])
    if (i < matchWinnerIds.length) merged.push(matchWinnerIds[i])
  }
  const pairs: [string, string][] = []
  let i = 0
  for (; i + 1 < merged.length; i += 2) pairs.push([merged[i], merged[i + 1]])
  return { pairs, leftover: i < merged.length ? merged[i] : null }
}
```

`matchWinnerId` needs no change — for `status === 'forfeited'` it already falls through its `status !== 'completed'` check and returns `null`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/tournaments/advancement.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/tournaments/advancement.ts lib/tournaments/advancement.test.ts
git commit -m "feat: forfeited rounds resolve, and a lone advancer gets a bye instead of being dropped"
```

---

## Task 3: No-show deadline helper

**Files:**
- Create: `lib/matches/noshow.ts`
- Test: `lib/matches/noshow.test.ts`

**Interfaces:**
- Produces: `noShowDeadlinePassed(scheduledAtISO: string | null, now: Date): boolean` — true once the WAT calendar day `scheduledAtISO` falls on has fully elapsed (i.e. `now` is at or past the following midnight WAT).
- Consumes: `fromDateLocal` from `lib/format.ts` (`lib/format.ts:95-99`).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { noShowDeadlinePassed } from './noshow'

describe('noShowDeadlinePassed', () => {
  it('is false while still within the scheduled WAT day', () => {
    // 2026-07-10 15:00 WAT = 2026-07-10T14:00:00Z
    expect(noShowDeadlinePassed('2026-07-10T14:00:00Z', new Date('2026-07-10T20:00:00Z'))).toBe(false)
  })
  it('is false right before the WAT-day boundary (23:59:59 WAT)', () => {
    expect(noShowDeadlinePassed('2026-07-10T08:00:00Z', new Date('2026-07-10T22:59:59Z'))).toBe(false)
  })
  it('is true exactly at midnight WAT the next day', () => {
    // midnight WAT on 2026-07-11 = 2026-07-10T23:00:00Z
    expect(noShowDeadlinePassed('2026-07-10T08:00:00Z', new Date('2026-07-10T23:00:00Z'))).toBe(true)
  })
  it('is true well after the deadline', () => {
    expect(noShowDeadlinePassed('2026-07-10T08:00:00Z', new Date('2026-07-15T00:00:00Z'))).toBe(true)
  })
  it('is false for a missing scheduled time', () => {
    expect(noShowDeadlinePassed(null, new Date())).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/matches/noshow.test.ts`
Expected: FAIL with "Cannot find module './noshow'"

- [ ] **Step 3: Implement**

```ts
import { fromDateLocal } from '@/lib/format'

const TZ = 'Africa/Lagos'

// WAT calendar date ("YYYY-MM-DD") a UTC instant falls on.
function watDateOf(iso: string): string {
  return new Date(iso).toLocaleDateString('sv-SE', { timeZone: TZ })
}

// True once the WAT calendar day scheduledAtISO falls on has fully elapsed —
// i.e. `now` is at or past the following midnight WAT. This is the "once
// it's 12AM the next day" no-show resolution deadline.
export function noShowDeadlinePassed(scheduledAtISO: string | null, now: Date): boolean {
  if (!scheduledAtISO) return false
  const day = watDateOf(scheduledAtISO)
  const dayStartUtc = fromDateLocal(day)
  if (!dayStartUtc) return false
  const deadline = new Date(dayStartUtc).getTime() + 86_400_000 // next WAT midnight
  return now.getTime() >= deadline
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/matches/noshow.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/matches/noshow.ts lib/matches/noshow.test.ts
git commit -m "feat: pure helper for the no-show resolution deadline (WAT calendar day)"
```

---

## Task 4: Group standings — points-per-game tiebreak

**Files:**
- Modify: `lib/tournaments/standings.ts`
- Test: `lib/tournaments/standings.test.ts`

**Interfaces:**
- Produces: `sortStandings` unchanged signature; sort order now primarily keys on points-per-game-played rather than raw points.
- Consumes: nothing new.

- [ ] **Step 1: Write the failing test**

Add to `lib/tournaments/standings.test.ts`:

```ts
it('ranks by points-per-game when match counts differ (substitute played fewer)', () => {
  const rows = sortStandings([
    // 3 games, 2W 1D = 7 points -> 2.33 ppg
    m({ playerId: 'regular', name: 'Regular', wins: 2, draws: 1, losses: 0, points: 7, goalsFor: 5, goalsAgainst: 2 }),
    // substitute: 2 games, 2W = 6 points -> 3.0 ppg (fewer raw points, better ppg)
    m({ playerId: 'sub', name: 'Sub', wins: 2, draws: 0, losses: 0, points: 6, goalsFor: 4, goalsAgainst: 1 }),
  ])
  expect(rows.map((r) => r.playerId)).toEqual(['sub', 'regular'])
})

it('is unaffected when every player has played the same number of games (existing behavior)', () => {
  const rows = sortStandings([
    m({ playerId: 'a', name: 'A', wins: 1, draws: 0, losses: 0, points: 3, goalsFor: 2, goalsAgainst: 1 }),
    m({ playerId: 'b', name: 'B', wins: 0, draws: 1, losses: 0, points: 1, goalsFor: 1, goalsAgainst: 1 }),
  ])
  expect(rows.map((r) => r.playerId)).toEqual(['a', 'b'])
})
```

- [ ] **Step 2: Run tests to verify the new one fails**

Run: `npx vitest run lib/tournaments/standings.test.ts`
Expected: The new "points-per-game" test FAILs (currently ranks `regular` first on raw points); the others still pass.

- [ ] **Step 3: Implement**

In `lib/tournaments/standings.ts`, change the sort comparator:

```ts
// Order: points-per-game-played desc, then goal difference desc, then goals-for desc.
// Points-per-game equals raw points whenever `played` is equal across the group
// (the normal case, and every group once its round-robin finishes), so this only
// changes ordering when a substitute has played fewer matches than the rest —
// exactly the case it needs to handle fairly.
// advancingCount defaults to 2 (top-2 advance) but is a parameter so a future
// format (e.g. best third-place) needs no surgery.
export function sortStandings(
  memberships: MembershipInput[],
  advancingCount = 2,
): StandingRow[] {
  return memberships
    .map((s) => ({
      ...s,
      played: s.wins + s.draws + s.losses,
      goalDiff: s.goalsFor - s.goalsAgainst,
    }))
    .sort((a, b) => {
      const ppgA = a.played > 0 ? a.points / a.played : -Infinity
      const ppgB = b.played > 0 ? b.points / b.played : -Infinity
      return ppgB - ppgA || b.goalDiff - a.goalDiff || b.goalsFor - a.goalsFor
    })
    .map((s, i) => ({
      ...s,
      rank: i + 1,
      advancing: i < advancingCount,
    }))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/tournaments/standings.test.ts`
Expected: PASS (all tests, including the pre-existing "orders by points" one — its rows all share the same `played` count implicitly via default `wins/draws/losses: 0` plus the explicit ones given, so ppg ordering matches raw-points ordering there).

- [ ] **Step 5: Commit**

```bash
git add lib/tournaments/standings.ts lib/tournaments/standings.test.ts
git commit -m "feat: group standings use points-per-game to handle substitute-affected groups fairly"
```

---

## Task 5: Sentinel Score wiring — no-show events

**Files:**
- Modify: `lib/scoring/events.ts`
- Test: `lib/scoring/events.test.ts`

**Interfaces:**
- Produces: `AUTO_MATCH_EVENT_TYPES` now includes `'no_show'`. `matchEventsFor` takes a `MatchInput` with a new `resolution: string | null` field and branches: `resolution='walkover'` → winner gets `match_completed` only, loser gets `no_show` only; `resolution='no_show_draw'` → both get `no_show`; `status='forfeited'` → both get `no_show`; everything else unchanged.
- Consumes: nothing new.

- [ ] **Step 1: Write the failing tests**

Add to `lib/scoring/events.test.ts` (the `base` fixture needs `resolution: null` added):

```ts
const base = {
  id: 'm1',
  player_a_id: 'A',
  player_b_id: 'B',
  score_a: 3,
  score_b: 1,
  status: 'completed',
  resolution: null,
}
```

```ts
describe('matchEventsFor — no-show resolutions', () => {
  it('gives a walkover winner match_completed only, and the loser no_show only', () => {
    const events = matchEventsFor({ ...base, resolution: 'walkover', score_a: 3, score_b: 0 })
    expect(events).toEqual([
      { player_id: 'A', match_id: 'm1', event_type: 'match_completed', points_delta: 2, note: null },
      { player_id: 'B', match_id: 'm1', event_type: 'no_show', points_delta: -10, note: null },
    ])
  })

  it('gives both players no_show on a group no_show_draw', () => {
    const events = matchEventsFor({ ...base, resolution: 'no_show_draw', score_a: 0, score_b: 0 })
    expect(events).toEqual([
      { player_id: 'A', match_id: 'm1', event_type: 'no_show', points_delta: -10, note: null },
      { player_id: 'B', match_id: 'm1', event_type: 'no_show', points_delta: -10, note: null },
    ])
  })

  it('gives both players no_show on a knockout forfeit, with no score required', () => {
    const events = matchEventsFor({ ...base, status: 'forfeited', score_a: null, score_b: null })
    expect(events).toEqual([
      { player_id: 'A', match_id: 'm1', event_type: 'no_show', points_delta: -10, note: null },
      { player_id: 'B', match_id: 'm1', event_type: 'no_show', points_delta: -10, note: null },
    ])
  })

  it('returns nothing for a forfeit missing a player (defensive)', () => {
    expect(matchEventsFor({ ...base, status: 'forfeited', player_b_id: null })).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/scoring/events.test.ts`
Expected: FAIL — `resolution` isn't read yet, `status='forfeited'` currently short-circuits to `[]`.

- [ ] **Step 3: Implement**

In `lib/scoring/events.ts`:

```ts
// The only event types this engine generates automatically from a match result.
// Used as the delete/regenerate discriminator so authored events (ratings, flags,
// disputes) are never touched — even when they carry the same match_id.
export const AUTO_MATCH_EVENT_TYPES = ['match_completed', 'win_no_dispute', 'no_show'] as const
export type AutoMatchEventType = (typeof AUTO_MATCH_EVENT_TYPES)[number]

export const MATCH_COMPLETED_DELTA = 2
export const WIN_DELTA = 1
export const NO_SHOW_DELTA = -10

export interface NewMatchEvent {
  player_id: string
  match_id: string
  event_type: AutoMatchEventType
  points_delta: number
  note: null
}

interface MatchInput {
  id: string
  player_a_id: string | null
  player_b_id: string | null
  score_a: number | null
  score_b: number | null
  status: string
  resolution: string | null
}

export function matchEventsFor(match: MatchInput): NewMatchEvent[] {
  const { id, player_a_id, player_b_id, score_a, score_b, status, resolution } = match

  // Knockout double-forfeit: both players no-showed, no score, both penalized.
  if (status === 'forfeited') {
    if (!player_a_id || !player_b_id) return []
    return [noShowEvent(player_a_id, id), noShowEvent(player_b_id, id)]
  }

  if (status !== 'completed') return []
  // A completed match must have both players and both scores; a bye never does.
  if (!player_a_id || !player_b_id || score_a == null || score_b == null) return []

  // Single no-show, admin-declared winner: the loser was penalized, not credited.
  if (resolution === 'walkover') {
    if (score_a === score_b) return []
    const winnerId = score_a > score_b ? player_a_id : player_b_id
    const loserId = score_a > score_b ? player_b_id : player_a_id
    return [completedEvent(winnerId, id), noShowEvent(loserId, id)]
  }

  // Group double-no-show: recorded as a 0-0 draw for standings, but both
  // players are penalized for not showing up, not credited for completing.
  if (resolution === 'no_show_draw') {
    return [noShowEvent(player_a_id, id), noShowEvent(player_b_id, id)]
  }

  const events: NewMatchEvent[] = [completedEvent(player_a_id, id), completedEvent(player_b_id, id)]
  if (score_a !== score_b) {
    const winnerId = score_a > score_b ? player_a_id : player_b_id
    events.push({
      player_id: winnerId,
      match_id: id,
      event_type: 'win_no_dispute',
      points_delta: WIN_DELTA,
      note: null,
    })
  }
  return events
}

function completedEvent(playerId: string, matchId: string): NewMatchEvent {
  return { player_id: playerId, match_id: matchId, event_type: 'match_completed', points_delta: MATCH_COMPLETED_DELTA, note: null }
}

function noShowEvent(playerId: string, matchId: string): NewMatchEvent {
  return { player_id: playerId, match_id: matchId, event_type: 'no_show', points_delta: NO_SHOW_DELTA, note: null }
}
```

The pre-existing tests in this file need `resolution: null` on their `base` fixture (Step 1 above already updates it) — no other change needed since those paths are untouched.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/scoring/events.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/scoring/events.ts lib/scoring/events.test.ts
git commit -m "feat: Sentinel Score events for walkover/no-show-draw/forfeited matches"
```

---

## Task 6: Scoring pipeline — carry `resolution` and include forfeited matches

**Files:**
- Modify: `lib/scoring/apply.ts`

**Interfaces:**
- Produces: `MATCH_COLS` includes `resolution`; `regenerateMatchEvents`/`syncMatchEvents`/`recomputeAllScoring` now also process `status='forfeited'` matches.
- Consumes: `matchEventsFor` (Task 5's new `resolution`-aware signature).

- [ ] **Step 1: Update `MatchRow` and `MATCH_COLS`**

In `lib/scoring/apply.ts`:

```ts
interface MatchRow {
  id: string
  player_a_id: string | null
  player_b_id: string | null
  score_a: number | null
  score_b: number | null
  status: string
  resolution: string | null
}

const MATCH_COLS = 'id, player_a_id, player_b_id, score_a, score_b, status, resolution'
```

- [ ] **Step 2: Broaden `recomputeAllScoring`'s match query to include forfeited matches**

Change the query in `recomputeAllScoring`:

```ts
  const { data: matches } = await admin
    .from('matches')
    .select(MATCH_COLS)
    .in('status', ['completed', 'forfeited'])
```

(`syncMatchEvents` needs no change — it already fetches by `id` with no status filter, so it already picks up a `forfeited` match once `MATCH_COLS` includes `resolution`.)

`refreshPlayer`'s career-stats query (the `.eq('status', 'completed')` one, further down in the same file) stays exactly as-is — a forfeit isn't a real result and must not appear in win/loss record or aggregates, only in the Sentinel Score ledger.

- [ ] **Step 3: Run the existing scoring tests to confirm nothing broke**

Run: `npx vitest run lib/scoring/`
Expected: PASS (this task only widens queries and adds a passthrough column; no test file changes needed here since `apply.ts` has no direct unit tests — it's exercised indirectly via `events.test.ts` and manual verification in Task 8).

- [ ] **Step 4: Commit**

```bash
git add lib/scoring/apply.ts
git commit -m "feat: scoring pipeline carries match resolution and covers forfeited matches"
```

---

## Task 7: Export shared post-processing from `verify-actions.ts`, wire in leftover-bye handling

**Files:**
- Modify: `lib/matches/verify-actions.ts`

**Interfaces:**
- Produces: `recomputeGroupAndMaybeAdvance`, `advanceKnockout`, and `revalidateAll` become `export`ed (previously private) so `lib/matches/noshow-actions.ts` (Task 8) can reuse them without duplicating the group-recompute/knockout-advance/revalidate pipeline.
- Consumes: `pairWinners`'s new `{ pairs, leftover }` return shape (Task 2).

- [ ] **Step 1: Add `export` to the three functions**

In `lib/matches/verify-actions.ts`, change:
- `async function recomputeGroupAndMaybeAdvance(...)` → `export async function recomputeGroupAndMaybeAdvance(...)`
- `async function advanceKnockout(...)` → `export async function advanceKnockout(...)`
- `function revalidateAll(...)` → `export function revalidateAll(...)`

- [ ] **Step 2: Update `advanceKnockout` to consume `pairWinners`'s new shape and insert a bye for the leftover**

Replace this block inside `advanceKnockout`:

```ts
  const byeWinners = rm
    .filter((m) => m.status === 'bye')
    .map((m) => m.player_a_id)
    .filter(Boolean) as string[]
  const matchWinners = rm
    .filter((m) => m.status === 'completed')
    .map((m) => matchWinnerId(m))
    .filter(Boolean) as string[]
  const { pairs, leftover } = pairWinners(byeWinners, matchWinners)
  if (pairs.length === 0 && !leftover) return
  const roundDate = await nextRoundScheduledAt(admin, tournamentId)
  const schedule = roundDate ? { scheduled_at: roundDate, is_full_day: true } : {}
  const { data: inserted } = await admin
    .from('matches')
    .insert(
      [
        ...pairs.map(([a, b]) => ({
          tournament_id: tournamentId,
          round: nr,
          group_id: null,
          player_a_id: a,
          player_b_id: b,
          status: 'scheduled',
          ...schedule,
        })),
        ...(leftover
          ? [
              {
                tournament_id: tournamentId,
                round: nr,
                group_id: null,
                player_a_id: leftover,
                player_b_id: null,
                status: 'bye',
                ...schedule,
              },
            ]
          : []),
      ],
    )
    .select('id, player_a_id, player_b_id, scheduled_at, is_full_day')
```

The `notifyNewFixtures(...)` call right after stays unchanged — it already iterates whatever `inserted` contains, so the leftover's bye row (if any) is notified the same way any other new fixture is.

- [ ] **Step 3: Manually verify against the existing knockout tests**

Run: `npx vitest run lib/tournaments/advancement.test.ts lib/tournaments/draw.test.ts`
Expected: PASS — this task only rewires `advanceKnockout`'s internals to match Task 2's already-tested `pairWinners` contract; no new test file needed here (there is no `verify-actions.test.ts` in the repo — `confirmResult`/`disputeResult`/`advanceKnockout` are integration-only today, verified manually the same way. Task 8's manual verification steps exercise this new bye-insertion path end-to-end).

- [ ] **Step 4: Commit**

```bash
git add lib/matches/verify-actions.ts
git commit -m "refactor: export group/knockout post-processing for reuse by no-show resolution"
```

---

## Task 8: No-show resolution actions — `lib/matches/noshow-actions.ts`

**Files:**
- Create: `lib/matches/noshow-actions.ts`

**Interfaces:**
- Produces:
  - `resolvePendingNoShowMatches(admin: Admin, tournamentId?: string): Promise<{ drawn: number; forfeited: number }>` — the core sweep, callable from both the cron route (Task 9) and the manual admin trigger (Task 14).
  - `export type NoShowState = { error?: string; success?: boolean } | undefined`
  - `declareNoShowWinner(_prev: NoShowState, formData: FormData): Promise<NoShowState>` — `'use server'` admin/staff action for a single no-show (formData: `id`, `winnerId`, `reason`).
  - `export type ResolveState = { error?: string; success?: boolean; resolved?: number } | undefined`
  - `triggerResolvePendingMatches(_prev: ResolveState, formData: FormData): Promise<ResolveState>` — `'use server'` action wrapping `resolvePendingNoShowMatches` scoped to one tournament (formData: `tournamentId`).
- Consumes: `noShowDeadlinePassed` (Task 3), `recomputeGroupAndMaybeAdvance`/`advanceKnockout`/`revalidateAll` (Task 7, now exported), `syncMatchEvents` (`lib/scoring/apply.ts`), `nextRoundName` (`lib/tournaments/advancement.ts`), `notify`/`notifyInApp`/`resultKey` (existing notification pipeline), `requireStaff` (`lib/admin/auth.ts`).

- [ ] **Step 1: Implement the module**

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaff } from '@/lib/admin/auth'
import { noShowDeadlinePassed } from './noshow'
import { nextRoundName } from '@/lib/tournaments/advancement'
import { recomputeGroupAndMaybeAdvance, advanceKnockout, revalidateAll } from './verify-actions'
import { syncMatchEvents } from '@/lib/scoring/apply'
import { notify } from '@/lib/notifications/notify'
import { notifyInApp } from '@/lib/notifications/inbox'
import { resultKey } from '@/lib/notifications/keys'

type Admin = ReturnType<typeof createAdminClient>

interface PendingMatch {
  id: string
  tournament_id: string
  round: string
  group_id: string | null
  scheduled_at: string | null
}

// The deadline sweep: any scheduled/live match whose WAT day has fully
// elapsed gets auto-resolved — a group match becomes a 0-0 no_show_draw,
// a knockout match becomes 'forfeited' (both players eliminated, no
// advancer — see advanceKnockout's leftover-to-bye handling). Called by
// both the daily cron (Task 9) and the admin "Resolve pending matches"
// button (Task 14) — the system must never depend on the cron alone.
export async function resolvePendingNoShowMatches(
  admin: Admin,
  tournamentId?: string,
): Promise<{ drawn: number; forfeited: number }> {
  const now = new Date()
  let query = admin
    .from('matches')
    .select('id, tournament_id, round, group_id, scheduled_at')
    .in('status', ['scheduled', 'live'])
    .not('scheduled_at', 'is', null)
  if (tournamentId) query = query.eq('tournament_id', tournamentId)
  const { data } = await query

  let drawn = 0
  let forfeited = 0
  for (const m of (data ?? []) as PendingMatch[]) {
    if (!noShowDeadlinePassed(m.scheduled_at, now)) continue
    if (m.round === 'group') {
      await admin
        .from('matches')
        .update({
          status: 'completed',
          resolution: 'no_show_draw',
          score_a: 0,
          score_b: 0,
          completed_at: now.toISOString(),
          admin_note: 'Auto-resolved: no result submitted by the match deadline.',
        })
        .eq('id', m.id)
      if (m.group_id) await recomputeGroupAndMaybeAdvance(admin, m.tournament_id, m.group_id)
      await syncMatchEvents(admin, m.id)
      drawn += 1
    } else {
      await admin
        .from('matches')
        .update({
          status: 'forfeited',
          completed_at: now.toISOString(),
          admin_note: 'Auto-resolved: no result submitted by the match deadline — both players forfeit.',
        })
        .eq('id', m.id)
      await advanceKnockout(admin, m.tournament_id, m.round)
      await syncMatchEvents(admin, m.id)
      forfeited += 1
    }
  }
  return { drawn, forfeited }
}

export type NoShowState = { error?: string; success?: boolean } | undefined

// Admin declares a winner for a single no-show, after receiving WhatsApp proof
// of contact attempts out-of-band. Also the correction path for an already
// auto-resolved match — except a knockout 'forfeited' match whose next round
// has already been generated, which is locked (see design spec's scope
// boundaries: reconciling an orphaned bye is out of scope, admin resolves by
// hand).
export async function declareNoShowWinner(_prev: NoShowState, formData: FormData): Promise<NoShowState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  const winnerId = String(formData.get('winnerId') ?? '')
  const reason = String(formData.get('reason') ?? '').trim()
  if (!id || !winnerId) return { error: 'Missing match or winner.' }
  if (!reason) return { error: 'Enter a reason (e.g. WhatsApp proof of contact attempts).' }

  const admin = createAdminClient()
  const { data: m } = await admin
    .from('matches')
    .select('id, round, group_id, tournament_id, status, resolution, player_a_id, player_b_id, tournament:tournaments(slug)')
    .eq('id', id)
    .maybeSingle()
  if (!m) return { error: 'Match not found.' }
  if (!m.player_a_id || !m.player_b_id) return { error: 'This match has no opponent assigned yet.' }
  if (winnerId !== m.player_a_id && winnerId !== m.player_b_id) return { error: 'Winner must be one of the two players.' }

  const eligible =
    m.status === 'scheduled' ||
    m.status === 'live' ||
    m.status === 'forfeited' ||
    (m.status === 'completed' && (m.resolution === 'walkover' || m.resolution === 'no_show_draw'))
  if (!eligible) {
    return { error: 'This match already has a normally confirmed result and cannot be overridden here.' }
  }

  if (m.status === 'forfeited') {
    const nr = nextRoundName(m.round)
    if (nr) {
      const { count } = await admin
        .from('matches')
        .select('*', { count: 'exact', head: true })
        .eq('tournament_id', m.tournament_id)
        .eq('round', nr)
      if (count && count > 0) {
        return {
          error:
            'The next round has already been generated from this forfeit — it can no longer be overridden automatically. Cancel the incorrect bye match and re-run advancement by hand.',
        }
      }
    }
  }

  const scoreA = winnerId === m.player_a_id ? 3 : 0
  const scoreB = winnerId === m.player_b_id ? 3 : 0

  const { error: upErr } = await admin
    .from('matches')
    .update({
      status: 'completed',
      resolution: 'walkover',
      score_a: scoreA,
      score_b: scoreB,
      completed_at: new Date().toISOString(),
      admin_note: reason,
    })
    .eq('id', id)
  if (upErr) return { error: 'Could not save the result. Please try again.' }

  if (m.round === 'group' && m.group_id) {
    await recomputeGroupAndMaybeAdvance(admin, m.tournament_id, m.group_id)
  } else if (m.round !== 'group') {
    await advanceKnockout(admin, m.tournament_id, m.round)
  }
  await syncMatchEvents(admin, id)

  const t = Array.isArray(m.tournament) ? m.tournament[0] : m.tournament
  await notify({
    type: 'result_confirmed',
    playerId: winnerId,
    dedupeKey: resultKey(id, winnerId),
    playerA: winnerId === m.player_a_id ? 'You' : 'Opponent',
    playerB: winnerId === m.player_a_id ? 'Opponent' : 'You',
    scoreA,
    scoreB,
    tournament: '',
  })
  await notifyInApp({
    playerId: winnerId,
    type: 'result_confirmed',
    title: 'Result confirmed',
    body: `Your opponent didn't show — you're marked as the winner (3-0).`,
    link: `/matches/${id}`,
  })

  revalidateAll(m.tournament_id, t?.slug ?? '', id)
  return { success: true }
}

export type ResolveState = { error?: string; success?: boolean; resolved?: number } | undefined

// Manual fallback for the daily cron — "the system shouldn't fail" per the
// design spec. Scoped to one tournament via the admin matches page.
export async function triggerResolvePendingMatches(_prev: ResolveState, formData: FormData): Promise<ResolveState> {
  await requireStaff()
  const tournamentId = String(formData.get('tournamentId') ?? '')
  if (!tournamentId) return { error: 'Missing tournament.' }

  const admin = createAdminClient()
  const { drawn, forfeited } = await resolvePendingNoShowMatches(admin, tournamentId)

  revalidatePath(`/admin/tournaments/${tournamentId}/matches`)
  revalidatePath(`/admin/tournaments/${tournamentId}/bracket`)
  return { success: true, resolved: drawn + forfeited }
}
```

Note: the `notify({ type: 'result_confirmed', ... })` call above deliberately uses placeholder `playerA`/`playerB` labels ("You"/"Opponent") rather than fetching both players' display names — a walkover only needs to tell the *winner* their own result, unlike `confirmResult` which notifies both players by name. This keeps the action from re-fetching profile data it doesn't otherwise need. If this reads oddly in the rendered WhatsApp message during manual verification (Step 3), swap to fetching both names the same way `confirmResult` does (`lib/matches/verify-actions.ts:286-316`) before wiring the UI in Task 14.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: No new type errors.

- [ ] **Step 3: Manual verification**

Against a local/dev Supabase project with a test tournament:
1. Create a group match, leave it `scheduled` with `scheduled_at` in the past (WAT). Call `resolvePendingNoShowMatches` (e.g. via a scratch script or the Task 9 cron route once built) and confirm the match becomes `completed`/`resolution='no_show_draw'`/0-0, `group_memberships` recomputes, and two `no_show` events land in `sentinel_score_events`.
2. Create a knockout match the same way; confirm it becomes `status='forfeited'`, no score, two `no_show` events, and — if it was paired with another completed match in the same round — the round's other winner gets an auto-bye into the next round (a new `bye` row).
3. Call `declareNoShowWinner` on a still-`scheduled` match; confirm `resolution='walkover'`, 3-0 score, one `match_completed` + one `no_show` event.
4. Call `declareNoShowWinner` again on a `forfeited` match whose next round has already been generated (from step 2's scenario); confirm it returns the lock error and makes no changes.

- [ ] **Step 4: Commit**

```bash
git add lib/matches/noshow-actions.ts
git commit -m "feat: no-show resolution actions (deadline sweep, walkover declare, manual trigger)"
```

---

## Task 9: Deadline cron route

**Files:**
- Create: `app/api/cron/resolve-noshow-matches/route.ts`

**Interfaces:**
- Produces: `POST` handler, bearer-secret-guarded, calling `resolvePendingNoShowMatches(admin)` across all tournaments.
- Consumes: `resolvePendingNoShowMatches` (Task 8), `createAdminClient` (`lib/supabase/admin`).

- [ ] **Step 1: Implement**

```ts
import { createAdminClient } from '@/lib/supabase/admin'
import { resolvePendingNoShowMatches } from '@/lib/matches/noshow-actions'

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const admin = createAdminClient()
  const { drawn, forfeited } = await resolvePendingNoShowMatches(admin)

  return Response.json({ drawn, forfeited })
}
```

This mirrors `app/api/cron/fixture-reminders/route.ts:32-38`'s auth pattern exactly — same `CRON_SECRET` env var, same 401 shape.

- [ ] **Step 2: Manual verification**

With `CRON_SECRET` set locally, `curl -X POST http://localhost:3000/api/cron/resolve-noshow-matches -H "Authorization: Bearer $CRON_SECRET"` against a dev DB with a past-deadline match staged; confirm `{"drawn":N,"forfeited":N}` and the match resolved as in Task 8's manual verification. Confirm a request with a wrong/missing header gets 401.

- [ ] **Step 3: Commit**

```bash
git add "app/api/cron/resolve-noshow-matches/route.ts"
git commit -m "feat: daily cron endpoint for no-show deadline resolution"
```

---

## Task 10: Schedule the cron via `pg_cron` (out-of-band)

**Files:** none (SQL run once via the Supabase MCP `execute_sql` tool or `psql`, not committed as a migration — mirrors how `fixture-reminders` was scheduled, `docs/superpowers/specs/2026-07-10-whatsapp-notifications-design.md:101-113`).

- [ ] **Step 1: Run the scheduling SQL against the linked Supabase project**

Substitute the real `CRON_SECRET` and deployed site URL:

```sql
select cron.schedule(
  'resolve-noshow-matches',
  '5 23 * * *', -- 23:05 UTC = 00:05 WAT daily, no DST in Nigeria
  $$
    select net.http_post(
      url := 'https://sentinelxesports.vercel.app/api/cron/resolve-noshow-matches',
      headers := jsonb_build_object('Authorization', 'Bearer ' || '<CRON_SECRET>')
    );
  $$
);
```

- [ ] **Step 2: Verify the job registered**

Run: `select * from cron.job where jobname = 'resolve-noshow-matches';`
Expected: one row, `schedule = '5 23 * * *'`, `active = true`.

(No commit — this step is infrastructure configuration, not a code change.)

---

## Task 11: Notifications — disqualification template, dedupe key, in-app type

**Files:**
- Modify: `lib/notifications/templates.ts`
- Modify: `lib/notifications/keys.ts`
- Modify: `lib/notifications/inbox.ts`
- Modify: `lib/notifications/keys.test.ts`
- Modify: `lib/notifications/templates.test.ts`

**Interfaces:**
- Produces: `TemplateInput` gains `{ type: 'player_disqualified'; tournament: string; reason: string }`; `disqualifyKey(registrationId: string): string`; `NotificationType` gains `'player_disqualified'`.

- [ ] **Step 1: Write the failing tests**

Add to `lib/notifications/keys.test.ts`:

```ts
import { regKey, reminderKey, resultKey, prizeKey, disqualifyKey } from './keys'
// ...
it('formats each key type', () => {
  expect(regKey('r1')).toBe('reg:r1')
  expect(reminderKey('m1', 'p1')).toBe('reminder:m1:p1')
  expect(resultKey('m1', 'p1')).toBe('result:m1:p1')
  expect(prizeKey('w1')).toBe('prize:w1')
  expect(disqualifyKey('reg1')).toBe('disqualify:reg1')
})
```

Add to `lib/notifications/templates.test.ts` (find the existing per-type test block and add alongside it):

```ts
it('renders player_disqualified', () => {
  const { templateName, body } = renderTemplate({
    type: 'player_disqualified',
    tournament: 'Season 2 Cup',
    reason: 'Repeated no-shows across group stage matches.',
  })
  expect(templateName).toBe('player_disqualified')
  expect(body).toContain('Season 2 Cup')
  expect(body).toContain('Repeated no-shows')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/notifications/keys.test.ts lib/notifications/templates.test.ts`
Expected: FAIL — `disqualifyKey` doesn't exist, `'player_disqualified'` isn't a valid `TemplateInput`.

- [ ] **Step 3: Implement**

In `lib/notifications/keys.ts`, add:

```ts
export const disqualifyKey = (registrationId: string) => `disqualify:${registrationId}`
```

In `lib/notifications/templates.ts`, add to the `TemplateInput` union:

```ts
  | { type: 'player_disqualified'; tournament: string; reason: string }
```

and a case in `renderTemplate`:

```ts
    case 'player_disqualified':
      return {
        templateName: 'player_disqualified',
        body: `🚫 You've been removed from ${input.tournament} on Sentinel X. Reason: ${input.reason} If you think this is a mistake, reach out to support.`,
      }
```

In `lib/notifications/inbox.ts`, add `'player_disqualified'` to the `NotificationType` union.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/notifications/keys.test.ts lib/notifications/templates.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/notifications/templates.ts lib/notifications/keys.ts lib/notifications/inbox.ts lib/notifications/keys.test.ts lib/notifications/templates.test.ts
git commit -m "feat: disqualification notification template, dedupe key, and in-app type"
```

---

## Task 12: Disqualify/substitute validation schemas

**Files:**
- Create: `lib/tournaments/disqualify-schema.ts`
- Test: `lib/tournaments/disqualify-schema.test.ts`

**Interfaces:**
- Produces: `disqualifySchema = z.object({ reason: z.string()... })`, `type DisqualifyInput`; `substituteSchema = z.object({ username: z.string()... })`, `type SubstituteInput`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { disqualifySchema, substituteSchema } from './disqualify-schema'

describe('disqualifySchema', () => {
  it('requires a non-empty reason', () => {
    expect(disqualifySchema.safeParse({ reason: '' }).success).toBe(false)
    expect(disqualifySchema.safeParse({ reason: '  ' }).success).toBe(false)
  })
  it('accepts a real reason and trims it', () => {
    const parsed = disqualifySchema.safeParse({ reason: '  Repeated no-shows  ' })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.reason).toBe('Repeated no-shows')
  })
  it('rejects an overly long reason', () => {
    expect(disqualifySchema.safeParse({ reason: 'x'.repeat(301) }).success).toBe(false)
  })
})

describe('substituteSchema', () => {
  it('requires a non-empty username', () => {
    expect(substituteSchema.safeParse({ username: '' }).success).toBe(false)
  })
  it('accepts and trims a username', () => {
    const parsed = substituteSchema.safeParse({ username: '  NewPlayer  ' })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.username).toBe('NewPlayer')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/tournaments/disqualify-schema.test.ts`
Expected: FAIL with "Cannot find module './disqualify-schema'"

- [ ] **Step 3: Implement**

```ts
import { z } from 'zod'

export const disqualifySchema = z.object({
  reason: z.string().trim().min(1, 'Enter a reason for the disqualification').max(300, 'Reason is too long'),
})
export type DisqualifyInput = z.infer<typeof disqualifySchema>

export const substituteSchema = z.object({
  username: z.string().trim().min(1, 'Enter a username'),
})
export type SubstituteInput = z.infer<typeof substituteSchema>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/tournaments/disqualify-schema.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/tournaments/disqualify-schema.ts lib/tournaments/disqualify-schema.test.ts
git commit -m "feat: validation schemas for disqualify/substitute admin actions"
```

---

## Task 13: Disqualify & substitute admin actions

**Files:**
- Create: `lib/tournaments/registrations-admin-actions.ts`

**Interfaces:**
- Produces: `export type DisqualifyState = { error?: string; success?: boolean } | undefined`; `disqualifyRegistration(_prev: DisqualifyState, formData: FormData): Promise<DisqualifyState>` (formData: `registrationId`, `tournamentId`, `playerId`, `tournamentTitle`, `reason`); `addSubstitute(_prev: DisqualifyState, formData: FormData): Promise<DisqualifyState>` (formData: `tournamentId`, `disqualifiedRegistrationId`, `username`).
- Consumes: `disqualifySchema`/`substituteSchema` (Task 12), `requireAdmin` (`lib/admin/auth.ts`), `notify`/`notifyInApp`/`disqualifyKey` (Task 11).

- [ ] **Step 1: Implement**

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/admin/auth'
import { disqualifySchema, substituteSchema } from './disqualify-schema'
import { notify } from '@/lib/notifications/notify'
import { notifyInApp } from '@/lib/notifications/inbox'
import { disqualifyKey } from '@/lib/notifications/keys'

export type DisqualifyState = { error?: string; success?: boolean } | undefined

// Admin-only (CLAUDE.md: moderators cannot ban players). Independent of
// payment_status — refund, if any, is a separate manual refundRegistration
// call, never automatic.
export async function disqualifyRegistration(_prev: DisqualifyState, formData: FormData): Promise<DisqualifyState> {
  await requireAdmin()
  const registrationId = String(formData.get('registrationId') ?? '')
  const tournamentId = String(formData.get('tournamentId') ?? '')
  const playerId = String(formData.get('playerId') ?? '')
  const tournamentTitle = String(formData.get('tournamentTitle') ?? 'the tournament')
  if (!registrationId || !tournamentId || !playerId) return { error: 'Missing registration.' }

  const parsed = disqualifySchema.safeParse({ reason: formData.get('reason') ?? '' })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const admin = createAdminClient()

  // Atomic conditional update — only an active registration can be disqualified.
  const { data: claimed } = await admin
    .from('tournament_registrations')
    .update({
      status: 'disqualified',
      disqualified_at: new Date().toISOString(),
      disqualification_note: parsed.data.reason,
    })
    .eq('id', registrationId)
    .eq('status', 'active')
    .select('id')
  if (!claimed || claimed.length === 0) {
    return { error: 'This registration is not active (already disqualified or withdrawn).' }
  }

  await admin.from('sentinel_score_events').insert({
    player_id: playerId,
    match_id: null,
    event_type: 'admin_flag_conduct',
    points_delta: -5,
    note: `Disqualified from ${tournamentTitle}: ${parsed.data.reason}`,
  })

  await notify({
    type: 'player_disqualified',
    playerId,
    dedupeKey: disqualifyKey(registrationId),
    tournament: tournamentTitle,
    reason: parsed.data.reason,
  })
  await notifyInApp({
    playerId,
    type: 'player_disqualified',
    title: 'Removed from tournament',
    body: `You've been removed from ${tournamentTitle}. Reason: ${parsed.data.reason}`,
  })

  revalidatePath(`/admin/tournaments/${tournamentId}/registrations`)
  return { success: true }
}

// Reassigns only not-yet-played matches and the group_memberships row — see
// design spec section C. Already-completed matches keep the removed player's
// id untouched; the substitute's standings are derived purely from matches
// they actually play going forward (recomputeGroupAndMaybeAdvance already
// does this once matches are repointed — no manual stat reset needed).
export async function addSubstitute(_prev: DisqualifyState, formData: FormData): Promise<DisqualifyState> {
  await requireAdmin()
  const tournamentId = String(formData.get('tournamentId') ?? '')
  const disqualifiedRegistrationId = String(formData.get('disqualifiedRegistrationId') ?? '')
  if (!tournamentId || !disqualifiedRegistrationId) return { error: 'Missing tournament or disqualified registration.' }

  const parsed = substituteSchema.safeParse({ username: formData.get('username') ?? '' })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const admin = createAdminClient()

  const { data: removedReg } = await admin
    .from('tournament_registrations')
    .select('id, player_id, status')
    .eq('id', disqualifiedRegistrationId)
    .maybeSingle()
  if (!removedReg) return { error: 'Disqualified registration not found.' }
  if (removedReg.status !== 'disqualified') return { error: 'This registration has not been disqualified.' }

  const { data: sub } = await admin
    .from('profiles')
    .select('id')
    .ilike('username', parsed.data.username)
    .maybeSingle()
  if (!sub) return { error: `No player found with username "${parsed.data.username}".` }
  if (sub.id === removedReg.player_id) return { error: 'The substitute cannot be the removed player.' }

  const { error: insErr } = await admin.from('tournament_registrations').insert({
    tournament_id: tournamentId,
    player_id: sub.id,
    payment_status: 'paid',
    fee_waived: false,
    status: 'active',
    replaces_registration_id: removedReg.id,
  })
  if (insErr) {
    if ((insErr as { code?: string }).code === '23505') {
      return { error: 'This player is already registered for this tournament.' }
    }
    return { error: 'Could not register the substitute. Please try again.' }
  }

  // Reassign not-yet-played matches to the substitute.
  const { data: pending } = await admin
    .from('matches')
    .select('id, player_a_id, player_b_id')
    .eq('tournament_id', tournamentId)
    .in('status', ['scheduled', 'live'])
    .or(`player_a_id.eq.${removedReg.player_id},player_b_id.eq.${removedReg.player_id}`)
  for (const m of pending ?? []) {
    const patch =
      m.player_a_id === removedReg.player_id ? { player_a_id: sub.id } : { player_b_id: sub.id }
    await admin.from('matches').update(patch).eq('id', m.id)
  }

  // Repoint the group_memberships row, if any — stats then derive purely
  // from matches the substitute actually plays via the existing recompute.
  const { data: tournamentGroups } = await admin.from('groups').select('id').eq('tournament_id', tournamentId)
  const groupIds = (tournamentGroups ?? []).map((g) => g.id)
  if (groupIds.length > 0) {
    await admin
      .from('group_memberships')
      .update({ player_id: sub.id })
      .eq('player_id', removedReg.player_id)
      .in('group_id', groupIds)
  }

  revalidatePath(`/admin/tournaments/${tournamentId}/registrations`)
  revalidatePath(`/admin/tournaments/${tournamentId}/matches`)
  revalidatePath(`/admin/tournaments/${tournamentId}/bracket`)
  return { success: true }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: No new type errors.

- [ ] **Step 3: Manual verification**

Against a dev Supabase project with a test group-stage tournament:
1. Disqualify an active registration; confirm `status='disqualified'`, `disqualified_at` set, an `admin_flag_conduct` (-5) event lands in `sentinel_score_events`, and a `player_disqualified` row appears in `notifications`/`player_notifications`.
2. Add a substitute by username; confirm a new `tournament_registrations` row (`payment_status='paid'`, `fee_waived=false`, `replaces_registration_id` set), the removed player's still-`scheduled` matches now show the substitute's id, their already-`completed` matches are untouched, and their `group_memberships` row now belongs to the substitute with points still reflecting only matches the substitute has actually played once the group recomputes on the next confirmed result.
3. Attempt `addSubstitute` with a registration that isn't `disqualified` (e.g. still `active`); confirm it's rejected.

- [ ] **Step 4: Commit**

```bash
git add lib/tournaments/registrations-admin-actions.ts
git commit -m "feat: admin disqualify and substitute actions with match/group reassignment"
```

---

## Task 14: Admin UI — "Declare no-show winner" on the match review page

**Files:**
- Create: `components/admin/DeclareNoShowWinnerForm.tsx`
- Modify: `app/admin/matches/[id]/review/page.tsx`

**Interfaces:**
- Produces: `DeclareNoShowWinnerForm({ matchId, playerAId, playerAName, playerBId, playerBName }: {...})` client component.
- Consumes: `declareNoShowWinner`, `type NoShowState` (Task 8).

- [ ] **Step 1: Implement the component**

```tsx
'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { declareNoShowWinner, type NoShowState } from '@/lib/matches/noshow-actions'

export function DeclareNoShowWinnerForm({
  matchId,
  playerAId,
  playerAName,
  playerBId,
  playerBName,
}: {
  matchId: string
  playerAId: string
  playerAName: string
  playerBId: string
  playerBName: string
}) {
  const [state, action] = useFormState<NoShowState, FormData>(declareNoShowWinner, undefined)
  const [winnerId, setWinnerId] = useState(playerAId)

  if (state?.success) {
    return (
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-center text-sm font-semibold text-emerald-400">
        ✓ No-show winner declared (3-0).
      </div>
    )
  }

  return (
    <form action={action} className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <input type="hidden" name="id" value={matchId} />
      <h3 className="text-sm font-bold text-white">Declare no-show winner</h3>
      <p className="text-xs text-slate-500">
        Use once you have WhatsApp proof the winner tried to reach their opponent and the opponent never responded.
        Records a 3-0 walkover.
      </p>
      <div className="space-y-1.5 text-sm">
        <label className="flex items-center gap-2 text-slate-300">
          <input
            type="radio"
            name="winnerId"
            value={playerAId}
            checked={winnerId === playerAId}
            onChange={() => setWinnerId(playerAId)}
          />
          {playerAName} showed up
        </label>
        <label className="flex items-center gap-2 text-slate-300">
          <input
            type="radio"
            name="winnerId"
            value={playerBId}
            checked={winnerId === playerBId}
            onChange={() => setWinnerId(playerBId)}
          />
          {playerBName} showed up
        </label>
      </div>
      <textarea
        name="reason"
        rows={2}
        required
        placeholder="Reason (required) — e.g. WhatsApp proof of contact attempts, opponent unresponsive all day"
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
      />
      {state?.error && <p className="text-xs text-red-400">{state.error}</p>}
      <button
        type="submit"
        className="rounded-lg border border-violet-500/40 px-4 py-2 text-xs font-bold text-violet-400 hover:bg-violet-500/10"
      >
        Declare winner
      </button>
    </form>
  )
}
```

- [ ] **Step 2: Wire it into the review page**

In `app/admin/matches/[id]/review/page.tsx`, add `status` and `resolution` to the `matches` select and the `m` cast (alongside the existing `admin_note`):

```ts
    .select(
      'id, status, resolution, admin_note, ' +
        'player_a:profiles!matches_player_a_id_fkey(id, username, display_name), ' +
        'player_b:profiles!matches_player_b_id_fkey(id, username, display_name)',
    )
```

(`player_a`/`player_b` need `id` added to their selected columns too, since the form needs both player ids — update the `ProfileRef` type and `m` cast accordingly: `type ProfileRef = { id: string; username: string | null; display_name: string | null } | null`, and thread `m.player_a?.id`/`m.player_b?.id` through.)

Render the new form only when the match isn't already normally-resolved, right after `<ResultReviewForms ... />`:

```tsx
      <ResultReviewForms matchId={m.id} playerAName={playerA} playerBName={playerB} prefill={prefill} />

      {!(m.status === 'completed' && m.resolution === null) && (
        <div className="mt-4">
          <DeclareNoShowWinnerForm
            matchId={m.id}
            playerAId={m.player_a?.id ?? ''}
            playerAName={playerA}
            playerBId={m.player_b?.id ?? ''}
            playerBName={playerB}
          />
        </div>
      )}
```

Add the import: `import { DeclareNoShowWinnerForm } from '@/components/admin/DeclareNoShowWinnerForm'`.

- [ ] **Step 3: Manual verification**

Run `npm run dev`, open `/admin/matches/[id]/review` for a `scheduled` match with no submissions, submit "Declare no-show winner" with a reason, confirm the success state renders and the match's status/score updates in the DB (per Task 8's contract). Confirm the form is hidden for a match already `completed` with `resolution=null`.

- [ ] **Step 4: Commit**

```bash
git add components/admin/DeclareNoShowWinnerForm.tsx "app/admin/matches/[id]/review/page.tsx"
git commit -m "feat: admin UI to declare a no-show winner from the match review page"
```

---

## Task 15: Admin UI — "Resolve pending matches" button

**Files:**
- Create: `components/admin/ResolvePendingMatchesButton.tsx`
- Modify: `app/admin/tournaments/[id]/matches/page.tsx`

**Interfaces:**
- Produces: `ResolvePendingMatchesButton({ tournamentId }: { tournamentId: string })` client component.
- Consumes: `triggerResolvePendingMatches`, `type ResolveState` (Task 8).

- [ ] **Step 1: Implement the component**

```tsx
'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { triggerResolvePendingMatches, type ResolveState } from '@/lib/matches/noshow-actions'

export function ResolvePendingMatchesButton({ tournamentId }: { tournamentId: string }) {
  const [state, action] = useFormState<ResolveState, FormData>(triggerResolvePendingMatches, undefined)
  const [confirming, setConfirming] = useState(false)

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-300 hover:border-slate-500"
      >
        Resolve pending matches
      </button>
    )
  }
  return (
    <form action={action} className="flex flex-col items-start gap-1.5">
      <input type="hidden" name="tournamentId" value={tournamentId} />
      <p className="text-xs text-amber-400">
        Auto-resolves any match past its deadline with no submitted result (group → 0-0 draw, knockout → forfeit). Continue?
      </p>
      <div className="flex gap-1.5">
        <button
          type="submit"
          className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-500"
        >
          Confirm
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-300 hover:border-slate-500"
        >
          Cancel
        </button>
      </div>
      {state?.success && <span className="text-xs text-emerald-400">Resolved {state.resolved} match(es).</span>}
      {state?.error && <span className="text-xs text-red-400">{state.error}</span>}
    </form>
  )
}
```

- [ ] **Step 2: Wire it into the tournament matches page**

In `app/admin/tournaments/[id]/matches/page.tsx`, import `ResolvePendingMatchesButton` and render it next to the page heading:

```tsx
      <div className="mb-4 mt-2 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-bold text-white">{t.title} · Matches</h2>
        <ResolvePendingMatchesButton tournamentId={t.id} />
      </div>
```

(replacing the existing standalone `<h2>` line).

- [ ] **Step 3: Manual verification**

Open `/admin/tournaments/[id]/matches` with a past-deadline pending match staged, click "Resolve pending matches" → "Confirm", confirm the success count renders and the page's match list updates (via `revalidatePath`) to show the newly-resolved status.

- [ ] **Step 4: Commit**

```bash
git add components/admin/ResolvePendingMatchesButton.tsx "app/admin/tournaments/[id]/matches/page.tsx"
git commit -m "feat: tournament-scoped manual trigger for pending no-show resolution"
```

---

## Task 16: Admin UI — disqualify & substitute on the registrations page

**Files:**
- Create: `components/admin/DisqualifyButton.tsx`
- Create: `components/admin/SubstituteForm.tsx`
- Modify: `components/admin/RegistrationsTable.tsx`
- Modify: `app/admin/tournaments/[id]/registrations/page.tsx`

**Interfaces:**
- Produces: `DisqualifyButton({ registrationId, tournamentId, playerId, tournamentTitle }: {...})`; `SubstituteForm({ tournamentId, disqualifiedRegistrationId }: {...})`; `AdminRegistrationRow` gains `status: string`, `replacesRegistrationId: string | null`.
- Consumes: `disqualifyRegistration`, `addSubstitute`, `type DisqualifyState` (Task 13).

- [ ] **Step 1: Implement `DisqualifyButton`**

```tsx
'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { disqualifyRegistration, type DisqualifyState } from '@/lib/tournaments/registrations-admin-actions'

export function DisqualifyButton({
  registrationId,
  tournamentId,
  playerId,
  tournamentTitle,
}: {
  registrationId: string
  tournamentId: string
  playerId: string
  tournamentTitle: string
}) {
  const [state, action] = useFormState<DisqualifyState, FormData>(disqualifyRegistration, undefined)
  const [confirming, setConfirming] = useState(false)

  if (state?.success) return <span className="text-xs font-bold text-red-400">Disqualified</span>

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-lg border border-red-500/40 px-2.5 py-1 text-xs font-bold text-red-400 hover:bg-red-500/10"
      >
        Disqualify
      </button>
    )
  }
  return (
    <form action={action} className="flex flex-col gap-1.5">
      <input type="hidden" name="registrationId" value={registrationId} />
      <input type="hidden" name="tournamentId" value={tournamentId} />
      <input type="hidden" name="playerId" value={playerId} />
      <input type="hidden" name="tournamentTitle" value={tournamentTitle} />
      <textarea
        name="reason"
        rows={2}
        required
        placeholder="Reason (required) — e.g. repeated no-shows across group stage"
        className="w-48 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white placeholder:text-slate-600 focus:border-red-500 focus:outline-none"
      />
      <div className="flex gap-1.5">
        <button
          type="submit"
          className="rounded-lg bg-red-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-red-500"
        >
          Confirm
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs font-bold text-slate-300 hover:border-slate-500"
        >
          Cancel
        </button>
      </div>
      {state?.error && <p className="text-xs text-red-400">{state.error}</p>}
    </form>
  )
}
```

- [ ] **Step 2: Implement `SubstituteForm`**

```tsx
'use client'
import { useFormState } from 'react-dom'
import { addSubstitute, type DisqualifyState } from '@/lib/tournaments/registrations-admin-actions'

export function SubstituteForm({
  tournamentId,
  disqualifiedRegistrationId,
}: {
  tournamentId: string
  disqualifiedRegistrationId: string
}) {
  const [state, action] = useFormState<DisqualifyState, FormData>(addSubstitute, undefined)

  if (state?.success) return <span className="text-xs font-bold text-emerald-400">Substitute added</span>

  return (
    <form action={action} className="flex items-center gap-1.5">
      <input type="hidden" name="tournamentId" value={tournamentId} />
      <input type="hidden" name="disqualifiedRegistrationId" value={disqualifiedRegistrationId} />
      <input
        name="username"
        type="text"
        placeholder="Substitute's username"
        required
        className="w-36 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
      />
      <button
        type="submit"
        className="rounded-lg bg-violet-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-violet-500"
      >
        Add substitute
      </button>
      {state?.error && <p className="text-xs text-red-400">{state.error}</p>}
    </form>
  )
}
```

- [ ] **Step 3: Extend `RegistrationsTable`**

In `components/admin/RegistrationsTable.tsx`:
- Add to `AdminRegistrationRow`: `status: string`, `replacesRegistrationId: string | null`.
- Add a `"Status"` column header and cell after the existing `"Payment"` column, and (for `ctx.isAdmin` only — pass an `isAdmin: boolean` prop from the page) render `DisqualifyButton` for `status === 'active'` rows and `SubstituteForm` for `status === 'disqualified'` rows that have no substitute pointing at them yet (compute a `Set<string>` of `replacesRegistrationId` values from `rows` and check `!substitutedIds.has(r.id)`):

```tsx
export function RegistrationsTable({
  rows,
  tournamentId,
  tournamentStatus,
  tournamentTitle,
  registrationFee,
  isAdmin,
}: {
  rows: AdminRegistrationRow[]
  tournamentId: string
  tournamentStatus: string
  tournamentTitle: string
  registrationFee: number
  isAdmin: boolean
}) {
  // ...existing query/filtered logic...
  const substitutedIds = new Set(rows.map((r) => r.replacesRegistrationId).filter(Boolean) as string[])
```

Add the column:

```tsx
                <th className="px-2 py-2.5 text-left">Status</th>
```

and, in the row map:

```tsx
                  <td className="px-2 py-2.5">
                    {r.status === 'disqualified' ? (
                      <div className="flex flex-col gap-1">
                        <span className="text-xs font-bold text-red-400">Disqualified</span>
                        {isAdmin && !substitutedIds.has(r.id) && (
                          <SubstituteForm tournamentId={tournamentId} disqualifiedRegistrationId={r.id} />
                        )}
                      </div>
                    ) : isAdmin ? (
                      <DisqualifyButton
                        registrationId={r.id}
                        tournamentId={tournamentId}
                        playerId={r.playerId}
                        tournamentTitle={tournamentTitle}
                      />
                    ) : (
                      <span className="text-xs capitalize text-slate-400">{r.status}</span>
                    )}
                  </td>
```

Import `DisqualifyButton` and `SubstituteForm` at the top of the file.

- [ ] **Step 4: Wire the page**

In `app/admin/tournaments/[id]/registrations/page.tsx`:
- Add `status, replaces_registration_id` to the `tournament_registrations` select.
- Add those fields (`status: r.status`, `replacesRegistrationId: r.replaces_registration_id`) to the `rows` mapping.
- Pass `tournamentTitle={t.title}` and `isAdmin={ctx.isAdmin}` to `<RegistrationsTable ... />`.

- [ ] **Step 5: Manual verification**

Open `/admin/tournaments/[id]/registrations` as an admin: disqualify an active registration, confirm the row now shows "Disqualified" + a substitute form; add a substitute by username, confirm the row updates to "Substitute added" and a new row for the substitute appears (after a refresh) with `payment_status='paid'`. Confirm a moderator (non-admin) sees no `Disqualify` control (per the CLAUDE.md role rule) — just the plain status text.

- [ ] **Step 6: Commit**

```bash
git add components/admin/DisqualifyButton.tsx components/admin/SubstituteForm.tsx components/admin/RegistrationsTable.tsx "app/admin/tournaments/[id]/registrations/page.tsx"
git commit -m "feat: admin UI to disqualify a registration and add a substitute"
```

---

## Task 17: Public bracket — forfeited match badge

**Files:**
- Modify: `components/bracket/MatchCard.tsx`

**Interfaces:**
- Produces: `STATUS_BADGE` gains a `'forfeited'` entry.

**Context:** `orderKnockoutRounds` (`lib/tournaments/bracket.ts:86-96`) passes every knockout match through to `MatchCard` regardless of status — it doesn't bucket by status the way `splitFixturesByState` does for group fixtures (and `'forfeited'` never applies to a group match, so `splitFixturesByState` itself needs no change). `MatchCard` already renders defensively (`score ?? '–'`, `STATUS_BADGE[match.status] ?? STATUS_BADGE.scheduled`), so a forfeited match won't crash — it would just fall back to an "UPCOMING" badge, which is misleading for a match that's actually over.

- [ ] **Step 1: Add the badge entry**

In `components/bracket/MatchCard.tsx`:

```ts
const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  live:      { label: 'LIVE',      cls: 'bg-red-500/20 text-red-400 border-red-500/30' },
  scheduled: { label: 'UPCOMING',  cls: 'bg-slate-600/30 text-slate-300 border-slate-600/40' },
  completed: { label: 'FT',        cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  disputed:  { label: 'DISPUTED',  cls: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
  cancelled: { label: 'CANCELLED', cls: 'bg-slate-700/40 text-slate-500 border-slate-700/50' },
  forfeited: { label: 'FORFEITED', cls: 'bg-slate-700/40 text-slate-400 border-slate-700/50' },
}
```

No other change is needed — `hasScore`/`aWon`/`bWon` are already `null`-safe for a forfeited match's `score_a`/`score_b: null`.

- [ ] **Step 2: Manual verification**

Run `npx vitest run lib/tournaments/bracket.test.ts` (unaffected, confirms no regression), then open a tournament's public bracket page with a `forfeited` knockout match staged in the DB and confirm it renders an "FORFEITED" badge with no crash and both scores showing "–".

- [ ] **Step 3: Commit**

```bash
git add components/bracket/MatchCard.tsx
git commit -m "feat: FORFEITED badge on the public bracket for knockout double-no-shows"
```

---

## Final check

- [ ] Run the full suite: `npm run test` (i.e. `vitest run`)
Expected: PASS across all modified/created test files.
- [ ] Run `npx tsc --noEmit`
Expected: no type errors.
- [ ] Re-read `docs/superpowers/specs/2026-07-28-noshow-resolution-and-player-substitution-design.md` against the 17 tasks above and confirm every section (A–D + scope boundaries, including the knockout-forfeit-override lock amendment) has a corresponding task.
