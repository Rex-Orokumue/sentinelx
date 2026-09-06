# Leaderboard Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the eleven gaps between `/rankings` and
`public/visual_bible/leaderboard_page.jpeg`, using the rank history shipped in
Part 1 to make the Trend column real.

**Architecture:** Three new pure modules (streak, pagination, game chips) unit
tested first; per-game tabs replacing category tabs; a widened table; a filters
card; and page wiring that reads `player_rank_snapshots`.

**Tech Stack:** Next.js App Router (server components), TypeScript, Tailwind
`sx` tokens, `lucide-react`, Supabase, vitest.

**Spec:** `docs/superpowers/specs/2026-09-06-leaderboard-page-design.md`

**Note on code blocks:** Tasks 1–3 carry full test and implementation code.
Presentational tasks specify columns, props, copy and responsive rules rather
than verbatim JSX; the mockup and the existing components are the styling truth.

## Global Constraints

- Worktree `C:\Users\gorok\Videos\sentinelx-champions`, branch
  `feat/leaderboard-page`. The primary checkout belongs to another agent.
- Before every commit: `git status -sb` and `git diff --cached --name-only`.
- Mobile-first; verify no horizontal overflow at 360px before finishing.
- Every figure on the page comes from real data. No invented numbers.
- `lib/rankings/trend.ts` and `lib/rankings/snapshot.ts` are Part 1 — consumed,
  never modified.
- Run tests scoped: `npx vitest run lib/rankings`.
- Commits end with the Co-Authored-By and Claude-Session trailers.

---

### Task 1: Longest win streak

**Files:** Create `lib/rankings/streak.ts`, `lib/rankings/streak.test.ts`

**Interfaces:**
- Consumes: `matchWinnerId`, `type AdvanceMatch` from `@/lib/tournaments/advancement`.
- Produces: `longestWinStreakByPlayer(matches: StreakMatch[]): Map<string, number>`
  where `StreakMatch = AdvanceMatch & { completed_at: string | null }`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/rankings/streak.test.ts
import { describe, it, expect } from 'vitest'
import { longestWinStreakByPlayer, type StreakMatch } from './streak'

const m = (a: string, b: string, sa: number, sb: number, at: string): StreakMatch => ({
  status: 'completed',
  score_a: sa,
  score_b: sb,
  player_a_id: a,
  player_b_id: b,
  completed_at: at,
})

describe('longestWinStreakByPlayer', () => {
  it('is empty with no matches', () => {
    expect(longestWinStreakByPlayer([]).size).toBe(0)
  })

  it('counts a run of consecutive wins', () => {
    const map = longestWinStreakByPlayer([
      m('x', 'y', 1, 0, '2026-01-01'),
      m('x', 'z', 2, 0, '2026-01-02'),
      m('x', 'w', 3, 0, '2026-01-03'),
    ])
    expect(map.get('x')).toBe(3)
  })

  it('breaks the run on a loss and keeps the longest', () => {
    const map = longestWinStreakByPlayer([
      m('x', 'y', 1, 0, '2026-01-01'),
      m('x', 'z', 2, 0, '2026-01-02'),
      m('x', 'w', 0, 1, '2026-01-03'), // loss
      m('x', 'v', 1, 0, '2026-01-04'),
    ])
    expect(map.get('x')).toBe(2)
  })

  it('breaks the run on a draw', () => {
    const map = longestWinStreakByPlayer([
      m('x', 'y', 1, 0, '2026-01-01'),
      m('x', 'z', 1, 1, '2026-01-02'), // draw
      m('x', 'w', 1, 0, '2026-01-03'),
    ])
    expect(map.get('x')).toBe(1)
  })

  it('counts wins from either side of the fixture', () => {
    const map = longestWinStreakByPlayer([
      m('y', 'x', 0, 1, '2026-01-01'),
      m('x', 'z', 5, 0, '2026-01-02'),
    ])
    expect(map.get('x')).toBe(2)
  })

  it('orders by completion time, not array order', () => {
    const map = longestWinStreakByPlayer([
      m('x', 'w', 1, 0, '2026-01-04'),
      m('x', 'y', 1, 0, '2026-01-01'),
      m('x', 'z', 0, 1, '2026-01-02'), // loss between them
    ])
    expect(map.get('x')).toBe(1)
  })

  it('tracks each player independently', () => {
    const map = longestWinStreakByPlayer([
      m('x', 'y', 1, 0, '2026-01-01'),
      m('x', 'y', 1, 0, '2026-01-02'),
      m('y', 'z', 1, 0, '2026-01-03'),
    ])
    expect(map.get('x')).toBe(2)
    expect(map.get('y')).toBe(1)
  })
})
```

- [ ] **Step 2: Run and verify it fails**

Run: `npx vitest run lib/rankings/streak.test.ts` — FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// lib/rankings/streak.ts
import { matchWinnerId, type AdvanceMatch } from '@/lib/tournaments/advancement'

export type StreakMatch = AdvanceMatch & { completed_at: string | null }

// Longest run of consecutive wins per player, over completed matches in
// chronological order. Draws and losses both break a run — reuses matchWinnerId
// so "who won" has one implementation, as lib/achievements/unlock.ts does.
export function longestWinStreakByPlayer(matches: StreakMatch[]): Map<string, number> {
  const ordered = [...matches].sort((a, b) =>
    (a.completed_at ?? '').localeCompare(b.completed_at ?? ''),
  )

  const best = new Map<string, number>()
  const running = new Map<string, number>()

  for (const match of ordered) {
    const winner = matchWinnerId(match)
    for (const id of [match.player_a_id, match.player_b_id]) {
      if (!id) continue
      const next = id === winner ? (running.get(id) ?? 0) + 1 : 0
      running.set(id, next)
      if (next > (best.get(id) ?? 0)) best.set(id, next)
    }
  }

  return best
}
```

- [ ] **Step 4: Run and verify it passes**
- [ ] **Step 5: Commit**

```bash
git add lib/rankings/streak.ts lib/rankings/streak.test.ts
git commit -m "feat(rankings): longest win streak per player"
```

---

### Task 2: Pagination

**Files:** Create `lib/rankings/pagination.ts`, `lib/rankings/pagination.test.ts`

**Interfaces:**
- Produces: `PageInfo` = `{ page: number; totalPages: number; from: number; to: number; total: number; startIndex: number; endIndex: number }`
  and `paginate(total: number, page: number, perPage?: number): PageInfo`,
  plus `PAGE_SIZE = 10`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/rankings/pagination.test.ts
import { describe, it, expect } from 'vitest'
import { paginate, PAGE_SIZE } from './pagination'

describe('paginate', () => {
  it('describes the first page', () => {
    expect(paginate(1482, 1)).toMatchObject({ page: 1, from: 1, to: 10, total: 1482, totalPages: 149 })
  })

  it('describes a middle page', () => {
    expect(paginate(1482, 3)).toMatchObject({ page: 3, from: 21, to: 30 })
  })

  it('caps the last page to the real total', () => {
    expect(paginate(1482, 149)).toMatchObject({ page: 149, from: 1481, to: 1482 })
  })

  it('clamps a page beyond the end', () => {
    expect(paginate(25, 99).page).toBe(3)
  })

  it('clamps a page below one', () => {
    expect(paginate(25, 0).page).toBe(1)
    expect(paginate(25, -5).page).toBe(1)
  })

  it('handles an empty list without going to page zero', () => {
    expect(paginate(0, 1)).toMatchObject({ page: 1, totalPages: 1, from: 0, to: 0, total: 0 })
  })

  it('exposes slice indices matching from/to', () => {
    const p = paginate(25, 2)
    expect(p.startIndex).toBe(10)
    expect(p.endIndex).toBe(20)
  })

  it('defaults to ten per page', () => {
    expect(PAGE_SIZE).toBe(10)
  })
})
```

- [ ] **Step 2: Run and verify it fails**

- [ ] **Step 3: Implement**

```ts
// lib/rankings/pagination.ts
export const PAGE_SIZE = 10

export interface PageInfo {
  page: number
  totalPages: number
  /** 1-based, for "Showing {from} to {to} of {total}". 0 when empty. */
  from: number
  to: number
  total: number
  /** 0-based slice bounds. */
  startIndex: number
  endIndex: number
}

// An out-of-range page clamps rather than rendering an empty table — a shared
// or stale ?page= link should land somewhere real.
export function paginate(total: number, page: number, perPage: number = PAGE_SIZE): PageInfo {
  const totalPages = Math.max(1, Math.ceil(total / perPage))
  const safe = Math.min(Math.max(1, Math.trunc(page) || 1), totalPages)
  const startIndex = (safe - 1) * perPage
  const endIndex = Math.min(startIndex + perPage, total)
  return {
    page: safe,
    totalPages,
    from: total === 0 ? 0 : startIndex + 1,
    to: endIndex,
    total,
    startIndex,
    endIndex,
  }
}
```

- [ ] **Step 4: Run and verify it passes**
- [ ] **Step 5: Commit**

```bash
git add lib/rankings/pagination.ts lib/rankings/pagination.test.ts
git commit -m "feat(rankings): leaderboard pagination helper"
```

---

### Task 3: Game chips

**Files:** Create `lib/rankings/game-chips.ts`, `lib/rankings/game-chips.test.ts`

**Interfaces:**
- Consumes: `type GameWinCount` from `./game-breakdown`.
- Produces: `GameChips` = `{ chips: string[]; overflow: number; total: number }`
  and `gameChipsFor(winsByGame: GameWinCount[], max?: number): GameChips`,
  plus `MAX_CHIPS = 4`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/rankings/game-chips.test.ts
import { describe, it, expect } from 'vitest'
import { gameChipsFor, MAX_CHIPS } from './game-chips'

describe('gameChipsFor', () => {
  it('is empty for a player with no games', () => {
    expect(gameChipsFor([])).toEqual({ chips: [], overflow: 0, total: 0 })
  })

  it('orders by wins descending', () => {
    const r = gameChipsFor([
      { game: 'DLS', wins: 2 },
      { game: 'CODM', wins: 9 },
    ])
    expect(r.chips).toEqual(['CODM', 'DLS'])
    expect(r.total).toBe(2)
  })

  it('caps the chips and reports the overflow', () => {
    const r = gameChipsFor([
      { game: 'A', wins: 5 },
      { game: 'B', wins: 4 },
      { game: 'C', wins: 3 },
      { game: 'D', wins: 2 },
      { game: 'E', wins: 1 },
      { game: 'F', wins: 1 },
    ])
    expect(r.chips).toHaveLength(MAX_CHIPS)
    expect(r.overflow).toBe(2)
    expect(r.total).toBe(6)
  })

  it('reports no overflow at exactly the cap', () => {
    const r = gameChipsFor([
      { game: 'A', wins: 1 },
      { game: 'B', wins: 1 },
      { game: 'C', wins: 1 },
      { game: 'D', wins: 1 },
    ])
    expect(r.overflow).toBe(0)
  })

  it('breaks ties on name so the order is stable', () => {
    const r = gameChipsFor([
      { game: 'Zed', wins: 3 },
      { game: 'Alpha', wins: 3 },
    ])
    expect(r.chips).toEqual(['Alpha', 'Zed'])
  })
})
```

- [ ] **Step 2: Run and verify it fails**

- [ ] **Step 3: Implement**

```ts
// lib/rankings/game-chips.ts
import type { GameWinCount } from './game-breakdown'

export const MAX_CHIPS = 4

export interface GameChips {
  chips: string[]
  overflow: number
  total: number
}

// The Games Played cell: the player's games, most-won first, capped so a row
// stays one line. Ties break on name so the order never depends on input order.
export function gameChipsFor(winsByGame: GameWinCount[], max: number = MAX_CHIPS): GameChips {
  const ordered = [...winsByGame].sort(
    (a, b) => b.wins - a.wins || a.game.localeCompare(b.game),
  )
  return {
    chips: ordered.slice(0, max).map((g) => g.game),
    overflow: Math.max(0, ordered.length - max),
    total: ordered.length,
  }
}
```

- [ ] **Step 4: Run and verify it passes**
- [ ] **Step 5: Commit**

```bash
git add lib/rankings/game-chips.ts lib/rankings/game-chips.test.ts
git commit -m "feat(rankings): games-played chip selection"
```

---

### Task 4: kyc_verified on PlayerStatsInput

**Files:**
- Modify: `lib/rankings/leaderboard.ts`, `app/[locale]/(public)/rankings/page.tsx`,
  `app/[locale]/(public)/hall-of-fame/page.tsx`

- [ ] **Step 1: Add the field and update both builders**

Add `kycVerified: boolean` to `PlayerStatsInput`. Add `kyc_verified` to the
profile select in **both** pages and map it. Required, not optional, so a future
call site cannot silently render everyone unverified.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit` — clean. Any error is a call site that must supply the field.

- [ ] **Step 3: Commit**

```bash
git add lib/rankings/leaderboard.ts "app/[locale]/(public)/rankings/page.tsx" "app/[locale]/(public)/hall-of-fame/page.tsx"
git commit -m "feat(rankings): carry kyc_verified on player stats"
```

---

### Task 5: Per-game tabs

**Files:** Modify `components/rankings/LeaderboardTabs.tsx`

- [ ] **Step 1: Replace category tabs with per-game tabs**

Props become `{ players, currentUserId, games, activeGameId, trendByPlayer, page, ... }`
where `games: { id: string; name: string; slug: string }[]` are only games with
at least one completed match.

Tabs: `All Games` plus one per game. Selection is URL-driven (`?game=<slug>`),
server-rendered — drop the `useState` metric toggle and the category rows. Above
six game tabs, the remainder go into a `More` dropdown.

Ordering: All Games ranks by SX Score; a game tab ranks by that game's wins,
using `winsByGame` to find the count.

Remove the metric toggle and the expandable wins row (superseded by the Games
Played column — see the spec).

- [ ] **Step 2: Typecheck and commit**

```bash
git add components/rankings/LeaderboardTabs.tsx
git commit -m "feat(rankings): per-game leaderboard tabs replacing category tabs"
```

---

### Task 6: Table columns

**Files:**
- Create: `components/rankings/GameChips.tsx`, `components/rankings/TrendCell.tsx`
- Modify: `components/rankings/LeaderboardTable.tsx`

- [ ] **Step 1: Build `GameChips` and `TrendCell`**

`GameChips` takes `{ chips, overflow, total }` and renders small bordered pills
plus a `+N` marker and the count, matching the mockup's cell.

`TrendCell` takes a `Trend` and renders green `▲{delta}`, red `▼{delta}`, or a
grey `—` for `flat` and `new`.

- [ ] **Step 2: Rework the table**

Columns: `#` · `Player` · `Games Played` · `SX Score` · `Total Wins` ·
`Win Rate` · `Titles Won` · `Trend`. Drop `GD`.

Player cell gains the country line under the name and a purple `BadgeCheck` when
`kycVerified`. Keep the existing medals and avatar.

Mobile: `Games Played`, `Titles Won`, `Trend` are `hidden lg:table-cell`.

Accept a `trendByPlayer: Map<string, Trend>` prop; a missing entry renders `—`.

- [ ] **Step 3: Pinned viewer row**

Accept `pinnedViewer: RankedPlayer | null`. When present, render one extra row
after the body, separated by a top border and highlighted purple, showing that
player's true rank. The page supplies it only when the viewer is ranked and not
on the current page.

- [ ] **Step 4: Typecheck, then commit**

```bash
git add components/rankings/LeaderboardTable.tsx components/rankings/GameChips.tsx components/rankings/TrendCell.tsx
git commit -m "feat(rankings): leaderboard table columns, chips, trend and pinned row"
```

---

### Task 7: Filters card

**Files:** Create `components/rankings/LeaderboardFilters.tsx`

- [ ] **Step 1: Build it**

A sidebar card headed `FILTERS` with a `Reset` link, containing Region and
Season selects and an `Apply Filters` button. A plain `<form method="get">` so it
is server-rendered and URL-driven, preserving the current `game` and clearing
`page` on apply. Reset links to `/rankings`.

Regions come from distinct non-null `profiles.country`; seasons from `seasons`.
The mockup's "All Games" select is omitted — the tabs already do that.

- [ ] **Step 2: Typecheck and commit**

```bash
git add components/rankings/LeaderboardFilters.tsx
git commit -m "feat(rankings): region and season filters"
```

---

### Task 8: Page wiring

**Files:** Modify `app/[locale]/(public)/rankings/page.tsx`

- [ ] **Step 1: Wire everything**

- `searchParams: { game?: string; page?: string; region?: string; season?: string }`.
- Load the latest `player_rank_snapshots` for the active scope and build
  `trendByPlayer` with `previousRankFor` + `trendFor`.
- Apply region and season filters before ranking.
- Paginate with `paginate(...)`; pass the page slice to the table and the full
  ranked list's viewer entry as `pinnedViewer` when off-page.
- Change the stat label to `Games Included`, counting games with ≥1 completed
  match.
- Add Longest Win Streak to `TopPerformersCard` via `longestWinStreakByPlayer`,
  plus its `View All →` link.
- Render `LeaderboardPagination` under the table with the "Showing X to Y of N
  players" line.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npm run lint && npx vitest run lib/rankings && npm run build`

Then load `/rankings` and confirm: per-game tabs show DLS and EA FC Mobile only;
Games Played chips render; Trend shows `—` (one snapshot day so far); pagination
works and an out-of-range `?page=99` clamps; region/season filters apply.

- [ ] **Step 3: Check 360px**

Confirm `docScrollWidth === 360` on `/rankings` — the table must scroll inside
its own container, not the page.

- [ ] **Step 4: Commit**

---

## Verification before completion

- [ ] `npx vitest run lib/rankings` — all pass
- [ ] `npx tsc --noEmit`, `npm run lint`, `npm run build` — clean
- [ ] `/rankings` at 360px — no horizontal overflow
- [ ] Tabs list only games with completed matches
- [ ] `?page=99` clamps to the last page
- [ ] Pinned row appears only when the viewer is ranked and off-page
- [ ] `git diff origin/main --stat` touches no file outside this plan
