# Mobile Phase 3a (Web) — Rankings / Seasons / Hall of Fame API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the rankings / hall-of-fame / seasons aggregation out of their web pages into shared services (behavior-neutral, proven by characterization tests), then expose them as read-only `/api/mobile/v1` endpoints.

**Architecture:** Two PRs. **PR 1** (Tasks 0–8) adds characterization tests that pin the *entire rendered element tree* and the *query log* of each web page, then moves the inline data logic into `lib/{rankings,hall-of-fame,seasons}/service.ts`; the same tests must pass unchanged afterwards. **PR 2** (Tasks 9–14) adds strict zod schemas + mappers and five `defineEndpoint()` endpoints on top of those services. Nothing about query shape, ranking math or tie-breaks changes in either PR.

**Tech Stack:** Next.js 14, TypeScript, Supabase JS, zod, vitest (`include: **/*.test.ts` only — test files must be `.ts`, not `.tsx`).

**Spec:** `docs/superpowers/specs/2026-09-23-mobile-phase3a-rankings-seasons-hof-design.md` (read it fully first, especially §3 and §5). Also read `CLAUDE.md` (repo root) — its "Key Rules When Coding" bind you; §"Global Constraints" restates the ones that matter here.

## Global Constraints

- **No behavior change in PR 1.** No query merged, dropped, reordered, cached or re-limited. Ranking math, tie-breaks, `RANKING_MIN_MATCHES`, the 200-profile cap and the 2000-snapshot cap stay exactly as they are.
- **Endpoints:** every route is defined with `defineEndpoint()` (`lib/mobile-api/define-endpoint.ts`); never hand-write a handler under `app/api/mobile/v1/**`. The route file is only `export const GET = xEndpoint.handler`.
- **No `select('*')` on `profiles`.** Explicit column lists only. `anon`/`authenticated` can SELECT only the allow-listed columns in `20260918200000_lock_down_profiles_and_write_paths.sql`.
- **Season endpoints run on the admin (service-role) client with no RLS backstop** — the single highest column-exposure risk in 3a. Explicit column lists, explicit mapper output, `.strict()` response schemas, and exact-key-set tests (Tasks 4, 11) are the only guard. Do not widen any select in `lib/seasons/data.ts`.
- **Rankings and hall-of-fame endpoints use `createAnonClient()`** (`lib/mobile-api/anon-client.ts`), like `/home` does — RLS applies as anon.
- `GET /rankings`, `/seasons`, `/seasons/{slug}`, `/hall-of-fame` must **not read the bearer** and must be byte-identical for everyone; only `GET /rankings/me` is `auth: 'user'`.
- **Migrations:** none expected. If one becomes necessary, name it with a UTC timestamp prefix (`20260924143000_x.sql`), never a sequential number.
- **Before every push:** `npm run lint` and `npm run build` (ESLint runs inside `next build`; `tsc --noEmit` alone is not enough). Never run `npm run build` while another session's `next dev` is running in the same checkout — work in your own worktree.
- **`npm run openapi` last**, after rebasing onto current `main`, then commit `openapi/mobile-v1.json`. Resolve conflicts in that file by regenerating, never by merging text.
- **Shared hotspots** the concurrent Phase 2b session also edits: `lib/mobile-api/endpoints/index.ts` (append-only edits), `openapi/mobile-v1.json`, `lib/supabase/types.ts`. Prefer new files.
- Use American spelling in new prose/code (`color`, `anonymize`); existing identifiers stay as they are.
- tsconfig has no `downlevelIteration`: use `Array.from(map.entries())` / `.forEach`, never `[...map]` or `for…of` on a `Map`/`Set`.

---

## File Structure

**PR 1 (tests + extraction)**

| File | Responsibility |
|---|---|
| `lib/testing/fake-supabase.ts` (create) | In-memory chainable Supabase double: applies `eq/neq/in/gte/is/not` filters to fixture rows, ignores `order/limit/select`, records a query log, throws on any unsupported method |
| `lib/testing/serialize-tree.ts` (create) | Turns a React element tree (what an async Server Component returns) into plain JSON for snapshotting |
| `lib/testing/progress-fixtures.ts` (create) | Deterministic fixture tables (profiles, games, matches, snapshots, seasons, tournaments, …) |
| `app/[locale]/(public)/rankings/page.characterization.test.ts` (create) | Snapshot of tree + query log, several scenarios |
| `app/[locale]/(public)/hall-of-fame/page.characterization.test.ts` (create) | Same |
| `app/[locale]/seasons/[slug]/page.characterization.test.ts` (create) | Same |
| `lib/seasons/data.test.ts` (modify) | Add exact-key-set assertions |
| `lib/rankings/service.ts` (create) | `getRankings()` — the logic moved out of `rankings/page.tsx` |
| `lib/hall-of-fame/service.ts` (create) | `getHallOfFame()` |
| `lib/seasons/service.ts` (create) | `listSeasons()`, `getSeasonDetail()` |
| the three `page.tsx` files (modify) | Become thin callers |

**PR 2 (endpoints)**

| File | Responsibility |
|---|---|
| `lib/mobile-api/endpoints/progress-schemas.ts` (create) | Strict zod schemas + `mapPlayerCard()` and friends |
| `lib/mobile-api/endpoints/rankings.ts` (create) | `rankingsEndpoint`, `rankingsMeEndpoint` |
| `lib/mobile-api/endpoints/seasons.ts` (create) | `seasonsListEndpoint`, `seasonDetailEndpoint` |
| `lib/mobile-api/endpoints/hall-of-fame.ts` (create) | `hallOfFameEndpoint` |
| `lib/mobile-api/endpoints/index.ts` (modify) | Append the five endpoints |
| `app/api/mobile/v1/{rankings,rankings/me,seasons,seasons/[slug],hall-of-fame}/route.ts` (create) | One-line route files |
| `*.test.ts` beside each endpoint (create) | Handler tests |

---

## PR 1 — Behavior-neutral extraction

### Task 0: Worktree, branch, baseline

**Files:** none (environment only)

- [ ] **Step 1: Create an isolated worktree from current `main`**

```bash
git fetch origin
git worktree add ../sentinelx-p3a-web -b phase3a/web-extraction origin/main
cd ../sentinelx-p3a-web
npm ci
```

- [ ] **Step 2: Confirm the suite is green before touching anything**

Run: `npx vitest run 2>&1 | tail -15`
Expected: all pass. If anything fails on a clean `main`, stop and report it — do not proceed on a red base.
(Check `git worktree list` first: nested worktrees make vitest double-count tests.)

- [ ] **Step 3: Record the cost baseline (live, staging)**

For each of `/rankings`, `/hall-of-fame`, `/seasons/<current-season-slug>` on the staging deployment (`sentinelx-staging`, project `ofxmoxpvwbemfouaowoa`), run 5 times and note the median:

```bash
for i in 1 2 3 4 5; do curl -s -o /dev/null -w "%{time_total}\n" "$STAGING_URL/rankings"; done
```

Write the three medians into a scratch note; they go in the PR description in Task 8. (Query counts come from the tests in Tasks 2–4.)

---

### Task 1: Test harness — fake Supabase, tree serializer, fixtures

**Files:**
- Create: `lib/testing/fake-supabase.ts`, `lib/testing/serialize-tree.ts`, `lib/testing/progress-fixtures.ts`
- Test: `lib/testing/fake-supabase.test.ts`, `lib/testing/serialize-tree.test.ts`
- Modify: `vitest.config.ts` (JSX transform)

**Interfaces:**
- Produces: `fakeSupabase(tables, opts?) → { client, queries }`; `serializeTree(node) → unknown`; `FIXTURE_TABLES`, `FIXTURE_NOW`, `VIEWER_ID`.

- [ ] **Step 1: Write the failing test for the fake**

```ts
// lib/testing/fake-supabase.test.ts
import { describe, it, expect } from 'vitest'
import { fakeSupabase } from './fake-supabase'

describe('fakeSupabase', () => {
  const tables = { profiles: [{ id: 'a', wins: 3 }, { id: 'b', wins: 1 }, { id: 'c', wins: 5 }] }

  it('applies gte/eq/in filters and ignores order/limit/select', async () => {
    const { client } = fakeSupabase(tables)
    const { data } = await client.from('profiles').select('id, wins').gte('wins', 3).order('wins', { ascending: false }).limit(200)
    expect((data as { id: string }[]).map((r) => r.id)).toEqual(['a', 'c'])
    const r2 = await client.from('profiles').select('id').in('id', ['b', 'c'])
    expect((r2.data as { id: string }[]).map((r) => r.id)).toEqual(['b', 'c'])
  })

  it('supports lt on ISO date strings', async () => {
    const { client } = fakeSupabase({ t: [{ id: 1, d: '2026-09-01T00:00:00Z' }, { id: 2, d: '2026-10-01T00:00:00Z' }] })
    const { data } = await client.from('t').select('id').gte('d', '2026-09-01T00:00:00Z').lt('d', '2026-10-01T00:00:00Z')
    expect((data as { id: number }[]).map((r) => r.id)).toEqual([1])
  })

  it('returns a count for head:true selects', async () => {
    const { client } = fakeSupabase(tables)
    const res = await client.from('profiles').select('id', { count: 'exact', head: true })
    expect(res.count).toBe(3)
    expect(res.data).toBeNull()
  })

  it('supports maybeSingle and auth.getUser', async () => {
    const { client } = fakeSupabase(tables, { user: { id: 'a' } })
    const one = await client.from('profiles').select('*').eq('id', 'b').maybeSingle()
    expect(one.data).toEqual({ id: 'b', wins: 1 })
    expect((await client.auth.getUser()).data.user).toEqual({ id: 'a' })
  })

  it('logs every query in order', async () => {
    const { client, queries } = fakeSupabase(tables)
    await client.from('profiles').select('id').eq('id', 'a')
    await client.from('games').select('id')
    expect(queries).toEqual(['profiles:select|eq(id)', 'games:select'])
  })

  it('throws loudly on an unsupported method', () => {
    const { client } = fakeSupabase(tables)
    expect(() => (client.from('profiles') as unknown as { overlaps: () => void }).overlaps()).toThrow(/not supported/)
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run lib/testing/fake-supabase.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the fake**

```ts
// lib/testing/fake-supabase.ts
type Row = Record<string, unknown>

// Numbers compare numerically, everything else (ISO date strings) lexicographically - correct for ISO-8601 UTC.
function cmp(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b))
}

/**
 * In-memory stand-in for the Supabase query builder, for characterization and service tests.
 * It APPLIES eq/neq/in/gte/is/not filters to fixture rows (so a query's filters matter) and IGNORES
 * order/limit/select-column-lists/embedded selects (fixtures already carry the nested shape the code reads).
 * Every query is logged as `table:op|op(col)…` so tests can pin query count and shape.
 * Any method it does not implement throws — extend it deliberately, never silently.
 */
export function fakeSupabase(tables: Record<string, Row[]>, opts: { user?: { id: string } | null } = {}) {
  const queries: string[] = []

  function builder(table: string) {
    let rows: Row[] = (tables[table] ?? []).slice()
    let head = false
    let wantCount = false
    let single = false
    const ops: string[] = []

    const filter = (name: string, col: string, pred: (v: unknown) => boolean) => {
      ops.push(`${name}(${col})`)
      rows = rows.filter((r) => pred(r[col]))
      return proxy
    }

    const impl: Record<string, unknown> = {
      select(_cols?: string, o?: { count?: string; head?: boolean }) {
        ops.push('select')
        if (o?.count) wantCount = true
        if (o?.head) head = true
        return proxy
      },
      eq: (col: string, val: unknown) => filter('eq', col, (v) => v === val),
      neq: (col: string, val: unknown) => filter('neq', col, (v) => v !== val),
      gte: (col: string, val: unknown) => filter('gte', col, (v) => cmp(v, val) >= 0),
      lt: (col: string, val: unknown) => filter('lt', col, (v) => cmp(v, val) < 0),
      in: (col: string, vals: unknown[]) => filter('in', col, (v) => vals.includes(v)),
      is: (col: string, val: unknown) => filter('is', col, (v) => (v ?? null) === val),
      not: (col: string, _op: string, val: unknown) => filter('not', col, (v) => (v ?? null) !== val),
      order: () => proxy,
      limit: () => proxy,
      maybeSingle: () => {
        single = true
        return proxy
      },
      single: () => {
        single = true
        return proxy
      },
      then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
        queries.push(`${table}:${ops.join('|')}`)
        const data = head ? null : single ? rows[0] ?? null : rows
        return Promise.resolve({ data, count: wantCount ? rows.length : null, error: null }).then(resolve, reject)
      },
    }

    const proxy: unknown = new Proxy(impl, {
      get(target, prop) {
        if (typeof prop === 'symbol') return undefined
        if (prop in target) return target[prop]
        throw new Error(`fake-supabase: .${prop}() is not supported — implement it in lib/testing/fake-supabase.ts`)
      },
    })
    return proxy as Record<string, (...a: unknown[]) => unknown>
  }

  // Deliberately loose: production code takes the real SupabaseClient type; tests inject this via vi.mock / `as never`.
  const client = {
    // Test double: the chain is intentionally untyped so tests can call any supported builder method.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    from: (table: string): any => builder(table),
    auth: { getUser: async () => ({ data: { user: opts.user ?? null }, error: null }) },
  }
  return { client, queries }
}
```

- [ ] **Step 4: Run to green**

Run: `npx vitest run lib/testing/fake-supabase.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Serializer test + implementation**

```ts
// lib/testing/serialize-tree.test.ts
import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { serializeTree } from './serialize-tree'

function Card(_: { name: string; onClick?: () => void }) { return null }

describe('serializeTree', () => {
  it('serializes nested elements, props, functions, arrays and maps', () => {
    const tree = createElement('div', { className: 'x' }, 'hi', createElement(Card, { name: 'A', onClick: () => {} }), [1, 2])
    expect(serializeTree(tree)).toEqual({
      t: 'div',
      props: { className: 'x' },
      children: ['hi', { t: 'Card', props: { name: 'A', onClick: '[fn]' }, children: null }, [1, 2]],
    })
  })
  it('serializes Map props deterministically', () => {
    const tree = createElement(Card as never, { name: 'A', by: new Map([['k', 1]]) })
    expect(serializeTree(tree)).toMatchObject({ props: { by: { __map: [['k', 1]] } } })
  })
})
```

```ts
// lib/testing/serialize-tree.ts
import { isValidElement, type ReactNode } from 'react'

function typeName(t: unknown): string {
  if (typeof t === 'string') return t
  const x = t as { displayName?: string; name?: string; render?: { name?: string } } | null
  return x?.displayName || x?.name || x?.render?.name || 'Anonymous'
}

function value(v: unknown): unknown {
  if (typeof v === 'function') return '[fn]'
  if (Array.isArray(v)) return v.map(value)
  if (isValidElement(v)) return serializeTree(v)
  if (v instanceof Map) return { __map: Array.from(v.entries()).map(([k, x]) => [value(k), value(x)]) }
  if (v instanceof Set) return { __set: Array.from(v.values()).map(value) }
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, value(x)]))
  return v
}

/** Plain-JSON view of what an async Server Component returns, for snapshotting. Children components are NOT executed. */
export function serializeTree(node: ReactNode): unknown {
  if (node === null || node === undefined || typeof node === 'boolean') return null
  if (typeof node === 'string' || typeof node === 'number') return node
  if (Array.isArray(node)) return node.map(serializeTree)
  if (isValidElement(node)) {
    const { children, ...props } = node.props as Record<string, unknown>
    return { t: typeName(node.type), props: value(props), children: serializeTree(children as ReactNode) }
  }
  return String(node)
}
```

Run: `npx vitest run lib/testing/serialize-tree.test.ts` → PASS.

- [ ] **Step 6: JSX transform for page tests**

Page files contain JSX and Next's tsconfig uses `"jsx": "preserve"`, which vitest's esbuild will not compile. Add to `vitest.config.ts` (top level, next to `resolve`):

```ts
  esbuild: { jsx: 'automatic' },
```

Run the **whole** suite: `npx vitest run 2>&1 | tail -8` — expected: unchanged pass count.

- [ ] **Step 7: Fixtures**

```ts
// lib/testing/progress-fixtures.ts
type Row = Record<string, unknown>

export const FIXTURE_NOW = '2026-09-23T12:00:00.000Z'
export const VIEWER_ID = 'p5'

export const GAMES: Row[] = [
  { id: 'g-dls', name: 'Dream League Soccer', slug: 'dls', category: 'football', active: true },
  { id: 'g-fc', name: 'EA FC Mobile', slug: 'ea-fc-mobile', category: 'football', active: true },
  { id: 'g-ff', name: 'Free Fire', slug: 'free-fire', category: 'shooter', active: true },
]

function profile(i: number, over: Row = {}): Row {
  return {
    id: `p${i}`, username: `player${i}`, display_name: `Player ${i}`, avatar_url: null,
    country: i % 2 ? 'NG' : 'GH',
    wins: 12 - i, losses: i, total_matches: 12, goals_scored: 30 - i, goals_conceded: 10 + i,
    total_titles: i < 3 ? 1 : 0, sx_score: 1000 - i * 20, sentinel_tier: 'trusted', membership_tier: 'bronze',
    kyc_verified: i % 3 === 0, deleted_at: null, equipped_avatar_border: null,
    ...over,
  }
}

// p5 and p6 tie on wins (7 each) so the tie-break cascade is exercised; p9 is a deleted account (tombstone);
// p10 has zero matches and is excluded by the total_matches >= RANKING_MIN_MATCHES filter.
export const PROFILES: Row[] = [
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => profile(i, i === 6 ? { wins: 7, losses: 5 } : {})),
  profile(9, { deleted_at: '2026-09-01T00:00:00Z', username: null, display_name: null }),
  profile(10, { total_matches: 0, wins: 0, losses: 0 }),
]

function match(n: number, gameId: string, a: string, b: string, sa: number, sb: number): Row {
  const g = GAMES.find((x) => x.id === gameId)!
  return {
    id: `m${n}`, status: 'completed', round: 'group', score_a: sa, score_b: sb,
    player_a_id: a, player_b_id: b, team_a_id: null, team_b_id: null,
    completed_at: `2026-09-${String(1 + (n % 20)).padStart(2, '0')}T10:00:00Z`,
    tournament: { game: { id: g.id, name: g.name, category: g.category } },
  }
}

export const MATCHES: Row[] = [
  ...Array.from({ length: 16 }, (_, k) => match(k + 1, 'g-dls', `p${(k % 8) + 1}`, `p${((k + 3) % 8) + 1}`, (k * 7) % 4, (k * 5) % 3)),
  ...Array.from({ length: 6 }, (_, k) => match(100 + k, 'g-fc', `p${(k % 4) + 1}`, `p${(k % 4) + 5}`, (k % 3) + 1, k % 2)),
  ...Array.from({ length: 4 }, (_, k) => match(200 + k, 'g-ff', `p${k + 1}`, `p${k + 5}`, 10 + k, 3 + k)),
]

export const SNAPSHOTS: Row[] = [1, 2, 3, 4, 5, 6, 7, 8].flatMap((i) => [
  { player_id: `p${i}`, game_id: null, rank: i === 5 ? 4 : i, captured_on: '2026-09-16' },
  { player_id: `p${i}`, game_id: 'g-dls', rank: i, captured_on: '2026-09-16' },
])

export const SEASONS: Row[] = [
  { id: 's1', slug: 'season-1', name: 'Season 1', start_date: '2026-08-01', end_date: '2026-10-31' },
]

export const FIXTURE_TABLES: Record<string, Row[]> = {
  profiles: PROFILES,
  games: GAMES,
  matches: MATCHES,
  player_rank_snapshots: SNAPSHOTS,
  seasons: SEASONS,
  tournaments: [],          // extended per page in Tasks 3–4
  squads: [],
  squad_members: [],
  season_ranking_points: [],
  season_noshow_penalties: [],
  tournament_registrations: [],
  player_achievements: [],
}
```

Sanity check: `PROFILES.length` is 10; after the `total_matches >= 1` filter 9 remain (8 normal + the tombstone).

- [ ] **Step 8: Commit**

```bash
git add lib/testing vitest.config.ts
git commit -m "test: fake-supabase, tree serializer and fixtures for 3a characterization

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Characterize the rankings page (BEFORE any refactor)

**Files:**
- Create: `app/[locale]/(public)/rankings/page.characterization.test.ts`

**Interfaces:**
- Consumes: `fakeSupabase`, `serializeTree`, `FIXTURE_TABLES`, `FIXTURE_NOW`, `VIEWER_ID`.
- Produces: committed `__snapshots__` files that PR 1's later tasks must leave byte-for-byte unchanged.

- [ ] **Step 1: Write the test**

```ts
// app/[locale]/(public)/rankings/page.characterization.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fakeSupabase } from '@/lib/testing/fake-supabase'
import { serializeTree } from '@/lib/testing/serialize-tree'
import { FIXTURE_TABLES, FIXTURE_NOW, VIEWER_ID } from '@/lib/testing/progress-fixtures'

const state = vi.hoisted(() => ({ fake: null as null | { client: unknown; queries: string[] } }))
vi.mock('@/lib/supabase/server', () => ({ createClient: () => state.fake!.client }))

import RankingsPage from './page'

async function render(searchParams: Record<string, string>, user: { id: string } | null) {
  state.fake = fakeSupabase(FIXTURE_TABLES, { user }) as never
  const tree = await RankingsPage({ searchParams })
  return { tree: serializeTree(tree), queries: state.fake!.queries }
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(FIXTURE_NOW)) })
afterEach(() => vi.useRealTimers())

describe('rankings page — characterization (pins current behavior; must not change during extraction)', () => {
  it('overall board, anonymous', async () => {
    const r = await render({}, null)
    expect(r.tree).toMatchSnapshot('tree')
    expect(r.queries).toMatchSnapshot('queries')
  })
  it('overall board, signed in (viewer row pinned when off-page)', async () => {
    const r = await render({ page: '1' }, { id: VIEWER_ID })
    expect(r.tree).toMatchSnapshot('tree')
  })
  it('game board (dls) narrows to players who competed', async () => {
    const r = await render({ game: 'dls' }, null)
    expect(r.tree).toMatchSnapshot('tree')
  })
  it('region filter', async () => {
    const r = await render({ region: 'GH' }, null)
    expect(r.tree).toMatchSnapshot('tree')
  })
  it('out-of-range page clamps', async () => {
    const r = await render({ page: '99' }, null)
    expect(r.tree).toMatchSnapshot('tree')
  })
  it('fixtures actually exercise the interesting paths (guards against an empty, vacuous snapshot)', async () => {
    const json = JSON.stringify((await render({}, null)).tree)
    expect(json).toContain('player1')
    expect(json).toContain('"direction"') // trend props present
  })
})
```

- [ ] **Step 2: Run to generate snapshots**

Run: `npx vitest run "app/[locale]/(public)/rankings/page.characterization.test.ts"`
Expected: PASS, snapshots written. If it fails with `fake-supabase: .xyz() is not supported`, implement that method in the fake (Task 1) — do **not** change the page. If it fails on an import (e.g. a module needing env vars), mock that module in the test.

- [ ] **Step 3: Read the snapshot, not just the pass**

Open `__snapshots__/page.characterization.test.ts.snap`. Confirm by eye: the board contains ranked players in the expected order (`p5`/`p6` tie-break visible), the tombstone `p9` is handled as the page handles it today, `p10` is absent, `region: 'GH'` shows only GH players, the game board shows only players in `MATCHES` for `g-dls`. If the snapshot is empty/trivial, fix the fixtures.

- [ ] **Step 4: Prove the harness catches regressions**

In `lib/rankings/leaderboard.ts` `rankPlayersBy`, temporarily swap the `b.wins - a.wins` and `b.winRate - a.winRate` terms of the tie-break cascade. Run the characterization test: it **must fail** (the p5/p6 tie reorders). Revert with `git checkout lib/rankings/leaderboard.ts` and re-run: PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/[locale]/(public)/rankings"
git commit -m "test: characterize rankings page (tree + query log) before extraction

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Characterize the hall-of-fame page

**Files:**
- Create: `app/[locale]/(public)/hall-of-fame/page.characterization.test.ts`
- Modify: `lib/testing/progress-fixtures.ts` (add completed tournaments + finals + third-place rows)

- [ ] **Step 1: Extend fixtures so every section is non-empty**

Read `lib/tournaments/champions.ts:236-330` (`fetchChampions`) and the tail of `app/[locale]/(public)/hall-of-fame/page.tsx` (third-place query at ~line 233, `sideRef`, `ProfileRef`/`SquadRef`). Add to `FIXTURE_TABLES`:
- `tournaments`: one completed `masters` tournament, one completed `champions_cup`, one completed `community_club`, each with `id, slug, title, tournament_type, prize_pool, tournament_end, game_id, games: {name}, season: {name}`.
- `matches`: for each, a completed `round: 'final'` row (embedded `player_a`/`player_b` objects in the exact shape `fetchChampions` reads), and one `round: 'third_place'` row for the masters tournament (embedded `player_a`/`team_a` etc. as the page's query selects).
Keep IDs in the `p1…p8` range.

- [ ] **Step 2: Write the test**

```ts
// app/[locale]/(public)/hall-of-fame/page.characterization.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fakeSupabase } from '@/lib/testing/fake-supabase'
import { serializeTree } from '@/lib/testing/serialize-tree'
import { FIXTURE_TABLES, FIXTURE_NOW } from '@/lib/testing/progress-fixtures'

const state = vi.hoisted(() => ({ fake: null as null | { client: unknown; queries: string[] } }))
vi.mock('@/lib/supabase/server', () => ({ createClient: () => state.fake!.client }))

import HallOfFamePage from './page'

async function render(searchParams: Record<string, string>) {
  state.fake = fakeSupabase(FIXTURE_TABLES, { user: null }) as never
  const tree = await HallOfFamePage({ searchParams })
  return { tree: serializeTree(tree), queries: state.fake!.queries }
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(FIXTURE_NOW)) })
afterEach(() => vi.useRealTimers())

describe('hall-of-fame page — characterization', () => {
  it('all games', async () => {
    const r = await render({})
    expect(r.tree).toMatchSnapshot('tree')
    expect(r.queries).toMatchSnapshot('queries')
  })
  it('filtered to one game', async () => {
    expect((await render({ game: 'dls' })).tree).toMatchSnapshot('tree')
  })
  it('unknown game slug falls back to all games', async () => {
    expect((await render({ game: 'nope' })).tree).toEqual((await render({})).tree)
  })
  it('every section is populated (guards against vacuous snapshots)', async () => {
    const json = JSON.stringify((await render({})).tree)
    for (const needle of ['All-Time MVP', 'Golden Boot', 'ChampionsCupCard', 'MastersChampionCard', 'BronzeCard']) {
      expect(json, needle).toContain(needle)
    }
  })
})
```

- [ ] **Step 3: Run, inspect, prove sensitivity**

Run: `npx vitest run "app/[locale]/(public)/hall-of-fame/page.characterization.test.ts"`. Fix fixtures/fake until the populated-sections test passes. Read the snapshot. Prove sensitivity by temporarily editing `pickMVP` in `lib/hall-of-fame/awards.ts` to return `null`; the test must fail; revert.

- [ ] **Step 4: Commit**

```bash
git add "app/[locale]/(public)/hall-of-fame" lib/testing
git commit -m "test: characterize hall-of-fame page before extraction

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Characterize seasons — exact key sets (the admin-client risk)

**Files:**
- Modify: `lib/seasons/data.test.ts` (add assertions)
- Create: `app/[locale]/seasons/[slug]/page.characterization.test.ts`

**Why this task is special:** `getSeasonLeaderboard`/`getMonthlyLeaderboard` run on the **admin client** — RLS will not catch an over-wide select or an extra field on a returned object. These tests are the only guard.

- [ ] **Step 1: Add exact-key-set tests to `lib/seasons/data.test.ts`**

Append (uses the shared `fakeSupabase`, not the file's rigid `fakeAdmin`; add `import { fakeSupabase } from '@/lib/testing/fake-supabase'` and extend the existing import to `{ getSeasonLeaderboard, getMonthlyLeaderboard }`):

```ts
describe('season leaderboards - exposed field set (admin client: no RLS backstop)', () => {
  const ROW_KEYS = ['avatarUrl', 'displayName', 'isProvisional', 'playerId', 'points', 'sxScore', 'username']

  // An extra sensitive-looking column on the profile row must never appear in the result.
  const profiles = [{ id: 'p1', username: 'ada', display_name: 'Ada', avatar_url: null, sx_score: 1234, whatsapp_number: '+2348000000000' }]

  it('getSeasonLeaderboard rows contain exactly the documented keys and nothing else', async () => {
    const { client } = fakeSupabase({
      tournaments: [{ id: 't1', season_id: 's1', game_id: 'g1', status: 'completed', tournament_type: 'masters', entry_unit: 'player' }],
      matches: [],
      tournament_registrations: [],
      season_ranking_points: [{ season_id: 's1', tournament_id: 't1', player_id: 'p1', points: 40 }],
      season_noshow_penalties: [],
      profiles,
    })
    const rows = await getSeasonLeaderboard(client as never, 's1', 'g1')
    expect(rows.length).toBe(1)
    expect(rows[0]).toMatchObject({ playerId: 'p1', points: 40, sxScore: 1234 })
    for (const row of rows) expect(Object.keys(row).sort()).toEqual(ROW_KEYS)
    expect(JSON.stringify(rows)).not.toContain('whatsapp')
  })

  it('getMonthlyLeaderboard rows contain exactly the documented keys and nothing else', async () => {
    const { client } = fakeSupabase({
      tournaments: [{ id: 't1', season_id: 's1', game_id: 'g1', tournament_type: 'community_club', tournament_start: '2026-09-10T10:00:00Z' }],
      matches: [{ id: 'm1', tournament_id: 't1' }],
      season_ranking_points: [{ season_id: 's1', tournament_id: 't1', player_id: 'p1', points: 25 }],
      season_noshow_penalties: [],
      profiles,
    })
    const rows = await getMonthlyLeaderboard(client as never, 's1', new Date('2026-09-15T00:00:00Z'), 'g1')
    expect(rows.length).toBe(1)
    for (const row of rows) expect(Object.keys(row).sort()).toEqual(ROW_KEYS)
    expect(JSON.stringify(rows)).not.toContain('whatsapp')
  })
})
```

If `getSeasonLeaderboard` issues a query the fake does not support (or reads a table not listed), extend the fixture/fake - do not touch `lib/seasons/data.ts`.

- [ ] **Step 2: Run, and prove the tests can fail**

Run: `npx vitest run lib/seasons/data.test.ts` -> PASS. Sensitivity check: in `lib/seasons/data.ts`, temporarily add an extra property (e.g. `whatsapp: 'x'`) to the row object built in `toRows`; both new tests **must fail**. Revert with `git checkout lib/seasons/data.ts`.

- [ ] **Step 3: Page characterization**

Extend `FIXTURE_TABLES` with a `tournaments` row for season `s1` (game `g-dls`, `tournament_type: 'masters'`, `season_id: 's1'`, `status: 'completed'`, `invitation_only: false`, `entry_unit: 'player'`), a `season_ranking_points` row and a `tournament_registrations` row so the leaderboard is non-empty. Write:

```ts
// app/[locale]/seasons/[slug]/page.characterization.test.ts
import { describe, it, expect, vi } from 'vitest'
import { fakeSupabase } from '@/lib/testing/fake-supabase'
import { serializeTree } from '@/lib/testing/serialize-tree'
import { FIXTURE_TABLES } from '@/lib/testing/progress-fixtures'

const state = vi.hoisted(() => ({ fake: null as null | { client: unknown; queries: string[] } }))
vi.mock('@/lib/supabase/server', () => ({ createClient: () => state.fake!.client }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => state.fake!.client }))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND') } }))

import SeasonPage from './page'

describe('season page — characterization', () => {
  it('renders sections for every active game', async () => {
    state.fake = fakeSupabase(FIXTURE_TABLES, { user: { id: 'p1' } }) as never
    const tree = await SeasonPage({ params: { slug: 'season-1' } })
    expect(serializeTree(tree)).toMatchSnapshot('tree')
    expect(state.fake!.queries).toMatchSnapshot('queries')
  })
  it('404s on an unknown slug', async () => {
    state.fake = fakeSupabase(FIXTURE_TABLES) as never
    await expect(SeasonPage({ params: { slug: 'nope' } })).rejects.toThrow('NOT_FOUND')
  })
})
```

Run and read the snapshot (leaderboard rows present, DLS game first, tier labels present).

- [ ] **Step 4: Commit**

```bash
git add lib/seasons "app/[locale]/seasons" lib/testing
git commit -m "test: exact-key-set + page characterization for seasons (admin-client path)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Extract `lib/rankings/service.ts`

**Files:**
- Create: `lib/rankings/service.ts`
- Modify: `app/[locale]/(public)/rankings/page.tsx`

**Interfaces:**
- Produces:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PlayerStatsInput, RankedPlayer } from './leaderboard'
import type { PageInfo } from './pagination'
import type { Trend } from './trend'

export interface RankingsParams { gameSlug: string | null; region: string | null; page: number }
export interface RankingsGame { id: string; name: string; slug: string; category: string }
export interface RankingsResult {
  players: PlayerStatsInput[]              // every eligible profile, unfiltered (page reads .length, top-N highlights, viewer)
  scopedRanked: RankedPlayer[]             // after region+game filter, ranked
  pageInfo: PageInfo
  pagePlayers: RankedPlayer[]
  pinnedViewer: RankedPlayer | null        // viewer's row when NOT on the current page
  viewerRanked: RankedPlayer | null        // viewer's row in scope, wherever it is
  viewer: PlayerStatsInput | null
  trendByPlayer: Record<string, Trend>
  streakByPlayer: Map<string, number>
  activeGame: RankingsGame | null
  gamesWithMatches: RankingsGame[]
  activeGames: RankingsGame[]
  regions: string[]
  seasons: { id: string; name: string }[]
  matchCount: number
  prizesAwarded: number
  highlights: {
    topScore: PlayerStatsInput | null; topTitles: PlayerStatsInput | null
    topWinRate: PlayerStatsInput | null; topStreak: PlayerStatsInput | null; topStreakValue: number
  }
  // plus every other local the page JSX reads (see Step 2) — e.g. matches/winsMap/categoryMaps if the JSX uses them
}
export async function getRankings(supabase: SupabaseClient, params: RankingsParams, viewerId: string | null): Promise<RankingsResult>
```

- [ ] **Step 1: Pre-flight** — run the characterization test; it must be green and the working tree clean.

- [ ] **Step 2: Move, verbatim**

Create `lib/rankings/service.ts`. **Cut** the part of `rankings/page.tsx` from `const supabase = createClient()` through the `topWinRate` computation (everything before `return (`) **verbatim** into `getRankings`, with only these mechanical edits:
1. `supabase` becomes the first parameter (the page still calls `createClient()` and passes it in).
2. `gameSlug`, `regionFilter`, `requestedPage` come from `params`.
3. The `type RawGameRef...`, `firstGameRef`, `firstTournamentRef` helpers move with it.
4. Return an object containing **every identifier the JSX below `return (` reads**. Do not guess: after the cut, run `npx tsc --noEmit` - each "Cannot find name 'x'" error in `page.tsx` is a field to add to `RankingsResult`. Repeat until clean. (`hrefForPage` and `seasonFilter` stay in the page - presentation.)

**Do not** change any query, `.limit(...)`, ordering, filter, or the order of statements.

- [ ] **Step 3: Viewer handling without changing the web query log**

The page currently runs `supabase.auth.getUser()` as the last entry of the first `Promise.all`. Keep that call exactly there for the web. Give the service a third parameter:

```ts
export type RankingsViewer = { mode: 'session' } | { mode: 'id'; id: string | null }
```
- `mode: 'session'` (web page): the `Promise.all` entry stays `supabase.auth.getUser()`.
- `mode: 'id'` (mobile, Task 10): that entry becomes `Promise.resolve({ data: { user: viewer.id ? { id: viewer.id } : null } })` - the anon client has no session, and `GET /rankings` must not consult one (it passes `id: null`).
Nothing else differs between the modes, and the web page passes `{ mode: 'session' }`, so the web query log is unchanged. Update the `getRankings` signature in the Interfaces block above to take `viewer: RankingsViewer` as its third parameter.

- [ ] **Step 4: Make the page a thin caller**

```tsx
export default async function RankingsPage({ searchParams }: { searchParams: { game?: string; page?: string; region?: string; season?: string } }) {
  const supabase = createClient()
  const seasonFilter = searchParams.season?.trim() || null
  const data = await getRankings(
    supabase,
    {
      gameSlug: searchParams.game?.trim() || null,
      region: searchParams.region?.trim() || null,
      page: Number.parseInt(searchParams.page ?? '1', 10) || 1,
    },
    { mode: 'session' },
  )
  const { players, scopedRanked, pageInfo /* …destructure exactly what the JSX uses */ } = data
  function hrefForPage(page: number) { /* unchanged, uses searchParams + seasonFilter */ }
  return ( /* JSX unchanged */ )
}
```

- [ ] **Step 5: Run the characterization test — it must pass with NO snapshot changes**

Run: `npx vitest run "app/[locale]/(public)/rankings"`
Expected: PASS and `git status` shows **no** modified `.snap` file. If a snapshot changed, the extraction altered behavior: `git diff` the snapshot, find the difference, fix the *service*, never `-u`.

- [ ] **Step 6: Unit-test the service's new seam**

Add `lib/rankings/service.test.ts` asserting `mode: 'id'` never calls `auth.getUser` (spy on `fake.client.auth.getUser`) and that `viewerRanked`/`pinnedViewer` are computed for `id: 'p5'` on a page that excludes them (use `page: 2` with a 10-player fixture, or shrink `PAGE_SIZE` via a param if needed — otherwise assert on `viewerRanked`).

- [ ] **Step 7: Lint + commit**

```bash
npx tsc --noEmit && npm run lint
git add lib/rankings/service.ts lib/rankings/service.test.ts "app/[locale]/(public)/rankings/page.tsx"
git commit -m "refactor(rankings): extract getRankings service, behavior-neutral

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Extract `lib/hall-of-fame/service.ts`

**Files:**
- Create: `lib/hall-of-fame/service.ts`
- Modify: `app/[locale]/(public)/hall-of-fame/page.tsx`

**Interfaces:**
- Produces:

```ts
export interface HallOfFameResult {
  activeGameList: { id: string; name: string; slug: string; category: string }[]
  selectedGame: { id: string; name: string; slug: string; category: string } | null
  mvp: PlayerStatsInput | null
  goldenBootOptions: AwardOption[]
  categoryAwards: { category: string; meta: (typeof CATEGORY_META)[string]; options: AwardOption[] }[]
  champions: ChampionEntry[]                                 // from lib/tournaments/champions.ts
  championGroups: Record<TournamentType, ChampionEntry[]>
  championProfileById: Map<string, { avatar_url: string | null; membership_tier: string | null; sentinel_tier: string | null; equipped_avatar_border: string | null }>
  cupEntry: ChampionEntry | null
  cupChampionSlugs: string[]
  thirdPlaces: ThirdPlaceEntry[]
  hasAwards: boolean
  hasBronze: boolean
}
export async function getHallOfFame(supabase: SupabaseClient, params: { gameSlug: string | null }): Promise<HallOfFameResult>
```
(`AwardOption` is the local type the page already declares — move it into the service file and export it.)

- [ ] **Step 1: Pre-flight** — characterization green, tree clean.
- [ ] **Step 2: Move verbatim** — cut everything from `const supabase = createClient()` (page line ~83) down to just before `return (` into `getHallOfFame`; `gameSlug` comes from params; keep `showEmptySections = !selectedGame` in the page (presentation). Move `AwardOption`, `awardOptionsFor`, `RawGameRef`/`firstGameRef`/`firstTournamentRef`, `sideRef`/`ProfileRef`/`SquadRef` helpers with it. Resolve every `tsc` "Cannot find name" by adding it to `HallOfFameResult`. No query change.
- [ ] **Step 3: Thin page** — `const data = await getHallOfFame(createClient(), { gameSlug: searchParams.game?.trim() || null })`, destructure, JSX unchanged.
- [ ] **Step 4:** `npx vitest run "app/[locale]/(public)/hall-of-fame"` → PASS, **no `.snap` diff**.
- [ ] **Step 5:** `npx tsc --noEmit && npm run lint`, then commit `refactor(hall-of-fame): extract getHallOfFame service, behavior-neutral` (with the Co-Authored-By trailer).

---

### Task 7: Extract `lib/seasons/service.ts`

**Files:**
- Create: `lib/seasons/service.ts`, `lib/seasons/service.test.ts`
- Modify: `app/[locale]/seasons/[slug]/page.tsx`

**Interfaces:**
- Produces:

```ts
import type { SeasonLeaderboardRow } from './data'
import type { SeasonTierLabels } from '@/lib/games/season-tier-labels'

export interface SeasonSummary { id: string; slug: string; name: string; start_date: string; end_date: string }
export interface SeasonTournamentRow {
  id: string; title: string; slug: string; tournament_type: string; status: string
  tournament_start: string | null; invitation_only: boolean
}
export interface SeasonGameSectionData {
  gameId: string; gameName: string; gameSlug: string
  tournaments: SeasonTournamentRow[]
  leaderboard: SeasonLeaderboardRow[]
  tierLabels: SeasonTierLabels
}
export async function listSeasons(supabase: SupabaseClient): Promise<SeasonSummary[]>
export async function getSeasonBySlug(supabase: SupabaseClient, slug: string): Promise<(SeasonSummary & Record<string, unknown>) | null>
export async function getSeasonSections(supabase: SupabaseClient, admin: Admin, seasonId: string): Promise<SeasonGameSectionData[]>
```

- [ ] **Step 1: Pre-flight** — seasons characterization green.
- [ ] **Step 2: Implement**
  - `getSeasonBySlug` = the page's `getSeason()` (`select('*')` on **`seasons`** is unchanged in PR 1 — it is not `profiles`; PR 2's endpoint maps it to an explicit shape).
  - `getSeasonSections` = the page's games query + DLS-first sort + the per-game `Promise.all` (tournaments query + `getSeasonLeaderboard`) + `seasonTierLabelsFor(game.slug)`; add `gameSlug: game.slug` to each section (an *additional* field: the page's `SeasonGameSection` type ignores it — verify by running the snapshot test, which must still pass; if adding the field changes the serialized tree, drop it here and re-derive the slug in Task 11 from `gameId`).
  - `listSeasons` = `supabase.from('seasons').select('id, slug, name, start_date, end_date').order('start_date', { ascending: false })` (new; used only by the endpoint).
- [ ] **Step 3: Thin page** using `getSeasonBySlug` + `getSeasonSections`; `generateMetadata` uses `getSeasonBySlug`.
- [ ] **Step 4:** `npx vitest run "app/[locale]/seasons" lib/seasons` → PASS, no `.snap` diff. Add `service.test.ts` for `listSeasons` ordering and `getSeasonSections` DLS-first ordering with the fake.
- [ ] **Step 5:** tsc, lint, commit `refactor(seasons): extract season services, behavior-neutral`.

---

### Task 8: PR 1 gate

- [ ] **Step 1:** `npx vitest run 2>&1 | tail -8` (whole suite), `npm run lint`, `npm run build`.
- [ ] **Step 2:** `git diff origin/main --stat -- '*.snap'` must show snapshot files only as **added** by Tasks 2–4 and never modified after Task 5–7 commits. Verify with `git log --oneline -- '**/__snapshots__/*'`: only the three characterization commits.
- [ ] **Step 3:** Re-measure the live baseline from Task 0 Step 3 on a preview deployment of this branch; medians should be within noise. Put both sets of numbers **and** the pinned query logs (`.snap` `queries` entries) in the PR description under "Cost baseline (unchanged by design)".
- [ ] **Step 4:** Rebase onto `origin/main`, push `phase3a/web-extraction`, open PR titled `refactor: extract rankings/hall-of-fame/season services (behavior-neutral) [mobile 3a PR 1]`. **Merge PR 1 before starting Task 9.**

---

## PR 2 — Mobile endpoints

Start a fresh branch from `origin/main` (after PR 1 merged): `git worktree add ../sentinelx-p3a-api -b phase3a/api origin/main`.

### Task 9: Schemas and mappers

**Files:**
- Create: `lib/mobile-api/endpoints/progress-schemas.ts`, `lib/mobile-api/endpoints/progress-schemas.test.ts`

**Interfaces:**
- Produces: `playerCardSchema`, `rankingRowSchema`, `rankingsResponseSchema`, `rankingsMeResponseSchema`, `seasonSummarySchema`, `seasonListResponseSchema`, `seasonDetailResponseSchema`, `hallOfFameResponseSchema`, `mapPlayerCard(p)`, `mapRankingRow(p, ctx)`.

- [ ] **Step 1: Failing tests**

```ts
// lib/mobile-api/endpoints/progress-schemas.test.ts
import { describe, it, expect } from 'vitest'
import { mapPlayerCard, mapRankingRow, playerCardSchema, rankingRowSchema } from './progress-schemas'
import type { RankedPlayer } from '@/lib/rankings/leaderboard'

const base: RankedPlayer = {
  id: 'p1', username: 'ada', displayName: 'Ada', deletedAt: null, avatarUrl: 'https://x/a.png', country: 'NG',
  wins: 5, losses: 2, totalMatches: 7, goalsScored: 20, goalsConceded: 8,
  categoryStats: [], gameStats: [], winsByGame: [], totalTitles: 1, sxScore: 980,
  sentinelTier: 'trusted', membershipTier: 'bronze', kycVerified: true, frameUrl: '/frames/gold.webp',
  winRate: 5 / 7, goalDiff: 12, rank: 1,
}
const PLAYER_KEYS = ['avatarUrl', 'country', 'displayName', 'frameUrl', 'id', 'isDeleted', 'kycVerified', 'membershipTier', 'sentinelTier', 'sxScore', 'username']

describe('mapPlayerCard', () => {
  it('exposes exactly the public card fields', () => {
    const card = mapPlayerCard(base)
    expect(Object.keys(card).sort()).toEqual(PLAYER_KEYS)
    expect(playerCardSchema.parse(card)).toEqual(card)
  })
  it('renders a deleted account as a tombstone, never leaking identity', () => {
    const card = mapPlayerCard({ ...base, deletedAt: '2026-09-01T00:00:00Z' })
    expect(card).toMatchObject({ isDeleted: true, username: null, displayName: null, avatarUrl: null, frameUrl: null })
  })
  it('drops fields it does not know about (a rogue extra on the input never reaches the output)', () => {
    const card = mapPlayerCard({ ...base, whatsapp_number: '+234' } as never)
    expect(JSON.stringify(card)).not.toContain('whatsapp')
  })
})

describe('mapRankingRow', () => {
  it('adds rank, metrics, trend and streak', () => {
    const row = mapRankingRow(base, { trend: { direction: 'up', delta: 2 }, streak: 3 })
    expect(row).toMatchObject({ rank: 1, wins: 5, losses: 2, totalMatches: 7, goalDiff: 12, trend: { direction: 'up', delta: 2 }, streak: 3 })
    expect(rankingRowSchema.parse(row)).toEqual(row)
  })
  it('the strict schema rejects an unknown extra key', () => {
    const row = mapRankingRow(base, { trend: { direction: 'new', delta: 0 }, streak: 0 })
    expect(() => rankingRowSchema.parse({ ...row, whatsapp: 'x' })).toThrow()
  })
})
```

- [ ] **Step 2:** `npx vitest run lib/mobile-api/endpoints/progress-schemas.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement the player/ranking part**

```ts
// lib/mobile-api/endpoints/progress-schemas.ts
import { z } from 'zod'
import type { PlayerStatsInput, RankedPlayer } from '@/lib/rankings/leaderboard'
import type { Trend } from '@/lib/rankings/trend'

export const playerCardSchema = z.object({
  id: z.string(),
  username: z.string().nullable(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  frameUrl: z.string().nullable(),
  country: z.string().nullable(),
  sxScore: z.number(),
  sentinelTier: z.string().nullable(),
  membershipTier: z.string(),
  kycVerified: z.boolean(),
  isDeleted: z.boolean(),
}).strict()
export type PlayerCard = z.infer<typeof playerCardSchema>

/** Explicit field-by-field mapping — never spread a query row into a response. */
export function mapPlayerCard(p: PlayerStatsInput): PlayerCard {
  const deleted = p.deletedAt != null
  return {
    id: p.id,
    username: deleted ? null : p.username,
    displayName: deleted ? null : p.displayName,
    avatarUrl: deleted ? null : p.avatarUrl,
    frameUrl: deleted ? null : p.frameUrl ?? null,
    country: p.country,
    sxScore: p.sxScore,
    sentinelTier: p.sentinelTier,
    membershipTier: p.membershipTier,
    kycVerified: p.kycVerified,
    isDeleted: deleted,
  }
}

const trendSchema = z.object({ direction: z.enum(['up', 'down', 'flat', 'new']), delta: z.number() }).strict()

export const rankingRowSchema = z.object({
  rank: z.number().int(),
  player: playerCardSchema,
  wins: z.number(), losses: z.number(), totalMatches: z.number(), winRate: z.number(),
  goalsScored: z.number(), goalsConceded: z.number(), goalDiff: z.number(),
  totalTitles: z.number(),
  trend: trendSchema,
  streak: z.number().int(),
}).strict()
export type RankingRow = z.infer<typeof rankingRowSchema>

export function mapRankingRow(p: RankedPlayer, extra: { trend: Trend; streak: number }): RankingRow {
  return {
    rank: p.rank,
    player: mapPlayerCard(p),
    wins: p.wins, losses: p.losses, totalMatches: p.totalMatches, winRate: p.winRate,
    goalsScored: p.goalsScored, goalsConceded: p.goalsConceded, goalDiff: p.goalDiff,
    totalTitles: p.totalTitles,
    trend: { direction: extra.trend.direction, delta: extra.trend.delta },
    streak: extra.streak,
  }
}
```

The test's `PLAYER_KEYS`/row assertions use `player` nesting for the row; update the first `mapRankingRow` test's `toMatchObject` accordingly (player fields live under `row.player`).

- [ ] **Step 4:** run → PASS.

- [ ] **Step 5: Add the response schemas** (append to the same file; each `.strict()`):

```ts
const gameChip = z.object({ id: z.string(), slug: z.string(), name: z.string(), category: z.string() }).strict()

export const rankingsResponseSchema = z.object({
  scope: z.object({ game: z.string().nullable(), region: z.string().nullable(), metric: z.enum(['score', 'wins']) }).strict(),
  rows: z.array(rankingRowSchema),
  page: z.object({ page: z.number().int(), totalPages: z.number().int(), total: z.number().int(), perPage: z.number().int() }).strict(),
  games: z.array(gameChip),
  regions: z.array(z.string()),
  stats: z.object({ playersRanked: z.number().int(), gamesIncluded: z.number().int(), totalMatches: z.number().int(), prizesAwarded: z.number() }).strict(),
  highlights: z.object({
    topScore: playerCardSchema.nullable(), topTitles: playerCardSchema.nullable(),
    topWinRate: playerCardSchema.nullable(), topStreak: playerCardSchema.nullable(),
    topStreakValue: z.number().int(),
  }).strict(),
}).strict()

export const rankingsMeResponseSchema = z.object({ row: rankingRowSchema.nullable() }).strict()

export const seasonSummarySchema = z.object({
  id: z.string(), slug: z.string(), name: z.string(), startDate: z.string(), endDate: z.string(),
}).strict()
export const seasonListResponseSchema = z.object({ seasons: z.array(seasonSummarySchema) }).strict()

const seasonLeaderboardRow = z.object({
  playerId: z.string(), username: z.string().nullable(), displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(), sxScore: z.number(), points: z.number(), isProvisional: z.boolean(),
}).strict()

const seasonTournament = z.object({
  id: z.string(), title: z.string(), slug: z.string(), tournamentType: z.string(), status: z.string(),
  tournamentStart: z.string().nullable(), invitationOnly: z.boolean(),
}).strict()

export const seasonDetailResponseSchema = z.object({
  season: seasonSummarySchema,
  games: z.array(z.object({
    gameId: z.string(), gameName: z.string(), gameSlug: z.string(),
    tournaments: z.array(seasonTournament),
    leaderboard: z.array(seasonLeaderboardRow),
    tierLabels: z.object({
      communityClub: z.string(), masters: z.string(), qualificationNote: z.string(), showChampionsCupSpotlight: z.boolean(),
    }).strict(),
  }).strict()),
}).strict()

const placing = z.object({ id: z.string(), name: z.string() }).strict()
export const hallOfFameChampion = z.object({
  tournamentId: z.string(), slug: z.string(), title: z.string(), tournamentType: z.enum(['champions_cup', 'masters', 'community_club', 'open']),
  gameId: z.string(), gameName: z.string(), date: z.string().nullable(), prizePool: z.number().nullable(),
  champion: placing, runnerUp: placing.nullable(), championAvatarUrl: z.string().nullable(), seasonName: z.string().nullable(),
}).strict()

const awardOption = z.object({
  gameId: z.string().nullable(), gameLabel: z.string(), winner: playerCardSchema.nullable(), metricValue: z.number(),
}).strict()

export const hallOfFameResponseSchema = z.object({
  games: z.array(gameChip),
  selectedGame: z.string().nullable(),
  awards: z.object({
    mvp: playerCardSchema.nullable(),
    goldenBoot: z.array(awardOption),
    categories: z.array(z.object({ category: z.string(), label: z.string(), metricLabel: z.string(), options: z.array(awardOption) }).strict()),
  }).strict(),
  champions: z.object({
    championsCup: z.array(hallOfFameChampion), masters: z.array(hallOfFameChampion),
    communityClub: z.array(hallOfFameChampion), open: z.array(hallOfFameChampion),
  }).strict(),
  bronze: z.array(z.object({
    tournamentId: z.string(), slug: z.string(), title: z.string(), gameName: z.string().nullable(),
    date: z.string().nullable(), player: placing,
  }).strict()),
}).strict()
```

Before finalizing `hallOfFameChampion`, open `lib/tournaments/champions.ts` `Placing` (line ~50) and make the `placing` schema match its real fields exactly (add e.g. `avatarUrl` only if `Placing` carries it and the page renders it).

- [ ] **Step 6:** `npx vitest run lib/mobile-api/endpoints/progress-schemas.test.ts` → PASS; commit `feat(mobile-api): strict schemas + mappers for rankings/seasons/hall-of-fame`.

---

### Task 10: `GET /rankings` and `GET /rankings/me`

**Files:**
- Create: `lib/mobile-api/endpoints/rankings.ts`, `lib/mobile-api/endpoints/rankings.test.ts`, `app/api/mobile/v1/rankings/route.ts`, `app/api/mobile/v1/rankings/me/route.ts`

**Interfaces:**
- Consumes: `getRankings(supabase, params, viewer)` (Task 5); `createAnonClient()`; `mapRankingRow`, `mapPlayerCard`, `rankingsResponseSchema`, `rankingsMeResponseSchema` (Task 9).
- Produces: `rankingsEndpoint` (`operationId: 'getRankings'`), `rankingsMeEndpoint` (`'getRankingsMe'`).

- [ ] **Step 1: Failing tests**

```ts
// lib/mobile-api/endpoints/rankings.test.ts
import { describe, it, expect, vi } from 'vitest'
import { fakeSupabase } from '@/lib/testing/fake-supabase'
import { FIXTURE_TABLES, VIEWER_ID } from '@/lib/testing/progress-fixtures'

const state = vi.hoisted(() => ({ fake: null as null | { client: unknown; queries: string[] } }))
vi.mock('../anon-client', () => ({ createAnonClient: () => state.fake!.client }))
const { authenticate, optionalAuth } = vi.hoisted(() => ({ authenticate: vi.fn(), optionalAuth: vi.fn() }))
vi.mock('../auth', () => ({ authenticate, optionalAuth }))

import { Errors } from '../errors'
import { rankingsEndpoint, rankingsMeEndpoint } from './rankings'

const url = (qs = '') => `https://x.test/api/mobile/v1/rankings${qs}`
function fresh() { state.fake = fakeSupabase(FIXTURE_TABLES) as never }

describe('GET /rankings', () => {
  it('returns ranked rows with the strict shape, cacheable', async () => {
    fresh(); optionalAuth.mockResolvedValue(null)
    const res = await rankingsEndpoint.handler(new Request(url()))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toContain('s-maxage=60')
    const { data } = await res.json()
    expect(data.rows[0].rank).toBe(1)
    expect(data.scope).toEqual({ game: null, region: null, metric: 'score' })
    expect(Object.keys(data.rows[0]).sort()).toEqual(['goalDiff', 'goalsConceded', 'goalsScored', 'losses', 'player', 'rank', 'streak', 'totalMatches', 'totalTitles', 'trend', 'winRate', 'wins'])
  })

  it('never reads the bearer: identical bytes with and without Authorization', async () => {
    fresh(); optionalAuth.mockResolvedValue(null)
    const a = await (await rankingsEndpoint.handler(new Request(url()))).text()
    fresh(); optionalAuth.mockResolvedValue({ userId: VIEWER_ID })
    const b = await (await rankingsEndpoint.handler(new Request(url(), { headers: { authorization: 'Bearer t' } }))).text()
    expect(b).toBe(a)
  })

  it('game board ranks by wins and reports metric=wins', async () => {
    fresh(); optionalAuth.mockResolvedValue(null)
    const { data } = await (await rankingsEndpoint.handler(new Request(url('?game=dls')))).json()
    expect(data.scope).toEqual({ game: 'dls', region: null, metric: 'wins' })
  })

  it('renders the tombstone without identity', async () => {
    fresh(); optionalAuth.mockResolvedValue(null)
    const { data } = await (await rankingsEndpoint.handler(new Request(url()))).json()
    const tomb = data.rows.find((r: { player: { id: string } }) => r.player.id === 'p9')
    if (tomb) expect(tomb.player).toMatchObject({ isDeleted: true, username: null, displayName: null, avatarUrl: null })
  })
})

describe('GET /rankings/me', () => {
  it('401s without a bearer', async () => {
    fresh(); authenticate.mockRejectedValue(Errors.unauthorized())
    const res = await rankingsMeEndpoint.handler(new Request(url('/me')))
    expect(res.status).toBe(401)
  })
  it('returns the viewer row, no-store', async () => {
    fresh(); authenticate.mockResolvedValue({ userId: VIEWER_ID, admin: {}, userClient: {} })
    const res = await rankingsMeEndpoint.handler(new Request(url('/me')))
    expect(res.headers.get('cache-control')).toBe('no-store')
    const { data } = await res.json()
    expect(data.row.player.id).toBe(VIEWER_ID)
  })
  it('returns row:null when the viewer is not ranked in scope', async () => {
    fresh(); authenticate.mockResolvedValue({ userId: 'nobody', admin: {}, userClient: {} })
    const { data } = await (await rankingsMeEndpoint.handler(new Request(url('/me')))).json()
    expect(data.row).toBeNull()
  })
})
```

(`Errors.unauthorized()` from `../errors` is the real error `authenticate` throws - the 401 test below imports it and asserts the status is exactly `401`.)

- [ ] **Step 2:** run → FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// lib/mobile-api/endpoints/rankings.ts
import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import { createAnonClient } from '../anon-client'
import { getRankings } from '@/lib/rankings/service'
import { PAGE_SIZE } from '@/lib/rankings/pagination'
import { mapPlayerCard, mapRankingRow, rankingsResponseSchema, rankingsMeResponseSchema } from './progress-schemas'

const query = z.object({
  game: z.string().trim().min(1).max(64).nullable().catch(null),
  region: z.string().trim().min(1).max(64).nullable().catch(null),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
})

function parseQuery(req: Request) {
  const sp = new URL(req.url).searchParams
  return query.parse({ game: sp.get('game'), region: sp.get('region'), page: sp.get('page') ?? 1 })
}

export const rankingsEndpoint = defineEndpoint({
  operationId: 'getRankings',
  method: 'GET',
  path: '/rankings',
  summary: 'Leaderboard: ranked players with trend and streak, filter chips, platform stats. Public and identical for everyone (the signed-in viewer\'s own row is GET /rankings/me).',
  auth: 'public',
  cacheControl: 'public, s-maxage=60, stale-while-revalidate=300',
  response: rankingsResponseSchema,
  handler: async ({ req }) => {
    const q = parseQuery(req)
    // mode:'id' with null: the service must not consult any session, so the response can never vary by caller.
    const r = await getRankings(createAnonClient(), { gameSlug: q.game, region: q.region, page: q.page }, { mode: 'id', id: null })
    return {
      scope: { game: r.activeGame?.slug ?? null, region: q.region, metric: r.activeGame ? ('wins' as const) : ('score' as const) },
      rows: r.pagePlayers.map((p) => mapRankingRow(p, { trend: r.trendByPlayer[p.id], streak: r.streakByPlayer.get(p.id) ?? 0 })),
      page: { page: r.pageInfo.page, totalPages: r.pageInfo.totalPages, total: r.pageInfo.total, perPage: PAGE_SIZE },
      games: r.gamesWithMatches.map((g) => ({ id: g.id, slug: g.slug, name: g.name, category: g.category })),
      regions: r.regions,
      stats: { playersRanked: r.players.length, gamesIncluded: r.gamesWithMatches.length, totalMatches: r.matchCount, prizesAwarded: r.prizesAwarded },
      highlights: {
        topScore: r.highlights.topScore ? mapPlayerCard(r.highlights.topScore) : null,
        topTitles: r.highlights.topTitles ? mapPlayerCard(r.highlights.topTitles) : null,
        topWinRate: r.highlights.topWinRate ? mapPlayerCard(r.highlights.topWinRate) : null,
        topStreak: r.highlights.topStreak ? mapPlayerCard(r.highlights.topStreak) : null,
        topStreakValue: r.highlights.topStreakValue,
      },
    }
  },
})

export const rankingsMeEndpoint = defineEndpoint({
  operationId: 'getRankingsMe',
  method: 'GET',
  path: '/rankings/me',
  summary: 'The signed-in viewer\'s own ranked row in the given scope (game/region), or null if not ranked.',
  auth: 'user',
  cacheControl: 'no-store',
  response: rankingsMeResponseSchema,
  handler: async ({ ctx, req }) => {
    const q = parseQuery(req)
    const r = await getRankings(createAnonClient(), { gameSlug: q.game, region: q.region, page: 1 }, { mode: 'id', id: ctx.userId })
    return { row: r.viewerRanked ? mapRankingRow(r.viewerRanked, { trend: r.trendByPlayer[r.viewerRanked.id], streak: r.streakByPlayer.get(r.viewerRanked.id) ?? 0 }) : null }
  },
})
```

`trendByPlayer` is computed for every player in `scopedRanked` on the web page's logic, so `r.trendByPlayer[id]` is defined for anyone in scope; if `pagePlayers` ever contains someone without a trend the zod parse (runtime contract check in `defineEndpoint`) will 500 in tests, which is what we want.

Route files:

```ts
// app/api/mobile/v1/rankings/route.ts
import { rankingsEndpoint } from '@/lib/mobile-api/endpoints/rankings'
export const GET = rankingsEndpoint.handler
```
```ts
// app/api/mobile/v1/rankings/me/route.ts
import { rankingsMeEndpoint } from '@/lib/mobile-api/endpoints/rankings'
export const GET = rankingsMeEndpoint.handler
```

- [ ] **Step 4:** `npx vitest run lib/mobile-api/endpoints/rankings.test.ts` → PASS. Fix mismatches by correcting the *mapper/endpoint*, not by loosening a schema.
- [ ] **Step 5:** commit `feat(mobile-api): GET /rankings and GET /rankings/me`.

---

### Task 11: `GET /seasons` and `GET /seasons/{slug}`

**Files:**
- Create: `lib/mobile-api/endpoints/seasons.ts`, `lib/mobile-api/endpoints/seasons.test.ts`, `app/api/mobile/v1/seasons/route.ts`, `app/api/mobile/v1/seasons/[slug]/route.ts`

**Interfaces:**
- Consumes: `listSeasons`, `getSeasonBySlug`, `getSeasonSections` (Task 7); `createAnonClient()`, `createAdminClient()` from `@/lib/supabase/admin`.
- Produces: `seasonsListEndpoint` (`getSeasons`), `seasonDetailEndpoint` (`getSeasonDetail`).

**⚠ Highest-risk endpoint in 3a.** Season data is read with the **service role**. Everything that leaves the handler goes through explicit mapping, never a spread.

- [ ] **Step 1: Failing tests**

```ts
// lib/mobile-api/endpoints/seasons.test.ts
import { describe, it, expect, vi } from 'vitest'
import { fakeSupabase } from '@/lib/testing/fake-supabase'
import { FIXTURE_TABLES } from '@/lib/testing/progress-fixtures'

const state = vi.hoisted(() => ({ fake: null as null | { client: unknown } }))
vi.mock('../anon-client', () => ({ createAnonClient: () => state.fake!.client }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => state.fake!.client }))
vi.mock('../auth', () => ({ authenticate: vi.fn(), optionalAuth: vi.fn().mockResolvedValue(null) }))

import { seasonsListEndpoint, seasonDetailEndpoint } from './seasons'

const SEASON_KEYS = ['endDate', 'id', 'name', 'slug', 'startDate']
const LB_KEYS = ['avatarUrl', 'displayName', 'isProvisional', 'playerId', 'points', 'sxScore', 'username']
const SECTION_KEYS = ['gameId', 'gameName', 'gameSlug', 'leaderboard', 'tierLabels', 'tournaments']
const TOURNAMENT_KEYS = ['id', 'invitationOnly', 'slug', 'status', 'title', 'tournamentStart', 'tournamentType']

describe('seasons endpoints — exact exposed key sets (admin-client path, no RLS backstop)', () => {
  it('GET /seasons', async () => {
    state.fake = fakeSupabase(FIXTURE_TABLES) as never
    const res = await seasonsListEndpoint.handler(new Request('https://x.test/api/mobile/v1/seasons'))
    const { data } = await res.json()
    for (const s of data.seasons) expect(Object.keys(s).sort()).toEqual(SEASON_KEYS)
  })

  it('GET /seasons/{slug}: every object level has exactly the documented keys', async () => {
    state.fake = fakeSupabase({
      ...FIXTURE_TABLES,
      // Poison: extra sensitive-looking columns on every table the admin client reads. None may surface.
      seasons: [{ id: 's1', slug: 'season-1', name: 'Season 1', start_date: '2026-08-01', end_date: '2026-10-31', internal_note: 'SECRET' }],
    }) as never
    const res = await seasonDetailEndpoint.handler(new Request('https://x.test/api/mobile/v1/seasons/season-1'), { params: { slug: 'season-1' } })
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).not.toContain('SECRET')
    expect(body).not.toContain('whatsapp')
    const { data } = JSON.parse(body)
    expect(Object.keys(data.season).sort()).toEqual(SEASON_KEYS)
    for (const g of data.games) {
      expect(Object.keys(g).sort()).toEqual(SECTION_KEYS)
      for (const row of g.leaderboard) expect(Object.keys(row).sort()).toEqual(LB_KEYS)
      for (const t of g.tournaments) expect(Object.keys(t).sort()).toEqual(TOURNAMENT_KEYS)
    }
    expect(data.games.some((g: { leaderboard: unknown[] }) => g.leaderboard.length > 0)).toBe(true) // not vacuous
  })

  it('404s on an unknown slug', async () => {
    state.fake = fakeSupabase(FIXTURE_TABLES) as never
    const res = await seasonDetailEndpoint.handler(new Request('https://x.test/api/mobile/v1/seasons/nope'), { params: { slug: 'nope' } })
    expect(res.status).toBe(404)
  })

  it('is public and cacheable', async () => {
    state.fake = fakeSupabase(FIXTURE_TABLES) as never
    const res = await seasonsListEndpoint.handler(new Request('https://x.test/api/mobile/v1/seasons'))
    expect(res.headers.get('cache-control')).toContain('s-maxage=')
  })
})
```

- [ ] **Step 2:** run → FAIL.

- [ ] **Step 3: Implement**

```ts
// lib/mobile-api/endpoints/seasons.ts
import { defineEndpoint } from '../define-endpoint'
import { createAnonClient } from '../anon-client'
import { createAdminClient } from '@/lib/supabase/admin'
import { Errors } from '../errors'
import { getSeasonBySlug, getSeasonSections, listSeasons } from '@/lib/seasons/service'
import { seasonDetailResponseSchema, seasonListResponseSchema } from './progress-schemas'

export const seasonsListEndpoint = defineEndpoint({
  operationId: 'getSeasons',
  method: 'GET',
  path: '/seasons',
  summary: 'All seasons, newest first.',
  auth: 'public',
  cacheControl: 'public, s-maxage=300, stale-while-revalidate=600',
  response: seasonListResponseSchema,
  handler: async () => {
    const seasons = await listSeasons(createAnonClient())
    return { seasons: seasons.map((s) => ({ id: s.id, slug: s.slug, name: s.name, startDate: s.start_date, endDate: s.end_date })) }
  },
})

export const seasonDetailEndpoint = defineEndpoint({
  operationId: 'getSeasonDetail',
  method: 'GET',
  path: '/seasons/{slug}',
  summary: 'One season: per-game tournaments, provisional-aware leaderboard and tier labels. Public; the app highlights the viewer\'s own row client-side.',
  auth: 'public',
  cacheControl: 'public, s-maxage=60, stale-while-revalidate=300',
  response: seasonDetailResponseSchema,
  handler: async ({ params }) => {
    const season = await getSeasonBySlug(createAnonClient(), params.slug)
    if (!season) throw Errors.notFound()
    const sections = await getSeasonSections(createAnonClient(), createAdminClient(), season.id)
    return {
      season: { id: season.id, slug: season.slug, name: season.name, startDate: season.start_date, endDate: season.end_date },
      games: sections.map((g) => ({
        gameId: g.gameId, gameName: g.gameName, gameSlug: g.gameSlug,
        tournaments: g.tournaments.map((t) => ({
          id: t.id, title: t.title, slug: t.slug, tournamentType: t.tournament_type, status: t.status,
          tournamentStart: t.tournament_start, invitationOnly: t.invitation_only,
        })),
        leaderboard: g.leaderboard.map((r) => ({
          playerId: r.playerId, username: r.username, displayName: r.displayName, avatarUrl: r.avatarUrl,
          sxScore: r.sxScore, points: r.points, isProvisional: r.isProvisional,
        })),
        tierLabels: {
          communityClub: g.tierLabels.communityClub, masters: g.tierLabels.masters,
          qualificationNote: g.tierLabels.qualificationNote, showChampionsCupSpotlight: g.tierLabels.showChampionsCupSpotlight,
        },
      })),
    }
  },
})
```

`Errors.notFound()` (404, `not_found`) already exists in `lib/mobile-api/errors.ts`. If Task 7 dropped `gameSlug` from the sections, derive it here from a `games` lookup (`createAnonClient().from('games').select('id, slug')`) — but then add that query's expected count to the test.

Routes:

```ts
// app/api/mobile/v1/seasons/route.ts
import { seasonsListEndpoint } from '@/lib/mobile-api/endpoints/seasons'
export const GET = seasonsListEndpoint.handler
// app/api/mobile/v1/seasons/[slug]/route.ts
import { seasonDetailEndpoint } from '@/lib/mobile-api/endpoints/seasons'
export const GET = seasonDetailEndpoint.handler
```
(Match the route-file style of `app/api/mobile/v1/tournaments/[id]/registration-state/route.ts` for how `context.params` is passed through.)

- [ ] **Step 4:** run → PASS. Sensitivity: temporarily spread `...r` into a leaderboard row in the mapper; the key-set test **must fail**; revert.
- [ ] **Step 5:** commit `feat(mobile-api): GET /seasons and /seasons/{slug} (explicit mapping, key-set tested)`.

---

### Task 12: `GET /hall-of-fame`

**Files:**
- Create: `lib/mobile-api/endpoints/hall-of-fame.ts`, `lib/mobile-api/endpoints/hall-of-fame.test.ts`, `app/api/mobile/v1/hall-of-fame/route.ts`

**Interfaces:** consumes `getHallOfFame(supabase, { gameSlug })` (Task 6) and `hallOfFameResponseSchema` (Task 9); produces `hallOfFameEndpoint` (`getHallOfFame`).

- [ ] **Step 1: Test** (fixtures from Task 3 already populate every section)

```ts
// lib/mobile-api/endpoints/hall-of-fame.test.ts
import { describe, it, expect, vi } from 'vitest'
import { fakeSupabase } from '@/lib/testing/fake-supabase'
import { FIXTURE_TABLES } from '@/lib/testing/progress-fixtures'

const state = vi.hoisted(() => ({ fake: null as null | { client: unknown } }))
vi.mock('../anon-client', () => ({ createAnonClient: () => state.fake!.client }))
vi.mock('../auth', () => ({ authenticate: vi.fn(), optionalAuth: vi.fn().mockResolvedValue(null) }))

import { hallOfFameEndpoint } from './hall-of-fame'

const call = async (qs = '') => hallOfFameEndpoint.handler(new Request(`https://x.test/api/mobile/v1/hall-of-fame${qs}`))

describe('GET /hall-of-fame', () => {
  it('returns awards, champions grouped by tier and bronze finishes; cacheable', async () => {
    state.fake = fakeSupabase(FIXTURE_TABLES) as never
    const res = await call()
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toContain('s-maxage=300')
    const { data } = await res.json()
    expect(data.awards.mvp).not.toBeNull()
    expect(data.champions.masters.length).toBeGreaterThan(0)
    expect(data.bronze.length).toBeGreaterThan(0)
    expect(Object.keys(data.champions).sort()).toEqual(['championsCup', 'communityClub', 'masters', 'open'])
  })
  it('a game filter narrows champions; an unknown slug falls back to all games (web parity)', async () => {
    state.fake = fakeSupabase(FIXTURE_TABLES) as never
    const all = await (await call()).json()
    state.fake = fakeSupabase(FIXTURE_TABLES) as never
    const unknown = await (await call('?game=nope')).json()
    expect(unknown.data.champions).toEqual(all.data.champions)
  })
  it('award winners carry only the public card fields', async () => {
    state.fake = fakeSupabase(FIXTURE_TABLES) as never
    const { data } = await (await call()).json()
    expect(Object.keys(data.awards.mvp).sort()).toEqual(['avatarUrl', 'country', 'displayName', 'frameUrl', 'id', 'isDeleted', 'kycVerified', 'membershipTier', 'sentinelTier', 'sxScore', 'username'])
  })
})
```

- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement**

```ts
// lib/mobile-api/endpoints/hall-of-fame.ts
import { defineEndpoint } from '../define-endpoint'
import { createAnonClient } from '../anon-client'
import { getHallOfFame } from '@/lib/hall-of-fame/service'
import { CATEGORY_META } from '@/lib/games/categories'
import { hallOfFameResponseSchema, mapPlayerCard } from './progress-schemas'
import type { ChampionEntry } from '@/lib/tournaments/champions'

function mapChampion(e: ChampionEntry) {
  return {
    tournamentId: e.tournamentId, slug: e.slug, title: e.title, tournamentType: e.tournamentType,
    gameId: e.gameId, gameName: e.gameName, date: e.date, prizePool: e.prizePool,
    champion: { id: e.champion.id, name: e.champion.name },
    runnerUp: e.runnerUp ? { id: e.runnerUp.id, name: e.runnerUp.name } : null,
    championAvatarUrl: e.championAvatarUrl, seasonName: e.seasonName,
  }
}

export const hallOfFameEndpoint = defineEndpoint({
  operationId: 'getHallOfFame',
  method: 'GET',
  path: '/hall-of-fame',
  summary: 'Hall of fame: all-time awards, champions by tournament tier, bronze finishes. Optional ?game=<slug> filter (unknown slug = all games, like the web page). Public.',
  auth: 'public',
  cacheControl: 'public, s-maxage=300, stale-while-revalidate=600',
  response: hallOfFameResponseSchema,
  handler: async ({ req }) => {
    const gameSlug = new URL(req.url).searchParams.get('game')?.trim() || null
    const h = await getHallOfFame(createAnonClient(), { gameSlug })
    const option = (o: { gameId: string | null; gameLabel: string; winner: Parameters<typeof mapPlayerCard>[0] | null; metricValue: number }) => ({
      gameId: o.gameId, gameLabel: o.gameLabel, winner: o.winner ? mapPlayerCard(o.winner) : null, metricValue: o.metricValue,
    })
    return {
      games: h.activeGameList.map((g) => ({ id: g.id, slug: g.slug, name: g.name, category: g.category })),
      selectedGame: h.selectedGame?.slug ?? null,
      awards: {
        mvp: h.mvp ? mapPlayerCard(h.mvp) : null,
        goldenBoot: h.goldenBootOptions.map(option),
        categories: h.categoryAwards.map((c) => ({
          category: c.category,
          label: CATEGORY_META[c.category].awardName,
          metricLabel: CATEGORY_META[c.category].statLabel.toLowerCase(),
          options: c.options.map(option),
        })),
      },
      champions: {
        championsCup: h.championGroups.champions_cup.map(mapChampion),
        masters: h.championGroups.masters.map(mapChampion),
        communityClub: h.championGroups.community_club.map(mapChampion),
        open: h.championGroups.open.map(mapChampion),
      },
      bronze: h.thirdPlaces.map((t) => ({
        tournamentId: t.tournamentId, slug: t.slug, title: t.title, gameName: t.gameName, date: t.date,
        player: { id: t.player.id, name: t.player.name },
      })),
    }
  },
})
```
Route: `app/api/mobile/v1/hall-of-fame/route.ts` → `export const GET = hallOfFameEndpoint.handler`.

Note: the web page's `cupChampionSlugs` / `championProfileById` (HexAvatar decorations, achievement slugs) are deliberately **not** exposed — that is 3b territory (achievements) and not needed by the 3a screens.

- [ ] **Step 4:** run → PASS. Commit `feat(mobile-api): GET /hall-of-fame`.

---

### Task 13: Register, OpenAPI, full checks

**Files:**
- Modify: `lib/mobile-api/endpoints/index.ts` (append)
- Generated: `openapi/mobile-v1.json`

- [ ] **Step 1: Register (append-only edit — the 2b session edits this file too)**

```ts
import { rankingsEndpoint, rankingsMeEndpoint } from './rankings'
import { seasonsListEndpoint, seasonDetailEndpoint } from './seasons'
import { hallOfFameEndpoint } from './hall-of-fame'
// …append inside ALL_ENDPOINTS, after the last existing entry:
  rankingsEndpoint,
  rankingsMeEndpoint,
  seasonsListEndpoint,
  seasonDetailEndpoint,
  hallOfFameEndpoint,
```

- [ ] **Step 2: Rebase, then regenerate OpenAPI last**

```bash
git fetch origin && git rebase origin/main
npm run openapi
git diff --stat openapi/mobile-v1.json      # only the 5 new operations (getRankings, getRankingsMe, getSeasons, getSeasonDetail, getHallOfFame) plus anything 2b already merged
```
If the rebase conflicts in `openapi/mobile-v1.json`, take `origin/main`'s version and re-run `npm run openapi`.

- [ ] **Step 3: Full verification**

```bash
npx vitest run 2>&1 | tail -10
npm run lint
npm run build
```
Expected: all green. Any failure is fixed at the cause; never `-u` a snapshot from Tasks 2–4.

- [ ] **Step 4: Commit and push**

```bash
git add lib/mobile-api/endpoints/index.ts openapi/mobile-v1.json app/api/mobile/v1
git commit -m "feat(mobile-api): register rankings/seasons/hall-of-fame endpoints, regenerate openapi

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
git push -u origin phase3a/api
```
Open PR `feat(mobile-api): Phase 3a rankings/seasons/hall-of-fame endpoints`. Merge after review; then tell the mobile side to refresh its `api/openapi.json`.

---

### Task 14: Exit check (web half)

- [ ] **Step 1:** Against the staging deployment, fetch `/api/mobile/v1/rankings`, `/seasons/<slug>`, `/hall-of-fame` and compare with the web pages for 10 players / 1 season / the award blocks; record any mismatch in the PR as a bug, not a "known difference". **Exception (spec §8):** the web table's `#` column is page-local (its tabs re-rank only the visible page), so compare *global* rank against the pinned-viewer rank and against `rankPlayersBy` over all players, and compare values (wins, SX Score, streak, trend) row by row.
- [ ] **Step 2:** Confirm `curl -sI` on each public endpoint shows the intended `cache-control`, and `/rankings/me` shows `no-store`.
- [ ] **Step 3:** Confirm no response body from any of the five endpoints contains: `whatsapp`, `phone`, `notification_prefs`, `referred_by`, `deletion_requested_at` (`curl -s … | grep -ci -E 'whatsapp|phone|notification|referred|deletion'` → `0`).
