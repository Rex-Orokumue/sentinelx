# Multi-Game Champions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface a tournament's winner automatically whenever it completes — for
every game, every tournament type, and both formats — on Hall of Fame, the
homepage, the games page and the tournament page.

**Architecture:** One pure resolver (`lib/tournaments/champions.ts`) decides who
won a tournament, reusing the existing `getChampion`/`getRunnerUp` for the
knockout-final case and adding a standings + head-to-head branch for
`round_robin`. A thin fetch layer turns that into `ChampionEntry[]`, and four
surfaces render from it. No migration: the champion is derived, never stored.

**Tech Stack:** Next.js 14 App Router (server components), TypeScript, Tailwind
(`sx` tokens), Supabase server client, vitest.

**Spec:** `docs/superpowers/specs/2026-09-06-multi-game-champions-design.md`

**Note on code blocks:** Tasks 1–3 carry full test and implementation code —
that logic decides competitive outcomes and must be exact. Presentational tasks
(4–8) specify props, copy, structure and placement rather than verbatim JSX; the
existing card components and the spec are the source of truth for styling.

## Global Constraints

- Mobile-first: design at 375px, scale up.
- Server Components by default; `"use client"` only where interactivity demands it.
- Colours from the `sx` Tailwind tokens only. Icons from `lucide-react`.
- Money renders through `formatNaira`; dates through the WAT helpers in `lib/format.ts`.
- A champion is **derived, never stored**. No migration in this plan.
- `lib/tournaments/standings.ts` must NOT be modified — it is shared with the
  group-stage tables, bracket advancement and season points. Head-to-head lives
  in the champion resolver only.
- An undecided tournament yields no champion and is omitted from every surface.
  Never fall back to array order to pick a winner.
- Work happens in the worktree `C:\Users\gorok\Videos\sentinelx-champions` on
  branch `feat/multi-game-champions`. The primary checkout belongs to another
  agent — never commit from it.
- Before every commit: `git status -sb` (confirm branch) and
  `git diff --cached --name-only` (confirm only intended files are staged).
- Run tests scoped (`npx vitest run lib/tournaments`), not the root suite.
- Every commit ends with the Co-Authored-By and Claude-Session trailers.

---

### Task 1: Head-to-head tiebreak

**Files:**
- Create: `lib/tournaments/champions.ts`, `lib/tournaments/champions.test.ts`

**Interfaces:**
- Produces: `H2HMatch` = `{ playerAId: string; playerBId: string; scoreA: number | null; scoreB: number | null; status: string }`
  and `headToHeadWinner(aId: string, bId: string, matches: H2HMatch[]): string | null`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/tournaments/champions.test.ts
import { describe, it, expect } from 'vitest'
import { headToHeadWinner, type H2HMatch } from './champions'

const m = (a: string, b: string, sa: number, sb: number): H2HMatch => ({
  playerAId: a, playerBId: b, scoreA: sa, scoreB: sb, status: 'completed',
})

describe('headToHeadWinner', () => {
  it('gives it to whoever won the meeting', () => {
    expect(headToHeadWinner('x', 'y', [m('x', 'y', 2, 1)])).toBe('x')
    expect(headToHeadWinner('x', 'y', [m('x', 'y', 1, 2)])).toBe('y')
  })

  it('reads the fixture from either side', () => {
    expect(headToHeadWinner('x', 'y', [m('y', 'x', 3, 0)])).toBe('y')
  })

  it('aggregates multiple meetings on points', () => {
    // x won one, y won one, but x also drew the third -> x leads on points
    expect(headToHeadWinner('x', 'y', [m('x', 'y', 1, 0), m('y', 'x', 1, 0), m('x', 'y', 2, 2)])).toBe('x')
  })

  it('falls to head-to-head goal difference when points are level', () => {
    expect(headToHeadWinner('x', 'y', [m('x', 'y', 3, 0), m('y', 'x', 1, 0)])).toBe('x')
  })

  it('returns null when they are completely level', () => {
    expect(headToHeadWinner('x', 'y', [m('x', 'y', 1, 1)])).toBeNull()
    expect(headToHeadWinner('x', 'y', [m('x', 'y', 2, 0), m('y', 'x', 2, 0)])).toBeNull()
  })

  it('returns null when they never met', () => {
    expect(headToHeadWinner('x', 'y', [m('x', 'z', 5, 0)])).toBeNull()
  })

  it('ignores matches that are not completed or have no score', () => {
    expect(headToHeadWinner('x', 'y', [{ ...m('x', 'y', 3, 0), status: 'scheduled' }])).toBeNull()
    expect(headToHeadWinner('x', 'y', [{ ...m('x', 'y', 0, 0), scoreA: null }])).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run lib/tournaments/champions.test.ts`
Expected: FAIL — module `./champions` not found.

- [ ] **Step 3: Implement**

```ts
// lib/tournaments/champions.ts
export interface H2HMatch {
  playerAId: string
  playerBId: string
  scoreA: number | null
  scoreB: number | null
  status: string
}

// Fourth tiebreak for a round-robin title, applied only after points-per-game,
// goal difference and goals-for have all failed to separate two players.
// Standard football convention: head-to-head points, then head-to-head goal
// difference. Returns null when it genuinely cannot separate them — the caller
// must then report the title as undecided rather than guess.
export function headToHeadWinner(aId: string, bId: string, matches: H2HMatch[]): string | null {
  let pointsA = 0
  let pointsB = 0
  let goalsA = 0
  let goalsB = 0
  let met = false

  for (const m of matches) {
    if (m.status !== 'completed' || m.scoreA == null || m.scoreB == null) continue
    const isAB = m.playerAId === aId && m.playerBId === bId
    const isBA = m.playerAId === bId && m.playerBId === aId
    if (!isAB && !isBA) continue
    met = true

    const forA = isAB ? m.scoreA : m.scoreB
    const forB = isAB ? m.scoreB : m.scoreA
    goalsA += forA
    goalsB += forB
    if (forA > forB) pointsA += 3
    else if (forB > forA) pointsB += 3
    else {
      pointsA += 1
      pointsB += 1
    }
  }

  if (!met) return null
  if (pointsA !== pointsB) return pointsA > pointsB ? aId : bId
  const diffA = goalsA - goalsB
  if (diffA !== 0) return diffA > 0 ? aId : bId
  return null
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run lib/tournaments/champions.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/tournaments/champions.ts lib/tournaments/champions.test.ts
git commit -m "feat(champions): head-to-head tiebreak for round-robin titles"
```

---

### Task 2: Champion resolution

**Files:**
- Modify: `lib/tournaments/champions.ts`, `lib/tournaments/champions.test.ts`

**Interfaces:**
- Consumes: `headToHeadWinner` (Task 1); `getChampion`, `getRunnerUp`,
  `type BracketMatch` from `@/lib/tournaments/bracket`; `sortStandings`,
  `type MembershipInput` from `@/lib/tournaments/standings`.
- Produces: `Placing` = `{ id: string; name: string }`;
  `ChampionResult` = `{ champion: Placing; runnerUp: Placing | null }`;
  `resolveChampion(input: ResolveChampionInput): ChampionResult | null` where
  `ResolveChampionInput` = `{ bracketMatches: BracketMatch[]; standings?: MembershipInput[]; h2hMatches?: H2HMatch[] }`.

- [ ] **Step 1: Write the failing test**

```ts
// appended to lib/tournaments/champions.test.ts
import { resolveChampion } from './champions'
import type { BracketMatch } from './bracket'
import type { MembershipInput } from './standings'

const finalMatch = (sa: number, sb: number, status = 'completed'): BracketMatch =>
  ({
    round: 'final',
    status,
    score_a: sa,
    score_b: sb,
    playerA: { id: 'x', name: 'X' },
    playerB: { id: 'y', name: 'Y' },
  }) as unknown as BracketMatch

const member = (id: string, w: number, d: number, l: number, gf: number, ga: number): MembershipInput => ({
  playerId: id, name: id.toUpperCase(), wins: w, draws: d, losses: l,
  goalsFor: gf, goalsAgainst: ga, points: w * 3 + d,
})

describe('resolveChampion — knockout final', () => {
  it('crowns the winner of a completed final and names the runner-up', () => {
    const r = resolveChampion({ bracketMatches: [finalMatch(4, 2)] })
    expect(r?.champion.id).toBe('x')
    expect(r?.runnerUp?.id).toBe('y')
  })

  it('is undecided when the final is drawn', () => {
    expect(resolveChampion({ bracketMatches: [finalMatch(2, 2)] })).toBeNull()
  })

  it('is undecided when the final is not completed', () => {
    expect(resolveChampion({ bracketMatches: [finalMatch(4, 2, 'scheduled')] })).toBeNull()
  })
})

describe('resolveChampion — round robin', () => {
  it('crowns the top of the league table', () => {
    const standings = [member('a', 3, 0, 0, 9, 1), member('b', 1, 0, 2, 3, 6)]
    const r = resolveChampion({ bracketMatches: [], standings })
    expect(r?.champion.id).toBe('a')
    expect(r?.runnerUp?.id).toBe('b')
  })

  it('uses head-to-head when the top two are level on every standings tiebreak', () => {
    // identical record: same points, same GD, same goals-for
    const standings = [member('a', 2, 0, 1, 5, 3), member('b', 2, 0, 1, 5, 3)]
    const h2h: H2HMatch[] = [
      { playerAId: 'a', playerBId: 'b', scoreA: 2, scoreB: 0, status: 'completed' },
    ]
    const r = resolveChampion({ bracketMatches: [], standings, h2hMatches: h2h })
    expect(r?.champion.id).toBe('a')
    expect(r?.runnerUp?.id).toBe('b')
  })

  it('is undecided on a dead tie with no head-to-head separation', () => {
    const standings = [member('a', 2, 0, 1, 5, 3), member('b', 2, 0, 1, 5, 3)]
    const h2h: H2HMatch[] = [
      { playerAId: 'a', playerBId: 'b', scoreA: 1, scoreB: 1, status: 'completed' },
    ]
    expect(resolveChampion({ bracketMatches: [], standings, h2hMatches: h2h })).toBeNull()
  })

  it('is undecided on a dead tie when they never met', () => {
    const standings = [member('a', 2, 0, 1, 5, 3), member('b', 2, 0, 1, 5, 3)]
    expect(resolveChampion({ bracketMatches: [], standings, h2hMatches: [] })).toBeNull()
  })

  it('crowns a sole entrant with no runner-up', () => {
    const r = resolveChampion({ bracketMatches: [], standings: [member('a', 1, 0, 0, 2, 0)] })
    expect(r?.champion.id).toBe('a')
    expect(r?.runnerUp).toBeNull()
  })

  it('is undecided with neither a final nor standings', () => {
    expect(resolveChampion({ bracketMatches: [] })).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run lib/tournaments/champions.test.ts`
Expected: FAIL — `resolveChampion` is not exported.

- [ ] **Step 3: Implement**

Append to `lib/tournaments/champions.ts`:

```ts
import { getChampion, getRunnerUp, type BracketMatch } from './bracket'
import { sortStandings, type MembershipInput } from './standings'

export interface Placing {
  id: string
  name: string
}

export interface ChampionResult {
  champion: Placing
  runnerUp: Placing | null
}

export interface ResolveChampionInput {
  bracketMatches: BracketMatch[]
  standings?: MembershipInput[]
  h2hMatches?: H2HMatch[]
}

// Two branches, because the platform runs two formats:
//   group_knockout -> a `final` match decides it (reuses the bracket helpers
//                     the bracket page already renders from)
//   round_robin    -> no final exists; the League Table decides it
// A tie the tiebreaks cannot separate returns null. sortStandings is a stable
// sort, so two level players come back in input order — crowning rank 1 there
// would silently pick an arbitrary winner.
export function resolveChampion({
  bracketMatches,
  standings,
  h2hMatches = [],
}: ResolveChampionInput): ChampionResult | null {
  const fromFinal = getChampion(bracketMatches)
  if (fromFinal) {
    return { champion: fromFinal, runnerUp: getRunnerUp(bracketMatches) }
  }
  // A final exists but isn't decided yet — don't fall through to standings and
  // crown the group leader while the final is still to be played.
  if (bracketMatches.some((m) => m.round === 'final')) return null

  if (!standings || standings.length === 0) return null

  const table = sortStandings(standings)
  const first = table[0]
  const second = table[1] ?? null
  if (!first) return null
  if (!second) return { champion: { id: first.playerId, name: first.name }, runnerUp: null }

  const level =
    first.points / Math.max(first.played, 1) === second.points / Math.max(second.played, 1) &&
    first.goalDiff === second.goalDiff &&
    first.goalsFor === second.goalsFor

  if (level) {
    const decided = headToHeadWinner(first.playerId, second.playerId, h2hMatches)
    if (decided === null) return null
    const winner = decided === first.playerId ? first : second
    const loser = decided === first.playerId ? second : first
    return {
      champion: { id: winner.playerId, name: winner.name },
      runnerUp: { id: loser.playerId, name: loser.name },
    }
  }

  return {
    champion: { id: first.playerId, name: first.name },
    runnerUp: { id: second.playerId, name: second.name },
  }
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run lib/tournaments/champions.test.ts`
Expected: PASS

- [ ] **Step 5: Confirm nothing else regressed**

Run: `npx vitest run lib/tournaments`
Expected: PASS — in particular the existing `bracket` and `standings` suites,
which this task must not alter.

- [ ] **Step 6: Commit**

```bash
git add lib/tournaments/champions.ts lib/tournaments/champions.test.ts
git commit -m "feat(champions): resolve champions from a final or a league table"
```

---

### Task 3: Entries, selectors and fetch

**Files:**
- Modify: `lib/tournaments/champions.ts`, `lib/tournaments/champions.test.ts`

**Interfaces:**
- Consumes: `resolveChampion` (Task 2).
- Produces: `TournamentType` = `'champions_cup' | 'masters' | 'community_club' | 'open'`;
  `ChampionEntry` (fields per spec);
  `groupByType(entries: ChampionEntry[]): Record<TournamentType, ChampionEntry[]>`;
  `latestChampion(entries: ChampionEntry[]): ChampionEntry | null`;
  `reigningChampionByGame(entries: ChampionEntry[]): Map<string, ChampionEntry>`;
  `fetchChampions(supabase, opts?: { gameId?: string }): Promise<ChampionEntry[]>`.

- [ ] **Step 1: Write the failing test**

```ts
// appended to lib/tournaments/champions.test.ts
import { groupByType, latestChampion, reigningChampionByGame, type ChampionEntry } from './champions'

const entry = (over: Partial<ChampionEntry>): ChampionEntry => ({
  tournamentId: 't1', slug: 't-1', title: 'T1', tournamentType: 'open',
  gameId: 'g1', gameName: 'DLS', date: '2026-01-01T00:00:00Z', prizePool: 1000,
  champion: { id: 'p1', name: 'P1' }, runnerUp: null,
  ...over,
})

describe('groupByType', () => {
  it('buckets every entry under its own type', () => {
    const g = groupByType([
      entry({ tournamentId: 'a', tournamentType: 'open' }),
      entry({ tournamentId: 'b', tournamentType: 'masters' }),
      entry({ tournamentId: 'c', tournamentType: 'open' }),
    ])
    expect(g.open.map((e) => e.tournamentId)).toEqual(['a', 'c'])
    expect(g.masters).toHaveLength(1)
  })

  it('always returns a bucket for every type, so a section can check length safely', () => {
    const g = groupByType([])
    expect(g.open).toEqual([])
    expect(g.masters).toEqual([])
    expect(g.community_club).toEqual([])
    expect(g.champions_cup).toEqual([])
  })
})

describe('latestChampion', () => {
  it('picks the most recent by date', () => {
    const r = latestChampion([
      entry({ tournamentId: 'old', date: '2026-01-01T00:00:00Z' }),
      entry({ tournamentId: 'new', date: '2026-06-01T00:00:00Z' }),
    ])
    expect(r?.tournamentId).toBe('new')
  })

  it('returns null for no entries', () => {
    expect(latestChampion([])).toBeNull()
  })

  it('ignores entries with no date rather than ranking them first', () => {
    const r = latestChampion([entry({ tournamentId: 'undated', date: null }), entry({ tournamentId: 'dated' })])
    expect(r?.tournamentId).toBe('dated')
  })
})

describe('reigningChampionByGame', () => {
  it('keeps only the most recent champion per game', () => {
    const map = reigningChampionByGame([
      entry({ tournamentId: 'dls-old', gameId: 'g1', date: '2026-01-01T00:00:00Z' }),
      entry({ tournamentId: 'dls-new', gameId: 'g1', date: '2026-05-01T00:00:00Z' }),
      entry({ tournamentId: 'fc', gameId: 'g2', date: '2026-03-01T00:00:00Z' }),
    ])
    expect(map.get('g1')?.tournamentId).toBe('dls-new')
    expect(map.get('g2')?.tournamentId).toBe('fc')
    expect(map.size).toBe(2)
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run lib/tournaments/champions.test.ts`
Expected: FAIL — `groupByType` is not exported.

- [ ] **Step 3: Implement the selectors**

```ts
export type TournamentType = 'champions_cup' | 'masters' | 'community_club' | 'open'

export interface ChampionEntry {
  tournamentId: string
  slug: string
  title: string
  tournamentType: TournamentType
  gameId: string
  gameName: string
  date: string | null
  prizePool: number | null
  champion: Placing
  runnerUp: Placing | null
}

export const TOURNAMENT_TYPES: readonly TournamentType[] = [
  'champions_cup', 'masters', 'community_club', 'open',
] as const

// Seeded with every type so a section can read `groups.masters.length` without
// an existence check and a new type can never render as undefined.
export function groupByType(entries: ChampionEntry[]): Record<TournamentType, ChampionEntry[]> {
  const out = Object.fromEntries(TOURNAMENT_TYPES.map((t) => [t, [] as ChampionEntry[]])) as Record<
    TournamentType,
    ChampionEntry[]
  >
  for (const e of entries) if (out[e.tournamentType]) out[e.tournamentType].push(e)
  return out
}

function time(e: ChampionEntry): number {
  return e.date ? new Date(e.date).getTime() : Number.NEGATIVE_INFINITY
}

// Undated entries sort to -Infinity, so any dated entry beats them; if every
// entry is undated the first one is returned rather than nothing.
export function latestChampion(entries: ChampionEntry[]): ChampionEntry | null {
  let best: ChampionEntry | null = null
  for (const e of entries) if (!best || time(e) > time(best)) best = e
  return best
}

export function reigningChampionByGame(entries: ChampionEntry[]): Map<string, ChampionEntry> {
  const map = new Map<string, ChampionEntry>()
  for (const e of entries) {
    const cur = map.get(e.gameId)
    if (!cur || time(e) > time(cur)) map.set(e.gameId, e)
  }
  return map
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run lib/tournaments/champions.test.ts`
Expected: PASS

- [ ] **Step 5: Add `fetchChampions`**

Append to `lib/tournaments/champions.ts`. It is a thin Supabase read, verified by
the pages rendering rather than by mocking the query builder:

1. Select completed tournaments — `id, slug, title, tournament_type, prize_pool,
   tournament_end, game_id, games(name)` — filtered by `gameId` when given,
   ordered by `tournament_end` descending.
2. Select all matches for those tournament ids with the player joins the bracket
   helpers expect (`player_a:profiles!matches_player_a_id_fkey(id, username,
   display_name)` and the `player_b` equivalent), mapped into `BracketMatch`
   shape the same way `hall-of-fame/page.tsx` already does.
3. For any tournament whose matches contain no `final` round, read its single
   group (`groups` where `tournament_id` matches) and that group's
   `group_memberships` rows, mapped to `MembershipInput` exactly as
   `lib/matches/season-points.ts` does. Player display names come from the
   profile join already loaded in step 2.
4. Call `resolveChampion` per tournament; drop the ones returning `null`; return
   the surviving `ChampionEntry[]`, newest first.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add lib/tournaments/champions.ts lib/tournaments/champions.test.ts
git commit -m "feat(champions): champion entries, selectors and fetch layer"
```

---

### Task 4: Tournament champion card and game filter

**Files:**
- Create: `components/hall-of-fame/TournamentChampionCard.tsx`,
  `components/hall-of-fame/HallOfFameGameFilter.tsx`

**Interfaces:**
- Consumes: `ChampionEntry` (Task 3).
- Produces: `<TournamentChampionCard entry={ChampionEntry} avatarUrl={string | null} />`
  and `<HallOfFameGameFilter games={{ id: string; name: string; slug: string }[]} active={string | null} />`.

- [ ] **Step 1: Build `TournamentChampionCard`**

The `open`-type champion card, styled as a sibling of the existing
`CommunityClubCard` (same `sx-surface` panel, border and rounding) so the four
sections read as one family. Shows: champion avatar (`HexAvatar`, matching the
other champion cards), champion name linking to `/players/<name>`, the tournament
title linking to `/tournaments/<slug>`, the game name as a small badge, the date
via `formatDate`, the prize pool via `formatNaira` when non-null, and
`runnerUp.name` as a muted "Runner-up" line when present.

- [ ] **Step 2: Build `HallOfFameGameFilter`**

A server-rendered row of links (no `"use client"`), mirroring `/tournaments`:
an "All Games" pill plus one pill per active game, each linking to
`/hall-of-fame?game=<slug>` (the All pill links to `/hall-of-fame`). The active
pill uses the purple treatment used by the exchange category chips. The whole
component returns `null` when `games.length < 2`, so the filter only appears once
a second game is active.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean apart from `hall-of-fame/page.tsx`, which Task 5 rewrites.

- [ ] **Step 4: Commit**

```bash
git add components/hall-of-fame/TournamentChampionCard.tsx components/hall-of-fame/HallOfFameGameFilter.tsx
git commit -m "feat(champions): tournament champion card and hall-of-fame game filter"
```

---

### Task 5: Rework Hall of Fame

**Files:**
- Modify: `app/[locale]/(public)/hall-of-fame/page.tsx`

**Interfaces:**
- Consumes: `fetchChampions`, `groupByType` (Task 3); both components (Task 4).

- [ ] **Step 1: Replace champion fetching**

Delete the three `.eq('tournament_type', …)` queries and the per-type champion
derivation they feed. Call `fetchChampions(supabase, { gameId })` once and
`groupByType` on the result. The page gains
`searchParams: { game?: string }`; the slug resolves to a game id against the
active games already queried, and an unknown slug is treated as no filter.

- [ ] **Step 2: Render the sections from the groups**

`champions_cup` → `ChampionsCupCard`, `masters` → `MastersChampionCard`,
`community_club` → `CommunityClubCard`, `open` → `TournamentChampionCard` under a
new section headed "Tournament Champions" with the subtitle
"Every other competition across the platform." Each existing section keeps its
current heading, icon, tone and layout.

Empty behaviour: when a game filter is active, a section with no entries renders
nothing. With no filter, the existing `ChampionsCupEmptyCard` /
`MastersChampionEmptyCard` / `EmptyState` placeholders are kept exactly as today.

- [ ] **Step 3: Apply the game filter to the rest of the page**

Render `<HallOfFameGameFilter>` directly beneath the page header. Scope All-Time
Awards and Bronze Finishes to the selected game: the awards already derive from
per-game match aggregates, and the Bronze query already reads all completed
tournaments — both take the same `gameId` narrowing.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm run build && npx vitest run lib/tournaments`
Then load `/hall-of-fame` and confirm **DER_KAISER appears under Tournament
Champions** for the SentinelX FC Mobile Premier League, and that
`/hall-of-fame?game=ea-fc-mobile` shows only that game.

- [ ] **Step 5: Commit**

```bash
git add "app/[locale]/(public)/hall-of-fame/page.tsx"
git commit -m "feat(champions): hall of fame covers every tournament type and game"
```

---

### Task 6: Homepage champion spotlight

**Files:**
- Create: `components/home/ChampionSpotlight.tsx`
- Modify: `app/[locale]/page.tsx`

**Interfaces:**
- Consumes: `fetchChampions`, `latestChampion` (Task 3).
- Produces: `<ChampionSpotlight entry={ChampionEntry} avatarUrl={string | null} />`.

- [ ] **Step 1: Build the component**

A single feature panel: "Latest Champion" eyebrow, champion avatar and name,
the game as a badge, tournament title, date, and a link to
`/tournaments/<slug>`. Uses the `sx` tokens and the glow/oversized-value
treatment the rest of the product uses for celebratory stats.

- [ ] **Step 2: Wire it into the homepage**

Call `fetchChampions` then `latestChampion`; render the panel only when it
returns an entry, so a platform with no decided champion shows nothing rather
than an empty frame. Place it after the hero, before the existing tournament
sections.

- [ ] **Step 3: Verify and commit**

Run: `npx tsc --noEmit && npm run build`, then load `/` and confirm the FC Mobile
champion appears.

```bash
git add components/home/ChampionSpotlight.tsx "app/[locale]/page.tsx"
git commit -m "feat(champions): homepage latest-champion spotlight"
```

---

### Task 7: Games page reigning champion

**Files:**
- Modify: `app/[locale]/(public)/games/page.tsx`

**Interfaces:**
- Consumes: `fetchChampions`, `reigningChampionByGame` (Task 3).

- [ ] **Step 1: Add the champion line**

Fetch champions once in the page and build the map. `GameCard` takes a new
optional `champion?: { name: string; tournamentSlug: string }` prop and renders a
single muted line — a small trophy icon plus "Champion: <name>" linking to the
tournament — beneath the existing stats row. Omitted entirely when the game has
no decided champion, so a newly activated game simply has no line.

- [ ] **Step 2: Verify and commit**

Run: `npx tsc --noEmit && npm run build`, then load `/games` and confirm EA FC
Mobile shows DER_KAISER and games without a champion show no line. Re-check the
card at 360px — the line must not reintroduce horizontal overflow.

```bash
git add "app/[locale]/(public)/games/page.tsx"
git commit -m "feat(champions): reigning champion on each game card"
```

---

### Task 8: Tournament page champion banner

**Files:**
- Create: `components/tournaments/ChampionBanner.tsx`
- Modify: `app/[locale]/(public)/tournaments/[slug]/page.tsx`

**Interfaces:**
- Consumes: `resolveChampion` (Task 2).
- Produces: `<ChampionBanner champion={Placing} runnerUp={Placing | null} prizePool={number | null} />`.

- [ ] **Step 1: Build and place the banner**

A celebratory panel naming the champion (linking to their profile), the runner-up
when present, and the prize pool via `formatNaira`. The tournament page already
loads its bracket matches, so it calls `resolveChampion` on those directly rather
than refetching. Rendered only when the tournament is `completed` **and**
`resolveChampion` returns a result; an undecided completed tournament keeps
today's presentation.

- [ ] **Step 2: Verify and commit**

Run: `npx tsc --noEmit && npm run build && npm run lint`, then load
`/tournaments/sentinelx-fc-mobile-premier-league` and confirm the banner names
DER_KAISER with AAGREATTEAM as runner-up.

```bash
git add components/tournaments/ChampionBanner.tsx "app/[locale]/(public)/tournaments/[slug]/page.tsx"
git commit -m "feat(champions): champion banner on completed tournament pages"
```

---

## Verification before completion

- [ ] `npx vitest run lib/tournaments` — all pass, including the pre-existing
      `bracket` and `standings` suites (proving `sortStandings` is untouched)
- [ ] `npx tsc --noEmit` — clean
- [ ] `npm run build` — clean
- [ ] `npm run lint` — clean
- [ ] `/hall-of-fame` shows DER_KAISER under Tournament Champions
- [ ] `/hall-of-fame?game=ea-fc-mobile` shows only EA FC Mobile
- [ ] `/hall-of-fame` with no filter still shows the aspirational empty cards
- [ ] `/`, `/games` and the FC Mobile tournament page all name the champion
- [ ] `/hall-of-fame` and `/games` at 360px — no horizontal overflow
- [ ] `git diff origin/main --stat` touches no file outside this plan
