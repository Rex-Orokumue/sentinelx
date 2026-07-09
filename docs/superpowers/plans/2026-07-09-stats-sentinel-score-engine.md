# Stats & Sentinel Score Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On match-result confirmation, populate `profiles` aggregates and Sentinel Score (currently never written), so player stats, Rankings, and Hall of Fame show real data.

**Architecture:** Two derived projections — aggregates recompute from the `matches` table, Sentinel Score recomputes by summing the `sentinel_score_events` log — with `profiles` columns as caches refreshed after every change. Pure functions (`score.ts`, `events.ts`, `stats.ts`) do the math and carry the test coverage; a thin impure `apply.ts` orchestrates DB reads/writes via the service-role client. Confirm/dispute hooks and an admin recompute button drive it.

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase (service-role client for system writes), Vitest.

## Global Constraints

- **Score is derived, never incremented.** `computeScore` sums stored `points_delta`; `profiles.sentinel_score` is a cache. Never patch the score with a delta.
- **Auto-event discriminator is `event_type`, not `match_id`.** Only `event_type ∈ {match_completed, win_no_dispute}` may be auto-deleted/regenerated. Authored events (future ratings/flags/disputes) are preserved even if they carry a `match_id`.
- **Overturn = delete-and-reinsert.** On any match result change, delete that match's auto-events and reinsert fresh from the current result. Never diff/patch.
- **All engine writes use the service-role admin client** (`createAdminClient()`), never the user client — they touch other users' rows and the append-only log. `confirmResult`/`disputeResult` already hold an admin client.
- **`sentinel_tier` is a DB generated column.** Write `sentinel_score` only; never write `sentinel_tier`.
- **Base score is 70**, clamped to `[0, 100]`.
- **Recompute button is admin-only** (`requireAdmin`) with a two-step in-app confirm. **No native `window.confirm`** — mobile-first, testable.
- Tests use Vitest (`import { describe, it, expect } from 'vitest'`), colocated `*.test.ts`. Run one file with `npx vitest run <path>`.

---

### Task 1: Migration — add `win_no_dispute` to the event_type CHECK

**Files:**
- Create: `supabase/migrations/006_win_no_dispute_event.sql`

**Interfaces:**
- Produces: the `win_no_dispute` value becomes valid in `sentinel_score_events.event_type`. Consumed by Task 3 (`events.ts`) and Task 5 (`apply.ts`) inserts.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/006_win_no_dispute_event.sql`:

```sql
-- Add 'win_no_dispute' to the Sentinel Score event types.
-- The scoring model awards +1 for a win with no dispute as a distinct, fixed-delta
-- ledger row (never folded into match_completed). The constraint was created inline
-- and auto-named <table>_<column>_check.
ALTER TABLE public.sentinel_score_events
  DROP CONSTRAINT sentinel_score_events_event_type_check,
  ADD CONSTRAINT sentinel_score_events_event_type_check
    CHECK (event_type IN (
      'match_completed', 'win_no_dispute', 'no_show', 'rage_quit',
      'dispute_lost', 'rating_received', 'admin_flag_conduct', 'admin_flag_cheat'
    ));
```

- [ ] **Step 2: Apply to the live Supabase project**

Apply via the Supabase MCP `apply_migration` tool (name: `win_no_dispute_event`, the SQL above), or `execute_sql` with the same statement. `event_type` is a `text`+CHECK column (not a Postgres enum type), so **no `lib/supabase/types.ts` regeneration is needed** — the generated type is already `string`.

- [ ] **Step 3: Verify the constraint accepts the new value**

Run via Supabase `execute_sql`:
```sql
SELECT pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname = 'sentinel_score_events_event_type_check';
```
Expected: the returned definition includes `'win_no_dispute'`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/006_win_no_dispute_event.sql
git commit -m "feat: add win_no_dispute sentinel score event type (#10a)"
```

---

### Task 2: `computeScore` — pure score from the log

**Files:**
- Create: `lib/scoring/score.ts`
- Test: `lib/scoring/score.test.ts`

**Interfaces:**
- Produces: `BASE_SCORE: number`; `computeScore(events: { points_delta: number }[]): number`. Consumed by Task 5 (`refreshPlayer`).

- [ ] **Step 1: Write the failing test**

Create `lib/scoring/score.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { computeScore, BASE_SCORE } from './score'

describe('computeScore', () => {
  it('returns the base score (70) for an empty log', () => {
    expect(BASE_SCORE).toBe(70)
    expect(computeScore([])).toBe(70)
  })

  it('adds stored deltas to the base', () => {
    expect(computeScore([{ points_delta: 2 }, { points_delta: 1 }])).toBe(73)
  })

  it('handles negative and mixed deltas', () => {
    expect(computeScore([{ points_delta: 2 }, { points_delta: -8 }, { points_delta: 1 }])).toBe(65)
  })

  it('clamps at 100', () => {
    expect(computeScore([{ points_delta: 40 }])).toBe(100)
  })

  it('clamps at 0', () => {
    expect(computeScore([{ points_delta: -100 }])).toBe(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/scoring/score.test.ts`
Expected: FAIL — cannot resolve `./score`.

- [ ] **Step 3: Write the implementation**

Create `lib/scoring/score.ts`:

```ts
// Sentinel Score is derived: base 70 plus the sum of every logged points_delta,
// clamped to 0–100. profiles.sentinel_score is a cache of this value, never the source.
export const BASE_SCORE = 70
const MIN_SCORE = 0
const MAX_SCORE = 100

export function computeScore(events: { points_delta: number }[]): number {
  const raw = BASE_SCORE + events.reduce((sum, e) => sum + e.points_delta, 0)
  return Math.max(MIN_SCORE, Math.min(MAX_SCORE, raw))
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/scoring/score.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/scoring/score.ts lib/scoring/score.test.ts
git commit -m "feat: computeScore pure function (#10a)"
```

---

### Task 3: `matchEventsFor` — auto match-derived events

**Files:**
- Create: `lib/scoring/events.ts`
- Test: `lib/scoring/events.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `AUTO_MATCH_EVENT_TYPES` (readonly tuple `['match_completed','win_no_dispute']`), `MATCH_COMPLETED_DELTA`, `WIN_DELTA`, `NewMatchEvent` interface, `matchEventsFor(match): NewMatchEvent[]`. Consumed by Task 5.

- [ ] **Step 1: Write the failing test**

Create `lib/scoring/events.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { matchEventsFor } from './events'

const base = {
  id: 'm1',
  player_a_id: 'A',
  player_b_id: 'B',
  score_a: 3,
  score_b: 1,
  status: 'completed',
}

describe('matchEventsFor', () => {
  it('gives both players match_completed and the winner win_no_dispute', () => {
    const events = matchEventsFor(base)
    expect(events).toHaveLength(3)
    expect(events.filter((e) => e.player_id === 'A')).toEqual([
      { player_id: 'A', match_id: 'm1', event_type: 'match_completed', points_delta: 2, note: null },
      { player_id: 'A', match_id: 'm1', event_type: 'win_no_dispute', points_delta: 1, note: null },
    ])
    expect(events.filter((e) => e.player_id === 'B')).toEqual([
      { player_id: 'B', match_id: 'm1', event_type: 'match_completed', points_delta: 2, note: null },
    ])
  })

  it('awards win_no_dispute to player B when B wins', () => {
    const events = matchEventsFor({ ...base, score_a: 0, score_b: 2 })
    const wins = events.filter((e) => e.event_type === 'win_no_dispute')
    expect(wins).toHaveLength(1)
    expect(wins[0].player_id).toBe('B')
  })

  it('gives no win bonus on a draw', () => {
    const events = matchEventsFor({ ...base, score_a: 1, score_b: 1 })
    expect(events).toHaveLength(2)
    expect(events.every((e) => e.event_type === 'match_completed')).toBe(true)
  })

  it('returns nothing for a non-completed match', () => {
    expect(matchEventsFor({ ...base, status: 'scheduled' })).toEqual([])
    expect(matchEventsFor({ ...base, status: 'disputed' })).toEqual([])
  })

  it('returns nothing for a bye or missing scores', () => {
    expect(matchEventsFor({ ...base, status: 'bye', player_b_id: null, score_a: null, score_b: null })).toEqual([])
    expect(matchEventsFor({ ...base, score_b: null })).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/scoring/events.test.ts`
Expected: FAIL — cannot resolve `./events`.

- [ ] **Step 3: Write the implementation**

Create `lib/scoring/events.ts`:

```ts
// The only event types this engine generates automatically from a match result.
// Used as the delete/regenerate discriminator so authored events (ratings, flags,
// disputes) are never touched — even when they carry the same match_id.
export const AUTO_MATCH_EVENT_TYPES = ['match_completed', 'win_no_dispute'] as const
export type AutoMatchEventType = (typeof AUTO_MATCH_EVENT_TYPES)[number]

export const MATCH_COMPLETED_DELTA = 2
export const WIN_DELTA = 1

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
}

export function matchEventsFor(match: MatchInput): NewMatchEvent[] {
  if (match.status !== 'completed') return []
  const { id, player_a_id, player_b_id, score_a, score_b } = match
  // A completed match must have both players and both scores; a bye never does.
  if (!player_a_id || !player_b_id || score_a == null || score_b == null) return []

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
  return {
    player_id: playerId,
    match_id: matchId,
    event_type: 'match_completed',
    points_delta: MATCH_COMPLETED_DELTA,
    note: null,
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/scoring/events.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/scoring/events.ts lib/scoring/events.test.ts
git commit -m "feat: matchEventsFor auto score events (#10a)"
```

---

### Task 4: `computeAggregates` — pure profile stats

**Files:**
- Create: `lib/scoring/stats.ts`
- Test: `lib/scoring/stats.test.ts`

**Interfaces:**
- Produces: `Aggregates` interface (`total_matches`, `wins`, `losses`, `goals_scored`, `goals_conceded`, `total_titles`), `CompletedMatch` interface (`player_a_id`, `player_b_id`, `score_a`, `score_b` — all non-null), `computeAggregates(playerId: string, matches: CompletedMatch[], titlesWon: number): Aggregates`. Consumed by Task 5.
- Note: `matches` passed in are already filtered to this player's completed matches with both scores present.

- [ ] **Step 1: Write the failing test**

Create `lib/scoring/stats.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { computeAggregates } from './stats'

describe('computeAggregates', () => {
  it('counts a win from the player-A perspective', () => {
    const agg = computeAggregates('A', [{ player_a_id: 'A', player_b_id: 'B', score_a: 3, score_b: 1 }], 0)
    expect(agg).toEqual({
      total_matches: 1, wins: 1, losses: 0,
      goals_scored: 3, goals_conceded: 1, total_titles: 0,
    })
  })

  it('counts a loss from the player-B perspective', () => {
    const agg = computeAggregates('B', [{ player_a_id: 'A', player_b_id: 'B', score_a: 2, score_b: 0 }], 0)
    expect(agg).toMatchObject({ wins: 0, losses: 1, goals_scored: 0, goals_conceded: 2 })
  })

  it('counts a draw as neither win nor loss', () => {
    const agg = computeAggregates('A', [{ player_a_id: 'A', player_b_id: 'B', score_a: 1, score_b: 1 }], 0)
    expect(agg).toMatchObject({ total_matches: 1, wins: 0, losses: 0, goals_scored: 1, goals_conceded: 1 })
  })

  it('aggregates across multiple matches and passes titles through', () => {
    const agg = computeAggregates('A', [
      { player_a_id: 'A', player_b_id: 'B', score_a: 3, score_b: 1 },
      { player_a_id: 'C', player_b_id: 'A', score_a: 2, score_b: 5 },
    ], 2)
    expect(agg).toEqual({
      total_matches: 2, wins: 2, losses: 0,
      goals_scored: 8, goals_conceded: 3, total_titles: 2,
    })
  })

  it('is all-zero for a player with no matches', () => {
    expect(computeAggregates('A', [], 0)).toEqual({
      total_matches: 0, wins: 0, losses: 0,
      goals_scored: 0, goals_conceded: 0, total_titles: 0,
    })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/scoring/stats.test.ts`
Expected: FAIL — cannot resolve `./stats`.

- [ ] **Step 3: Write the implementation**

Create `lib/scoring/stats.ts`:

```ts
// Aggregates derive from the matches table (not the score log). Keys match the
// profiles columns exactly so the result can be spread straight into an update.
// Draws count as neither win nor loss — profiles has no draws column, by design.
export interface Aggregates {
  total_matches: number
  wins: number
  losses: number
  goals_scored: number
  goals_conceded: number
  total_titles: number
}

export interface CompletedMatch {
  player_a_id: string
  player_b_id: string
  score_a: number
  score_b: number
}

export function computeAggregates(
  playerId: string,
  matches: CompletedMatch[],
  titlesWon: number,
): Aggregates {
  let wins = 0
  let losses = 0
  let goalsScored = 0
  let goalsConceded = 0

  for (const m of matches) {
    const isA = m.player_a_id === playerId
    const mine = isA ? m.score_a : m.score_b
    const theirs = isA ? m.score_b : m.score_a
    goalsScored += mine
    goalsConceded += theirs
    if (mine > theirs) wins += 1
    else if (mine < theirs) losses += 1
  }

  return {
    total_matches: matches.length,
    wins,
    losses,
    goals_scored: goalsScored,
    goals_conceded: goalsConceded,
    total_titles: titlesWon,
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/scoring/stats.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/scoring/stats.ts lib/scoring/stats.test.ts
git commit -m "feat: computeAggregates pure function (#10a)"
```

---

### Task 5: `apply.ts` — DB orchestration

**Files:**
- Create: `lib/scoring/apply.ts`

**Interfaces:**
- Consumes: `computeScore` (Task 2), `matchEventsFor` + `AUTO_MATCH_EVENT_TYPES` (Task 3), `computeAggregates` + `CompletedMatch` (Task 4), `getChampion` + `BracketMatch` from `lib/tournaments/bracket`, `createAdminClient` from `lib/supabase/admin`.
- Produces: `syncMatchEvents(admin, matchId: string): Promise<void>` (Task 6 hook), `recomputeAllScoring(admin): Promise<{ players: number }>` (Task 7), plus internal `regenerateMatchEvents` and `refreshPlayer`.
- `admin` param type: `ReturnType<typeof createAdminClient>`.

This task is impure DB orchestration over the Supabase query builder; its correctness gate is `npx tsc --noEmit` here and the end-to-end recompute in Task 8. The math it calls is already unit-tested in Tasks 2–4.

- [ ] **Step 1: Write the implementation**

Create `lib/scoring/apply.ts`:

```ts
import { createAdminClient } from '@/lib/supabase/admin'
import { getChampion, type BracketMatch } from '@/lib/tournaments/bracket'
import { AUTO_MATCH_EVENT_TYPES, matchEventsFor } from './events'
import { computeAggregates, type CompletedMatch } from './stats'
import { computeScore } from './score'

type Admin = ReturnType<typeof createAdminClient>

interface MatchRow {
  id: string
  player_a_id: string | null
  player_b_id: string | null
  score_a: number | null
  score_b: number | null
  status: string
}

const MATCH_COLS = 'id, player_a_id, player_b_id, score_a, score_b, status'

// Reuse getChampion's winner rule by shaping a raw final row into a BracketMatch.
// Only ids are compared, so names are irrelevant.
function toBracketFinal(m: {
  round: string
  status: string
  score_a: number | null
  score_b: number | null
  player_a_id: string | null
  player_b_id: string | null
}): BracketMatch {
  return {
    id: '',
    round: m.round,
    group_id: null,
    groupName: null,
    status: m.status,
    score_a: m.score_a,
    score_b: m.score_b,
    scheduled_at: null,
    playerA: { id: m.player_a_id ?? '', name: '' },
    playerB: { id: m.player_b_id ?? '', name: '' },
  }
}

// Delete this match's AUTO events (only) and reinsert from the current result.
// Returns the ids of players whose scoring is affected. No refresh here.
async function regenerateMatchEvents(admin: Admin, match: MatchRow): Promise<string[]> {
  await admin
    .from('sentinel_score_events')
    .delete()
    .eq('match_id', match.id)
    .in('event_type', [...AUTO_MATCH_EVENT_TYPES])
  const events = matchEventsFor(match)
  if (events.length > 0) await admin.from('sentinel_score_events').insert(events)
  return [match.player_a_id, match.player_b_id].filter((x): x is string => !!x)
}

// Recompute aggregates + score for one player and write both caches to profiles.
async function refreshPlayer(admin: Admin, playerId: string): Promise<void> {
  const { data: rawMatches } = await admin
    .from('matches')
    .select('player_a_id, player_b_id, score_a, score_b, round, status')
    .eq('status', 'completed')
    .or(`player_a_id.eq.${playerId},player_b_id.eq.${playerId}`)
  const rows = rawMatches ?? []

  const completed: CompletedMatch[] = rows
    .filter((m) => m.player_a_id && m.player_b_id && m.score_a != null && m.score_b != null)
    .map((m) => ({
      player_a_id: m.player_a_id as string,
      player_b_id: m.player_b_id as string,
      score_a: m.score_a as number,
      score_b: m.score_b as number,
    }))

  const titlesWon = rows
    .filter((m) => m.round === 'final')
    .map((m) => getChampion([toBracketFinal(m)]))
    .filter((champ) => champ?.id === playerId).length

  const aggregates = computeAggregates(playerId, completed, titlesWon)

  const { data: events } = await admin
    .from('sentinel_score_events')
    .select('points_delta')
    .eq('player_id', playerId)
  const sentinel_score = computeScore(events ?? [])

  await admin
    .from('profiles')
    .update({ ...aggregates, sentinel_score })
    .eq('id', playerId)
}

// Confirm/dispute hook: regenerate one match's events, then refresh both players.
// Works symmetrically for disputes — a non-completed match reinserts no events,
// so both players' totals drop.
export async function syncMatchEvents(admin: Admin, matchId: string): Promise<void> {
  const { data: match } = await admin
    .from('matches')
    .select(MATCH_COLS)
    .eq('id', matchId)
    .maybeSingle()
  if (!match) return
  const affected = await regenerateMatchEvents(admin, match)
  for (const pid of affected) await refreshPlayer(admin, pid)
}

// Full rebuild — the admin recompute button and the recover-from-bug path.
// Wipes all AUTO events (authored events preserved), regenerates from every
// completed match, then refreshes every profile.
export async function recomputeAllScoring(admin: Admin): Promise<{ players: number }> {
  await admin
    .from('sentinel_score_events')
    .delete()
    .in('event_type', [...AUTO_MATCH_EVENT_TYPES])

  const { data: matches } = await admin
    .from('matches')
    .select(MATCH_COLS)
    .eq('status', 'completed')
  for (const m of matches ?? []) {
    const events = matchEventsFor(m)
    if (events.length > 0) await admin.from('sentinel_score_events').insert(events)
  }

  const { data: profiles } = await admin.from('profiles').select('id')
  for (const p of profiles ?? []) await refreshPlayer(admin, p.id)
  return { players: (profiles ?? []).length }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (If the typed client rejects `.in()` with the readonly tuple, the `[...AUTO_MATCH_EVENT_TYPES]` spread already widens it to `string[]`.)

- [ ] **Step 3: Commit**

```bash
git add lib/scoring/apply.ts
git commit -m "feat: scoring apply orchestration — sync + recompute (#10a)"
```

---

### Task 6: Hook the engine into confirm/dispute

**Files:**
- Modify: `lib/matches/verify-actions.ts`

**Interfaces:**
- Consumes: `syncMatchEvents` (Task 5).

- [ ] **Step 1: Add the import**

In `lib/matches/verify-actions.ts`, add to the imports near the top (after the existing `@/lib/tournaments/*` imports):

```ts
import { syncMatchEvents } from '@/lib/scoring/apply'
```

- [ ] **Step 2: Call it in `confirmResult`**

In `confirmResult`, immediately before the `revalidateAll(m.tournament_id, slug, id)` line, add:

```ts
  await syncMatchEvents(admin, id)
```

(The match is now `completed`; this regenerates its auto-events and refreshes both players. It is independent of the group/knockout advancement above, so order relative to that block does not matter.)

- [ ] **Step 3: Call it in `disputeResult`**

In `disputeResult`, immediately before its `revalidateAll(...)` line, add:

```ts
  await syncMatchEvents(admin, id)
```

(The match left `completed`, so its auto-events are deleted and none reinserted — both players refresh downward.)

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/matches/verify-actions.ts
git commit -m "feat: refresh scoring on result confirm/dispute (#10a)"
```

---

### Task 7: Admin recompute action + button

**Files:**
- Create: `lib/scoring/admin-actions.ts`
- Create: `components/admin/RecomputeButton.tsx`
- Modify: `app/admin/page.tsx`

**Interfaces:**
- Consumes: `recomputeAllScoring` (Task 5), `requireAdmin` from `lib/admin/auth`, `createAdminClient`.
- Produces: `recomputeAllAction(_prev, formData): Promise<RecomputeState>` and `RecomputeState` type; `RecomputeButton` component.

- [ ] **Step 1: Write the server action**

Create `lib/scoring/admin-actions.ts`:

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/admin/auth'
import { recomputeAllScoring } from './apply'

export type RecomputeState = { error?: string; players?: number } | undefined

export async function recomputeAllAction(
  _prev: RecomputeState,
  _formData: FormData,
): Promise<RecomputeState> {
  await requireAdmin()
  try {
    const admin = createAdminClient()
    const { players } = await recomputeAllScoring(admin)
    revalidatePath('/rankings')
    revalidatePath('/hall-of-fame')
    return { players }
  } catch {
    return { error: 'Recompute failed. Please try again.' }
  }
}
```

- [ ] **Step 2: Write the button (two-step confirm, no native dialog)**

Create `components/admin/RecomputeButton.tsx`:

```tsx
'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { recomputeAllAction, type RecomputeState } from '@/lib/scoring/admin-actions'

export function RecomputeButton() {
  const [state, action] = useFormState<RecomputeState, FormData>(recomputeAllAction, undefined)
  const [confirming, setConfirming] = useState(false)

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <p className="font-bold text-white">Recompute all scores &amp; stats</p>
      <p className="mt-0.5 text-xs text-slate-500">
        Rebuilds every player&apos;s aggregates and Sentinel Score from match history and the
        events log. Safe to run anytime; use it to recover from a scoring bug.
      </p>

      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="mt-3 rounded-lg border border-slate-700 px-4 py-2 text-xs font-bold text-slate-200 hover:border-slate-500"
        >
          Recompute all…
        </button>
      ) : (
        <form action={action} className="mt-3 space-y-2">
          <p className="text-xs font-semibold text-amber-400">
            This recomputes scores for all players. Are you sure?
          </p>
          <div className="flex gap-2">
            <button
              type="submit"
              onClick={() => setConfirming(false)}
              className="rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white hover:bg-red-500"
            >
              Yes, recompute all players
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-bold text-slate-300 hover:border-slate-500"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {state?.players != null && (
        <p className="mt-2 text-xs text-emerald-400">Recomputed {state.players} players.</p>
      )}
      {state?.error && <p className="mt-2 text-xs text-red-400">{state.error}</p>}
    </div>
  )
}
```

- [ ] **Step 3: Mount it on the admin dashboard (admin-only)**

In `app/admin/page.tsx`, add the import at the top:

```ts
import { RecomputeButton } from '@/components/admin/RecomputeButton'
```

Then, inside the returned `<section>`, after the closing `</div>` of the stat-card grid (before `</section>`), add:

```tsx
      {ctx.isAdmin && (
        <div className="mt-8">
          <h2 className="mb-4 text-[11px] font-bold uppercase tracking-widest text-slate-500">
            Maintenance
          </h2>
          <RecomputeButton />
        </div>
      )}
```

(`ctx` is already available from the existing `const ctx = await requireStaff()`.)

- [ ] **Step 4: Type-check and build**

Run: `npx tsc --noEmit && npm run build`
Expected: no errors; build completes.

- [ ] **Step 5: Commit**

```bash
git add lib/scoring/admin-actions.ts components/admin/RecomputeButton.tsx app/admin/page.tsx
git commit -m "feat: admin recompute-all scores button (#10a)"
```

---

### Task 8: End-to-end verification + backfill

**Files:** none (verification + one-time backfill run).

**Interfaces:** exercises Tasks 1–7 together.

- [ ] **Step 1: Full test + build gate**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: all scoring tests pass, no type errors, build succeeds.

- [ ] **Step 2: Confirm the migration is applied**

Re-run the Task 1 Step 3 constraint query via Supabase `execute_sql`; confirm `'win_no_dispute'` is present. (Required before any event insert can succeed.)

- [ ] **Step 3: Backfill existing data**

Start the app (`npm run dev`) or use the deployed site. As an **admin** user, open `/admin`, use **Recompute all scores & stats** → confirm. Expected: "Recomputed N players."

- [ ] **Step 4: Verify the projections populated**

- Visit `/rankings` — players with completed matches now appear, ranked by wins (previously empty).
- Visit `/hall-of-fame` — champions/MVP/Golden Boot populate if any tournament has a completed final.
- Spot-check one player's `profiles` row via Supabase `execute_sql`: `wins`, `total_matches`, `goals_scored`, `sentinel_score`, and the generated `sentinel_tier` reflect their match history.

- [ ] **Step 5: Verify the confirm hook live (optional but recommended)**

Confirm a pending result in `/admin/results`, then re-check that player's row — `total_matches`/`wins` and `sentinel_score` increased, and `sentinel_score_events` has fresh `match_completed`/`win_no_dispute` rows for that `match_id`.

- [ ] **Step 6: Push**

```bash
git push origin main
```

---

## Self-Review

- **Spec coverage:** §3 migration → Task 1; §4.1 `score.ts` → Task 2; §4.2 `events.ts` → Task 3; §4.3 `stats.ts` → Task 4; §4.4 `apply.ts` (regenerate/refresh/sync/recomputeAll) → Task 5; §5 confirm/dispute hooks → Task 6; §6 admin button → Task 7; §7 testing → Tasks 2–4 + 8; §8 "Rankings/Hall of Fame light up" verification → Task 8. All covered.
- **Auto-event discriminator:** `.in('event_type', [...AUTO_MATCH_EVENT_TYPES])` used in both `regenerateMatchEvents` and `recomputeAllScoring` — never `match_id`-only deletes. Consistent with the global constraint.
- **Type consistency:** `Aggregates` keys (`total_matches`, `wins`, `losses`, `goals_scored`, `goals_conceded`, `total_titles`) match the `profiles` columns and are spread directly into `.update({ ...aggregates, sentinel_score })`. `CompletedMatch` (non-null fields) is produced by the filter/map in `refreshPlayer`. `syncMatchEvents`/`recomputeAllScoring` signatures match their Task 6/7 call sites. `RecomputeState` shape matches the button's `useFormState` usage.
- **Deferred (not in these tasks, per spec §8):** event-writing for ratings/flags/no-show, suspension, the profile page (10b).
