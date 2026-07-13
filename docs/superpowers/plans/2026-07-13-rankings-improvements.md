# Rankings Improvements (#23) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wins tab rows expand to show a per-game win breakdown; the Goals tab and Golden Boot switch from the cumulative all-games `profiles.goals_scored` column to a live football-scoped aggregate; Sentinel Score and Champions are confirmed unchanged.

**Architecture:** A new pure module (`lib/rankings/game-breakdown.ts`) derives both the wins-by-game breakdown and the football-scoped goals from one shared completed-matches query per page — never two separate fetches for the same page. `PlayerStatsInput` (the shared type consumed by both the rankings and Hall of Fame pages) gains three fields: `footballGoalsScored`, `footballGoalsConceded`, `winsByGame`. `rankPlayersBy`'s existing goal-difference tie-break logic is untouched (stays all-games-scoped everywhere, including on the Goals tab) — only the Goals tab's primary sort/display value and Golden Boot's selection value switch to the football-scoped figure.

**Tech Stack:** Next.js 14 App Router (Server Components), Supabase (Postgres + RLS), TypeScript, Vitest, Tailwind.

## Global Constraints

- `winsByPlayerAndGame` and `footballGoalsByPlayer` must operate on **one shared completed-matches query result** per page — never fetch matches twice for the same page load.
- Reuse `matchWinnerId` from `lib/tournaments/advancement.ts` for "who won" — never reimplement. It already returns `null` for draws/undecided matches; `winsByPlayerAndGame` must skip those without crashing.
- `profiles.goals_scored`/`goals_conceded` are left completely untouched everywhere except the Goals tab and Golden Boot (dashboard, player profile page keep showing the cumulative all-games figure).
- The existing goal-difference (`goalDiff`) tie-break and GD table column stay all-games-scoped on every tab, including Goals — not football-scoped. This is a deliberate scope decision (the spec only requires the Goals tab's headline metric to be football-scoped, not its tie-break column).
- Migration file: `supabase/migrations/020_game_category.sql` (next after `019_referral_program.sql`).

---

### Task 1: Migration — `games.category`

**Files:**
- Create: `supabase/migrations/020_game_category.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Genre/category classification. 'other' is a deliberate catch-all for now —
-- #21 will split it into real values (fps, battle_royale, etc.) when those
-- games are actually added. Football-specific views (Goals tab, Golden Boot)
-- filter on category = 'football' and will simply show nothing for 'other'
-- games until #21 gives them their own stat columns and their own category.
ALTER TABLE public.games
  ADD COLUMN category text NOT NULL DEFAULT 'football'
    CHECK (category IN ('football', 'other'));
```

- [ ] **Step 2: Apply the migration**

Try `supabase db push --dry-run` then `supabase db push --yes` first. If the CLI's direct Postgres connection times out from this environment (seen before in this session), fall back to the `mcp__claude_ai_Supabase__apply_migration` tool — **ask the user to confirm before applying**, showing the exact SQL, since the auto-mode classifier blocks blind schema applies via that path without explicit sign-off.

If a migration was applied via the MCP tool instead of the CLI, check `supabase migration list` before the next migration is written — the MCP path creates a timestamp-versioned remote entry the CLI doesn't recognize, and needs `supabase migration repair --status applied <version>` (+ `--status reverted <timestamp>` for the stray entry) before `db push` will proceed cleanly. This happened with migration 018 earlier this session.

- [ ] **Step 3: Regenerate Supabase types**

Via CLI (`supabase gen types typescript --project-id itxubrkbropttfdackmi`) if reachable, otherwise `mcp__claude_ai_Supabase__generate_typescript_types`. Overwrite `lib/supabase/types.ts`, preserving its existing header format.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/020_game_category.sql lib/supabase/types.ts
git commit -m "feat: #23 add games.category (football | other)"
```

---

### Task 2: `lib/rankings/game-breakdown.ts` — pure aggregation functions (TDD)

**Files:**
- Create: `lib/rankings/game-breakdown.ts`
- Test: `lib/rankings/game-breakdown.test.ts`

**Interfaces:**
- Consumes: `matchWinnerId` from `lib/tournaments/advancement.ts`.
- Produces: `GameScopedMatch` type, `GameWinCount` type, `FootballGoals` type, `winsByPlayerAndGame(matches: GameScopedMatch[]): Map<string, GameWinCount[]>`, `footballGoalsByPlayer(matches: GameScopedMatch[]): Map<string, FootballGoals>` — consumed by `app/(public)/rankings/page.tsx` (Task 5) and `app/(public)/hall-of-fame/page.tsx` (Task 6).

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from 'vitest'
import { winsByPlayerAndGame, footballGoalsByPlayer, type GameScopedMatch } from './game-breakdown'

function m(over: Partial<GameScopedMatch>): GameScopedMatch {
  return {
    status: 'completed',
    score_a: 2,
    score_b: 1,
    player_a_id: 'a',
    player_b_id: 'b',
    game_name: 'DLS',
    game_category: 'football',
    ...over,
  }
}

describe('winsByPlayerAndGame', () => {
  it('counts a decisive completed match for the winner only', () => {
    const r = winsByPlayerAndGame([m({ score_a: 2, score_b: 1 })])
    expect(r.get('a')).toEqual([{ game: 'DLS', wins: 1 }])
    expect(r.get('b')).toBeUndefined()
  })

  it('groups multiple wins in the same game into one count', () => {
    const r = winsByPlayerAndGame([
      m({ score_a: 2, score_b: 0 }),
      m({ score_a: 3, score_b: 1 }),
    ])
    expect(r.get('a')).toEqual([{ game: 'DLS', wins: 2 }])
  })

  it('splits wins across different games into separate entries', () => {
    const r = winsByPlayerAndGame([
      m({ score_a: 2, score_b: 0, game_name: 'DLS' }),
      m({ score_a: 2, score_b: 0, game_name: 'EA FC Mobile' }),
    ])
    expect(r.get('a')).toEqual(
      expect.arrayContaining([
        { game: 'DLS', wins: 1 },
        { game: 'EA FC Mobile', wins: 1 },
      ]),
    )
  })

  it('skips a draw without crashing', () => {
    const r = winsByPlayerAndGame([m({ score_a: 1, score_b: 1 })])
    expect(r.size).toBe(0)
  })

  it('skips a non-completed match', () => {
    const r = winsByPlayerAndGame([m({ status: 'scheduled' })])
    expect(r.size).toBe(0)
  })

  it('returns an empty map for no matches', () => {
    expect(winsByPlayerAndGame([]).size).toBe(0)
  })
})

describe('footballGoalsByPlayer', () => {
  it('sums scored and conceded for both players of a football match', () => {
    const r = footballGoalsByPlayer([m({ score_a: 3, score_b: 1, game_category: 'football' })])
    expect(r.get('a')).toEqual({ scored: 3, conceded: 1 })
    expect(r.get('b')).toEqual({ scored: 1, conceded: 3 })
  })

  it('accumulates across multiple matches', () => {
    const r = footballGoalsByPlayer([
      m({ score_a: 3, score_b: 1 }),
      m({ score_a: 0, score_b: 2 }),
    ])
    expect(r.get('a')).toEqual({ scored: 3, conceded: 3 })
    expect(r.get('b')).toEqual({ scored: 3, conceded: 3 })
  })

  it('excludes matches from non-football games', () => {
    const r = footballGoalsByPlayer([m({ game_category: 'other', score_a: 5, score_b: 5 })])
    expect(r.size).toBe(0)
  })

  it('excludes non-completed matches', () => {
    const r = footballGoalsByPlayer([m({ status: 'scheduled' })])
    expect(r.size).toBe(0)
  })

  it('returns an empty map for no matches', () => {
    expect(footballGoalsByPlayer([]).size).toBe(0)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/rankings/game-breakdown.test.ts`
Expected: FAIL — `Cannot find module './game-breakdown'`

- [ ] **Step 3: Write the implementation**

```typescript
import { matchWinnerId, type AdvanceMatch } from '@/lib/tournaments/advancement'

export interface GameScopedMatch extends AdvanceMatch {
  game_name: string
  game_category: string
}

export interface GameWinCount {
  game: string
  wins: number
}

// Groups completed-match wins by (player, game). Draws and undecided matches
// (matchWinnerId returns null) are skipped, not counted for anyone — reuses
// the single "who won" implementation rather than reimplementing it.
export function winsByPlayerAndGame(matches: GameScopedMatch[]): Map<string, GameWinCount[]> {
  const counts = new Map<string, Map<string, number>>()
  for (const match of matches) {
    const winnerId = matchWinnerId(match)
    if (!winnerId) continue
    const byGame = counts.get(winnerId) ?? new Map<string, number>()
    byGame.set(match.game_name, (byGame.get(match.game_name) ?? 0) + 1)
    counts.set(winnerId, byGame)
  }
  const result = new Map<string, GameWinCount[]>()
  for (const [playerId, byGame] of counts) {
    result.set(
      playerId,
      Array.from(byGame.entries()).map(([game, wins]) => ({ game, wins })),
    )
  }
  return result
}

export interface FootballGoals {
  scored: number
  conceded: number
}

// Sums score_a/score_b from completed matches whose game category is
// 'football' only. This deliberately does NOT read profiles.goals_scored —
// that column mixes every game a player has played with no per-game
// provenance, so it can't be filtered after the fact. See the #23 design
// spec for why the Goals tab and Golden Boot need this instead.
export function footballGoalsByPlayer(matches: GameScopedMatch[]): Map<string, FootballGoals> {
  const result = new Map<string, FootballGoals>()
  for (const match of matches) {
    if (match.game_category !== 'football') continue
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/rankings/game-breakdown.test.ts`
Expected: PASS (12 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/rankings/game-breakdown.ts lib/rankings/game-breakdown.test.ts
git commit -m "feat: #23 pure wins-by-game and football-scoped-goals aggregation"
```

---

### Task 3: `lib/rankings/leaderboard.ts` — extend `PlayerStatsInput`, football-scoped goals metric

**Files:**
- Modify: `lib/rankings/leaderboard.ts`
- Modify: `lib/rankings/leaderboard.test.ts`

**Interfaces:**
- Consumes: `GameWinCount` from `lib/rankings/game-breakdown.ts` (Task 2).
- Produces: `PlayerStatsInput` gains `footballGoalsScored: number`, `footballGoalsConceded: number`, `winsByGame: GameWinCount[]`.

- [ ] **Step 1: Update the test fixture and the "goals" metric test to use the new field**

In `lib/rankings/leaderboard.test.ts`, change the `p()` helper to include the three new fields:

```typescript
import { describe, it, expect } from 'vitest'
import {
  rankPlayers,
  rankPlayersBy,
  isRankingEligible,
  RANKING_MIN_MATCHES,
  type PlayerStatsInput,
} from './leaderboard'

function p(over: Partial<PlayerStatsInput> & { id: string }): PlayerStatsInput {
  return {
    username: over.id,
    displayName: null,
    avatarUrl: null,
    country: null,
    wins: 0,
    losses: 0,
    totalMatches: 0,
    goalsScored: 0,
    goalsConceded: 0,
    footballGoalsScored: 0,
    footballGoalsConceded: 0,
    winsByGame: [],
    totalTitles: 0,
    sentinelScore: 70,
    sentinelTier: null,
    ...over,
  }
}
```

Then update the existing "sorts by goals scored when metric is goals" test to use `footballGoalsScored` instead of `goalsScored`:

```typescript
  it('sorts by football-scoped goals when metric is "goals"', () => {
    const r = rankPlayersBy(
      [
        p({ id: 'a', footballGoalsScored: 4, wins: 9 }),
        p({ id: 'b', footballGoalsScored: 20, wins: 1 }),
      ],
      'goals',
    )
    expect(r.map((x) => x.id)).toEqual(['b', 'a'])
  })
```

(This replaces the old test of the same name in the `describe('rankPlayersBy', ...)` block — same position, new body.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/rankings/leaderboard.test.ts`
Expected: FAIL — TS error, `PlayerStatsInput` doesn't have `footballGoalsScored` yet (or the "goals" test fails because `METRIC_VALUE.goals` still reads `goalsScored`, which is 0 in the new test)

- [ ] **Step 3: Update the implementation**

In `lib/rankings/leaderboard.ts`:

```typescript
import type { GameWinCount } from './game-breakdown'

export interface PlayerStatsInput {
  id: string
  username: string | null
  displayName: string | null
  avatarUrl: string | null
  country: string | null
  wins: number
  losses: number
  totalMatches: number
  goalsScored: number
  goalsConceded: number
  // Football-only aggregate, computed live from completed matches (see
  // lib/rankings/game-breakdown.ts) — NOT the same as goalsScored/goalsConceded
  // above, which mix every game a player has played. Used by the Goals tab
  // and Golden Boot only; goalsScored/goalsConceded stay the source of truth
  // everywhere else (dashboard, player profile page).
  footballGoalsScored: number
  footballGoalsConceded: number
  // Per-game win breakdown for the Wins tab's expand view. Always sums to
  // `wins` above (both derive from the same completed-matches set via the
  // same matchWinnerId "who won" logic).
  winsByGame: GameWinCount[]
  totalTitles: number
  sentinelScore: number
  sentinelTier: string | null
}
```

Change `METRIC_VALUE.goals` to read the football-scoped field:

```typescript
const METRIC_VALUE: Record<LeaderboardMetric, (p: PlayerStatsInput) => number> = {
  wins: (p) => p.wins,
  score: (p) => p.sentinelScore,
  // Football-scoped, not the cumulative goalsScored — see PlayerStatsInput's
  // footballGoalsScored doc comment.
  goals: (p) => p.footballGoalsScored,
}
```

(`goalDiff` in `rankPlayersBy`'s `.map()` step is unchanged — stays `pl.goalsScored - pl.goalsConceded`, all-games-scoped on every tab including Goals, matching this plan's Global Constraints.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/rankings/leaderboard.test.ts`
Expected: PASS (all tests, including the updated "goals" test)

- [ ] **Step 5: Commit**

```bash
git add lib/rankings/leaderboard.ts lib/rankings/leaderboard.test.ts
git commit -m "feat: #23 PlayerStatsInput gains football-scoped goals + per-game wins"
```

---

### Task 4: `lib/hall-of-fame/awards.ts` — Golden Boot uses football-scoped goals

**Files:**
- Modify: `lib/hall-of-fame/awards.ts`
- Modify: `lib/hall-of-fame/awards.test.ts`

- [ ] **Step 1: Update the test fixture and Golden Boot tests**

In `lib/hall-of-fame/awards.test.ts`, update the `p()` helper the same way as Task 3:

```typescript
function p(over: Partial<PlayerStatsInput> & { id: string }): PlayerStatsInput {
  return {
    username: over.id,
    displayName: null,
    avatarUrl: null,
    country: null,
    wins: 0,
    losses: 0,
    totalMatches: 0,
    goalsScored: 0,
    goalsConceded: 0,
    footballGoalsScored: 0,
    footballGoalsConceded: 0,
    winsByGame: [],
    totalTitles: 0,
    sentinelScore: 70,
    sentinelTier: null,
    ...over,
  }
}
```

Update the two Golden Boot tests that reference `goalsScored` to use `footballGoalsScored` instead:

```typescript
describe('pickGoldenBoot', () => {
  it('returns null when no eligible players', () => {
    expect(pickGoldenBoot([])).toBeNull()
    expect(pickGoldenBoot([p({ id: 'a', totalMatches: 0, footballGoalsScored: 50 })])).toBeNull()
  })

  it('picks the highest football-scoped goals scored', () => {
    const r = pickGoldenBoot([
      p({ id: 'a', totalMatches: 3, footballGoalsScored: 12 }),
      p({ id: 'b', totalMatches: 3, footballGoalsScored: 20 }),
    ])
    expect(r?.id).toBe('b')
  })

  it('breaks a goals tie by wins', () => {
    const r = pickGoldenBoot([
      p({ id: 'a', totalMatches: 5, footballGoalsScored: 15, wins: 2 }),
      p({ id: 'b', totalMatches: 5, footballGoalsScored: 15, wins: 4 }),
    ])
    expect(r?.id).toBe('b')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/hall-of-fame/awards.test.ts`
Expected: FAIL — `pickGoldenBoot` still reads `goalsScored`, which is 0 in the updated tests

- [ ] **Step 3: Update the implementation**

In `lib/hall-of-fame/awards.ts`:

```typescript
// Golden Boot: most FOOTBALL-scoped goals scored among eligible players (not
// the cumulative goalsScored — see PlayerStatsInput's doc comment), ties
// broken by wins.
export function pickGoldenBoot(players: PlayerStatsInput[]): PlayerStatsInput | null {
  const eligible = players.filter(isRankingEligible)
  if (eligible.length === 0) return null
  return [...eligible].sort(
    (a, b) => b.footballGoalsScored - a.footballGoalsScored || b.wins - a.wins,
  )[0]
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/hall-of-fame/awards.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add lib/hall-of-fame/awards.ts lib/hall-of-fame/awards.test.ts
git commit -m "feat: #23 Golden Boot uses football-scoped goals"
```

---

### Task 5: `app/(public)/rankings/page.tsx` — fetch matches once, compute both breakdowns

**Files:**
- Modify: `app/(public)/rankings/page.tsx`

**Interfaces:**
- Consumes: `winsByPlayerAndGame`, `footballGoalsByPlayer`, `GameScopedMatch` (Task 2).

- [ ] **Step 1: Add the matches query and normalization, and populate the new player fields**

Replace the full file with:

```tsx
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { RANKING_MIN_MATCHES, type PlayerStatsInput } from '@/lib/rankings/leaderboard'
import { winsByPlayerAndGame, footballGoalsByPlayer, type GameScopedMatch } from '@/lib/rankings/game-breakdown'
import { LeaderboardTabs } from '@/components/rankings/LeaderboardTabs'
import { EmptyState } from '@/components/shared/EmptyState'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sentinelx.gg'

export const metadata: Metadata = {
  title: 'Rankings — Sentinel X',
  description: "Nigeria's top mobile esports players on Sentinel X, ranked by wins.",
  openGraph: {
    title: 'Rankings — Sentinel X',
    description: "Nigeria's top mobile esports players, ranked by wins.",
    url: `${SITE_URL}/rankings`,
    siteName: 'Sentinel X',
    type: 'website',
  },
}

type RawGameRef = { name: string; category: string } | { name: string; category: string }[] | null
type RawTournamentRef = { game: RawGameRef } | { game: RawGameRef }[] | null

function firstGameRef(g: RawGameRef): { name: string; category: string } | null {
  return Array.isArray(g) ? g[0] ?? null : g
}
function firstTournamentRef(t: RawTournamentRef): { game: RawGameRef } | null {
  return Array.isArray(t) ? t[0] ?? null : t
}

export default async function RankingsPage() {
  const supabase = createClient()
  const [{ data: profiles }, { data: matchRows }, { data: { user } }] = await Promise.all([
    supabase
      .from('profiles')
      .select(
        'id, username, display_name, avatar_url, country, wins, losses, total_matches, goals_scored, goals_conceded, total_titles, sentinel_score, sentinel_tier',
      )
      .gte('total_matches', RANKING_MIN_MATCHES)
      .order('wins', { ascending: false })
      .limit(200),
    // Fetched once and shared by both winsByPlayerAndGame and
    // footballGoalsByPlayer below — never fetch completed matches twice.
    supabase
      .from('matches')
      .select(
        'status, score_a, score_b, player_a_id, player_b_id, tournament:tournaments(game:games(name, category))',
      )
      .eq('status', 'completed'),
    supabase.auth.getUser(),
  ])

  const rawMatches = ((matchRows as unknown[] | null) ?? []) as {
    status: string
    score_a: number | null
    score_b: number | null
    player_a_id: string | null
    player_b_id: string | null
    tournament: RawTournamentRef
  }[]
  const matches: GameScopedMatch[] = rawMatches.map((m) => {
    const t = firstTournamentRef(m.tournament)
    const g = firstGameRef(t?.game ?? null)
    return {
      status: m.status,
      score_a: m.score_a,
      score_b: m.score_b,
      player_a_id: m.player_a_id,
      player_b_id: m.player_b_id,
      game_name: g?.name ?? 'Unknown',
      game_category: g?.category ?? 'other',
    }
  })
  const winsMap = winsByPlayerAndGame(matches)
  const goalsMap = footballGoalsByPlayer(matches)

  const players: PlayerStatsInput[] = (profiles ?? []).map(
    (p): PlayerStatsInput => ({
      id: p.id,
      username: p.username,
      displayName: p.display_name,
      avatarUrl: p.avatar_url,
      country: p.country,
      wins: p.wins,
      losses: p.losses,
      totalMatches: p.total_matches,
      goalsScored: p.goals_scored,
      goalsConceded: p.goals_conceded,
      footballGoalsScored: goalsMap.get(p.id)?.scored ?? 0,
      footballGoalsConceded: goalsMap.get(p.id)?.conceded ?? 0,
      winsByGame: winsMap.get(p.id) ?? [],
      totalTitles: p.total_titles,
      sentinelScore: p.sentinel_score,
      sentinelTier: p.sentinel_tier,
    }),
  )

  return (
    <div className="mx-auto max-w-3xl px-4 pb-20">
      <div className="py-8">
        <h1 className="text-2xl font-black text-white">Rankings</h1>
        <p className="mt-1 text-sm text-slate-400">
          Nigeria&apos;s top mobile esports players, ranked by wins.
        </p>
      </div>

      {players.length === 0 ? (
        <EmptyState
          icon="🏅"
          title="Rankings coming soon"
          body="Be the first to compete and claim the top spot."
        />
      ) : (
        <LeaderboardTabs players={players} currentUserId={user?.id ?? null} />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors referencing this file

- [ ] **Step 3: Commit**

```bash
git add "app/(public)/rankings/page.tsx"
git commit -m "feat: #23 rankings page computes per-game wins + football goals"
```

---

### Task 6: `app/(public)/hall-of-fame/page.tsx` — football-scoped goals for Golden Boot

**Files:**
- Modify: `app/(public)/hall-of-fame/page.tsx`

**Interfaces:**
- Consumes: `footballGoalsByPlayer`, `GameScopedMatch` (Task 2).

- [ ] **Step 1: Add a completed-matches query and populate the new `PlayerStatsInput` fields**

Add the import:

```typescript
import { footballGoalsByPlayer, type GameScopedMatch } from '@/lib/rankings/game-breakdown'
```

Add the same `RawGameRef`/`RawTournamentRef`/`firstGameRef`/`firstTournamentRef` helpers used in Task 5 (module-level, above `HallOfFamePage`):

```typescript
type RawGameRef = { name: string; category: string } | { name: string; category: string }[] | null
type RawTournamentRef = { game: RawGameRef } | { game: RawGameRef }[] | null

function firstGameRef(g: RawGameRef): { name: string; category: string } | null {
  return Array.isArray(g) ? g[0] ?? null : g
}
function firstTournamentRef(t: RawTournamentRef): { game: RawGameRef } | null {
  return Array.isArray(t) ? t[0] ?? null : t
}
```

Add a third parallel query alongside the existing `profileRows`/`tournamentRows` fetch:

```typescript
  const [{ data: profileRows }, { data: tournamentRows }, { data: matchRows }] = await Promise.all([
    supabase
      .from('profiles')
      .select(
        'id, username, display_name, avatar_url, country, wins, losses, total_matches, goals_scored, goals_conceded, total_titles, sentinel_score, sentinel_tier',
      )
      .gte('total_matches', RANKING_MIN_MATCHES),
    supabase
      .from('tournaments')
      .select('id, slug, title, tournament_end, games(name)')
      .eq('status', 'completed'),
    supabase
      .from('matches')
      .select(
        'status, score_a, score_b, player_a_id, player_b_id, tournament:tournaments(game:games(name, category))',
      )
      .eq('status', 'completed'),
  ])
```

Right after that, before `const players = ...`, add:

```typescript
  const rawMatches = ((matchRows as unknown[] | null) ?? []) as {
    status: string
    score_a: number | null
    score_b: number | null
    player_a_id: string | null
    player_b_id: string | null
    tournament: RawTournamentRef
  }[]
  const matches: GameScopedMatch[] = rawMatches.map((m) => {
    const t = firstTournamentRef(m.tournament)
    const g = firstGameRef(t?.game ?? null)
    return {
      status: m.status,
      score_a: m.score_a,
      score_b: m.score_b,
      player_a_id: m.player_a_id,
      player_b_id: m.player_b_id,
      game_name: g?.name ?? 'Unknown',
      game_category: g?.category ?? 'other',
    }
  })
  const goalsMap = footballGoalsByPlayer(matches)
```

Update the `players` construction to include the three new fields (`winsByGame` is unused on this page but required by the shared `PlayerStatsInput` type — always `[]` here):

```typescript
  const players: PlayerStatsInput[] = (profileRows ?? []).map((p) => ({
    id: p.id,
    username: p.username,
    displayName: p.display_name,
    avatarUrl: p.avatar_url,
    country: p.country,
    wins: p.wins,
    losses: p.losses,
    totalMatches: p.total_matches,
    goalsScored: p.goals_scored,
    goalsConceded: p.goals_conceded,
    footballGoalsScored: goalsMap.get(p.id)?.scored ?? 0,
    footballGoalsConceded: goalsMap.get(p.id)?.conceded ?? 0,
    winsByGame: [],
    totalTitles: p.total_titles,
    sentinelScore: p.sentinel_score,
    sentinelTier: p.sentinel_tier,
  }))
```

Update the Golden Boot `AwardCard`'s displayed value from `goldenBoot.goalsScored` to `goldenBoot.footballGoalsScored`:

```tsx
                {goldenBoot && (
                  <AwardCard
                    label="Golden Boot"
                    icon="👟"
                    name={goldenBoot.displayName ?? goldenBoot.username ?? 'Anonymous'}
                    metricLabel="goals scored"
                    metricValue={goldenBoot.footballGoalsScored}
                  />
                )}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors referencing this file

- [ ] **Step 3: Commit**

```bash
git add "app/(public)/hall-of-fame/page.tsx"
git commit -m "feat: #23 Hall of Fame computes football-scoped goals for Golden Boot"
```

---

### Task 7: `components/rankings/LeaderboardTabs.tsx` — rename the Goals tab

**Files:**
- Modify: `components/rankings/LeaderboardTabs.tsx`

- [ ] **Step 1: Update the tab label**

```typescript
const TABS: { key: LeaderboardMetric; label: string }[] = [
  { key: 'wins', label: 'Wins' },
  { key: 'score', label: 'Sentinel Score' },
  { key: 'goals', label: 'Goals (Football)' },
]
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add components/rankings/LeaderboardTabs.tsx
git commit -m "feat: #23 rename Goals tab to signal football-only scope"
```

---

### Task 8: `components/rankings/LeaderboardTable.tsx` — expandable wins rows + football goals value

**Files:**
- Modify: `components/rankings/LeaderboardTable.tsx`

- [ ] **Step 1: Write the full updated component**

```tsx
'use client'
import { Fragment, useState } from 'react'
import Link from 'next/link'
import { TierBadge } from '@/components/player/TierBadge'
import type { RankedPlayer, LeaderboardMetric } from '@/lib/rankings/leaderboard'

const METRIC_LABEL: Record<LeaderboardMetric, string> = { wins: 'W', score: 'Score', goals: 'Goals' }
const METRIC_VALUE: Record<LeaderboardMetric, (p: RankedPlayer) => number> = {
  wins: (p) => p.wins,
  score: (p) => p.sentinelScore,
  goals: (p) => p.footballGoalsScored,
}

export function LeaderboardTable({
  players,
  currentUserId,
  metric,
}: {
  players: RankedPlayer[]
  currentUserId: string | null
  metric: LeaderboardMetric
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const metricValue = METRIC_VALUE[metric]
  const expandable = metric === 'wins'

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-800 text-[11px] uppercase tracking-widest text-slate-500">
            <th className="px-3 py-3 text-left">#</th>
            <th className="px-2 py-3 text-left">Player</th>
            <th className="px-2 py-3 text-right">{METRIC_LABEL[metric]}</th>
            <th className="px-2 py-3 text-right">Win%</th>
            <th className="hidden px-2 py-3 text-right sm:table-cell">Titles</th>
            <th className="hidden px-3 py-3 text-right sm:table-cell">GD</th>
          </tr>
        </thead>
        <tbody>
          {players.map((pl) => {
            // A logged-in user with 0 matches is excluded by the page query, so there
            // is simply no row here to highlight — expected, not a bug.
            const isMe = currentUserId != null && pl.id === currentUserId
            const name = pl.displayName ?? pl.username ?? 'Anonymous'
            const initial = (name[0] ?? '?').toUpperCase()
            const isExpanded = expandable && expandedId === pl.id
            return (
              <Fragment key={pl.id}>
                <tr
                  onClick={expandable ? () => setExpandedId(isExpanded ? null : pl.id) : undefined}
                  className={`border-b border-slate-800/50 transition-colors last:border-0 ${
                    isMe ? 'bg-violet-500/10' : 'hover:bg-slate-800/40'
                  } ${expandable ? 'cursor-pointer' : ''}`}
                >
                  <td className="px-3 py-3.5 font-bold text-slate-400">
                    {pl.rank === 1 ? '🥇' : pl.rank === 2 ? '🥈' : pl.rank === 3 ? '🥉' : `#${pl.rank}`}
                  </td>
                  <td className="px-2 py-3.5">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-700 text-xs font-bold text-white">
                        {initial}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-semibold leading-tight text-white">
                          {pl.username ? (
                            <Link
                              href={`/players/${pl.username}`}
                              onClick={(e) => e.stopPropagation()}
                              className="hover:text-violet-300"
                            >
                              {name}
                            </Link>
                          ) : (
                            name
                          )}
                          {isMe && <span className="ml-1 text-[11px] text-violet-400">(you)</span>}
                          {expandable && (
                            <span className="ml-1.5 inline-block text-[10px] text-slate-500">
                              {isExpanded ? '▲' : '▼'}
                            </span>
                          )}
                        </p>
                        <TierBadge tier={pl.sentinelTier} />
                      </div>
                    </div>
                  </td>
                  <td className="px-2 py-3.5 text-right font-bold text-emerald-400">{metricValue(pl)}</td>
                  <td className="px-2 py-3.5 text-right text-slate-300">{Math.round(pl.winRate * 100)}%</td>
                  <td className="hidden px-2 py-3.5 text-right text-slate-400 sm:table-cell">{pl.totalTitles}</td>
                  <td className="hidden px-3 py-3.5 text-right font-bold text-white sm:table-cell">
                    {pl.goalDiff > 0 ? `+${pl.goalDiff}` : pl.goalDiff}
                  </td>
                </tr>
                {isExpanded && (
                  <tr className="border-b border-slate-800/50 bg-slate-950/50 last:border-0">
                    <td colSpan={6} className="px-6 py-3 text-xs text-slate-400">
                      {pl.winsByGame.length === 0
                        ? 'No wins recorded yet.'
                        : pl.winsByGame
                            .map((g) => `${g.game}: ${g.wins} win${g.wins === 1 ? '' : 's'}`)
                            .join(' · ')}
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add components/rankings/LeaderboardTable.tsx
git commit -m "feat: #23 expandable per-game wins breakdown on the Wins tab"
```

---

### Task 9: Audit — confirm no non-football players currently on the Goals tab

**Files:** none (verification only, per the design spec's §4 "verification step, not a permanent feature")

- [ ] **Step 1: Run an audit query**

Via `mcp__claude_ai_Supabase__execute_sql` (project_id `itxubrkbropttfdackmi`) or the Supabase SQL editor:

```sql
select p.username, count(*) as non_football_completed_matches
from matches m
join tournaments t on t.id = m.tournament_id
join games g on g.id = t.game_id
join profiles p on p.id in (m.player_a_id, m.player_b_id)
where m.status = 'completed' and g.category != 'football'
group by p.username;
```

Expected: zero rows (only Dream League Soccer exists today, and it defaults to `category = 'football'` per Task 1). If this returns rows, stop and report to the user before proceeding — it would mean a non-football game already has completed matches, which contradicts this plan's assumption that the Goals-tab filter is currently a no-op.

- [ ] **Step 2: Report the result**

No commit for this task — report the query result to the user as confirmation.

---

### Task 10: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test -- --run`
Expected: all tests pass (existing suite plus the 12 new `game-breakdown.test.ts` tests and the updated leaderboard/awards tests)

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: `✔ No ESLint warnings or errors`

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output (clean)

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: build succeeds

- [ ] **Step 5: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: #23 rankings improvements verification fixes"
```

(Skip this step if Steps 1–4 passed clean with no changes needed.)
