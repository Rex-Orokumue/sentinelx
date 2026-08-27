# FC Mobile Competition Structure — Discovery UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make FC Mobile visible where DLS already is — `/seasons` becomes
game-grouped, and Rankings/Hall of Fame gain a per-game sub-filter so FC
Mobile's football stats no longer silently blend into DLS's.

**Architecture:** Purely additive, no schema changes. `lib/rankings/
game-breakdown.ts` gains a game-scoped sibling to its existing
category-scoped aggregation (same shape, different filter column) — nothing
about the category-level "All Football" view changes. `/seasons` fetches
one view-model per active game up front (cheap — same query shapes already
used for DLS, just looped) and hands them to a new client tab switcher. A
small new per-game copy config (`lib/games/season-tier-labels.ts`) replaces
the hardcoded "Community Club"/"Masters"/Champions-Cup text that was
previously safe to hardcode because only one game existed.

**Tech Stack:** Next.js 14 (App Router) Server Components + one new client
tab component, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-27-fc-mobile-competition-structure-design.md`
§6-§7 (this plan implements those two sections; §1-§5 already shipped —
see `docs/superpowers/plans/2026-08-27-fc-mobile-competition-structure-core.md`).

## Global Constraints

- Zero DB schema changes — every new grouping/label lives in application
  code, mirroring how `CATEGORY_META` (`lib/games/categories.ts`) is
  already a code-level constant, not a table.
- The existing category-level views ("All Football" Goals tab, "All
  Football" Golden Boot) must render byte-for-byte identically to today —
  the per-game filter is additive, never a replacement default.
- A per-game sub-filter only appears when its category/section actually has
  2+ active games — a category with exactly one active game (fighting,
  shooter, racing today) shows no sub-filter at all, matching current
  behavior exactly.
- New per-game season-tier copy (`lib/games/season-tier-labels.ts`) is
  keyed by game **slug** (stable, already used for the `'dls'`/
  `'ea-fc-mobile'` lookups added in the core plan), with a generic fallback
  for any future game not yet given its own entry.

---

### Task 1: Game-scoped stat aggregation — `scoreStatsByPlayerAndGame` + `gameStat`

**Files:**
- Modify: `lib/rankings/game-breakdown.ts`
- Modify: `lib/rankings/game-breakdown.test.ts`

**Interfaces:**
- Produces: `GameScopedMatch.game_id: string` (new field, alongside the
  existing `game_name`/`game_category`); `GameStat { gameId: string;
  scored: number; conceded: number }`; `scoreStatsByPlayerAndGame(matches:
  GameScopedMatch[], gameId: string): Map<string, {scored, conceded}>`;
  `gameStat(stats: GameStat[], gameId: string): GameStat`. Consumed by
  Task 2 (`PlayerStatsInput.gameStats`) and Task 5/6 (page-level wiring).

- [ ] **Step 1: Write the failing tests**

Append to `lib/rankings/game-breakdown.test.ts` (its `m()` fixture needs
`game_id` added first):

```typescript
function m(over: Partial<GameScopedMatch>): GameScopedMatch {
  return {
    status: 'completed',
    score_a: 2,
    score_b: 1,
    player_a_id: 'a',
    player_b_id: 'b',
    game_id: 'dls-id',
    game_name: 'DLS',
    game_category: 'football',
    ...over,
  }
}

describe('scoreStatsByPlayerAndGame', () => {
  it('sums scored and conceded for both players, scoped to the given game', () => {
    const r = scoreStatsByPlayerAndGame(
      [m({ score_a: 3, score_b: 1, game_id: 'fc-mobile-id' })],
      'fc-mobile-id',
    )
    expect(r.get('a')).toEqual({ scored: 3, conceded: 1 })
    expect(r.get('b')).toEqual({ scored: 1, conceded: 3 })
  })

  it('excludes matches from a different game, even in the same category', () => {
    const r = scoreStatsByPlayerAndGame(
      [m({ game_id: 'dls-id', game_category: 'football', score_a: 5, score_b: 5 })],
      'fc-mobile-id',
    )
    expect(r.size).toBe(0)
  })

  it('excludes non-completed matches', () => {
    const r = scoreStatsByPlayerAndGame([m({ status: 'scheduled' })], 'dls-id')
    expect(r.size).toBe(0)
  })

  it('returns an empty map for no matches', () => {
    expect(scoreStatsByPlayerAndGame([], 'dls-id').size).toBe(0)
  })
})

describe('gameStat', () => {
  it('returns the matching entry', () => {
    const stats = [
      { gameId: 'dls-id', scored: 4, conceded: 2 },
      { gameId: 'fc-mobile-id', scored: 9, conceded: 3 },
    ]
    expect(gameStat(stats, 'fc-mobile-id')).toEqual({ gameId: 'fc-mobile-id', scored: 9, conceded: 3 })
  })

  it('returns a zero-default when the gameId is absent', () => {
    expect(gameStat([], 'dls-id')).toEqual({ gameId: 'dls-id', scored: 0, conceded: 0 })
  })
})
```

Add `scoreStatsByPlayerAndGame` and `gameStat` to the import list at the
top of the test file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/rankings/game-breakdown.test.ts`
Expected: FAIL — neither function exists yet, and `GameScopedMatch` has no
`game_id` field (the `m()` fixture change alone won't compile/fail
gracefully — accept either a type error surfaced as a test failure or an
explicit "not a function" error).

- [ ] **Step 3: Implement**

In `lib/rankings/game-breakdown.ts`, add `game_id: string` to
`GameScopedMatch`:

```typescript
export interface GameScopedMatch extends AdvanceMatch {
  game_id: string
  game_name: string
  game_category: string
}
```

Add, after `scoreStatsByPlayerAndCategory`:

```typescript
// Same aggregation as scoreStatsByPlayerAndCategory, scoped to one game_id
// instead of one category — lets a category with 2+ active games (e.g.
// football: DLS + EA FC Mobile) be narrowed to a single game's numbers
// without touching the category-wide aggregate at all.
export function scoreStatsByPlayerAndGame(
  matches: GameScopedMatch[],
  gameId: string,
): Map<string, { scored: number; conceded: number }> {
  const result = new Map<string, { scored: number; conceded: number }>()
  for (const match of matches) {
    if (match.game_id !== gameId) continue
    if (match.status !== 'completed') continue
    if (match.score_a == null || match.score_b == null) continue
    if (!match.player_a_id || !match.player_b_id) continue

    const a = result.get(match.player_a_id) ?? { scored: 0, conceded: 0 }
    a.scored += match.score_a
    a.conceded += match.score_b
    result.set(match.player_a_id, a)

    const b = result.get(match.player_b_id) ?? { scored: 0, conceded: 0 }
    b.scored += match.score_b
    b.conceded += match.score_a
    result.set(match.player_b_id, b)
  }
  return result
}

export interface GameStat {
  gameId: string
  scored: number
  conceded: number
}

export function gameStat(stats: GameStat[], gameId: string): GameStat {
  return stats.find((s) => s.gameId === gameId) ?? { gameId, scored: 0, conceded: 0 }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/rankings/game-breakdown.test.ts`
Expected: PASS (all cases, including the pre-existing ones — confirm none
regressed from the `game_id` field addition).

- [ ] **Step 5: Commit**

```bash
git add lib/rankings/game-breakdown.ts lib/rankings/game-breakdown.test.ts
git commit -m "feat(rankings): game-scoped stat aggregation alongside the existing category one"
```

---

### Task 2: `PlayerStatsInput.gameStats` + per-game ranking

**Files:**
- Modify: `lib/rankings/leaderboard.ts`
- Modify: `lib/rankings/leaderboard.test.ts`

**Interfaces:**
- Consumes: `GameStat`, `gameStat()` (Task 1).
- Produces: `PlayerStatsInput.gameStats: GameStat[]`; `rankPlayersBy(players,
  metric, gameId?: string): RankedPlayer[]` — when `gameId` is given and
  `metric` is a category metric (`football`/`fighting`/`shooter`), ranks by
  that game's `gameStat(...).scored` instead of the category-wide stat.
  Consumed by Task 5 (Rankings page + `LeaderboardTabs`).

- [ ] **Step 1: Write the failing tests**

Add `gameStats: []` to the existing `p()` fixture in
`lib/rankings/leaderboard.test.ts` (required now that the interface has a
new field), then append:

```typescript
describe('rankPlayersBy — per-game', () => {
  it('sorts by a single game\'s stat when gameId is given, ignoring the category-wide stat', () => {
    const r = rankPlayersBy(
      [
        p({
          id: 'a',
          categoryStats: [{ category: 'football', scored: 100, conceded: 0 }], // huge category total...
          gameStats: [{ gameId: 'dls-id', scored: 2, conceded: 0 }], // ...but tiny on this one game
        }),
        p({
          id: 'b',
          categoryStats: [{ category: 'football', scored: 1, conceded: 0 }],
          gameStats: [{ gameId: 'dls-id', scored: 9, conceded: 0 }],
        }),
      ],
      'football',
      'dls-id',
    )
    expect(r.map((x) => x.id)).toEqual(['b', 'a'])
  })

  it('falls back to the category-wide stat when gameId is omitted (unchanged behavior)', () => {
    const players = [
      p({ id: 'a', categoryStats: [{ category: 'football', scored: 4, conceded: 0 }] }),
      p({ id: 'b', categoryStats: [{ category: 'football', scored: 20, conceded: 0 }] }),
    ]
    expect(rankPlayersBy(players, 'football').map((x) => x.id)).toEqual(
      rankPlayersBy(players, 'football', undefined).map((x) => x.id),
    )
    expect(rankPlayersBy(players, 'football').map((x) => x.id)).toEqual(['b', 'a'])
  })

  it('ignores gameId for non-category metrics (wins/score)', () => {
    const r = rankPlayersBy(
      [p({ id: 'a', wins: 3, gameStats: [{ gameId: 'x', scored: 99, conceded: 0 }] }), p({ id: 'b', wins: 7 })],
      'wins',
      'x',
    )
    expect(r.map((x) => x.id)).toEqual(['b', 'a'])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/rankings/leaderboard.test.ts`
Expected: FAIL — `gameStats` isn't a recognized field / `rankPlayersBy`
ignores its third argument entirely today.

- [ ] **Step 3: Implement**

In `lib/rankings/leaderboard.ts`, update the imports and interface:

```typescript
import type { GameWinCount, CategoryStat, GameStat } from './game-breakdown'
import { categoryStat, gameStat } from './game-breakdown'
```

Add to `PlayerStatsInput` (alongside `categoryStats`):

```typescript
  // Per-game live aggregate (see lib/rankings/game-breakdown.ts) — a
  // sibling to categoryStats, scoped to one game_id instead of one
  // category. Only meaningful for categories with 2+ active games; empty
  // for every other category today.
  gameStats: GameStat[]
```

Change `rankPlayersBy`'s signature and body:

```typescript
export function rankPlayersBy(
  players: PlayerStatsInput[],
  metric: LeaderboardMetric,
  gameId?: string,
): RankedPlayer[] {
  const isCategoryMetric = metric === 'football' || metric === 'fighting' || metric === 'shooter'
  const lead: (p: PlayerStatsInput) => number =
    gameId && isCategoryMetric ? (p) => gameStat(p.gameStats, gameId).scored : METRIC_VALUE[metric]
  return players
```

(The rest of the function body — the `.map(...).sort(...).map(...)` chain
— is unchanged; only how `lead` is resolved changes.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/rankings/leaderboard.test.ts`
Expected: PASS.

- [ ] **Step 5: Fix the now-broken fixture in `lib/hall-of-fame/awards.test.ts`**

That file has its own local `p()` fixture (does not import
`leaderboard.test.ts`'s) — add `gameStats: []` to it too, in the same spot
`categoryStats: []`/`winsByGame: []` already sit.

- [ ] **Step 6: Run the full test suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS, no type errors (every existing `PlayerStatsInput` literal
across the codebase — pages included — now needs a `gameStats` field; the
compiler will point at each one directly).

- [ ] **Step 7: Commit**

```bash
git add lib/rankings/leaderboard.ts lib/rankings/leaderboard.test.ts lib/hall-of-fame/awards.test.ts
git commit -m "feat(rankings): PlayerStatsInput.gameStats + per-game rankPlayersBy"
```

---

### Task 3: `pickGameAward` — per-game Hall of Fame award winner

**Files:**
- Modify: `lib/hall-of-fame/awards.ts`
- Modify: `lib/hall-of-fame/awards.test.ts`

**Interfaces:**
- Consumes: `gameStat()` (Task 1), `PlayerStatsInput.gameStats` (Task 2).
- Produces: `pickGameAward(players: PlayerStatsInput[], gameId: string):
  PlayerStatsInput | null` — same eligibility/tie-break/null-when-nobody-
  scored rules as `pickCategoryAward`, scoped to one game. Consumed by
  Task 6 (Hall of Fame page).

- [ ] **Step 1: Write the failing tests**

Append to `lib/hall-of-fame/awards.test.ts`:

```typescript
describe('pickGameAward', () => {
  it('returns the top scorer for the given game, ignoring other games\' totals', () => {
    const winner = pickGameAward(
      [
        p({ id: 'a', totalMatches: 3, gameStats: [{ gameId: 'dls-id', scored: 50, conceded: 0 }] }),
        p({ id: 'b', totalMatches: 3, gameStats: [{ gameId: 'dls-id', scored: 12, conceded: 0 }, { gameId: 'fcm-id', scored: 99, conceded: 0 }] }),
      ],
      'dls-id',
    )
    expect(winner?.id).toBe('a')
  })

  it('returns null when nobody has scored in that game', () => {
    expect(
      pickGameAward([p({ id: 'a', totalMatches: 3, wins: 5, gameStats: [] })], 'dls-id'),
    ).toBeNull()
  })

  it('excludes ineligible (zero-match) players', () => {
    expect(
      pickGameAward([p({ id: 'a', totalMatches: 0, gameStats: [{ gameId: 'dls-id', scored: 99, conceded: 0 }] })], 'dls-id'),
    ).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/hall-of-fame/awards.test.ts`
Expected: FAIL — `pickGameAward` is not exported.

- [ ] **Step 3: Implement**

In `lib/hall-of-fame/awards.ts`, add the import and function:

```typescript
import { categoryStat, gameStat } from '@/lib/rankings/game-breakdown'
```

(Replaces the existing `import { categoryStat } from ...` line — same
module, one more named import.)

```typescript
// Same rule as pickCategoryAward, scoped to one game instead of one
// category — the per-game Hall of Fame filter (a category with 2+ active
// games gets one of these per game, alongside the existing "All X" award).
export function pickGameAward(players: PlayerStatsInput[], gameId: string): PlayerStatsInput | null {
  const eligible = players.filter(isRankingEligible)
  if (eligible.length === 0) return null
  const ranked = [...eligible].sort(
    (a, b) => gameStat(b.gameStats, gameId).scored - gameStat(a.gameStats, gameId).scored || b.wins - a.wins,
  )
  const top = ranked[0]
  return gameStat(top.gameStats, gameId).scored > 0 ? top : null
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/hall-of-fame/awards.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/hall-of-fame/awards.ts lib/hall-of-fame/awards.test.ts
git commit -m "feat(hall-of-fame): pickGameAward for the per-game award filter"
```

---

### Task 4: Season tier labels config

**Files:**
- Create: `lib/games/season-tier-labels.ts`
- Create: `lib/games/season-tier-labels.test.ts`

**Interfaces:**
- Produces: `SeasonTierLabels { communityClub: string; masters: string;
  qualificationNote: string; showChampionsCupSpotlight: boolean }`;
  `seasonTierLabelsFor(gameSlug: string): SeasonTierLabels`. Consumed by
  Task 9 (`/seasons` page).

- [ ] **Step 1: Write the failing test**

```typescript
// lib/games/season-tier-labels.test.ts
import { describe, it, expect } from 'vitest'
import { seasonTierLabelsFor } from './season-tier-labels'

describe('seasonTierLabelsFor', () => {
  it('returns DLS\'s own labels, including the Champions Cup spotlight', () => {
    const labels = seasonTierLabelsFor('dls')
    expect(labels.communityClub).toBe('Community Clubs')
    expect(labels.masters).toBe('Masters')
    expect(labels.showChampionsCupSpotlight).toBe(true)
  })

  it('returns FC Mobile\'s own labels, with no Champions Cup spotlight', () => {
    const labels = seasonTierLabelsFor('ea-fc-mobile')
    expect(labels.communityClub).toBe('Circuit Cups')
    expect(labels.masters).toBe('Elite Cups')
    expect(labels.showChampionsCupSpotlight).toBe(false)
  })

  it('falls back to generic labels for an unlisted game slug', () => {
    const labels = seasonTierLabelsFor('some-future-game')
    expect(labels.showChampionsCupSpotlight).toBe(false)
    expect(labels.communityClub.length).toBeGreaterThan(0)
    expect(labels.masters.length).toBeGreaterThan(0)
    expect(labels.qualificationNote.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/games/season-tier-labels.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement**

```typescript
// lib/games/season-tier-labels.ts
// Season-page copy that was previously safe to hardcode into SeasonHero/
// SeasonLeaderboardTable/ChampionsCupSpotlight because only DLS existed.
// Keyed by game slug (stable — already used for the DLS/FC-Mobile
// game_id lookups in lib/seasons and app pages), same code-level-constant
// pattern as CATEGORY_META (lib/games/categories.ts), not a DB table:
// tournament.title stays the source of truth for any single tournament's
// name, this is only for the season page's aggregate copy.
export interface SeasonTierLabels {
  /** Pluralized — always used as "{n} {communityClub} completed". */
  communityClub: string
  /** Pluralized — always used as "{n} {masters} completed". */
  masters: string
  /** Shown under the season leaderboard table. */
  qualificationNote: string
  /** Whether this game has a season finale worth its own spotlight section. */
  showChampionsCupSpotlight: boolean
}

const SEASON_TIER_LABELS: Record<string, SeasonTierLabels> = {
  dls: {
    communityClub: 'Community Clubs',
    masters: 'Masters',
    qualificationNote: 'Qualify for Champions Cup — top 16 at season end earn an invitation.',
    showChampionsCupSpotlight: true,
  },
  'ea-fc-mobile': {
    communityClub: 'Circuit Cups',
    masters: 'Elite Cups',
    qualificationNote: 'Top 16 monthly Circuit Cup points earn an Elite Cup invitation.',
    showChampionsCupSpotlight: false,
  },
}

const DEFAULT_SEASON_TIER_LABELS: SeasonTierLabels = {
  communityClub: 'Community Tournaments',
  masters: 'Masters',
  qualificationNote: 'Top ranked players earn an invitation to the next tier.',
  showChampionsCupSpotlight: false,
}

export function seasonTierLabelsFor(gameSlug: string): SeasonTierLabels {
  return SEASON_TIER_LABELS[gameSlug] ?? DEFAULT_SEASON_TIER_LABELS
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/games/season-tier-labels.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/games/season-tier-labels.ts lib/games/season-tier-labels.test.ts
git commit -m "feat(seasons): per-game season-tier copy config"
```

---

### Task 5: Rankings page + `LeaderboardTabs` per-game sub-filter

**Files:**
- Modify: `app/[locale]/(public)/rankings/page.tsx`
- Modify: `components/rankings/LeaderboardTabs.tsx`

**Interfaces:**
- Consumes: `scoreStatsByPlayerAndGame` (Task 1), `PlayerStatsInput.gameStats`
  + `rankPlayersBy(players, metric, gameId?)` (Task 2).
- Produces: `LeaderboardTabs` gains an `activeGames: {id, name, category}[]`
  prop; renders a per-game sub-filter row under the tab strip whenever the
  selected tab's category has 2+ entries in `activeGames`.

- [ ] **Step 1: Fetch full active-game rows and compute `gameStats`**

In `app/[locale]/(public)/rankings/page.tsx`, change:

```typescript
    supabase.from('games').select('category').eq('active', true),
```

to:

```typescript
    supabase.from('games').select('id, name, category').eq('active', true),
```

Change the `activeCategories` line and the match-mapping's `game_id` (the
`matches` query already embeds `games(name, category)` — add `id`):

```typescript
    supabase
      .from('matches')
      .select(
        'status, score_a, score_b, player_a_id, player_b_id, tournament:tournaments(game:games(id, name, category))',
      )
      .eq('status', 'completed'),
```

Update `RawGameRef`/`firstGameRef` and the `matches` mapping to carry
`game_id`:

```typescript
type RawGameRef = { id: string; name: string; category: string } | { id: string; name: string; category: string }[] | null
type RawTournamentRef = { game: RawGameRef } | { game: RawGameRef }[] | null

function firstGameRef(g: RawGameRef): { id: string; name: string; category: string } | null {
  return Array.isArray(g) ? g[0] ?? null : g
}
```

```typescript
  const matches: GameScopedMatch[] = rawMatches.map((m) => {
    const t = firstTournamentRef(m.tournament)
    const g = firstGameRef(t?.game ?? null)
    return {
      status: m.status,
      score_a: m.score_a,
      score_b: m.score_b,
      player_a_id: m.player_a_id,
      player_b_id: m.player_b_id,
      game_id: g?.id ?? 'unknown',
      game_name: g?.name ?? 'Unknown',
      game_category: g?.category ?? 'other',
    }
  })
```

Change `activeCategories`'s source (now `activeGames` carries more than
`category`) and add the per-game stat computation right after `winsMap`:

```typescript
  const activeCategories = Array.from(new Set((activeGames ?? []).map((g) => g.category)))
  ...
  const winsMap = winsByPlayerAndGame(matches)
  const categoryMaps = Object.keys(CATEGORY_META).map((category) => ({
    category,
    map: scoreStatsByPlayerAndCategory(matches, category),
  }))
  const gameMaps = (activeGames ?? []).map((g) => ({
    gameId: g.id,
    map: scoreStatsByPlayerAndGame(matches, g.id),
  }))
```

(`activeCategories`'s own line is unchanged in content, just now derived
from the richer `activeGames` rows — no functional difference there.)

Add `import { scoreStatsByPlayerAndGame } from '@/lib/rankings/game-breakdown'`
to the existing import from that module (extend the named-import list, not
a new import line).

Add `gameStats` to the `players` mapping:

```typescript
      categoryStats: categoryMaps.map(({ category, map }) => ({
        category,
        scored: map.get(p.id)?.scored ?? 0,
        conceded: map.get(p.id)?.conceded ?? 0,
      })),
      gameStats: gameMaps.map(({ gameId, map }) => ({
        gameId,
        scored: map.get(p.id)?.scored ?? 0,
        conceded: map.get(p.id)?.conceded ?? 0,
      })),
      winsByGame: winsMap.get(p.id) ?? [],
```

Pass the richer active-games list to `LeaderboardTabs`:

```typescript
          <LeaderboardTabs players={players} currentUserId={user?.id ?? null} activeGames={activeGames ?? []} />
```

(Replaces the existing `activeCategories={activeCategories}` prop —
`LeaderboardTabs` derives `activeCategories` itself from `activeGames` now,
see Step 2. The page-level `activeCategories` constant above still feeds
the `StatItem icon="🎮"` count in the stats bar unchanged — keep that usage
as-is.)

- [ ] **Step 2: Add the per-game sub-filter to `LeaderboardTabs`**

Replace the whole file:

```typescript
'use client'
import { useState } from 'react'
import { LeaderboardTable } from './LeaderboardTable'
import { rankPlayersBy, type PlayerStatsInput, type LeaderboardMetric } from '@/lib/rankings/leaderboard'
import { CATEGORY_META } from '@/lib/games/categories'

const BASE_TABS: { key: LeaderboardMetric; label: string }[] = [
  { key: 'wins', label: 'Wins' },
  { key: 'score', label: 'SX Score' },
]

export interface ActiveGame {
  id: string
  name: string
  category: string
}

export function LeaderboardTabs({
  players,
  currentUserId,
  activeGames,
}: {
  players: PlayerStatsInput[]
  currentUserId: string | null
  activeGames: ActiveGame[]
}) {
  const activeCategories = Array.from(new Set(activeGames.map((g) => g.category)))
  const categoryTabs = activeCategories
    .filter((c) => CATEGORY_META[c] != null)
    .map((c) => ({ key: c as LeaderboardMetric, label: CATEGORY_META[c].statLabel }))
  const tabs = [...BASE_TABS, ...categoryTabs]

  const [metric, setMetric] = useState<LeaderboardMetric>('wins')
  // Games belonging to the currently selected category tab — a sub-filter
  // only makes sense (and only renders) when there are 2+ of them.
  const gamesForMetric = activeGames.filter((g) => g.category === metric)
  const [gameId, setGameId] = useState<string | null>(null)
  const ranked = rankPlayersBy(players, metric, gameId ?? undefined)

  function selectMetric(key: LeaderboardMetric) {
    setMetric(key)
    setGameId(null) // reset to "All" whenever the category changes
  }

  if (players.length === 0) return null

  return (
    <div>
      <div className="mb-4 flex gap-1 overflow-x-auto scrollbar-hide rounded-xl border border-sx-border bg-sx-surface p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => selectMetric(t.key)}
            className={`shrink-0 flex-1 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
              metric === t.key ? 'bg-sx-purple text-white' : 'text-sx-gray hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {gamesForMetric.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          <button
            onClick={() => setGameId(null)}
            className={`rounded-full border px-3 py-1 text-[11px] font-bold transition-colors ${
              gameId === null
                ? 'border-sx-purple bg-sx-purple/15 text-white'
                : 'border-sx-border text-sx-gray hover:text-white'
            }`}
          >
            All {CATEGORY_META[metric]?.statLabel ?? metric}
          </button>
          {gamesForMetric.map((g) => (
            <button
              key={g.id}
              onClick={() => setGameId(g.id)}
              className={`rounded-full border px-3 py-1 text-[11px] font-bold transition-colors ${
                gameId === g.id
                  ? 'border-sx-purple bg-sx-purple/15 text-white'
                  : 'border-sx-border text-sx-gray hover:text-white'
              }`}
            >
              {g.name}
            </button>
          ))}
        </div>
      )}
      <LeaderboardTable players={ranked} currentUserId={currentUserId} metric={metric} />
    </div>
  )
}
```

- [ ] **Step 3: Run the full test suite + typecheck + build**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: PASS, clean build.

- [ ] **Step 4: Manual verification against the live dev server**

Load `/rankings`. Expected: "Wins"/"SX Score" tabs unchanged; a "Goals" tab
appears (football category); switching to it shows an "All Goals" +
per-game pill row (since DLS and FC Mobile are both active football
games) — clicking a specific game narrows the table; switching to any
other category tab (fighting/shooter/racing, if active) shows no pill row
since each has only one active game.

- [ ] **Step 5: Commit**

```bash
git add "app/[locale]/(public)/rankings/page.tsx" components/rankings/LeaderboardTabs.tsx
git commit -m "feat(rankings): per-game sub-filter on category tabs"
```

---

### Task 6: Hall of Fame per-game award filter

**Files:**
- Create: `components/hall-of-fame/CategoryAwardFilter.tsx`
- Modify: `app/[locale]/(public)/hall-of-fame/page.tsx`

**Interfaces:**
- Consumes: `pickGameAward` (Task 3), `PlayerStatsInput.gameStats` (Task 2).
- Produces: `CategoryAwardFilter` (client) wraps `AllTimeAwardCard`/
  `AllTimeAwardEmptyCard`, switching between precomputed per-game winners;
  renders no filter UI (just the "All" card) when only one option exists.

- [ ] **Step 1: Create `CategoryAwardFilter`**

```typescript
// components/hall-of-fame/CategoryAwardFilter.tsx
'use client'
import { useState } from 'react'
import { AllTimeAwardCard, AllTimeAwardEmptyCard } from './AllTimeAwardCard'
import type { PlayerStatsInput } from '@/lib/rankings/leaderboard'

export interface AwardOption {
  /** null = the category-wide "All X" option. */
  gameId: string | null
  gameLabel: string
  winner: PlayerStatsInput | null
  metricValue: number
}

export function CategoryAwardFilter({
  label,
  icon,
  metricLabel,
  awardName,
  options,
}: {
  label: string
  icon: string
  metricLabel: string
  awardName: string
  options: AwardOption[]
}) {
  const [gameId, setGameId] = useState<string | null>(null)
  const selected = options.find((o) => o.gameId === gameId) ?? options[0]

  return (
    <div className="flex-1">
      {options.length > 1 && (
        <div className="mb-2 flex flex-wrap justify-center gap-1.5 sm:justify-start">
          {options.map((o) => (
            <button
              key={o.gameId ?? 'all'}
              onClick={() => setGameId(o.gameId)}
              className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold transition-colors ${
                selected.gameId === o.gameId
                  ? 'border-amber-400 bg-amber-400/15 text-amber-200'
                  : 'border-sx-border text-sx-gray hover:text-white'
              }`}
            >
              {o.gameLabel}
            </button>
          ))}
        </div>
      )}
      {selected.winner ? (
        <AllTimeAwardCard
          label={label}
          icon={icon}
          avatarUrl={selected.winner.avatarUrl}
          name={selected.winner.displayName ?? selected.winner.username ?? 'Anonymous'}
          membershipTier={selected.winner.membershipTier}
          sentinelTier={selected.winner.sentinelTier}
          metricLabel={metricLabel}
          metricValue={selected.metricValue}
          awardName={awardName}
        />
      ) : (
        <AllTimeAwardEmptyCard label={label} icon={icon} />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Wire it into the Hall of Fame page**

In `app/[locale]/(public)/hall-of-fame/page.tsx`:

Change the `games` select to include `id` and `slug` isn't needed here
(name is what's displayed) — change:

```typescript
    supabase.from('games').select('category').eq('active', true),
```

to:

```typescript
    supabase.from('games').select('id, name, category').eq('active', true),
```

Add the import:

```typescript
import { pickMVP, pickGoldenBoot, pickCategoryAward, pickGameAward, deriveThirdPlaces, type ThirdPlaceInput } from '@/lib/hall-of-fame/awards'
import { scoreStatsByPlayerAndCategory, scoreStatsByPlayerAndGame, categoryStat, gameStat, type GameScopedMatch } from '@/lib/rankings/game-breakdown'
import { CategoryAwardFilter, type AwardOption } from '@/components/hall-of-fame/CategoryAwardFilter'
```

Update `RawGameRef`/`firstGameRef` and the match mapping the same way as
Task 5 Step 1 (add `id` to the embed select, the type, and the mapped
`game_id` field) — this page's `games(name, category)` embed and match
mapping are structurally identical to the Rankings page's, so apply the
same three edits (select string, `RawGameRef`/`firstGameRef` types, the
`matches.map(...)` block's `game_id: g?.id ?? 'unknown'` line).

Add `gameStats` to the `players` mapping (mirroring Task 5's `gameMaps`
computation) — insert right after the existing `categoryMaps` line:

```typescript
  const gameMaps = (activeGames ?? []).map((g) => ({
    gameId: g.id,
    map: scoreStatsByPlayerAndGame(matches, g.id),
  }))
```

and add to the `players` array literal:

```typescript
    gameStats: gameMaps.map(({ gameId, map }) => ({
      gameId,
      scored: map.get(p.id)?.scored ?? 0,
      conceded: map.get(p.id)?.conceded ?? 0,
    })),
```

Build award options per category — add this helper above the `mvp`/
`goldenBoot` computation:

```typescript
  function awardOptionsFor(category: string): AwardOption[] {
    const allWinner = pickCategoryAward(players, category)
    const options: AwardOption[] = [
      { gameId: null, gameLabel: `All ${CATEGORY_META[category]?.statLabel ?? category}`, winner: allWinner, metricValue: allWinner ? categoryStat(allWinner.categoryStats, category).scored : 0 },
    ]
    const gamesInCategory = (activeGames ?? []).filter((g) => g.category === category)
    if (gamesInCategory.length > 1) {
      for (const g of gamesInCategory) {
        const winner = pickGameAward(players, g.id)
        options.push({ gameId: g.id, gameLabel: g.name, winner, metricValue: winner ? gameStat(winner.gameStats, g.id).scored : 0 })
      }
    }
    return options
  }
```

Replace the `mvp`/`goldenBoot`/`categoryAwards` block:

```typescript
  const mvp = pickMVP(players)
  const goldenBoot = pickGoldenBoot(players)
  const categoryAwards = activeCategories
    .filter((c) => c !== 'football' && CATEGORY_META[c] != null)
    .map((c) => ({ category: c, meta: CATEGORY_META[c], winner: pickCategoryAward(players, c) }))
    .filter((a) => a.winner != null)
```

with:

```typescript
  const mvp = pickMVP(players)
  const goldenBootOptions = awardOptionsFor('football')
  const goldenBoot = goldenBootOptions[0]?.winner ?? null
  const categoryAwards = activeCategories
    .filter((c) => c !== 'football' && CATEGORY_META[c] != null)
    .map((c) => ({ category: c, meta: CATEGORY_META[c], options: awardOptionsFor(c) }))
    .filter((a) => a.options[0]?.winner != null)
```

(`hasAwards`'s existing `goldenBoot != null` check keeps working
unchanged since `goldenBoot` is still derived the same way, just now
sourced from `goldenBootOptions[0]`.)

Replace the Golden Boot `AllTimeAwardCard` JSX:

```tsx
                {goldenBoot ? (
                  <AllTimeAwardCard
                    label="Golden Boot"
                    icon="👟"
                    avatarUrl={goldenBoot.avatarUrl}
                    name={goldenBoot.displayName ?? goldenBoot.username ?? 'Anonymous'}
                    membershipTier={goldenBoot.membershipTier}
                    sentinelTier={goldenBoot.sentinelTier}
                    metricLabel="goals scored"
                    metricValue={categoryStat(goldenBoot.categoryStats, 'football').scored}
                    awardName="All-Time Golden Boot"
                  />
                ) : (
                  <AllTimeAwardEmptyCard label="Golden Boot" icon="👟" />
                )}
```

with:

```tsx
                <CategoryAwardFilter
                  label="Golden Boot"
                  icon="👟"
                  metricLabel="goals scored"
                  awardName="All-Time Golden Boot"
                  options={goldenBootOptions}
                />
```

Replace the `categoryAwards.map(...)` JSX block:

```tsx
              {categoryAwards.length > 0 && (
                <div className="mt-4 flex flex-col gap-4 sm:flex-row">
                  {categoryAwards.map(({ category, meta, winner }) => (
                    <AllTimeAwardCard
                      key={category}
                      label={meta.awardName}
                      icon={meta.awardEmoji}
                      avatarUrl={winner!.avatarUrl}
                      name={winner!.displayName ?? winner!.username ?? 'Anonymous'}
                      membershipTier={winner!.membershipTier}
                      sentinelTier={winner!.sentinelTier}
                      metricLabel={meta.statLabel.toLowerCase()}
                      metricValue={categoryStat(winner!.categoryStats, category).scored}
                      awardName={meta.awardName}
                    />
                  ))}
                </div>
              )}
```

with:

```tsx
              {categoryAwards.length > 0 && (
                <div className="mt-4 flex flex-col gap-4 sm:flex-row">
                  {categoryAwards.map(({ category, meta, options }) => (
                    <CategoryAwardFilter
                      key={category}
                      label={meta.awardName}
                      icon={meta.awardEmoji}
                      metricLabel={meta.statLabel.toLowerCase()}
                      awardName={meta.awardName}
                      options={options}
                    />
                  ))}
                </div>
              )}
```

The now-unused direct `AllTimeAwardCard`/`AllTimeAwardEmptyCard` import for
these two spots stays imported (still used for the empty-state fallback
block lower in the file) — do not remove the import line.

- [ ] **Step 3: Run the full test suite + typecheck + build**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: PASS, clean build.

- [ ] **Step 4: Manual verification against the live dev server**

Load `/hall-of-fame`. Expected: Golden Boot card shows filter pills ("All
Goals | Dream League Soccer | EA FC Mobile") once both games have scored
matches; clicking a pill swaps the displayed champion/metric without a
page reload; every other category award (fighting/shooter/racing, if
active) shows no pills, matching today.

- [ ] **Step 5: Commit**

```bash
git add components/hall-of-fame/CategoryAwardFilter.tsx "app/[locale]/(public)/hall-of-fame/page.tsx"
git commit -m "feat(hall-of-fame): per-game award filter on Golden Boot + category awards"
```

---

### Task 7: Generalize `SeasonHero` + `SeasonLeaderboardTable` copy

**Files:**
- Modify: `components/seasons/SeasonHero.tsx`
- Modify: `components/seasons/SeasonLeaderboardTable.tsx`

**Interfaces:**
- Consumes: `SeasonTierLabels` (Task 4).
- Produces: both components take their tier-specific copy as props instead
  of hardcoding it — DLS's rendered output is unchanged since Task 9 will
  pass DLS's own `SeasonTierLabels` values.

- [ ] **Step 1: Update `SeasonHero`**

Replace the whole file:

```typescript
import { Crown } from 'lucide-react'
import type { SeasonTierLabels } from '@/lib/games/season-tier-labels'

function formatMonthYear(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

export function SeasonHero({
  season,
  tournaments,
  playersCompeting,
  tierLabels,
}: {
  season: { name: string; start_date: string; end_date: string }
  tournaments: { tournament_type: string; status: string }[]
  playersCompeting: number
  tierLabels: SeasonTierLabels
}) {
  const clubsCompleted = tournaments.filter((t) => t.tournament_type === 'community_club' && t.status === 'completed').length
  const mastersCompleted = tournaments.filter((t) => t.tournament_type === 'masters' && t.status === 'completed').length

  return (
    <div className="relative mb-8 overflow-hidden rounded-2xl border border-sx-border bg-sx-surface p-6 sm:p-8">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-sx-purple/20 blur-[90px]"
      />
      <div className="relative flex items-center gap-2">
        <Crown className="h-5 w-5 text-sx-purple-text" />
        <p className="text-xs font-bold uppercase tracking-widest text-sx-purple-text">{season.name}</p>
      </div>
      <h1 className="relative mt-2 font-display text-3xl font-black uppercase text-white sm:text-4xl">
        {formatMonthYear(season.start_date)} – {formatMonthYear(season.end_date)}
      </h1>
      <div className="relative mt-5 flex flex-wrap gap-3 text-xs font-bold">
        <span className="rounded-full border border-sx-border bg-sx-bg px-3.5 py-1.5 text-white/80">
          {clubsCompleted} {tierLabels.communityClub} completed
        </span>
        <span className="rounded-full border border-sx-border bg-sx-bg px-3.5 py-1.5 text-white/80">
          {mastersCompleted} {tierLabels.masters} completed
        </span>
        <span className="rounded-full border border-sx-purple/30 bg-sx-purple/10 px-3.5 py-1.5 text-sx-purple-text">
          {playersCompeting} players competing
        </span>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Update `SeasonLeaderboardTable`**

Change the props destructuring and the footer line:

```typescript
export function SeasonLeaderboardTable({
  rows,
  currentUserId,
  qualificationNote,
}: {
  rows: SeasonLeaderboardRow[]
  currentUserId: string | null
  qualificationNote: string
}) {
```

```tsx
      <p className="mt-3 text-xs text-sx-gray">{qualificationNote}</p>
```

(Replaces the hardcoded `"Qualify for Champions Cup — top 16 at season end earn an invitation."` string.)

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit`
Expected: FAIL at this point — the current call site
(`app/[locale]/seasons/[slug]/page.tsx`) doesn't pass `tierLabels`/
`qualificationNote` yet. This is expected; Task 9 fixes the call site. Note
the exact error locations for confirmation once Task 9 lands.

- [ ] **Step 4: Commit**

```bash
git add components/seasons/SeasonHero.tsx components/seasons/SeasonLeaderboardTable.tsx
git commit -m "refactor(seasons): SeasonHero/SeasonLeaderboardTable take tier copy as props

Intentionally leaves the /seasons page call site broken until Task 9 —
committed separately so this refactor's diff is reviewable on its own."
```

---

### Task 8: `SeasonGameTabs` — multi-game tab switcher

**Files:**
- Create: `components/seasons/SeasonGameTabs.tsx`

**Interfaces:**
- Consumes: `SeasonTierLabels` (Task 4), `ScheduleTournament`
  (`components/seasons/SeasonSchedule.tsx`, existing), `SeasonLeaderboardRow`
  (`lib/seasons/data.ts`, existing).
- Produces: `SeasonGameSection { gameId: string; gameName: string;
  tournaments: ScheduleTournament[]; leaderboard: SeasonLeaderboardRow[];
  tierLabels: SeasonTierLabels }`; `SeasonGameTabs` component. Consumed by
  Task 9.

- [ ] **Step 1: Create the component**

```typescript
// components/seasons/SeasonGameTabs.tsx
'use client'
import { useState } from 'react'
import { SeasonHero } from './SeasonHero'
import { SeasonSchedule, type ScheduleTournament } from './SeasonSchedule'
import { SeasonLeaderboardTable } from './SeasonLeaderboardTable'
import { ChampionsCupSpotlight } from './ChampionsCupSpotlight'
import type { SeasonLeaderboardRow } from '@/lib/seasons/data'
import type { SeasonTierLabels } from '@/lib/games/season-tier-labels'

export interface SeasonGameSection {
  gameId: string
  gameName: string
  tournaments: ScheduleTournament[]
  leaderboard: SeasonLeaderboardRow[]
  tierLabels: SeasonTierLabels
}

export function SeasonGameTabs({
  sections,
  season,
  currentUserId,
  seasonEndLabel,
}: {
  sections: SeasonGameSection[]
  season: { name: string; start_date: string; end_date: string }
  currentUserId: string | null
  seasonEndLabel: string
}) {
  const [gameId, setGameId] = useState(sections[0]?.gameId ?? '')
  const active = sections.find((s) => s.gameId === gameId) ?? sections[0]
  if (!active) return null

  return (
    <div>
      {sections.length > 1 && (
        <div className="mb-6 flex gap-1 overflow-x-auto scrollbar-hide rounded-xl border border-sx-border bg-sx-surface p-1">
          {sections.map((s) => (
            <button
              key={s.gameId}
              onClick={() => setGameId(s.gameId)}
              className={`shrink-0 flex-1 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                active.gameId === s.gameId ? 'bg-sx-purple text-white' : 'text-sx-gray hover:text-white'
              }`}
            >
              {s.gameName}
            </button>
          ))}
        </div>
      )}
      <SeasonHero
        season={season}
        tournaments={active.tournaments}
        playersCompeting={active.leaderboard.length}
        tierLabels={active.tierLabels}
      />
      <SeasonSchedule tournaments={active.tournaments} />
      <SeasonLeaderboardTable
        rows={active.leaderboard}
        currentUserId={currentUserId}
        qualificationNote={active.tierLabels.qualificationNote}
      />
      {active.tierLabels.showChampionsCupSpotlight && <ChampionsCupSpotlight seasonEndLabel={seasonEndLabel} />}
    </div>
  )
}
```

(`ScheduleTournament` isn't currently exported from `SeasonSchedule.tsx` —
add `export` to its `interface ScheduleTournament` declaration there as
part of this task, since this file is the first consumer that needs to
name the type explicitly.)

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: same pre-existing failure as Task 7 (the page call site isn't
updated yet) plus no new errors from this file itself — confirm this
file's own types resolve cleanly by checking the error list only
references `app/[locale]/seasons/[slug]/page.tsx`.

- [ ] **Step 3: Commit**

```bash
git add components/seasons/SeasonGameTabs.tsx components/seasons/SeasonSchedule.tsx
git commit -m "feat(seasons): SeasonGameTabs multi-game tab switcher"
```

---

### Task 9: `/seasons` page — multi-game data + wiring

**Files:**
- Modify: `app/[locale]/seasons/[slug]/page.tsx`

**Interfaces:**
- Consumes: `SeasonGameTabs`/`SeasonGameSection` (Task 8),
  `seasonTierLabelsFor` (Task 4), `getSeasonLeaderboard` (existing,
  game-scoped since the core plan).
- Produces: the page renders one section per active game via
  `SeasonGameTabs`, replacing the DLS-only rendering the core plan's Task 7
  temporarily pinned in place.

- [ ] **Step 1: Rewrite the page**

Replace the whole file:

```typescript
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { JsonLd } from '@/components/seo/JsonLd'
import { buildBreadcrumbJsonLd } from '@/lib/seo/schema/breadcrumb'
import { getSeasonLeaderboard } from '@/lib/seasons/data'
import { seasonTierLabelsFor } from '@/lib/games/season-tier-labels'
import { SeasonGameTabs, type SeasonGameSection } from '@/components/seasons/SeasonGameTabs'

async function getSeason(slug: string) {
  const supabase = createClient()
  const { data } = await supabase.from('seasons').select('*').eq('slug', slug).maybeSingle()
  return data
}

export async function generateMetadata({ params }: { params: { slug: string; locale: Locale } }): Promise<Metadata> {
  const season = await getSeason(params.slug)
  if (!season) return { title: 'Season — Sentinel X' }
  return buildMetadata({
    title: `${season.name} — Sentinel X`,
    description: `Follow ${season.name}'s tournaments across every game, and the road to the top of each leaderboard.`,
    path: `/seasons/${season.slug}`,
    locale: params.locale,
  })
}

function formatMonthYear(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

export default async function SeasonPage({ params }: { params: { slug: string } }) {
  const season = await getSeason(params.slug)
  if (!season) notFound()

  const admin = createAdminClient()
  const supabase = createClient()
  const [
    { data: activeGamesRaw },
    {
      data: { user },
    },
  ] = await Promise.all([supabase.from('games').select('id, name, slug').eq('active', true), supabase.auth.getUser()])

  // DLS first (existing users' expectation — it's the game this page was
  // originally built for), then every other active game alphabetically.
  const activeGames = (activeGamesRaw ?? []).sort((a, b) =>
    a.slug === 'dls' ? -1 : b.slug === 'dls' ? 1 : a.name.localeCompare(b.name),
  )

  const sections: SeasonGameSection[] = await Promise.all(
    activeGames.map(async (game) => {
      const [{ data: tournaments }, leaderboard] = await Promise.all([
        supabase
          .from('tournaments')
          .select('id, title, slug, tournament_type, status, tournament_start, invitation_only')
          .eq('season_id', season.id)
          .eq('game_id', game.id)
          .neq('tournament_type', 'open')
          .order('tournament_start'),
        getSeasonLeaderboard(admin, season.id, game.id),
      ])
      return {
        gameId: game.id,
        gameName: game.name,
        tournaments: tournaments ?? [],
        leaderboard,
        tierLabels: seasonTierLabelsFor(game.slug),
      }
    }),
  )

  return (
    <div className="mx-auto max-w-4xl px-4 pb-20 pt-8 sm:px-6">
      <JsonLd
        data={buildBreadcrumbJsonLd([
          { name: 'Home', path: '/' },
          { name: season.name, path: `/seasons/${season.slug}` },
        ])}
      />
      <SeasonGameTabs
        sections={sections}
        season={season}
        currentUserId={user?.id ?? null}
        seasonEndLabel={formatMonthYear(season.end_date)}
      />
    </div>
  )
}
```

- [ ] **Step 2: Run the full test suite + typecheck + build**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: PASS, clean build — confirms Task 7 and Task 8's
temporarily-broken typecheck is now resolved.

- [ ] **Step 3: Manual verification against the live dev server**

Load `/seasons/season-1`. Expected: a game tab row appears (DLS, EA FC
Mobile) since both are active; DLS tab shows exactly what the page showed
before this plan (Community Clubs/Masters pills, Champions Cup spotlight,
"Qualify for Champions Cup..." footer); EA FC Mobile tab shows Circuit
Cups/Elite Cups pills, no Champions Cup spotlight, and the FC-Mobile-
specific qualification note.

- [ ] **Step 4: Commit**

```bash
git add "app/[locale]/seasons/[slug]/page.tsx"
git commit -m "feat(seasons): /seasons becomes multi-game (per-game tabs)"
```

---

## Self-Review Notes

**Spec coverage:** §6 (`/seasons` multi-game) = Tasks 4, 7, 8, 9. §7
(Rankings/Hall of Fame per-game filter) = Tasks 1, 2, 3, 5, 6.

**Placeholder scan:** no TBD/TODO; every step has real code or an exact
command with expected output. Task 7's typecheck-fails-until-Task-9 is a
deliberate, explicitly-called-out intermediate state (matches how a
refactor and its call-site update are legitimately reviewable as separate
commits), not an unresolved placeholder.

**Type consistency:** `GameStat`/`gameStat()` (Task 1) are used identically
in Task 2 (`rankPlayersBy`), Task 3 (`pickGameAward`), Task 5 (Rankings
page), and Task 6 (Hall of Fame page) — same field names (`gameId`,
`scored`, `conceded`) throughout. `SeasonGameSection` (Task 8) matches
exactly what Task 9's page constructs. `ActiveGame`
(`components/rankings/LeaderboardTabs.tsx`, Task 5) and the `activeGames`
row shape fetched in both the Rankings and Hall of Fame pages carry the
same three fields (`id`, `name`, `category`) throughout.
