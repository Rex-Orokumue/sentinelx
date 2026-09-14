# Team-vs-team matches — Phase 6b: stats consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A player's win/loss/goals totals, MVP/Golden Boot eligibility, per-game breakdown, win streak, and recent-matches list all correctly reflect team-tournament matches they played, not just solo 1v1 — matching what refreshPlayer already does for `sx_score` (Phase 3-4-5) but currently doesn't do for the cached `profiles` aggregate columns or the three pages that independently recompute category/game stats live.

**Architecture:** One shared generalization (`sideAIds`/`sideBIds` in `lib/tournaments/advancement.ts`) expands a match's side to its full roster — a single id for a solo match, every squad member for a team match — and every consumer (`lib/rankings/game-breakdown.ts`, `lib/rankings/streak.ts`) is rewritten to attribute a match's outcome to every id on a side instead of a single `player_a_id`/`player_b_id`. Each of the 4 independent call sites (`refreshPlayer`, `hall-of-fame/page.tsx`, `rankings/page.tsx`, `players/[username]/page.tsx`, the rank-snapshot cron) resolves its own matches' rosters via the batched `rostersForSquads` helper (Phase 6a, Task 1) and attaches them before calling the shared functions.

**Tech Stack:** Next.js 14 (App Router) Server Components, Supabase, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-13-team-vs-team-matches-design.md` §8 ("SX Score" — the roster-cascading precedent this plan extends to the separate `profiles` aggregate columns and rankings/Hall-of-Fame stats, which §8 doesn't itself cover). Builds on `docs/superpowers/plans/2026-09-14-team-vs-team-matches-phase3-4-5-bracket-match-economy.md`'s "Explicit scope boundary" (which named `profiles` aggregate stats as deferred here) and `docs/superpowers/plans/2026-09-14-team-vs-team-matches-phase6a-public-rendering.md` (Task 1's `rostersForSquads` is a prerequisite — run Phase 6a before this plan, or at minimum land its Task 1).

## Global Constraints

- **Depends on Phase 6a Task 1.** `rostersForSquads(client, squadIds)` and the widened `SupabaseClient<Database>` typing on `lib/tournaments/squad-roster.ts` must exist before Task 4 of this plan. If Phase 6a hasn't merged yet, cherry-pick that one task first.
- **Solo 1v1 must stay byte-for-byte identical.** Every existing test fixture that never sets a team field continues to produce the exact same result — `sideAIds`/`sideBIds` fall back to `[player_a_id]`/`[player_b_id]` (or `[]` for an unpopulated side) when no roster is attached. The existing test suite (`npm run test`) must stay green **without modification**.
- **No new migration.** Every column this plan reads already exists.
- **A squad's own id is never itself a ranking-eligible "player"** — `profiles.gte('total_matches', RANKING_MIN_MATCHES)` and every ranking query stays keyed on real player ids; squad ids only ever appear transiently inside a match row before being expanded to roster player ids.

---

## Task 1: `advancement.ts` — roster-aware side resolution

**Files:**
- Modify: `lib/tournaments/advancement.ts`
- Test: `lib/tournaments/advancement.test.ts`

**Interfaces:**
- Produces: `RosterAwareMatch` (extends `AdvanceMatch` with optional `team_a_roster?: string[]`, `team_b_roster?: string[]`), `sideAIds(m: RosterAwareMatch): string[]`, `sideBIds(m: RosterAwareMatch): string[]`. Every task in this plan that attributes a match outcome to individual players imports these two functions.

- [ ] **Step 1: Write the failing test**

```typescript
// Add to lib/tournaments/advancement.test.ts
import { sideAIds, sideBIds, type RosterAwareMatch } from './advancement'

describe('sideAIds / sideBIds', () => {
  it('returns the single player id for a solo match', () => {
    const m: RosterAwareMatch = { status: 'completed', score_a: 1, score_b: 0, player_a_id: 'a', player_b_id: 'b' }
    expect(sideAIds(m)).toEqual(['a'])
    expect(sideBIds(m)).toEqual(['b'])
  })

  it('returns the roster for a team match', () => {
    const m: RosterAwareMatch = {
      status: 'completed', score_a: 1, score_b: 0,
      player_a_id: null, player_b_id: null,
      team_a_id: 'sq1', team_b_id: 'sq2',
      team_a_roster: ['p1', 'p2'], team_b_roster: ['p3', 'p4'],
    }
    expect(sideAIds(m)).toEqual(['p1', 'p2'])
    expect(sideBIds(m)).toEqual(['p3', 'p4'])
  })

  it('returns an empty roster for a team match whose roster was never attached', () => {
    const m: RosterAwareMatch = { status: 'completed', score_a: 1, score_b: null, player_a_id: null, player_b_id: null, team_a_id: 'sq1', team_b_id: null }
    expect(sideAIds(m)).toEqual([])
  })

  it('returns an empty array for an unpopulated side (an open bye slot)', () => {
    const m: RosterAwareMatch = { status: 'bye', score_a: null, score_b: null, player_a_id: 'a', player_b_id: null }
    expect(sideBIds(m)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/tournaments/advancement.test.ts`
Expected: FAIL — `sideAIds`/`sideBIds`/`RosterAwareMatch` are not exported.

- [ ] **Step 3: Implement**

Add to `lib/tournaments/advancement.ts`, near the existing `sideAId`/`sideBId`:

```typescript
export interface RosterAwareMatch extends AdvanceMatch {
  // A team match's full roster for each side — attached by the caller
  // (which already knows how to batch-resolve squad_members, e.g. via
  // rostersForSquads) rather than queried here. Absent/undefined for a
  // solo match, or for a team match whose caller didn't attach it (treated
  // as an empty roster, never as "fall back to the squad id itself" — a
  // squad id is never a real player id, so attributing to it would corrupt
  // a per-player stat rather than just under-count it).
  team_a_roster?: string[]
  team_b_roster?: string[]
}

// All ids on a match's side A: the roster for a team match, the single
// player for a solo match, or empty for an unpopulated side (a bye's open
// slot, or a team match whose roster wasn't attached).
export function sideAIds(m: RosterAwareMatch): string[] {
  if (m.team_a_id) return m.team_a_roster ?? []
  return m.player_a_id ? [m.player_a_id] : []
}
export function sideBIds(m: RosterAwareMatch): string[] {
  if (m.team_b_id) return m.team_b_roster ?? []
  return m.player_b_id ? [m.player_b_id] : []
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/tournaments/advancement.test.ts`
Expected: PASS, including every pre-existing `matchWinnerId`/`roundResolved`/`pairWinners`/`nextRoundName`/`thirdPlacePair` test unmodified.

- [ ] **Step 5: Typecheck and full suite**

Run: `npx tsc --noEmit && npm run test`

- [ ] **Step 6: Commit**

```bash
git add lib/tournaments/advancement.ts lib/tournaments/advancement.test.ts
git commit -m "feat(tournaments): sideAIds/sideBIds roster-aware side resolution"
```

---

## Task 2: `game-breakdown.ts` — roster-expanded wins/category/game stats

**Files:**
- Modify: `lib/rankings/game-breakdown.ts`
- Test: `lib/rankings/game-breakdown.test.ts`

**Interfaces:**
- Consumes: `sideAIds`, `sideBIds`, `RosterAwareMatch` from Task 1.
- Produces: `GameScopedMatch` now extends `RosterAwareMatch` (gains optional `team_a_roster`/`team_b_roster`) instead of `AdvanceMatch` directly. `winsByPlayerAndGame`, `scoreStatsByPlayerAndCategory`, `scoreStatsByPlayerAndGame` unchanged signatures, now attribute a team match's win/goals to every roster id on the winning/scoring side instead of silently skipping it.

- [ ] **Step 1: Write the failing tests**

```typescript
// Add to lib/rankings/game-breakdown.test.ts
function teamMatch(over: Partial<GameScopedMatch>): GameScopedMatch {
  return {
    status: 'completed',
    score_a: 2,
    score_b: 1,
    player_a_id: null,
    player_b_id: null,
    team_a_id: 'sq1',
    team_b_id: 'sq2',
    team_a_roster: ['p1', 'p2'],
    team_b_roster: ['p3', 'p4'],
    game_id: 'dls-id',
    game_name: 'DLS',
    game_category: 'football',
    ...over,
  }
}

describe('winsByPlayerAndGame with a team match', () => {
  it('credits every roster member of the winning squad, not the squad id', () => {
    const r = winsByPlayerAndGame([teamMatch({})])
    expect(r.get('p1')).toEqual([{ game: 'DLS', wins: 1 }])
    expect(r.get('p2')).toEqual([{ game: 'DLS', wins: 1 }])
    expect(r.get('p3')).toBeUndefined()
    expect(r.get('sq1')).toBeUndefined()
  })
})

describe('scoreStatsByPlayerAndCategory with a team match', () => {
  it('credits every roster member on both sides with their side\'s scored/conceded', () => {
    const r = scoreStatsByPlayerAndCategory([teamMatch({})], 'football')
    expect(r.get('p1')).toEqual({ scored: 2, conceded: 1 })
    expect(r.get('p3')).toEqual({ scored: 1, conceded: 2 })
  })

  it('skips a team match whose roster was never attached, rather than crediting the squad id', () => {
    const r = scoreStatsByPlayerAndCategory([teamMatch({ team_a_roster: undefined, team_b_roster: undefined })], 'football')
    expect(r.size).toBe(0)
  })
})

describe('scoreStatsByPlayerAndGame with a team match', () => {
  it('credits every roster member', () => {
    const r = scoreStatsByPlayerAndGame([teamMatch({})], 'dls-id')
    expect(r.get('p2')).toEqual({ scored: 2, conceded: 1 })
    expect(r.get('p4')).toEqual({ scored: 1, conceded: 2 })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/rankings/game-breakdown.test.ts`
Expected: FAIL — current functions key on `player_a_id`/`player_b_id`, both `null` for these fixtures, so every new assertion returns `undefined`/empty instead of the roster-credited values.

- [ ] **Step 3: Implement**

```typescript
import { matchWinnerId, sideAId, sideBId, sideAIds, sideBIds, type RosterAwareMatch } from '@/lib/tournaments/advancement'

export interface GameScopedMatch extends RosterAwareMatch {
  game_id: string
  game_name: string
  game_category: string
}
```

(`sideAId`/`sideBId` — singular — are already exported from `advancement.ts`, confirmed by reading it — no visibility change needed, just import them alongside `matchWinnerId`.)

```typescript
export function winsByPlayerAndGame(matches: GameScopedMatch[]): Map<string, GameWinCount[]> {
  const counts = new Map<string, Map<string, number>>()
  for (const match of matches) {
    const winnerId = matchWinnerId(match)
    if (!winnerId) continue
    const winnerIds = winnerId === sideAId(match) ? sideAIds(match) : sideBIds(match)
    for (const id of winnerIds) {
      const byGame = counts.get(id) ?? new Map<string, number>()
      byGame.set(match.game_name, (byGame.get(match.game_name) ?? 0) + 1)
      counts.set(id, byGame)
    }
  }
  const result = new Map<string, GameWinCount[]>()
  counts.forEach((byGame, playerId) => {
    const entries: GameWinCount[] = []
    byGame.forEach((wins, game) => entries.push({ game, wins }))
    result.set(playerId, entries)
  })
  return result
}
```

```typescript
export function scoreStatsByPlayerAndCategory(
  matches: GameScopedMatch[],
  category: string,
): Map<string, { scored: number; conceded: number }> {
  const result = new Map<string, { scored: number; conceded: number }>()
  for (const match of matches) {
    if (match.game_category !== category) continue
    if (match.status !== 'completed') continue
    if (match.score_a == null || match.score_b == null) continue
    const aIds = sideAIds(match)
    const bIds = sideBIds(match)
    if (aIds.length === 0 || bIds.length === 0) continue

    for (const id of aIds) {
      const s = result.get(id) ?? { scored: 0, conceded: 0 }
      s.scored += match.score_a
      s.conceded += match.score_b
      result.set(id, s)
    }
    for (const id of bIds) {
      const s = result.get(id) ?? { scored: 0, conceded: 0 }
      s.scored += match.score_b
      s.conceded += match.score_a
      result.set(id, s)
    }
  }
  return result
}
```

```typescript
export function scoreStatsByPlayerAndGame(
  matches: GameScopedMatch[],
  gameId: string,
): Map<string, { scored: number; conceded: number }> {
  const result = new Map<string, { scored: number; conceded: number }>()
  for (const match of matches) {
    if (match.game_id !== gameId) continue
    if (match.status !== 'completed') continue
    if (match.score_a == null || match.score_b == null) continue
    const aIds = sideAIds(match)
    const bIds = sideBIds(match)
    if (aIds.length === 0 || bIds.length === 0) continue

    for (const id of aIds) {
      const s = result.get(id) ?? { scored: 0, conceded: 0 }
      s.scored += match.score_a
      s.conceded += match.score_b
      result.set(id, s)
    }
    for (const id of bIds) {
      const s = result.get(id) ?? { scored: 0, conceded: 0 }
      s.scored += match.score_b
      s.conceded += match.score_a
      result.set(id, s)
    }
  }
  return result
}
```

`footballGoalsByPlayer`, `categoryStat`, `gameStat` are untouched — they either delegate to the functions above or operate on already-aggregated data.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/rankings/game-breakdown.test.ts`
Expected: PASS, including every pre-existing solo-match test unmodified (their fixtures have no `team_a_id`, so `sideAIds`/`sideBIds` fall back to `[player_a_id]`/`[player_b_id]` exactly as the old code read them directly).

- [ ] **Step 5: Typecheck and full suite**

Run: `npx tsc --noEmit && npm run test`

- [ ] **Step 6: Commit**

```bash
git add lib/rankings/game-breakdown.ts lib/rankings/game-breakdown.test.ts
git commit -m "feat(rankings): game-breakdown stats credit every roster member on a team match"
```

---

## Task 3: `streak.ts` — roster-expanded win streak

**Files:**
- Modify: `lib/rankings/streak.ts`
- Test: `lib/rankings/streak.test.ts`

**Interfaces:**
- Consumes: `sideAId`, `sideAIds`, `sideBIds` from Task 1/2's advancement.ts exports.
- Produces: `StreakMatch` now extends `RosterAwareMatch` instead of `AdvanceMatch`. `longestWinStreakByPlayer` unchanged signature, now tracks a streak per roster member on a team match.

- [ ] **Step 1: Write the failing test**

```typescript
// Add to lib/rankings/streak.test.ts
import type { RosterAwareMatch } from '@/lib/tournaments/advancement'

const teamM = (over: Partial<StreakMatch>): StreakMatch => ({
  status: 'completed',
  score_a: 1,
  score_b: 0,
  player_a_id: null,
  player_b_id: null,
  team_a_id: 'sq1',
  team_b_id: 'sq2',
  team_a_roster: ['p1', 'p2'],
  team_b_roster: ['p3', 'p4'],
  completed_at: '2026-01-01',
  ...over,
})

describe('longestWinStreakByPlayer with team matches', () => {
  it('credits every roster member of the winning squad with the streak', () => {
    const map = longestWinStreakByPlayer([
      teamM({ completed_at: '2026-01-01' }),
      teamM({ completed_at: '2026-01-02' }),
    ])
    expect(map.get('p1')).toBe(2)
    expect(map.get('p2')).toBe(2)
    expect(map.get('p3')).toBe(0)
  })

  it('breaks a roster member\'s streak on their squad losing', () => {
    const map = longestWinStreakByPlayer([
      teamM({ completed_at: '2026-01-01' }),
      teamM({ completed_at: '2026-01-02', score_a: 0, score_b: 1 }),
    ])
    expect(map.get('p1')).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/rankings/streak.test.ts`
Expected: FAIL — current code iterates `[match.player_a_id, match.player_b_id]`, both `null` for these fixtures, so nobody is credited.

- [ ] **Step 3: Implement**

```typescript
import { matchWinnerId, sideAId, sideAIds, sideBIds, type RosterAwareMatch } from '@/lib/tournaments/advancement'

export type StreakMatch = RosterAwareMatch & { completed_at: string | null }

// Longest run of consecutive wins per player, over completed matches in
// chronological order. Both a loss and a draw break a run — reuses
// matchWinnerId so "who won" has a single implementation. A team match's
// win/loss applies identically to every roster member.
export function longestWinStreakByPlayer(matches: StreakMatch[]): Map<string, number> {
  const ordered = [...matches].sort((a, b) =>
    (a.completed_at ?? '').localeCompare(b.completed_at ?? ''),
  )

  const best = new Map<string, number>()
  const running = new Map<string, number>()

  for (const match of ordered) {
    const winner = matchWinnerId(match)
    const winnerIds = new Set(winner == null ? [] : winner === sideAId(match) ? sideAIds(match) : sideBIds(match))
    for (const id of [...sideAIds(match), ...sideBIds(match)]) {
      const next = winnerIds.has(id) ? (running.get(id) ?? 0) + 1 : 0
      running.set(id, next)
      if (next > (best.get(id) ?? 0)) best.set(id, next)
    }
  }

  return best
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/rankings/streak.test.ts`
Expected: PASS, including every pre-existing solo-match test unmodified.

- [ ] **Step 5: Typecheck and full suite**

Run: `npx tsc --noEmit && npm run test`

- [ ] **Step 6: Commit**

```bash
git add lib/rankings/streak.ts lib/rankings/streak.test.ts
git commit -m "feat(rankings): win-streak credits every roster member on a team match"
```

---

## Task 4: `lib/scoring/stats.ts` — pure helpers for a team match, one player's perspective

**Files:**
- Modify: `lib/scoring/stats.ts`
- Test: `lib/scoring/stats.test.ts`

**Interfaces:**
- Produces: `completedMatchesForSquadPlayer(playerId: string, squadIds: Set<string>, matches: TeamMatchRow[]): CompletedMatch[]` — translates every completed team match where one of `squadIds` is on a side into a `CompletedMatch` with `playerId` standing in for that side (the existing `computeAggregates` only ever compares `player_a_id === playerId`, so the opposite side's id is never read — any placeholder is safe there). `teamTitlesWon(playerId: string, squadIds: Set<string>, finals: TeamMatchRow[]): number` — same substitution, reusing `getChampion`.

- [ ] **Step 1: Write the failing tests**

```typescript
// Add to lib/scoring/stats.test.ts
import { completedMatchesForSquadPlayer, teamTitlesWon, type TeamMatchRow } from './stats'

const tm = (over: Partial<TeamMatchRow>): TeamMatchRow => ({
  round: 'group',
  status: 'completed',
  score_a: 2,
  score_b: 1,
  team_a_id: 'sq1',
  team_b_id: 'sq2',
  ...over,
})

describe('completedMatchesForSquadPlayer', () => {
  it('attributes a match to the player when their squad was side A', () => {
    const result = completedMatchesForSquadPlayer('me', new Set(['sq1']), [tm({})])
    expect(result).toEqual([{ player_a_id: 'me', player_b_id: 'opponent', score_a: 2, score_b: 1 }])
  })

  it('attributes a match to the player when their squad was side B', () => {
    const result = completedMatchesForSquadPlayer('me', new Set(['sq2']), [tm({})])
    expect(result).toEqual([{ player_a_id: 'opponent', player_b_id: 'me', score_a: 2, score_b: 1 }])
  })

  it('skips a match where neither side is one of the player\'s squads', () => {
    expect(completedMatchesForSquadPlayer('me', new Set(['sq-other']), [tm({})])).toEqual([])
  })

  it('skips an incomplete or unscored match', () => {
    expect(completedMatchesForSquadPlayer('me', new Set(['sq1']), [tm({ status: 'scheduled', score_a: null, score_b: null })])).toEqual([])
  })
})

describe('teamTitlesWon', () => {
  it('counts a final the player\'s squad won', () => {
    expect(teamTitlesWon('me', new Set(['sq1']), [tm({ round: 'final' })])).toBe(1)
  })

  it('does not count a final the player\'s squad lost', () => {
    expect(teamTitlesWon('me', new Set(['sq2']), [tm({ round: 'final' })])).toBe(0)
  })

  it('does not count a non-final', () => {
    expect(teamTitlesWon('me', new Set(['sq1']), [tm({ round: 'semi_final' })])).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/scoring/stats.test.ts`
Expected: FAIL — `completedMatchesForSquadPlayer`/`teamTitlesWon`/`TeamMatchRow` not exported.

- [ ] **Step 3: Implement**

Add to `lib/scoring/stats.ts`:

```typescript
import { getChampion, type BracketMatch } from '@/lib/tournaments/bracket'

export interface TeamMatchRow {
  round: string
  status: string
  score_a: number | null
  score_b: number | null
  team_a_id: string | null
  team_b_id: string | null
}

// Reshapes a squad's completed team matches into the same CompletedMatch
// shape computeAggregates already consumes, standing playerId in for
// whichever side their squad was on. computeAggregates only ever compares
// player_a_id === playerId to decide "mine" vs "theirs" (see below) — the
// opposing side's real id is never read, so a placeholder is safe there.
export function completedMatchesForSquadPlayer(
  playerId: string,
  squadIds: Set<string>,
  matches: TeamMatchRow[],
): CompletedMatch[] {
  const result: CompletedMatch[] = []
  for (const m of matches) {
    if (m.status !== 'completed' || m.score_a == null || m.score_b == null) continue
    if (m.team_a_id && squadIds.has(m.team_a_id)) {
      result.push({ player_a_id: playerId, player_b_id: 'opponent', score_a: m.score_a, score_b: m.score_b })
    } else if (m.team_b_id && squadIds.has(m.team_b_id)) {
      result.push({ player_a_id: 'opponent', player_b_id: playerId, score_a: m.score_a, score_b: m.score_b })
    }
  }
  return result
}

// Same substitution, scoped to 'final' rows and reusing getChampion so "who
// won the final" has a single implementation shared with the bracket page.
export function teamTitlesWon(playerId: string, squadIds: Set<string>, finals: TeamMatchRow[]): number {
  return finals.filter((m) => {
    if (m.round !== 'final') return false
    const mySide = m.team_a_id && squadIds.has(m.team_a_id) ? 'a' : m.team_b_id && squadIds.has(m.team_b_id) ? 'b' : null
    if (!mySide) return false
    const bracketMatch: BracketMatch = {
      id: '',
      round: m.round,
      group_id: null,
      groupName: null,
      status: m.status,
      score_a: m.score_a,
      score_b: m.score_b,
      scheduled_at: null,
      is_full_day: false,
      playerA: { id: mySide === 'a' ? playerId : 'opponent', name: '' },
      playerB: { id: mySide === 'b' ? playerId : 'opponent', name: '' },
    }
    return getChampion([bracketMatch])?.id === playerId
  }).length
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/scoring/stats.test.ts`
Expected: PASS, including every pre-existing `computeAggregates` test unmodified.

- [ ] **Step 5: Typecheck and full suite**

Run: `npx tsc --noEmit && npm run test`

- [ ] **Step 6: Commit**

```bash
git add lib/scoring/stats.ts lib/scoring/stats.test.ts
git commit -m "feat(scoring): pure helpers translating a squad's team matches to one roster member's perspective"
```

---

## Task 5: `lib/scoring/apply.ts` — `refreshPlayer` counts team matches

**Files:**
- Modify: `lib/scoring/apply.ts`

**Interfaces:**
- Consumes: `completedMatchesForSquadPlayer`, `teamTitlesWon` from Task 4.
- Produces: `refreshPlayer`'s exported signature and every other function in this file (`syncMatchEvents`, `recomputeAllScoring`) unchanged — only `refreshPlayer`'s internal query and aggregation gain a team-match branch.

- [ ] **Step 1: Implement**

```typescript
import { completedMatchesForSquadPlayer, teamTitlesWon } from './stats'
```

Replace `refreshPlayer`'s body:

```typescript
export async function refreshPlayer(admin: Admin, playerId: string): Promise<void> {
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

  let soloTitles = rows
    .filter((m) => m.round === 'final')
    .map((m) => getChampion([toBracketFinal(m)]))
    .filter((champ) => champ?.id === playerId).length

  // Team matches: find every squad this player has ever belonged to, then
  // every completed team match either squad played, and translate each to
  // this player's own perspective (same substitution season-placement.ts
  // already established for season points).
  const { data: squadRows } = await admin.from('squad_members').select('squad_id').eq('player_id', playerId)
  const squadIds = new Set((squadRows ?? []).map((r) => r.squad_id as string))

  let teamCompleted: CompletedMatch[] = []
  let teamTitles = 0
  if (squadIds.size > 0) {
    const idList = Array.from(squadIds).join(',')
    const { data: teamRows } = await admin
      .from('matches')
      .select('round, status, score_a, score_b, team_a_id, team_b_id')
      .eq('status', 'completed')
      .or(`team_a_id.in.(${idList}),team_b_id.in.(${idList})`)
    const rows2 = teamRows ?? []
    teamCompleted = completedMatchesForSquadPlayer(playerId, squadIds, rows2)
    teamTitles = teamTitlesWon(playerId, squadIds, rows2.filter((m) => m.round === 'final'))
  }

  const aggregates = computeAggregates(playerId, [...completed, ...teamCompleted], soloTitles + teamTitles)

  const { data: events } = await admin
    .from('sx_score_events')
    .select('points_delta')
    .eq('player_id', playerId)
  const sx_score = computeScore(events ?? [])

  await admin
    .from('profiles')
    .update({ ...aggregates, sx_score })
    .eq('id', playerId)

  await checkAndUnlockAchievements(admin, playerId, { type: 'sx_score_updated', newScore: sx_score })
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Full suite**

Run: `npm run test`
Expected: green, including `verify-actions.test.ts` (which exercises `syncMatchEvents` → `refreshPlayer` indirectly for solo matches — the new `squadIds.size > 0` branch is a no-op for a player with no squad membership rows, so solo-only test fixtures take the exact same path as before).

- [ ] **Step 4: Commit**

```bash
git add lib/scoring/apply.ts
git commit -m "feat(scoring): refreshPlayer counts a player's team-tournament matches in their cached totals"
```

---

## Task 6: Hall of Fame — category/game stats include team matches

**Files:**
- Modify: `app/[locale]/(public)/hall-of-fame/page.tsx`

**Interfaces:**
- Consumes: `GameScopedMatch` (now roster-aware, Task 2), `rostersForSquads` (Phase 6a Task 1).

- [ ] **Step 1: Implement**

Update the `matches` query (the one building `categoryMaps`/`gameMaps`, not the separate `thirdPlaceRows` query from Phase 6a Task 4):

```typescript
supabase
  .from('matches')
  .select(
    'status, score_a, score_b, player_a_id, player_b_id, team_a_id, team_b_id, tournament:tournaments(game:games(id, name, category))',
  )
  .eq('status', 'completed'),
```

Update the row type and the `matches` construction to attach rosters:

```typescript
const rawMatches = ((matchRows as unknown[] | null) ?? []) as {
  status: string
  score_a: number | null
  score_b: number | null
  player_a_id: string | null
  player_b_id: string | null
  team_a_id: string | null
  team_b_id: string | null
  tournament: RawTournamentRef
}[]

const squadIds = Array.from(
  new Set(rawMatches.flatMap((m) => [m.team_a_id, m.team_b_id]).filter((id): id is string => id != null)),
)
const rosterBySquad = await rostersForSquads(supabase, squadIds)

const matches: GameScopedMatch[] = rawMatches.map((m) => {
  const t = firstTournamentRef(m.tournament)
  const g = firstGameRef(t?.game ?? null)
  return {
    status: m.status,
    score_a: m.score_a,
    score_b: m.score_b,
    player_a_id: m.player_a_id,
    player_b_id: m.player_b_id,
    team_a_id: m.team_a_id,
    team_b_id: m.team_b_id,
    team_a_roster: m.team_a_id ? rosterBySquad.get(m.team_a_id) ?? [] : undefined,
    team_b_roster: m.team_b_id ? rosterBySquad.get(m.team_b_id) ?? [] : undefined,
    game_id: g?.id ?? 'unknown',
    game_name: g?.name ?? 'Unknown',
    game_category: g?.category ?? 'other',
  }
})
```

Add the import:

```typescript
import { rostersForSquads } from '@/lib/tournaments/squad-roster'
```

`winsByPlayerAndGame`'s result (`winsMap`, if this page uses it directly — grep confirms this page doesn't call `winsByPlayerAndGame` itself, only `scoreStatsByPlayerAndCategory`/`scoreStatsByPlayerAndGame`, both already updated) needs no further change; `categoryMaps`/`gameMaps` construction below is untouched, since it already just calls those two functions on `matches`.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Manual verification**

No dedicated test file. Run `npm run build`.

- [ ] **Step 4: Commit**

```bash
git add "app/[locale]/(public)/hall-of-fame/page.tsx"
git commit -m "feat(hall-of-fame): MVP/Golden Boot eligibility includes team-tournament matches"
```

---

## Task 7: Rankings page — wins/category/game/streak stats include team matches

**Files:**
- Modify: `app/[locale]/(public)/rankings/page.tsx`

**Interfaces:**
- Consumes: `GameScopedMatch`/`StreakMatch` (Tasks 2-3), `rostersForSquads` (Phase 6a Task 1).

- [ ] **Step 1: Implement**

Update the `matches` query:

```typescript
supabase
  .from('matches')
  .select(
    'status, score_a, score_b, player_a_id, player_b_id, team_a_id, team_b_id, completed_at, tournament:tournaments(game:games(id, name, category))',
  )
  .eq('status', 'completed'),
```

Update the row type and `matches` construction — identical pattern to Task 6, plus `completed_at` (this page also feeds `longestWinStreakByPlayer`, which needs it):

```typescript
const rawMatches = ((matchRows as unknown[] | null) ?? []) as {
  status: string
  score_a: number | null
  score_b: number | null
  player_a_id: string | null
  player_b_id: string | null
  team_a_id: string | null
  team_b_id: string | null
  completed_at: string | null
  tournament: RawTournamentRef
}[]

const squadIds = Array.from(
  new Set(rawMatches.flatMap((m) => [m.team_a_id, m.team_b_id]).filter((id): id is string => id != null)),
)
const rosterBySquad = await rostersForSquads(supabase, squadIds)

const matches: (GameScopedMatch & { completed_at: string | null })[] = rawMatches.map((m) => {
  const t = firstTournamentRef(m.tournament)
  const g = firstGameRef(t?.game ?? null)
  return {
    status: m.status,
    score_a: m.score_a,
    score_b: m.score_b,
    player_a_id: m.player_a_id,
    player_b_id: m.player_b_id,
    team_a_id: m.team_a_id,
    team_b_id: m.team_b_id,
    team_a_roster: m.team_a_id ? rosterBySquad.get(m.team_a_id) ?? [] : undefined,
    team_b_roster: m.team_b_id ? rosterBySquad.get(m.team_b_id) ?? [] : undefined,
    completed_at: m.completed_at,
    game_id: g?.id ?? 'unknown',
    game_name: g?.name ?? 'Unknown',
    game_category: g?.category ?? 'other',
  }
})
```

Add the import:

```typescript
import { rostersForSquads } from '@/lib/tournaments/squad-roster'
```

`winsMap`, `categoryMaps`, `gameMaps`, and the `longestWinStreakByPlayer(matches)` call (if present on this page — it imports `longestWinStreakByPlayer` per the earlier file read, confirm its call site uses the same `matches` array) all need no further change; they already operate on whatever `matches` array is passed in, and `matches`'s shape now satisfies both `GameScopedMatch` and `StreakMatch` (`StreakMatch = RosterAwareMatch & {completed_at}`, and `GameScopedMatch extends RosterAwareMatch`).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Manual verification**

Run `npm run build`.

- [ ] **Step 4: Commit**

```bash
git add "app/[locale]/(public)/rankings/page.tsx"
git commit -m "feat(rankings): wins/category/game/streak stats include team-tournament matches"
```

---

## Task 8: Player profile page — category stats and games-played include team matches

**Files:**
- Modify: `app/[locale]/(public)/players/[username]/page.tsx`

**Interfaces:**
- Consumes: `GameScopedMatch` (Task 2), `rostersForSquads` (Phase 6a Task 1).

This is the `rawCategoryMatches` query (feeds `categoryStats`, `playedMatches`/`gamesPlayed`, `winsByGameMap`) — Task 9 covers this page's *other* two queries (`rawMatches` recent-list, `rawFinals`).

- [ ] **Step 1: Implement**

Update the `rawCategoryMatches` query:

```typescript
supabase
  .from('matches')
  .select(
    'score_a, score_b, player_a_id, player_b_id, team_a_id, team_b_id, status, tournament:tournaments(game:games(id, name, category))',
  )
  .eq('status', 'completed')
  .or(`player_a_id.eq.${p.id},player_b_id.eq.${p.id}`),
```

This `.or(...)` filter only matches solo rows involving `p.id` — a team match where `p.id` is a roster member (not the row's own `player_a_id`/`player_b_id`, which are `null`) is never returned by this filter. Replace the filter with an OR across both solo participation and squad membership. First resolve `p.id`'s squad ids (once, reused by Task 9 too — hoist above both queries):

```typescript
const { data: mySquadRows } = await supabase.from('squad_members').select('squad_id').eq('player_id', p.id)
const mySquadIds = (mySquadRows ?? []).map((r) => r.squad_id as string)
const squadOrClause = mySquadIds.length > 0 ? `,team_a_id.in.(${mySquadIds.join(',')}),team_b_id.in.(${mySquadIds.join(',')})` : ''
```

Then the category-matches query's filter becomes:

```typescript
.or(`player_a_id.eq.${p.id},player_b_id.eq.${p.id}${squadOrClause}`),
```

Update the row type and mapping to attach rosters (same pattern as Tasks 6-7):

```typescript
const rawCategoryRows = ((rawCategoryMatches as unknown[] | null) ?? []) as {
  score_a: number | null
  score_b: number | null
  player_a_id: string | null
  player_b_id: string | null
  team_a_id: string | null
  team_b_id: string | null
  status: string
  tournament: CategoryTournamentRef
}[]
const categorySquadIds = Array.from(
  new Set(rawCategoryRows.flatMap((m) => [m.team_a_id, m.team_b_id]).filter((id): id is string => id != null)),
)
const rosterBySquad = await rostersForSquads(supabase, categorySquadIds)
const categoryMatches: GameScopedMatch[] = rawCategoryRows.map((m) => {
  const t = firstCategoryTournamentRef(m.tournament)
  const g = firstCategoryGameRef(t?.game ?? null)
  return {
    status: m.status,
    score_a: m.score_a,
    score_b: m.score_b,
    player_a_id: m.player_a_id,
    player_b_id: m.player_b_id,
    team_a_id: m.team_a_id,
    team_b_id: m.team_b_id,
    team_a_roster: m.team_a_id ? rosterBySquad.get(m.team_a_id) ?? [] : undefined,
    team_b_roster: m.team_b_id ? rosterBySquad.get(m.team_b_id) ?? [] : undefined,
    game_id: g?.id ?? 'unknown',
    game_name: g?.name ?? 'Unknown',
    game_category: g?.category ?? 'other',
  }
})
```

The `playedMatches`/`winsByGameMap`/`gamesPlayed` block right below stays almost the same, except `playedMatches`'s own filter (`categoryMatches.filter((m) => m.player_a_id === p.id || m.player_b_id === p.id)`) has the exact same "misses team rows" bug — replace with a roster-aware check using the same `sideAIds`/`sideBIds` helpers:

```typescript
import { sideAIds, sideBIds } from '@/lib/tournaments/advancement'
// ...
const playedMatches = categoryMatches.filter((m) => sideAIds(m).includes(p.id) || sideBIds(m).includes(p.id))
```

Add the import for `rostersForSquads` alongside the existing imports:

```typescript
import { rostersForSquads } from '@/lib/tournaments/squad-roster'
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit** (staged together with Task 9 — this page's remaining two queries share the `mySquadIds`/`squadOrClause` values just computed, so commit both tasks' changes together)

Skip committing after this step; proceed directly to Task 9.

---

## Task 9: Player profile page — recent-matches list and finals query include team matches

**Files:**
- Modify: `app/[locale]/(public)/players/[username]/page.tsx` (continuing from Task 8)

**Interfaces:**
- Consumes: `mySquadIds`/`squadOrClause` from Task 8's Step 1 (already hoisted above both queries).

- [ ] **Step 1: Implement — recent matches (`rawMatches`)**

Update the query:

```typescript
supabase
  .from('matches')
  .select(
    'id, score_a, score_b, completed_at, player_a_id, player_b_id, team_a_id, team_b_id, ' +
      'tournament:tournaments(title), ' +
      'player_a:profiles!matches_player_a_id_fkey(username, display_name), ' +
      'player_b:profiles!matches_player_b_id_fkey(username, display_name), ' +
      'team_a:squads!matches_team_a_id_fkey(id, name), ' +
      'team_b:squads!matches_team_b_id_fkey(id, name)',
  )
  .eq('status', 'completed')
  .or(`player_a_id.eq.${p.id},player_b_id.eq.${p.id}${squadOrClause}`)
  .order('completed_at', { ascending: false })
  .limit(10),
```

Update `RecentRow` to add `team_a_id`, `team_b_id`, `team_a: SquadRef`, `team_b: SquadRef` (add a `SquadRef` type matching the pattern from Phase 6a's tasks: `{id: string; name: string} | {id: string; name: string}[] | null`, plus a `firstSquad` helper — this file doesn't have one yet).

Update the `matches: ProfileMatch[]` mapping:

```typescript
const recentRows = (rawMatches ?? []) as unknown as RecentRow[]
const matches: ProfileMatch[] = recentRows
  .filter((m) => {
    const isTeam = !!(m.team_a_id || m.team_b_id)
    if (isTeam) return m.team_a_id != null && m.team_b_id != null && m.score_a != null && m.score_b != null
    return m.player_a_id && m.player_b_id && m.score_a != null && m.score_b != null
  })
  .map((m) => {
    const isTeam = !!(m.team_a_id || m.team_b_id)
    if (isTeam) {
      const teamA = firstSquad(m.team_a)
      const teamB = firstSquad(m.team_b)
      const isA = mySquadIds.includes(m.team_a_id as string)
      return {
        id: m.id,
        opponentName: isA ? teamB?.name ?? 'Squad' : teamA?.name ?? 'Squad',
        playerScore: (isA ? m.score_a : m.score_b) as number,
        opponentScore: (isA ? m.score_b : m.score_a) as number,
        outcome: matchOutcome(isA ? (teamA?.id ?? '') : (teamB?.id ?? ''), {
          player_a_id: teamA?.id ?? '',
          player_b_id: teamB?.id ?? '',
          score_a: m.score_a as number,
          score_b: m.score_b as number,
        }),
        tournamentTitle: firstTitleName(m.tournament),
        completedAt: m.completed_at,
      }
    }
    const isA = m.player_a_id === p.id
    return {
      id: m.id,
      opponentName: firstName(isA ? m.player_b : m.player_a),
      playerScore: (isA ? m.score_a : m.score_b) as number,
      opponentScore: (isA ? m.score_b : m.score_a) as number,
      outcome: matchOutcome(p.id, {
        player_a_id: m.player_a_id as string,
        player_b_id: m.player_b_id as string,
        score_a: m.score_a as number,
        score_b: m.score_b as number,
      }),
      tournamentTitle: firstTitleName(m.tournament),
      completedAt: m.completed_at,
    }
  })
```

`matchOutcome` (`lib/players/profile.ts`) takes `(playerId, m: MatchSides)` and only ever compares `m.player_a_id === playerId` to decide "mine" vs "theirs" — confirmed by reading it, no other use of either id. Passing `isA ? (teamA?.id ?? '') : (teamB?.id ?? '')` as `playerId` alongside a match whose `player_a_id`/`player_b_id` are the two squad ids reuses it correctly without a team-aware variant.

- [ ] **Step 2: Implement — finals (`rawFinals` feeds `titles: ProfileTitle[]`, the player's "titles won" list — confirmed by reading the file: `finalRows.filter((f) => getChampion([toBracketFinal(f)])?.id === p.id).map(...)`)**

Update the query:

```typescript
supabase
  .from('matches')
  .select(
    'round, status, score_a, score_b, player_a_id, player_b_id, team_a_id, team_b_id, ' +
      'tournament:tournaments(title, slug, tournament_end, game:games(name))',
  )
  .eq('round', 'final')
  .eq('status', 'completed')
  .or(`player_a_id.eq.${p.id},player_b_id.eq.${p.id}${squadOrClause}`),
```

Update `FinalRow` (add `team_a_id`, `team_b_id`) and `toBracketFinal` to accept the team fields, substituting `p.id` for whichever side is one of `mySquadIds` (mirrors Task 4's `teamTitlesWon` substitution, but inline here since this file builds `BracketMatch` objects directly rather than importing the pure helper — following this file's existing convention of a local `toBracketFinal`):

```typescript
function toBracketFinal(f: {
  round: string
  status: string
  score_a: number | null
  score_b: number | null
  player_a_id: string | null
  player_b_id: string | null
  team_a_id: string | null
  team_b_id: string | null
}, viewerId: string, viewerSquadIds: string[]): BracketMatch {
  const isTeam = !!(f.team_a_id || f.team_b_id)
  const aId = isTeam ? (viewerSquadIds.includes(f.team_a_id as string) ? viewerId : 'opponent') : (f.player_a_id ?? '')
  const bId = isTeam ? (viewerSquadIds.includes(f.team_b_id as string) ? viewerId : 'opponent') : (f.player_b_id ?? '')
  return {
    id: '',
    round: f.round,
    group_id: null,
    groupName: null,
    status: f.status,
    score_a: f.score_a,
    score_b: f.score_b,
    scheduled_at: null,
    is_full_day: false,
    playerA: { id: aId, name: '' },
    playerB: { id: bId, name: '' },
  }
}
```

Update every `toBracketFinal(f)` call site in this file to `toBracketFinal(f, p.id, mySquadIds)`.

- [ ] **Step 3: Typecheck and full suite**

Run: `npx tsc --noEmit && npm run test`

- [ ] **Step 4: Manual verification**

Run `npm run build`, then load a team-tournament roster member's `/players/[username]` page against the kept DRY RUN test data and confirm recent matches, category stats, games-played, and titles-won all reflect their team matches.

- [ ] **Step 5: Commit** (Tasks 8 and 9 together)

```bash
git add "app/[locale]/(public)/players/[username]/page.tsx"
git commit -m "feat(players): profile page's recent matches, category stats, and titles include team-tournament matches"
```

---

## Task 10: Rank-snapshot cron — per-game win counts include team matches

**Files:**
- Modify: `app/api/cron/snapshot-ranks/route.ts`

**Interfaces:**
- Consumes: `sideAId`, `sideAIds`, `sideBIds` (Tasks 1-2), `rostersForSquads` (Phase 6a Task 1).

- [ ] **Step 1: Implement**

Update the `matches` query:

```typescript
admin
  .from('matches')
  .select(
    'status, score_a, score_b, player_a_id, player_b_id, team_a_id, team_b_id, ' +
      'tournament:tournaments(game:games(id, name))',
  )
  .eq('status', 'completed'),
```

Update the imports and the win-counting loop:

```typescript
import { matchWinnerId, sideAId, sideAIds, sideBIds } from '@/lib/tournaments/advancement'
import { rostersForSquads } from '@/lib/tournaments/squad-roster'
```

```typescript
const rawTeamRows = ((matchRows as unknown[] | null) ?? []) as {
  status: string
  score_a: number | null
  score_b: number | null
  player_a_id: string | null
  player_b_id: string | null
  team_a_id: string | null
  team_b_id: string | null
  tournament: RawTournamentRef
}[]
const squadIds = Array.from(
  new Set(rawTeamRows.flatMap((m) => [m.team_a_id, m.team_b_id]).filter((id): id is string => id != null)),
)
const rosterBySquad = await rostersForSquads(admin, squadIds)

const winsByGameId = new Map<string, Map<string, number>>()
for (const m of rawTeamRows) {
  const gameId = one(one(m.tournament)?.game ?? null)?.id
  if (!gameId) continue
  const rosterAware = {
    ...m,
    team_a_roster: m.team_a_id ? rosterBySquad.get(m.team_a_id) ?? [] : undefined,
    team_b_roster: m.team_b_id ? rosterBySquad.get(m.team_b_id) ?? [] : undefined,
  }
  const winner = matchWinnerId(rosterAware)
  if (!winner) continue
  const winnerIds = winner === sideAId(rosterAware) ? sideAIds(rosterAware) : sideBIds(rosterAware)
  const byPlayer = winsByGameId.get(gameId) ?? new Map<string, number>()
  for (const winnerId of winnerIds) {
    byPlayer.set(winnerId, (byPlayer.get(winnerId) ?? 0) + 1)
  }
  winsByGameId.set(gameId, byPlayer)
}
```

(Replace the existing `for (const raw of (matchRows as unknown[] | null) ?? []) { const m = raw as {...}; ... }` loop entirely with the block above — same outer behavior, `matchWinnerId`/`sideAId`/`sideAIds`/`sideBIds` now operate on the roster-attached row instead of `m` directly.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Manual verification**

No dedicated test file for this route. Run `npm run build`.

- [ ] **Step 4: Commit**

```bash
git add app/api/cron/snapshot-ranks/route.ts
git commit -m "feat(rankings): rank-snapshot cron credits every roster member's per-game win"
```

---

## Explicitly out of scope

- `lib/achievements/unlock.ts`'s win-streak-style achievement triggers, if they independently re-derive from `player_a_id`/`player_b_id` rather than reading the now-generalized cached `profiles` columns or `sx_score_events` — not investigated in this plan (SX Score's own achievement cascade was already confirmed generalized in Phase 3-4-5; anything beyond that is a new finding for its own follow-up, not silently pulled in here).

## Self-review notes

- **Spec coverage:** this plan implements the "profiles aggregate stats... for team matches" item named in the Phase 3-4-5 plan's scope boundary, expanded (per explicit approval during brainstorming) to full consistency across Hall of Fame, Rankings, and the player profile page — not narrowly just the cached `profiles` columns.
- **Type consistency:** `RosterAwareMatch` (Task 1) is the base every later roster-aware type extends — `GameScopedMatch` (Task 2), `StreakMatch` (Task 3). `sideAIds`/`sideBIds` (Task 1) are called identically in Tasks 2, 3, 8, 9 (via `matchOutcome`'s substitution), and 10. `rostersForSquads`'s `Map<string, string[]>` return (Phase 6a Task 1) is consumed identically as `rosterBySquad.get(id) ?? []` in Tasks 6, 7, 8, 10.
- **Placeholder scan:** none — every step has complete code.
