# Rank History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record each player's rank daily so the leaderboard's Trend column has
something real to compare against.

**Architecture:** A `player_rank_snapshots` table, a `snapshot-ranks` cron route
following the four existing cron routes, and two pure modules — `trend.ts` (rank
now vs rank then) and `snapshot.ts` (building the day's rows). All decision logic
is pure and unit-tested; the route is thin glue.

**Tech Stack:** Next.js route handler, Supabase service-role client, vitest.

**Spec:** `docs/superpowers/specs/2026-09-06-rank-history-design.md`

## Global Constraints

- Work in the worktree `C:\Users\gorok\Videos\sentinelx-champions` on branch
  `feat/rank-history`. The primary checkout belongs to another agent — never
  commit from it.
- Before every commit: `git status -sb` (confirm branch) and
  `git diff --cached --name-only` (confirm only intended files are staged).
- `lib/rankings/leaderboard.ts` must NOT be modified — `rankPlayersBy` is read,
  never changed.
- Rank 1 is the best rank. Moving from 12 to 1 is **up** by 11.
- A player with no earlier snapshot is `new`, never `up`.
- The cron route is the only writer; it never modifies profiles, ranks or scores.
- Run tests scoped: `npx vitest run lib/rankings`.
- Every commit ends with the Co-Authored-By and Claude-Session trailers.

---

### Task 1: Migration and types

**Files:**
- Create: `supabase/migrations/080_player_rank_snapshots.sql`
- Modify: `lib/supabase/types.ts` (regenerated)

- [ ] **Step 1: Write the migration**

```sql
-- 080_player_rank_snapshots.sql
-- Rank history for the leaderboard's Trend column. Rank is otherwise computed
-- per request and discarded, so there is nothing to compare "now" against.
-- game_id NULL = the global, all-games board.

CREATE TABLE public.player_rank_snapshots (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id    uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  game_id      uuid        REFERENCES public.games(id) ON DELETE CASCADE,
  rank         integer     NOT NULL CHECK (rank > 0),
  metric_value integer     NOT NULL,
  captured_on  date        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- One row per player per scope per day. Postgres treats NULLs as distinct, so a
-- single constraint over a nullable game_id would not stop duplicate global
-- rows — hence two partial unique indexes.
CREATE UNIQUE INDEX player_rank_snapshots_global_uniq
  ON public.player_rank_snapshots (player_id, captured_on)
  WHERE game_id IS NULL;

CREATE UNIQUE INDEX player_rank_snapshots_game_uniq
  ON public.player_rank_snapshots (player_id, game_id, captured_on)
  WHERE game_id IS NOT NULL;

CREATE INDEX player_rank_snapshots_lookup
  ON public.player_rank_snapshots (player_id, game_id, captured_on DESC);

ALTER TABLE public.player_rank_snapshots ENABLE ROW LEVEL SECURITY;

-- The leaderboard is public, so history is publicly readable. No write policies:
-- the cron route writes with the service-role client, which bypasses RLS.
CREATE POLICY "prs_public_read" ON public.player_rank_snapshots
  FOR SELECT USING (true);
```

- [ ] **Step 2: Apply it and regenerate types**

Apply via the Supabase MCP `apply_migration`, then regenerate `lib/supabase/types.ts`
and confirm `player_rank_snapshots` appears with all six columns.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/080_player_rank_snapshots.sql lib/supabase/types.ts
git commit -m "feat(rankings): player_rank_snapshots table for leaderboard trend"
```

---

### Task 2: Trend helper

**Files:**
- Create: `lib/rankings/trend.ts`, `lib/rankings/trend.test.ts`

**Interfaces:**
- Produces: `TrendDirection`, `Trend`, `trendFor(currentRank, previousRank)`,
  `previousRankFor(snapshots, playerId, gameId, today)`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/rankings/trend.test.ts
import { describe, it, expect } from 'vitest'
import { trendFor, previousRankFor, type RankSnapshot } from './trend'

describe('trendFor', () => {
  it('reports a player with no history as new, not risen', () => {
    expect(trendFor(5, null)).toEqual({ direction: 'new', delta: 0 })
  })

  it('treats a smaller rank number as an improvement', () => {
    // rank 1 is better than rank 12 — moving 12 -> 1 is up by 11
    expect(trendFor(1, 12)).toEqual({ direction: 'up', delta: 11 })
  })

  it('reports a larger rank number as a drop', () => {
    expect(trendFor(9, 7)).toEqual({ direction: 'down', delta: 2 })
  })

  it('reports no movement as flat', () => {
    expect(trendFor(4, 4)).toEqual({ direction: 'flat', delta: 0 })
  })

  it('never returns a negative delta', () => {
    for (const [cur, prev] of [[1, 12], [9, 7], [4, 4]] as const) {
      expect(trendFor(cur, prev).delta).toBeGreaterThanOrEqual(0)
    }
  })
})

const snap = (over: Partial<RankSnapshot>): RankSnapshot => ({
  playerId: 'p1', gameId: null, rank: 10, capturedOn: '2026-09-01', ...over,
})

describe('previousRankFor', () => {
  const today = '2026-09-06'

  it('picks the most recent snapshot older than today', () => {
    const rows = [
      snap({ rank: 20, capturedOn: '2026-09-01' }),
      snap({ rank: 15, capturedOn: '2026-09-05' }),
    ]
    expect(previousRankFor(rows, 'p1', null, today)).toBe(15)
  })

  it("ignores today's own row so a second run doesn't compare against itself", () => {
    const rows = [
      snap({ rank: 15, capturedOn: '2026-09-05' }),
      snap({ rank: 3, capturedOn: today }),
    ]
    expect(previousRankFor(rows, 'p1', null, today)).toBe(15)
  })

  it('ignores other players', () => {
    const rows = [snap({ playerId: 'other', rank: 2, capturedOn: '2026-09-05' })]
    expect(previousRankFor(rows, 'p1', null, today)).toBeNull()
  })

  it('keeps scopes separate', () => {
    const rows = [
      snap({ gameId: 'g1', rank: 2, capturedOn: '2026-09-05' }),
      snap({ gameId: null, rank: 8, capturedOn: '2026-09-05' }),
    ]
    expect(previousRankFor(rows, 'p1', 'g1', today)).toBe(2)
    expect(previousRankFor(rows, 'p1', null, today)).toBe(8)
  })

  it('returns null with no history at all', () => {
    expect(previousRankFor([], 'p1', null, today)).toBeNull()
  })
})
```

- [ ] **Step 2: Run and verify it fails**

Run: `npx vitest run lib/rankings/trend.test.ts`
Expected: FAIL — module `./trend` not found.

- [ ] **Step 3: Implement**

```ts
// lib/rankings/trend.ts

export type TrendDirection = 'up' | 'down' | 'flat' | 'new'

export interface Trend {
  direction: TrendDirection
  /** Places moved. Always >= 0; read the direction for which way. */
  delta: number
}

export interface RankSnapshot {
  playerId: string
  /** null = the global, all-games board. */
  gameId: string | null
  rank: number
  /** ISO date, YYYY-MM-DD. */
  capturedOn: string
}

// Rank 1 is the best rank, so a SMALLER number is an improvement — the
// comparison is inverted relative to the raw values, which is the easy thing to
// get backwards here.
export function trendFor(currentRank: number, previousRank: number | null): Trend {
  if (previousRank === null) return { direction: 'new', delta: 0 }
  if (previousRank === currentRank) return { direction: 'flat', delta: 0 }
  return previousRank > currentRank
    ? { direction: 'up', delta: previousRank - currentRank }
    : { direction: 'down', delta: currentRank - previousRank }
}

// The most recent snapshot for this player and scope from BEFORE today, so a
// second run on the same day compares against yesterday rather than itself.
export function previousRankFor(
  snapshots: RankSnapshot[],
  playerId: string,
  gameId: string | null,
  today: string,
): number | null {
  let best: RankSnapshot | null = null
  for (const s of snapshots) {
    if (s.playerId !== playerId) continue
    if (s.gameId !== gameId) continue
    if (s.capturedOn >= today) continue
    if (!best || s.capturedOn > best.capturedOn) best = s
  }
  return best?.rank ?? null
}
```

- [ ] **Step 4: Run and verify it passes**

Run: `npx vitest run lib/rankings/trend.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/rankings/trend.ts lib/rankings/trend.test.ts
git commit -m "feat(rankings): trend helper comparing current rank to history"
```

---

### Task 3: Snapshot row building

**Files:**
- Create: `lib/rankings/snapshot.ts`, `lib/rankings/snapshot.test.ts`

**Interfaces:**
- Consumes: `rankPlayersBy`, `isRankingEligible`, `type PlayerStatsInput` from `./leaderboard`.
- Produces:
  `SnapshotRow` = `{ player_id: string; game_id: string | null; rank: number; metric_value: number; captured_on: string }`;
  `GameWinEntry` = `{ playerId: string; wins: number; sxScore: number }`;
  `buildGlobalSnapshotRows(players: PlayerStatsInput[], capturedOn: string): SnapshotRow[]`;
  `buildGameSnapshotRows(entries: GameWinEntry[], gameId: string, capturedOn: string): SnapshotRow[]`.

**Why `buildGameSnapshotRows` takes its own input shape:** the existing
`winsByGame` on `PlayerStatsInput` is keyed by **game name**
(`GameWinCount = { game: string; wins: number }` — see
`winsByPlayerAndGame`, which groups on `match.game_name`). Snapshot rows need
`game_id`. Rather than thread a name-to-id map through a pure function, the cron
route computes per-game wins by id from the raw matches it already loads and
passes plain entries in. That keeps this module free of the name-keyed quirk.

- [ ] **Step 1: Write the failing test**

```ts
// lib/rankings/snapshot.test.ts
import { describe, it, expect } from 'vitest'
import { buildGlobalSnapshotRows, buildGameSnapshotRows, type GameWinEntry } from './snapshot'
import type { PlayerStatsInput } from './leaderboard'

const player = (over: Partial<PlayerStatsInput> & { id: string }): PlayerStatsInput => ({
  id: over.id,
  username: over.id,
  displayName: null,
  avatarUrl: null,
  country: null,
  wins: 0,
  losses: 0,
  totalMatches: 1,
  goalsScored: 0,
  goalsConceded: 0,
  categoryStats: [],
  gameStats: [],
  winsByGame: [],
  totalTitles: 0,
  sxScore: 700,
  sentinelTier: null,
  membershipTier: 'recruit',
  ...over,
})

const DAY = '2026-09-06'

describe('buildGlobalSnapshotRows', () => {
  it('ranks by SX Score, best first, and stamps the day', () => {
    const rows = buildGlobalSnapshotRows(
      [player({ id: 'low', sxScore: 700 }), player({ id: 'high', sxScore: 900 })],
      DAY,
    )
    expect(rows[0]).toMatchObject({ player_id: 'high', rank: 1, metric_value: 900, game_id: null, captured_on: DAY })
    expect(rows[1]).toMatchObject({ player_id: 'low', rank: 2, metric_value: 700 })
  })

  it('excludes players below the eligibility gate', () => {
    const rows = buildGlobalSnapshotRows(
      [player({ id: 'played', totalMatches: 1 }), player({ id: 'never', totalMatches: 0 })],
      DAY,
    )
    expect(rows.map((r) => r.player_id)).toEqual(['played'])
  })

  it('returns nothing when nobody is eligible', () => {
    expect(buildGlobalSnapshotRows([player({ id: 'x', totalMatches: 0 })], DAY)).toEqual([])
  })
})

describe('buildGameSnapshotRows', () => {
  const e = (playerId: string, wins: number, sxScore = 700): GameWinEntry => ({ playerId, wins, sxScore })

  it('ranks by wins in that game and carries the game id', () => {
    const rows = buildGameSnapshotRows([e('a', 2), e('b', 5)], 'g1', DAY)
    expect(rows[0]).toMatchObject({ player_id: 'b', rank: 1, metric_value: 5, game_id: 'g1', captured_on: DAY })
    expect(rows[1]).toMatchObject({ player_id: 'a', rank: 2, metric_value: 2 })
  })

  it('breaks a wins tie on SX Score so the order is deterministic', () => {
    const rows = buildGameSnapshotRows([e('lower', 3, 700), e('higher', 3, 950)], 'g1', DAY)
    expect(rows.map((r) => r.player_id)).toEqual(['higher', 'lower'])
  })

  it('omits players with no wins in that game', () => {
    expect(buildGameSnapshotRows([e('a', 2), e('b', 0)], 'g1', DAY).map((r) => r.player_id)).toEqual(['a'])
  })

  it('returns nothing for an empty game', () => {
    expect(buildGameSnapshotRows([], 'g1', DAY)).toEqual([])
  })
})
```

- [ ] **Step 2: Run and verify it fails**

Run: `npx vitest run lib/rankings/snapshot.test.ts`
Expected: FAIL — module `./snapshot` not found.

- [ ] **Step 3: Implement**

```ts
// lib/rankings/snapshot.ts
import { isRankingEligible, rankPlayersBy, type PlayerStatsInput } from './leaderboard'

export interface SnapshotRow {
  player_id: string
  /** null = the global, all-games board. */
  game_id: string | null
  rank: number
  metric_value: number
  captured_on: string
}

/** Per-game wins for one game, by id — see the note in the plan on why this
 *  isn't PlayerStatsInput['winsByGame'] (that one is keyed by game name). */
export interface GameWinEntry {
  playerId: string
  wins: number
  sxScore: number
}

// Global board: SX Score, matching the page's own statement that players are
// ranked by total SX Score across all games.
export function buildGlobalSnapshotRows(
  players: PlayerStatsInput[],
  capturedOn: string,
): SnapshotRow[] {
  const eligible = players.filter(isRankingEligible)
  return rankPlayersBy(eligible, 'score').map((p) => ({
    player_id: p.id,
    game_id: null,
    rank: p.rank,
    metric_value: p.sxScore,
    captured_on: capturedOn,
  }))
}

// Per-game board: wins in that game. SX Score is a single global figure, so
// ranking a game tab by it would reproduce the global order exactly. Ties break
// on SX Score then player id, so the order never depends on input order.
export function buildGameSnapshotRows(
  entries: GameWinEntry[],
  gameId: string,
  capturedOn: string,
): SnapshotRow[] {
  return entries
    .filter((e) => e.wins > 0)
    .slice()
    .sort((a, b) => b.wins - a.wins || b.sxScore - a.sxScore || a.playerId.localeCompare(b.playerId))
    .map((e, i) => ({
      player_id: e.playerId,
      game_id: gameId,
      rank: i + 1,
      metric_value: e.wins,
      captured_on: capturedOn,
    }))
}
```

- [ ] **Step 4: Run and verify it passes**

Run: `npx vitest run lib/rankings/snapshot.test.ts`
Expected: PASS

- [ ] **Step 5: Confirm the shared ranking suite still passes**

Run: `npx vitest run lib/rankings`
Expected: PASS — `leaderboard` and `game-breakdown` unchanged.

- [ ] **Step 6: Commit**

```bash
git add lib/rankings/snapshot.ts lib/rankings/snapshot.test.ts
git commit -m "feat(rankings): build daily rank snapshot rows per scope"
```

---

### Task 4: Cron route

**Files:**
- Create: `app/api/cron/snapshot-ranks/route.ts`

**Interfaces:**
- Consumes: `buildGlobalSnapshotRows`, `buildGameSnapshotRows` (Task 3);
  `createAdminClient` from `@/lib/supabase/admin`.

- [ ] **Step 1: Write the route**

Mirror `app/api/cron/fixture-reminders/route.ts` exactly: `POST`, a
`CRON_SECRET` bearer check returning 401 when absent or wrong, then the
service-role client.

Per run:

1. Load ranking-eligible profiles with the same columns the rankings page
   selects, plus the completed matches needed to build `gameStats` via the
   existing `winsByPlayerAndGame` / `scoreStatsByPlayerAndGame` helpers.
2. Compute `capturedOn` as today's date in **WAT**, using the existing date
   helpers in `lib/format.ts` — the platform's day boundary is Lagos, not UTC,
   so a run just after midnight WAT must stamp the new day.
3. Build the global rows, then the rows for each game that has at least one
   completed match.
4. Upsert all rows. Because the unique indexes are partial, upsert the global
   rows on `(player_id, captured_on)` and the per-game rows on
   `(player_id, game_id, captured_on)` — two calls, not one.
5. Return `{ ok: true, capturedOn, global: n, games: m, rows: total }`.

- [ ] **Step 2: Typecheck, lint, build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: all clean.

- [ ] **Step 3: Verify it writes, and is idempotent**

With the dev server running and `CRON_SECRET` set locally:

```bash
curl -s -X POST -H "authorization: Bearer $CRON_SECRET" http://localhost:3222/api/cron/snapshot-ranks
```

Confirm rows appear in `player_rank_snapshots` (query via Supabase MCP), then
call it a second time and confirm the row count is **unchanged** — the upsert
must not duplicate.

Also confirm an unauthenticated call returns 401.

- [ ] **Step 4: Commit**

```bash
git add app/api/cron/snapshot-ranks/route.ts
git commit -m "feat(rankings): daily rank snapshot cron route"
```

---

## Verification before completion

- [ ] `npx vitest run lib/rankings` — all pass
- [ ] `npx tsc --noEmit` — clean
- [ ] `npm run lint` — clean
- [ ] `npm run build` — clean
- [ ] Cron route writes rows; a second call adds none
- [ ] Unauthenticated call returns 401
- [ ] `git diff origin/main --stat` touches no file outside this plan
- [ ] Tell the user the schedule still needs wiring outside the repo
