# Multi-Game Support (#21a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize tournaments/rankings/profiles so non-football games (Mortal Kombat Mobile, COD Mobile 1v1 modes, EA FC Mobile, eFootball) work correctly, and give admin a way to add games without direct database access.

**Architecture:** No new tables. `matches.score_a`/`score_b` already work as a generic secondary stat (goals/rounds/kills) for any 1v1 game. The only schema change is widening `games.category`. Everything else is: a new admin CRUD surface for `games`, generalizing an aggregation function that's currently football-only, and fixing two display surfaces (profile page, dashboard header) that still read a blended cross-game total instead of the live per-category aggregate Rankings/Hall of Fame already use.

**Tech Stack:** Next.js 14.2.35 App Router (Server Components, Server Actions), Supabase (Postgres + RLS), TypeScript, Tailwind, Vitest.

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-07-14-multi-game-support-design.md` — read for full rationale; this plan implements it directly.
- This codebase's test convention: unit tests with TDD only for pure functions in `lib/`; Server Actions, Next.js pages, and React components have no test files.
- Every Supabase query goes through the RLS-scoped client (`lib/supabase/server`), never `createAdminClient`, except inside existing admin-only actions that already use it.
- `CATEGORY_META[category]` must ALWAYS be accessed defensively (`CATEGORY_META[category]?.statLabel`, or filter first) wherever `category` is an arbitrary runtime string (e.g. from the database) — `'other'` and any future uncategorized game deliberately have no entry. Only skip the `?.` when the key is a literal known category name typed directly in source (e.g. `CATEGORY_META.football`).
- Out of scope: battle-royale games, team/school/state leagues, dropping `profiles.goals_scored`/`goals_conceded` columns. See the spec's Scope section.
- Line numbers cited below reflect each file's state as read during planning (2026-07-14) — `Read` the current file before each `Edit` and match by surrounding code, not by line number alone.

---

### Task 1: Category taxonomy — migration, `CATEGORY_META`, generalized stat aggregation

**Files:**
- Create: `supabase/migrations/027_multi_game_categories.sql`
- Create: `lib/games/categories.ts`
- Modify: `lib/rankings/game-breakdown.ts`
- Modify: `lib/rankings/game-breakdown.test.ts`

**Interfaces:**
- Produces: `CATEGORY_META` (`Record<string, { statLabel: string; awardName: string; awardEmoji: string }>`), `CategoryStat` type (`{ category: string; scored: number; conceded: number }`), `scoreStatsByPlayerAndCategory(matches, category)`, `categoryStat(stats, category)` helper — all consumed by Tasks 3 and 4.

- [ ] **Step 1: Write the migration**

```sql
ALTER TABLE public.games DROP CONSTRAINT games_category_check;
ALTER TABLE public.games ADD CONSTRAINT games_category_check
  CHECK (category IN ('football', 'fighting', 'shooter', 'other'));
```

(Confirmed live constraint name: `games_category_check`.)

- [ ] **Step 2: Apply the migration**

Try `supabase db push --dry-run` then `--yes`. If the CLI is unreachable, fall back to `mcp__claude_ai_Supabase__apply_migration` with explicit user confirmation.

- [ ] **Step 3: Write `lib/games/categories.ts`**

```typescript
export interface CategoryMeta {
  statLabel: string
  awardName: string
  awardEmoji: string
}

// 'other' and any future uncategorized game deliberately have NO entry here —
// callers must always use CATEGORY_META[category]?.field, never assume a
// lookup is defined, except when indexing by a literal key written directly
// in source (e.g. CATEGORY_META.football).
export const CATEGORY_META: Record<string, CategoryMeta> = {
  football: { statLabel: 'Goals', awardName: 'Golden Boot', awardEmoji: '⚽' },
  fighting: { statLabel: 'Rounds Won', awardName: 'Iron Fist', awardEmoji: '🥊' },
  shooter: { statLabel: 'Kills', awardName: 'Sharpshooter', awardEmoji: '🎯' },
}
```

- [ ] **Step 4: Write the failing tests for the generalized aggregation function**

Read the current `lib/rankings/game-breakdown.test.ts` first (it already has `winsByPlayerAndGame`/`footballGoalsByPlayer` describe blocks — keep those, add new ones). Add:

```typescript
describe('scoreStatsByPlayerAndCategory', () => {
  it('sums scored and conceded for both players, scoped to the given category', () => {
    const r = scoreStatsByPlayerAndCategory(
      [m({ score_a: 3, score_b: 1, game_category: 'fighting' })],
      'fighting',
    )
    expect(r.get('a')).toEqual({ scored: 3, conceded: 1 })
    expect(r.get('b')).toEqual({ scored: 1, conceded: 3 })
  })

  it('excludes matches from a different category', () => {
    const r = scoreStatsByPlayerAndCategory(
      [m({ game_category: 'shooter', score_a: 5, score_b: 5 })],
      'fighting',
    )
    expect(r.size).toBe(0)
  })

  it('excludes non-completed matches', () => {
    const r = scoreStatsByPlayerAndCategory([m({ status: 'scheduled', game_category: 'shooter' })], 'shooter')
    expect(r.size).toBe(0)
  })

  it('works identically for the shooter category', () => {
    const r = scoreStatsByPlayerAndCategory(
      [m({ score_a: 10, score_b: 4, game_category: 'shooter' })],
      'shooter',
    )
    expect(r.get('a')).toEqual({ scored: 10, conceded: 4 })
  })

  it('returns an empty map for no matches', () => {
    expect(scoreStatsByPlayerAndCategory([], 'football').size).toBe(0)
  })
})

describe('categoryStat', () => {
  it('returns the matching entry', () => {
    const stats = [{ category: 'football', scored: 4, conceded: 2 }, { category: 'shooter', scored: 9, conceded: 3 }]
    expect(categoryStat(stats, 'shooter')).toEqual({ category: 'shooter', scored: 9, conceded: 3 })
  })

  it('returns a zero-default when the category is absent', () => {
    expect(categoryStat([], 'fighting')).toEqual({ category: 'fighting', scored: 0, conceded: 0 })
  })
})
```

Update the top-of-file import to add the new names:

```typescript
import { winsByPlayerAndGame, footballGoalsByPlayer, scoreStatsByPlayerAndCategory, categoryStat, type GameScopedMatch } from './game-breakdown'
```

Keep the existing `footballGoalsByPlayer` describe block exactly as-is — it now tests the thin wrapper (see Step 6), not duplicate logic.

- [ ] **Step 5: Run the tests to verify the new ones fail**

Run: `npx vitest run lib/rankings/game-breakdown.test.ts`
Expected: FAIL — `scoreStatsByPlayerAndCategory`/`categoryStat` not exported

- [ ] **Step 6: Generalize `lib/rankings/game-breakdown.ts`**

Read the current file first. Replace the `FootballGoals`/`footballGoalsByPlayer` section (keep `GameScopedMatch`, `winsByPlayerAndGame`, and `GameWinCount` untouched above it) with:

```typescript
export interface CategoryStat {
  category: string
  scored: number
  conceded: number
}

// Sums score_a/score_b from completed matches scoped to the given category.
// Works identically for any category — football goals, fighting rounds
// won, shooter kills are all just the match's numeric score_a/score_b.
export function scoreStatsByPlayerAndCategory(
  matches: GameScopedMatch[],
  category: string,
): Map<string, { scored: number; conceded: number }> {
  const result = new Map<string, { scored: number; conceded: number }>()
  for (const match of matches) {
    if (match.game_category !== category) continue
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

// Kept for existing callers/tests — identical to
// scoreStatsByPlayerAndCategory(matches, 'football').
export function footballGoalsByPlayer(matches: GameScopedMatch[]): Map<string, { scored: number; conceded: number }> {
  return scoreStatsByPlayerAndCategory(matches, 'football')
}

export function categoryStat(stats: CategoryStat[], category: string): CategoryStat {
  return stats.find((s) => s.category === category) ?? { category, scored: 0, conceded: 0 }
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run lib/rankings/game-breakdown.test.ts`
Expected: PASS (all describe blocks, including the pre-existing `footballGoalsByPlayer` ones — confirms the wrapper delegates correctly)

- [ ] **Step 8: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors (some may surface from Tasks 3/4's not-yet-updated consumers if run out of order — run this after Task 1 alone, before starting Task 2)

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/027_multi_game_categories.sql lib/games/categories.ts lib/rankings/game-breakdown.ts lib/rankings/game-breakdown.test.ts
git commit -m "feat: widen game categories to fighting/shooter, generalize stat aggregation"
```

---

### Task 2: Admin game management

**Files:**
- Create: `lib/games/schema.ts`
- Create: `lib/games/schema.test.ts`
- Create: `lib/games/admin-actions.ts`
- Create: `app/admin/games/page.tsx`
- Create: `components/admin/GameRow.tsx`
- Create: `components/admin/GameForm.tsx`
- Modify: `lib/admin/nav.ts`

**Interfaces:**
- Consumes: `slugify` (`lib/tournaments/slug.ts`), `requireStaff` (`lib/admin/auth.ts`).
- Produces: `createGame`, `toggleGameActive` Server Actions.

- [ ] **Step 1: Write the failing schema tests**

```typescript
import { describe, it, expect } from 'vitest'
import { gameSchema } from './schema'

const valid = { name: 'EA FC Mobile', category: 'football', iconUrl: '' }

describe('gameSchema', () => {
  it('accepts a valid submission', () => {
    expect(gameSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects a missing name', () => {
    expect(gameSchema.safeParse({ ...valid, name: '  ' }).success).toBe(false)
  })

  it('rejects an invalid category', () => {
    expect(gameSchema.safeParse({ ...valid, category: 'racing' }).success).toBe(false)
  })

  it('accepts each valid category', () => {
    for (const category of ['football', 'fighting', 'shooter', 'other']) {
      expect(gameSchema.safeParse({ ...valid, category }).success).toBe(true)
    }
  })

  it('accepts an empty icon URL', () => {
    expect(gameSchema.safeParse({ ...valid, iconUrl: '' }).success).toBe(true)
  })

  it('rejects a malformed icon URL', () => {
    expect(gameSchema.safeParse({ ...valid, iconUrl: 'not-a-url' }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/games/schema.test.ts`
Expected: FAIL — `Cannot find module './schema'`

- [ ] **Step 3: Write `lib/games/schema.ts`**

```typescript
import { z } from 'zod'

export const gameSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100, 'Name is too long'),
  category: z.enum(['football', 'fighting', 'shooter', 'other']),
  iconUrl: z.union([z.literal(''), z.string().trim().url('Enter a valid URL')]),
})

export type GameInput = z.infer<typeof gameSchema>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/games/schema.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Write `lib/games/admin-actions.ts`**

```typescript
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { gameSchema } from './schema'
import { slugify } from '@/lib/tournaments/slug'

export type GameFormState = { error?: string; success?: boolean } | undefined

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '23505'
}

export async function createGame(_prev: GameFormState, formData: FormData): Promise<GameFormState> {
  await requireStaff()
  const parsed = gameSchema.safeParse({
    name: formData.get('name'),
    category: formData.get('category'),
    iconUrl: formData.get('iconUrl') ?? '',
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const base = slugify(parsed.data.name)
  if (!base) return { error: 'Enter a name that produces a valid slug.' }

  const supabase = createClient()
  let slug = base
  for (let i = 0; i < 5; i++) {
    const { error } = await supabase.from('games').insert({
      name: parsed.data.name,
      slug,
      category: parsed.data.category,
      icon_url: parsed.data.iconUrl || null,
    })
    if (!error) {
      revalidatePath('/admin/games')
      return { success: true }
    }
    if (!isUniqueViolation(error)) return { error: 'Could not create the game. Please try again.' }
    slug = `${base}-${Math.random().toString(36).slice(2, 6)}`
  }
  return { error: 'Could not generate a unique slug. Try a different name.' }
}

export async function toggleGameActive(_prev: GameFormState, formData: FormData): Promise<GameFormState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  const nextActive = formData.get('nextActive') === 'true'
  if (!id) return { error: 'Missing game.' }

  const supabase = createClient()
  const { error } = await supabase.from('games').update({ active: nextActive }).eq('id', id)
  if (error) return { error: 'Could not update the game. Please try again.' }

  revalidatePath('/admin/games')
  revalidatePath('/admin/tournaments/new')
  return { success: true }
}
```

- [ ] **Step 6: Write `app/admin/games/page.tsx`**

```tsx
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { GameForm } from '@/components/admin/GameForm'
import { GameRow } from '@/components/admin/GameRow'

export const metadata: Metadata = { title: 'Games · Admin · SentinelX' }

export default async function AdminGamesPage() {
  await requireStaff()
  const supabase = createClient()
  const { data: games } = await supabase.from('games').select('id, name, category, active').order('name')

  const rows = games ?? []
  const tournamentCounts = await Promise.all(
    rows.map(async (g) => {
      const { count } = await supabase
        .from('tournaments')
        .select('id', { count: 'exact', head: true })
        .eq('game_id', g.id)
        .not('status', 'in', '(completed,cancelled)')
      return count ?? 0
    }),
  )

  return (
    <section>
      <h2 className="mb-4 text-base font-bold text-white">Games</h2>
      <div className="mb-6">
        <GameForm />
      </div>
      <div className="space-y-2">
        {rows.map((g, i) => (
          <GameRow key={g.id} game={g} activeTournamentCount={tournamentCounts[i]} />
        ))}
      </div>
    </section>
  )
}
```

- [ ] **Step 7: Write `components/admin/GameForm.tsx`**

```tsx
'use client'
import { useFormState } from 'react-dom'
import { createGame, type GameFormState } from '@/lib/games/admin-actions'

export function GameForm() {
  const [state, action] = useFormState<GameFormState, FormData>(createGame, undefined)

  if (state?.success) return <p className="text-sm text-emerald-400">Game added.</p>

  return (
    <form action={action} className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <h3 className="text-sm font-bold text-white">Add a game</h3>
      <input
        name="name"
        type="text"
        placeholder="Game name"
        required
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
      />
      <select
        name="category"
        defaultValue="football"
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
      >
        <option value="football">Football</option>
        <option value="fighting">Fighting</option>
        <option value="shooter">Shooter</option>
        <option value="other">Other</option>
      </select>
      <input
        name="iconUrl"
        type="text"
        placeholder="Icon URL (optional)"
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
      />
      {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
      <button type="submit" className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-bold text-white hover:bg-violet-500">
        Add game
      </button>
    </form>
  )
}
```

- [ ] **Step 8: Write `components/admin/GameRow.tsx`**

Two-step confirm, mirroring `components/admin/RecomputeButton.tsx`'s established pattern:

```tsx
'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { toggleGameActive, type GameFormState } from '@/lib/games/admin-actions'

export function GameRow({
  game,
  activeTournamentCount,
}: {
  game: { id: string; name: string; category: string; active: boolean }
  activeTournamentCount: number
}) {
  const [state, action] = useFormState<GameFormState, FormData>(toggleGameActive, undefined)
  const [confirming, setConfirming] = useState(false)
  const nextActive = !game.active

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-bold text-white">{game.name}</p>
          <p className="text-xs text-slate-500">
            {game.category} · {game.active ? 'Active' : 'Inactive'}
            {activeTournamentCount > 0 && ` · ${activeTournamentCount} active tournament${activeTournamentCount === 1 ? '' : 's'}`}
          </p>
        </div>

        {!confirming ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="shrink-0 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-200 hover:border-slate-500"
          >
            {game.active ? 'Deactivate' : 'Activate'}
          </button>
        ) : (
          <form action={action} className="flex shrink-0 items-center gap-2">
            <input type="hidden" name="id" value={game.id} />
            <input type="hidden" name="nextActive" value={String(nextActive)} />
            <button
              type="submit"
              onClick={() => setConfirming(false)}
              className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-500"
            >
              {game.active
                ? activeTournamentCount > 0
                  ? `Confirm — ${activeTournamentCount} active tournament${activeTournamentCount === 1 ? '' : 's'} will be unaffected`
                  : 'Confirm deactivate'
                : 'Confirm activate'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-300 hover:border-slate-500"
            >
              Cancel
            </button>
          </form>
        )}
      </div>
      {state?.error && <p className="mt-2 text-xs text-red-400">{state.error}</p>}
    </div>
  )
}
```

- [ ] **Step 9: Add "Games" to `ADMIN_NAV`**

In `lib/admin/nav.ts`, add after the "Tournaments" entry:

```typescript
  { label: 'Tournaments', href: '/admin/tournaments', adminOnly: false },
  { label: 'Games', href: '/admin/games', adminOnly: false },
```

- [ ] **Step 10: Verify**

Run: `npx tsc --noEmit && npm run lint && npm run test`
Expected: no errors, full suite passes

- [ ] **Step 11: Commit**

```bash
git add lib/games/schema.ts lib/games/schema.test.ts lib/games/admin-actions.ts app/admin/games/page.tsx components/admin/GameForm.tsx components/admin/GameRow.tsx lib/admin/nav.ts
git commit -m "feat: admin game management (create, activate/deactivate with tournament-count warning)"
```

---

### Task 3: Rankings and Hall of Fame generalization

**Files:**
- Modify: `lib/rankings/leaderboard.ts`
- Modify: `lib/rankings/leaderboard.test.ts`
- Modify: `lib/hall-of-fame/awards.ts`
- Modify: `lib/hall-of-fame/awards.test.ts`
- Modify: `components/rankings/LeaderboardTabs.tsx`
- Modify: `components/rankings/LeaderboardTable.tsx`
- Modify: `app/(public)/rankings/page.tsx`
- Modify: `app/(public)/hall-of-fame/page.tsx`

**Interfaces:**
- Consumes: `CATEGORY_META`, `CategoryStat`, `scoreStatsByPlayerAndCategory`, `categoryStat` (Task 1).
- Produces: `PlayerStatsInput.categoryStats: CategoryStat[]` (replaces `footballGoalsScored`/`footballGoalsConceded`), `LeaderboardMetric` extended to `'wins' | 'score' | 'football' | 'fighting' | 'shooter'`, `pickCategoryAward(players, category)`.

This is the largest task — `footballGoalsScored`/`footballGoalsConceded` currently appear in 8 files (`lib/rankings/leaderboard.ts`, `.test.ts`, `lib/hall-of-fame/awards.ts`, `.test.ts`, `components/rankings/LeaderboardTable.tsx`, `app/(public)/rankings/page.tsx`, `app/(public)/hall-of-fame/page.tsx`, plus `lib/rankings/game-breakdown.ts` already handled in Task 1). Every one is touched below.

**Deliberate metric-key rename:** the existing `LeaderboardMetric` key `'goals'` becomes `'football'` (matching the category name directly, so tab key = category key everywhere, no separate mapping table needed). This is a breaking rename of that one string literal, propagated through both `.test.ts` files below.

**Deliberate behavior fix in `pickCategoryAward`:** the original `pickGoldenBoot` had no guard against crowning a 0-scorer — if every eligible player had 0 football goals (impossible today with only football active, but very possible once a Mortal-Kombat-only player is "eligible" for a football award), it would silently award the Golden Boot to whoever had the most wins, having scored zero football goals. `pickCategoryAward` explicitly returns `null` instead when the top scorer's stat is 0. Flagging this so it isn't mistaken for a bug during review — it's an intentional correction surfaced by generalizing the function.

- [ ] **Step 1: Update `lib/rankings/leaderboard.test.ts` fixture and add failing tests**

Read the current file first. Replace the `p()` fixture's `footballGoalsScored: 0, footballGoalsConceded: 0,` lines with `categoryStats: [],`. Replace the existing `'sorts by football-scoped goals when metric is "goals"'` test:

```typescript
  it('sorts by category-scoped stat when metric matches a category', () => {
    const r = rankPlayersBy(
      [
        p({ id: 'a', categoryStats: [{ category: 'football', scored: 4, conceded: 0 }], wins: 9 }),
        p({ id: 'b', categoryStats: [{ category: 'football', scored: 20, conceded: 0 }], wins: 1 }),
      ],
      'football',
    )
    expect(r.map((x) => x.id)).toEqual(['b', 'a'])
  })

  it('sorts by a different category independently', () => {
    const r = rankPlayersBy(
      [
        p({ id: 'a', categoryStats: [{ category: 'shooter', scored: 30, conceded: 0 }] }),
        p({ id: 'b', categoryStats: [{ category: 'shooter', scored: 55, conceded: 0 }] }),
      ],
      'shooter',
    )
    expect(r.map((x) => x.id)).toEqual(['b', 'a'])
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/rankings/leaderboard.test.ts`
Expected: FAIL — `categoryStats` not a known field / `'football'`/`'shooter'` not a valid `LeaderboardMetric`

- [ ] **Step 3: Update `lib/rankings/leaderboard.ts`**

Read the current file first. Replace the whole file:

```typescript
import type { GameWinCount, CategoryStat } from './game-breakdown'
import { categoryStat } from './game-breakdown'

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
  // Per-category live aggregate (see lib/rankings/game-breakdown.ts) — NOT the
  // same as goalsScored/goalsConceded above, which mix every game a player
  // has played. Used by category-scoped Rankings tabs and Hall of Fame
  // awards; goalsScored/goalsConceded stay the source of truth for the
  // (non-per-game) cases that still read them.
  categoryStats: CategoryStat[]
  // Per-game win breakdown for the Wins tab's expand view. Always sums to
  // `wins` above (both derive from the same completed-matches set via the
  // same matchWinnerId "who won" logic).
  winsByGame: GameWinCount[]
  totalTitles: number
  sentinelScore: number
  sentinelTier: string | null
}

export interface RankedPlayer extends PlayerStatsInput {
  winRate: number
  goalDiff: number
  rank: number
}

// Minimum matches a player must have completed to appear in any ranking or award.
// Value equals the semantic minimum (1 = at least one match) so the constant never
// contradicts its name. Shared by the rankings page and the Hall of Fame.
export const RANKING_MIN_MATCHES = 1

export function isRankingEligible(p: { totalMatches: number }): boolean {
  return p.totalMatches >= RANKING_MIN_MATCHES
}

// Metric keys for 'football'/'fighting'/'shooter' match their category name
// directly — tab key = category key everywhere, no separate mapping needed.
export type LeaderboardMetric = 'wins' | 'score' | 'football' | 'fighting' | 'shooter'

const METRIC_VALUE: Record<LeaderboardMetric, (p: PlayerStatsInput) => number> = {
  wins: (p) => p.wins,
  score: (p) => p.sentinelScore,
  football: (p) => categoryStat(p.categoryStats, 'football').scored,
  fighting: (p) => categoryStat(p.categoryStats, 'fighting').scored,
  shooter: (p) => categoryStat(p.categoryStats, 'shooter').scored,
}

// Sort led by the chosen metric, falling back to the same tie-break cascade
// rankPlayers has always used: wins desc → win rate desc → titles desc →
// goal difference desc. When metric is 'wins', the leading term duplicates
// the first tie-break — harmless, and keeps this the single sort implementation.
export function rankPlayersBy(players: PlayerStatsInput[], metric: LeaderboardMetric): RankedPlayer[] {
  const lead = METRIC_VALUE[metric]
  return players
    .map((pl) => ({
      ...pl,
      winRate: pl.totalMatches > 0 ? pl.wins / pl.totalMatches : 0,
      goalDiff: pl.goalsScored - pl.goalsConceded,
    }))
    .sort(
      (a, b) =>
        lead(b) - lead(a) ||
        b.wins - a.wins ||
        b.winRate - a.winRate ||
        b.totalTitles - a.totalTitles ||
        b.goalDiff - a.goalDiff,
    )
    .map((pl, i) => ({ ...pl, rank: i + 1 }))
}

// Kept for existing callers/tests — identical to rankPlayersBy(players, 'wins').
export function rankPlayers(players: PlayerStatsInput[]): RankedPlayer[] {
  return rankPlayersBy(players, 'wins')
}
```

Also update `rankPlayers`' `p()` fixture usages of `footballGoalsScored`/`footballGoalsConceded` in the earlier `describe('rankPlayers', ...)` tests to `categoryStats: []` (they don't test category-scoped sorting, so an empty array is correct — no other change needed to those tests).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/rankings/leaderboard.test.ts`
Expected: PASS

- [ ] **Step 5: Update `lib/hall-of-fame/awards.test.ts` fixture and tests**

Read the current file first. Replace the `p()` fixture's `footballGoalsScored: 0, footballGoalsConceded: 0,` with `categoryStats: [],`. Replace the `describe('pickGoldenBoot', ...)` block's bodies:

```typescript
describe('pickGoldenBoot', () => {
  it('returns null when no eligible players', () => {
    expect(pickGoldenBoot([])).toBeNull()
    expect(
      pickGoldenBoot([p({ id: 'a', totalMatches: 0, categoryStats: [{ category: 'football', scored: 50, conceded: 0 }] })]),
    ).toBeNull()
  })

  it('returns null when nobody has scored in that category', () => {
    expect(pickGoldenBoot([p({ id: 'a', totalMatches: 3, wins: 5, categoryStats: [] })])).toBeNull()
  })

  it('picks the highest football-scoped goals scored', () => {
    const r = pickGoldenBoot([
      p({ id: 'a', totalMatches: 3, categoryStats: [{ category: 'football', scored: 12, conceded: 0 }] }),
      p({ id: 'b', totalMatches: 3, categoryStats: [{ category: 'football', scored: 20, conceded: 0 }] }),
    ])
    expect(r?.id).toBe('b')
  })

  it('breaks a goals tie by wins', () => {
    const r = pickGoldenBoot([
      p({ id: 'a', totalMatches: 5, categoryStats: [{ category: 'football', scored: 15, conceded: 0 }], wins: 2 }),
      p({ id: 'b', totalMatches: 5, categoryStats: [{ category: 'football', scored: 15, conceded: 0 }], wins: 4 }),
    ])
    expect(r?.id).toBe('b')
  })
})

describe('pickCategoryAward', () => {
  it('works identically for a non-football category', () => {
    const r = pickCategoryAward(
      [
        p({ id: 'a', totalMatches: 3, categoryStats: [{ category: 'shooter', scored: 40, conceded: 0 }] }),
        p({ id: 'b', totalMatches: 3, categoryStats: [{ category: 'shooter', scored: 55, conceded: 0 }] }),
      ],
      'shooter',
    )
    expect(r?.id).toBe('b')
  })
})
```

Update the import line: `import { pickMVP, pickGoldenBoot, pickCategoryAward, deriveChampions, type ChampionInput } from './awards'`.

- [ ] **Step 6: Run the tests to verify they fail**

Run: `npx vitest run lib/hall-of-fame/awards.test.ts`
Expected: FAIL — `pickCategoryAward` not exported, `categoryStats` not a known field

- [ ] **Step 7: Update `lib/hall-of-fame/awards.ts`**

Read the current file first. Replace `pickGoldenBoot`:

```typescript
// Picks the top scorer in the given category among eligible players, ties
// broken by wins. Returns null if nobody eligible has scored anything in
// that category — otherwise a category with an active game but zero
// completed matches would silently crown an arbitrary non-player (whoever
// has the most wins) as its award winner.
export function pickCategoryAward(players: PlayerStatsInput[], category: string): PlayerStatsInput | null {
  const eligible = players.filter(isRankingEligible)
  if (eligible.length === 0) return null
  const ranked = [...eligible].sort(
    (a, b) => categoryStat(b.categoryStats, category).scored - categoryStat(a.categoryStats, category).scored || b.wins - a.wins,
  )
  const top = ranked[0]
  return categoryStat(top.categoryStats, category).scored > 0 ? top : null
}

// Kept for existing callers/tests — identical to pickCategoryAward(players, 'football').
export function pickGoldenBoot(players: PlayerStatsInput[]): PlayerStatsInput | null {
  return pickCategoryAward(players, 'football')
}
```

Add the import: `import { categoryStat } from '@/lib/rankings/game-breakdown'` alongside the existing imports at the top of the file.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run lib/hall-of-fame/awards.test.ts`
Expected: PASS

- [ ] **Step 9: Update `components/rankings/LeaderboardTabs.tsx`**

Read the current file first. Full replacement:

```tsx
'use client'
import { useState } from 'react'
import { LeaderboardTable } from './LeaderboardTable'
import { rankPlayersBy, type PlayerStatsInput, type LeaderboardMetric } from '@/lib/rankings/leaderboard'
import { CATEGORY_META } from '@/lib/games/categories'

const BASE_TABS: { key: LeaderboardMetric; label: string }[] = [
  { key: 'wins', label: 'Wins' },
  { key: 'score', label: 'Sentinel Score' },
]

export function LeaderboardTabs({
  players,
  currentUserId,
  activeCategories,
}: {
  players: PlayerStatsInput[]
  currentUserId: string | null
  activeCategories: string[]
}) {
  const categoryTabs = activeCategories
    .filter((c) => CATEGORY_META[c] != null)
    .map((c) => ({ key: c as LeaderboardMetric, label: CATEGORY_META[c].statLabel }))
  const tabs = [...BASE_TABS, ...categoryTabs]

  const [metric, setMetric] = useState<LeaderboardMetric>('wins')
  const ranked = rankPlayersBy(players, metric)
  return (
    <div>
      <div className="mb-4 flex gap-1 rounded-lg border border-slate-800 bg-slate-900 p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setMetric(t.key)}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-bold transition-colors ${
              metric === t.key ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <LeaderboardTable players={ranked} currentUserId={currentUserId} metric={metric} />
    </div>
  )
}
```

- [ ] **Step 10: Update `components/rankings/LeaderboardTable.tsx`**

Read the current file first. Replace only the two `Record<LeaderboardMetric, ...>` constants near the top (everything else in the file — the JSX, the GD column showing `pl.goalDiff` — is unchanged, per the approved spec's scope: GD stays the blended cross-game total, not touched by this task):

```typescript
import { CATEGORY_META } from '@/lib/games/categories'

const METRIC_LABEL: Record<LeaderboardMetric, string> = {
  wins: 'W',
  score: 'Score',
  football: CATEGORY_META.football?.statLabel ?? 'Football',
  fighting: CATEGORY_META.fighting?.statLabel ?? 'Fighting',
  shooter: CATEGORY_META.shooter?.statLabel ?? 'Shooter',
}
const METRIC_VALUE: Record<LeaderboardMetric, (p: RankedPlayer) => number> = {
  wins: (p) => p.wins,
  score: (p) => p.sentinelScore,
  football: (p) => categoryStat(p.categoryStats, 'football').scored,
  fighting: (p) => categoryStat(p.categoryStats, 'fighting').scored,
  shooter: (p) => categoryStat(p.categoryStats, 'shooter').scored,
}
```

Add `categoryStat` to the existing `@/lib/rankings/game-breakdown` — wait, there is no existing import from that module in this file; add a new import line: `import { categoryStat } from '@/lib/rankings/game-breakdown'`.

- [ ] **Step 11: Update `app/(public)/rankings/page.tsx`**

Read the current file first. Add the active-categories query and build `categoryStats` per player. Replace the `Promise.all` array and everything after it through the `LeaderboardTabs` call:

```typescript
import { CATEGORY_META } from '@/lib/games/categories'
```

```typescript
  const [{ data: profiles }, { data: matchRows }, { data: activeGames }, { data: { user } }] = await Promise.all([
    supabase
      .from('profiles')
      .select(
        'id, username, display_name, avatar_url, country, wins, losses, total_matches, goals_scored, goals_conceded, total_titles, sentinel_score, sentinel_tier',
      )
      .gte('total_matches', RANKING_MIN_MATCHES)
      .order('wins', { ascending: false })
      .limit(200),
    // Fetched once and shared by both winsByPlayerAndGame and the per-category
    // aggregates below — never fetch completed matches twice.
    supabase
      .from('matches')
      .select(
        'status, score_a, score_b, player_a_id, player_b_id, tournament:tournaments(game:games(name, category))',
      )
      .eq('status', 'completed'),
    // Independent of match data — a category can be "active" (a tab should
    // show) even with zero completed matches played in it yet.
    supabase.from('games').select('category').eq('active', true),
    supabase.auth.getUser(),
  ])

  const activeCategories = Array.from(new Set((activeGames ?? []).map((g) => g.category)))

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
  const categoryMaps = Object.keys(CATEGORY_META).map((category) => ({
    category,
    map: scoreStatsByPlayerAndCategory(matches, category),
  }))

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
      categoryStats: categoryMaps.map(({ category, map }) => ({
        category,
        scored: map.get(p.id)?.scored ?? 0,
        conceded: map.get(p.id)?.conceded ?? 0,
      })),
      winsByGame: winsMap.get(p.id) ?? [],
      totalTitles: p.total_titles,
      sentinelScore: p.sentinel_score,
      sentinelTier: p.sentinel_tier,
    }),
  )
```

Update the import line: `import { winsByPlayerAndGame, scoreStatsByPlayerAndCategory, type GameScopedMatch } from '@/lib/rankings/game-breakdown'` (drop `footballGoalsByPlayer`, add `scoreStatsByPlayerAndCategory`).

Update the `<LeaderboardTabs />` call to pass the new prop: `<LeaderboardTabs players={players} currentUserId={user?.id ?? null} activeCategories={activeCategories} />`.

- [ ] **Step 12: Update `app/(public)/hall-of-fame/page.tsx`**

Read the current file first. Mirror the same `categoryMaps`/`categoryStats` construction from Step 11 (this page's `matches` mapping is already identical in shape). Replace:

```typescript
  const goalsMap = footballGoalsByPlayer(matches)
```

with:

```typescript
  const categoryMaps = Object.keys(CATEGORY_META).map((category) => ({
    category,
    map: scoreStatsByPlayerAndCategory(matches, category),
  }))
```

And the `players` mapping's `footballGoalsScored`/`footballGoalsConceded` fields become:

```typescript
    categoryStats: categoryMaps.map(({ category, map }) => ({
      category,
      scored: map.get(p.id)?.scored ?? 0,
      conceded: map.get(p.id)?.conceded ?? 0,
    })),
```

Update the import: `import { scoreStatsByPlayerAndCategory, type GameScopedMatch } from '@/lib/rankings/game-breakdown'`, and add `import { CATEGORY_META } from '@/lib/games/categories'`, and `import { pickMVP, pickGoldenBoot, pickCategoryAward, deriveChampions, type ChampionInput } from '@/lib/hall-of-fame/awards'`.

Also fetch active categories the same way as Rankings (add `supabase.from('games').select('category').eq('active', true)` to this page's `Promise.all` and derive `activeCategories` the same way), then render one `AwardCard` per active non-football category using `pickCategoryAward`. Replace the `const mvp = pickMVP(players)` / `const goldenBoot = pickGoldenBoot(players)` block and the awards JSX section:

```typescript
  const mvp = pickMVP(players)
  const goldenBoot = pickGoldenBoot(players)
  const categoryAwards = activeCategories
    .filter((c) => c !== 'football' && CATEGORY_META[c] != null)
    .map((c) => ({ category: c, meta: CATEGORY_META[c], winner: pickCategoryAward(players, c) }))
    .filter((a) => a.winner != null)
```

In the JSX, after the existing `{goldenBoot && (<AwardCard .../>)}` block, add:

```tsx
                {categoryAwards.map(({ category, meta, winner }) => (
                  <AwardCard
                    key={category}
                    label={meta.awardName}
                    icon={meta.awardEmoji}
                    name={winner!.displayName ?? winner!.username ?? 'Anonymous'}
                    metricLabel={meta.statLabel.toLowerCase()}
                    metricValue={categoryStat(winner!.categoryStats, category).scored}
                  />
                ))}
```

Update `hasAwards` to `const hasAwards = mvp != null || goldenBoot != null || categoryAwards.length > 0`. Add `import { categoryStat } from '@/lib/rankings/game-breakdown'` for the metric-value lookup in the JSX above (or reuse the already-imported `scoreStatsByPlayerAndCategory`'s companion — `categoryStat` is the one needed here).

- [ ] **Step 13: Verify**

Run: `npx tsc --noEmit && npm run lint && npm run test`
Expected: no errors, full suite passes

- [ ] **Step 14: Commit**

```bash
git add lib/rankings/leaderboard.ts lib/rankings/leaderboard.test.ts lib/hall-of-fame/awards.ts lib/hall-of-fame/awards.test.ts components/rankings/LeaderboardTabs.tsx components/rankings/LeaderboardTable.tsx "app/(public)/rankings/page.tsx" "app/(public)/hall-of-fame/page.tsx"
git commit -m "feat: dynamic per-category Rankings tabs and Hall of Fame awards"
```

---

### Task 4: Profile page, dashboard header, pre-ship grep, and seeding

**Files:**
- Modify: `lib/players/profile.ts`
- Modify: `components/player/ProfileStats.tsx`
- Modify: `app/(public)/players/[username]/page.tsx`
- Modify: `components/dashboard/DashboardHeader.tsx`
- Modify: `app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `CATEGORY_META`, `CategoryStat`, `scoreStatsByPlayerAndCategory` (Task 1).

- [ ] **Step 1: Add `categoryStats` to `ProfileView`**

Read the current `lib/players/profile.ts` first. Add to the `ProfileView` interface (after `totalTitles`, before `rank`):

```typescript
import type { CategoryStat } from '@/lib/rankings/game-breakdown'
```

```typescript
export interface ProfileView {
  id: string
  username: string
  displayName: string | null
  avatarUrl: string | null
  country: string | null
  bio: string | null
  createdAt: string | null
  sentinelScore: number
  sentinelTier: string | null
  totalMatches: number
  wins: number
  losses: number
  goalsScored: number
  goalsConceded: number
  totalTitles: number
  categoryStats: CategoryStat[]
  rank: number | null // null = unranked
}
```

Leave `winPercent`/`goalDifference`/`matchOutcome` functions in this file untouched — `goalDifference` simply becomes unused by `ProfileStats.tsx` after Step 2 below, but is not deleted (other code or tests may still reference it).

- [ ] **Step 2: Rewrite `components/player/ProfileStats.tsx`**

Full replacement:

```tsx
import { Fragment } from 'react'
import { winPercent } from '@/lib/players/profile'
import type { ProfileView } from '@/lib/players/profile'
import { CATEGORY_META } from '@/lib/games/categories'

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-3 text-center">
      <p className="text-lg font-black text-white">{value}</p>
      <p className="mt-0.5 text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
    </div>
  )
}

export function ProfileStats({ profile }: { profile: ProfileView }) {
  // Only categories this player has actually completed matches in, and only
  // ones with a defined secondary stat ('other' deliberately has none).
  const playedCategories = profile.categoryStats.filter(
    (c) => CATEGORY_META[c.category] != null && (c.scored > 0 || c.conceded > 0),
  )
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-base font-bold text-white">Stats</h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Matches" value={profile.totalMatches} />
        <Stat label="Wins" value={profile.wins} />
        <Stat label="Losses" value={profile.losses} />
        <Stat label="Win rate" value={winPercent(profile.wins, profile.totalMatches)} />
        <Stat label="Titles" value={profile.totalTitles} />
        {playedCategories.map((c) => {
          const label = CATEGORY_META[c.category].statLabel
          const diff = c.scored - c.conceded
          return (
            <Fragment key={c.category}>
              <Stat label={`${label} for`} value={c.scored} />
              <Stat label={`${label} against`} value={c.conceded} />
              <Stat label={`${label} diff`} value={diff > 0 ? `+${diff}` : diff} />
            </Fragment>
          )
        })}
      </div>
    </section>
  )
}
```

A player who's only played football sees exactly today's three stat tiles (Goals for/against/diff); a multi-game player sees one triplet per category they've actually played.

- [ ] **Step 3: Add the per-category matches query to the profile page**

Read the current `app/(public)/players/[username]/page.tsx` first. Add these types near the top (after the existing `TitleRef`/`firstTitleName` helpers):

```typescript
import { scoreStatsByPlayerAndCategory, type GameScopedMatch, type CategoryStat } from '@/lib/rankings/game-breakdown'
import { CATEGORY_META } from '@/lib/games/categories'
```

```typescript
type CategoryGameRef = { name: string; category: string } | { name: string; category: string }[] | null
type CategoryTournamentRef = { game: CategoryGameRef } | { game: CategoryGameRef }[] | null
function firstCategoryGameRef(g: CategoryGameRef): { name: string; category: string } | null {
  return Array.isArray(g) ? g[0] ?? null : g
}
function firstCategoryTournamentRef(t: CategoryTournamentRef): { game: CategoryGameRef } | null {
  return Array.isArray(t) ? t[0] ?? null : t
}
```

Add a fourth query to the existing `Promise.all` (after the `rawFinals` query):

```typescript
    supabase
      .from('matches')
      .select(
        'score_a, score_b, player_a_id, player_b_id, status, tournament:tournaments(game:games(name, category))',
      )
      .eq('status', 'completed')
      .or(`player_a_id.eq.${p.id},player_b_id.eq.${p.id}`),
```

Destructure it: `const [{ data: rankData }, { data: rawMatches }, { data: rawFinals }, { data: rawCategoryMatches }] = await Promise.all([...])`.

After the `finalRows`/`titles` block, build the category stats:

```typescript
  const categoryMatches: GameScopedMatch[] = ((rawCategoryMatches as unknown[] | null) ?? []).map((raw) => {
    const m = raw as {
      score_a: number | null
      score_b: number | null
      player_a_id: string | null
      player_b_id: string | null
      status: string
      tournament: CategoryTournamentRef
    }
    const t = firstCategoryTournamentRef(m.tournament)
    const g = firstCategoryGameRef(t?.game ?? null)
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
  const categoryStats: CategoryStat[] = Object.keys(CATEGORY_META).map((category) => {
    const stat = scoreStatsByPlayerAndCategory(categoryMatches, category).get(p.id) ?? { scored: 0, conceded: 0 }
    return { category, ...stat }
  })
```

Add `categoryStats,` to the `profile: ProfileView` object literal (after `totalTitles: p.total_titles,`).

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors

- [ ] **Step 5: Fix `DashboardHeader` — drop the goals figure**

Read the current `components/dashboard/DashboardHeader.tsx` first. Replace:

```tsx
        <p className="mt-1 text-sm text-slate-400">
          <span className="font-bold text-emerald-400">{wins}</span> W ·{' '}
          <span className="font-bold text-red-400">{losses}</span> L ·{' '}
          <span className="font-bold text-white">{goalsScored}</span> goals
        </p>
```

with:

```tsx
        <p className="mt-1 text-sm text-slate-400">
          <span className="font-bold text-emerald-400">{wins}</span> W ·{' '}
          <span className="font-bold text-red-400">{losses}</span> L
        </p>
```

Remove `goalsScored` from the component's prop type and function signature entirely (both the destructured param and the `{ ...: number }` type block).

- [ ] **Step 6: Update the dashboard page's `DashboardHeader` call**

Read the current `app/dashboard/page.tsx` first. Remove the `goalsScored={profile?.goals_scored ?? 0}` line from the `<DashboardHeader />` call. Leave the `profiles` query's `select(...)` string with `goals_scored` in it untouched (it's a cheap extra column, and other code in this file may still reference `profile?.goals_scored` — check before removing the column from the select; if nothing else in this file uses it after this change, it's fine to leave unused in the select rather than risk missing a reference).

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit && npm run lint && npm run test && npm run build`
Expected: no errors, full suite passes, production build succeeds

- [ ] **Step 8: Pre-ship due diligence — grep for stray display reads**

Run: `grep -rn "goals_scored\|goalsConceded\|goalsScored" --include="*.tsx" --include="*.ts" app/ components/ lib/ | grep -v test`

Review the output. Expected remaining matches: `lib/scoring/stats.ts` (the recompute engine, writes the columns — correct, untouched by this plan), `lib/rankings/leaderboard.ts`'s `goalsScored`/`goalsConceded` fields on `PlayerStatsInput`/`RankedPlayer` (still used for the blended `goalDiff` tie-break and GD column, deliberately out of scope per the approved spec), and the `profiles` table `.select()` strings that still fetch the columns (harmless, unused-for-display is fine). If anything else displays these values directly to a user, flag it — don't fix silently, report back what was found before touching it, since it wasn't anticipated by the spec.

- [ ] **Step 9: Seed the four launch games**

Via the new `/admin/games` page (not a migration), create:
- EA FC Mobile — category `football`
- eFootball — category `football`
- COD Mobile — category `shooter`
- Mortal Kombat Mobile — category `fighting`

- [ ] **Step 10: Commit**

```bash
git add lib/players/profile.ts components/player/ProfileStats.tsx "app/(public)/players/[username]/page.tsx" components/dashboard/DashboardHeader.tsx app/dashboard/page.tsx
git commit -m "fix: profile page and dashboard header show per-category stats instead of a cross-game blend"
```
