# Rank History (Leaderboard Trend) — Design

**Date:** 2026-09-06
**Part 1 of 2.** Part 2 is the leaderboard page rebuild against
`public/visual_bible/leaderboard_page.jpeg`; it consumes this and degrades
gracefully without it.

## The problem

The leaderboard mockup shows a **Trend** column — `▲12`, `▼2`, `—` — describing
how far a player has moved since last time. Nothing in the schema records where
anyone ranked previously. Rank is computed on every request by `rankPlayersBy`
and immediately discarded, so there is nothing to compare today against.

Trend cannot be derived from existing data. It needs history, and history has to
start being recorded before it can be shown.

## Goal

Record each player's rank periodically, and expose a pure helper that turns
"rank now" plus "rank last time" into the arrow and number the table renders.

## Scope

In scope: the snapshot table, the job that writes it, and the trend helper.

Out of scope: the leaderboard page itself (Part 2), and any UI. This part ships
as data plus one tested function.

## Storage

Migration `078_player_rank_snapshots.sql`:

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `player_id` | `uuid` | FK → `profiles(id)` on delete cascade |
| `game_id` | `uuid` | FK → `games(id)`; **NULL means the global, all-games board** |
| `rank` | `integer` | 1-based, as the ranking function produced it |
| `metric_value` | `integer` | the value the rank was produced from — SX Score for the global scope, wins-in-that-game for a game scope — kept for auditing |
| `captured_on` | `date` | the day the snapshot represents |
| `created_at` | `timestamptz` | default `now()` |

Uniqueness is one row per player, per scope, per day. Postgres treats NULLs as
distinct, so a single unique constraint over a nullable `game_id` would not
prevent duplicate global rows. Two partial unique indexes instead:

```sql
CREATE UNIQUE INDEX player_rank_snapshots_global_uniq
  ON public.player_rank_snapshots (player_id, captured_on)
  WHERE game_id IS NULL;

CREATE UNIQUE INDEX player_rank_snapshots_game_uniq
  ON public.player_rank_snapshots (player_id, game_id, captured_on)
  WHERE game_id IS NOT NULL;
```

Plus a read index for the trend lookup:

```sql
CREATE INDEX player_rank_snapshots_lookup
  ON public.player_rank_snapshots (player_id, game_id, captured_on DESC);
```

**RLS:** the leaderboard is public, so snapshots are publicly readable. No
INSERT/UPDATE/DELETE policies — writes happen only through the service-role
client in the cron route, which bypasses RLS. This matches how
`marketplace_orders` is handled.

**Retention:** none. At ~100 ranked players across three scopes this is roughly
100k rows a year, which Postgres does not notice. If it ever matters, pruning
past 90 days is a one-line delete; deliberately not built now.

## Capture

New route `app/api/cron/snapshot-ranks/route.ts`, following the four existing
cron routes exactly: `CRON_SECRET` bearer check, service-role client, JSON
result.

Per run:

1. Load ranking-eligible profiles — the same `RANKING_MIN_MATCHES` gate the
   rankings page uses, so a player appears in history exactly when they appear
   on the board.
2. Rank them with **`rankPlayersBy(players, 'score')`** — SX Score, because that
   is what the leaderboard ranks by ("Players are ranked by their total SX Score
   across all games they compete in").
3. Write the global scope (`game_id = NULL`), then one scope per game that has
   at least one completed match.
4. Upsert on the day's key so a re-run is idempotent and a retry cannot create
   duplicates.

### What "rank" means per scope

**Global** ranks by SX Score, matching the page's own statement that players are
ranked by total SX Score across all games.

**Per game** cannot use SX Score. SX Score is a single global figure on
`profiles` — there is no per-game SX Score — so ranking a game's tab by it would
reproduce the global order exactly and the tab would be meaningless. Per-game
scopes therefore rank by **wins within that game**, from the existing
`winsByPlayerAndGame` helper, with the same tie-break cascade. That is the only
genuine per-game signal the schema carries.

This is a forced consequence of the data, not a preference: if per-game boards
should rank by something else, the honest options are to add a per-game score to
the schema (a much larger change) or to accept wins.

The job is the only writer. It never modifies ranks, scores or profiles — it
only records what the ranking functions already return.

### The schedule is not in this repo

There is **no `vercel.json`**; the four existing cron routes are triggered by
something configured outside the codebase. This change adds the endpoint and its
secret check, but **the schedule must be wired wherever the others are** — a
daily run is the intended cadence. Until that is done the endpoint is reachable
but never fires, no history accumulates, and Trend renders `—` everywhere. This
is a deployment step the repo cannot perform for itself, and it is the one part
of this design that is not self-contained.

## Trend helper

`lib/rankings/trend.ts`, pure and unit-tested:

```ts
export type TrendDirection = 'up' | 'down' | 'flat' | 'new'

export interface Trend {
  direction: TrendDirection
  delta: number   // places moved, always >= 0
}

export function trendFor(currentRank: number, previousRank: number | null): Trend
```

Rules:

- `previousRank === null` → `{ direction: 'new', delta: 0 }`. A player with no
  earlier snapshot has not "risen"; the table renders `—`, matching row 6 of the
  mockup.
- `previousRank > currentRank` → `up`, delta = the difference. **Rank 1 is
  better than rank 12**, so moving from 12 to 1 is `up` by 11 — the comparison
  is deliberately inverted relative to the raw numbers, which is the easiest
  thing to get backwards here.
- `previousRank < currentRank` → `down`.
- Equal → `flat`, delta 0.

A companion `previousRankFor(snapshots, playerId, gameId)` selects the most
recent snapshot **strictly older than today** for that scope, so a second run on
the same day compares against yesterday rather than against itself.

## Testing

Unit tests first (vitest):

- `trendFor` — new player; moved up; moved down; unchanged; the 12→1 inversion;
  delta never negative.
- `previousRankFor` — picks the newest snapshot older than today; ignores
  today's own row; ignores other players; ignores other scopes; returns null
  when there is no history.
- Snapshot row building — one row per eligible player per scope; global rows
  carry `game_id = null`; ineligible players are excluded.

The cron route is verified by calling it locally with the secret and confirming
rows appear, then calling it again and confirming the count does not change
(idempotency).

## Files

**New**

- `supabase/migrations/078_player_rank_snapshots.sql`
- `app/api/cron/snapshot-ranks/route.ts`
- `lib/rankings/trend.ts` + `lib/rankings/trend.test.ts`
- `lib/rankings/snapshot.ts` + `lib/rankings/snapshot.test.ts` — the pure
  row-building logic the route calls, kept out of the route so it is testable

**Changed**

- `lib/supabase/types.ts` — regenerated

Nothing existing changes behaviour. `rankPlayersBy` is read, never modified.
