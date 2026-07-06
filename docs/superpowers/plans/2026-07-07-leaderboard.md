# Leaderboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the public overall leaderboard at `/rankings`, ranking players by wins → win% → titles → goal difference, with a self-row highlight and a shared tier badge.

**Architecture:** A Server Component page fetches qualifying `profiles`, runs one pure `rankPlayers` function, and renders a presentational `LeaderboardTable`. A shared, null-safe `TierBadge` is extracted and reused on both the leaderboard and the home page (removing the home page's duplicated tier maps).

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase (anon server client), Tailwind, vitest.

## Global Constraints

- Mobile-first, 375px up. **No `xs:` breakpoint** — hide columns with `hidden sm:table-cell`.
- Server Components only (no client interactivity on this page).
- Rank: **wins desc → win rate desc → total_titles desc → goal difference desc**. Exclude `total_matches = 0`.
- `sentinel_tier` is `string | null`; `TierBadge` renders nothing for null/unrecognized tiers.
- Win% displayed as whole percent (`Math.round(winRate * 100)`); GD prefixed `+` when > 0.
- Name fallback: `display_name ?? username ?? 'Anonymous'`.
- Tests colocated `*.test.ts`, vitest node env, pure-function style. Run `npm test`.

---

## File Structure

- Create `lib/rankings/leaderboard.ts` — `rankPlayers` + `PlayerStatsInput`/`RankedPlayer`.
- Create `components/player/TierBadge.tsx` — shared null-safe tier badge.
- Create `components/rankings/LeaderboardTable.tsx` — presentational table.
- Create `app/(public)/rankings/page.tsx` — fetch, rank, render.
- Modify `app/page.tsx` — use `TierBadge`, drop inline `TIER_STYLE`/`TIER_LABEL`.
- Test: `lib/rankings/leaderboard.test.ts`.

---

## Task 1: rankPlayers helper

**Files:**
- Create: `lib/rankings/leaderboard.ts`
- Test: `lib/rankings/leaderboard.test.ts`

**Interfaces:**
- Produces:
  - `PlayerStatsInput = { id, username: string|null, displayName: string|null, avatarUrl: string|null, country: string|null, wins, losses, totalMatches, goalsScored, goalsConceded, totalTitles, sentinelScore, sentinelTier: string|null }`
  - `RankedPlayer = PlayerStatsInput & { winRate: number; goalDiff: number; rank: number }`
  - `rankPlayers(players: PlayerStatsInput[]): RankedPlayer[]`

- [ ] **Step 1: Write the failing test**

Create `lib/rankings/leaderboard.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { rankPlayers, type PlayerStatsInput } from './leaderboard'

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
    totalTitles: 0,
    sentinelScore: 70,
    sentinelTier: null,
    ...over,
  }
}

describe('rankPlayers', () => {
  it('sorts by wins desc and assigns sequential ranks', () => {
    const r = rankPlayers([
      p({ id: 'a', wins: 5, totalMatches: 10 }),
      p({ id: 'b', wins: 9, totalMatches: 10 }),
    ])
    expect(r.map((x) => x.id)).toEqual(['b', 'a'])
    expect(r.map((x) => x.rank)).toEqual([1, 2])
  })

  it('breaks a wins tie by win rate', () => {
    const r = rankPlayers([
      p({ id: 'a', wins: 6, totalMatches: 12 }), // 50%
      p({ id: 'b', wins: 6, totalMatches: 8 }), // 75%
    ])
    expect(r.map((x) => x.id)).toEqual(['b', 'a'])
  })

  it('breaks a wins+winRate tie by titles', () => {
    const r = rankPlayers([
      p({ id: 'a', wins: 6, totalMatches: 10, totalTitles: 1 }),
      p({ id: 'b', wins: 6, totalMatches: 10, totalTitles: 3 }),
    ])
    expect(r.map((x) => x.id)).toEqual(['b', 'a'])
  })

  it('breaks a wins+winRate+titles tie by goal difference', () => {
    const r = rankPlayers([
      p({ id: 'a', wins: 6, totalMatches: 10, totalTitles: 2, goalsScored: 20, goalsConceded: 10 }), // +10
      p({ id: 'b', wins: 6, totalMatches: 10, totalTitles: 2, goalsScored: 25, goalsConceded: 10 }), // +15
    ])
    expect(r.map((x) => x.id)).toEqual(['b', 'a'])
  })

  it('derives winRate and goalDiff', () => {
    const [row] = rankPlayers([
      p({ id: 'a', wins: 6, totalMatches: 12, goalsScored: 20, goalsConceded: 8 }),
    ])
    expect(row.winRate).toBeCloseTo(0.5)
    expect(row.goalDiff).toBe(12)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/rankings/leaderboard.test.ts`
Expected: FAIL — cannot resolve `./leaderboard`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/rankings/leaderboard.ts`:

```ts
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
  totalTitles: number
  sentinelScore: number
  sentinelTier: string | null
}

export interface RankedPlayer extends PlayerStatsInput {
  winRate: number
  goalDiff: number
  rank: number
}

// Sort: wins desc → win rate desc → titles desc → goal difference desc.
// Callers exclude total_matches = 0, but winRate still guards divide-by-zero.
export function rankPlayers(players: PlayerStatsInput[]): RankedPlayer[] {
  return players
    .map((pl) => ({
      ...pl,
      winRate: pl.totalMatches > 0 ? pl.wins / pl.totalMatches : 0,
      goalDiff: pl.goalsScored - pl.goalsConceded,
    }))
    .sort(
      (a, b) =>
        b.wins - a.wins ||
        b.winRate - a.winRate ||
        b.totalTitles - a.totalTitles ||
        b.goalDiff - a.goalDiff,
    )
    .map((pl, i) => ({ ...pl, rank: i + 1 }))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lib/rankings/leaderboard.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck & commit**

Run: `npx tsc --noEmit` → clean.

```bash
git add lib/rankings/leaderboard.ts lib/rankings/leaderboard.test.ts
git commit -m "feat: rankPlayers leaderboard helper (wins > win% > titles > GD)"
```

---

## Task 2: Shared TierBadge + home page refactor

**Files:**
- Create: `components/player/TierBadge.tsx`
- Modify: `app/page.tsx`

**Interfaces:**
- Produces: `TierBadge({ tier: string | null })` — renders a coloured tier label, or `null` for null/unrecognized tier.

- [ ] **Step 1: Write `TierBadge`**

Create `components/player/TierBadge.tsx`:

```tsx
const TIER: Record<string, { label: string; cls: string }> = {
  elite:      { label: '🟢 Elite',      cls: 'text-emerald-400' },
  trusted:    { label: '🔵 Trusted',    cls: 'text-blue-400' },
  developing: { label: '🟡 Developing', cls: 'text-violet-400' },
  at_risk:    { label: '🔴 At Risk',    cls: 'text-red-400' },
}

// Returns null for a null or unrecognized tier (matches the home page's prior
// `{tier && …}` guard). Tiers are a fixed set, so unrecognized shouldn't occur.
export function TierBadge({ tier }: { tier: string | null }) {
  if (!tier) return null
  const t = TIER[tier]
  if (!t) return null
  return <span className={`text-[11px] ${t.cls}`}>{t.label}</span>
}
```

- [ ] **Step 2: Import `TierBadge` in the home page**

In `app/page.tsx`, add after the `EmptyState` import (line 6):

```tsx
import { TierBadge } from '@/components/player/TierBadge'
```

- [ ] **Step 3: Remove the inline tier maps**

In `app/page.tsx`, delete these lines (11–22):

```tsx
const TIER_STYLE: Record<string, string> = {
  elite:      'text-emerald-400',
  trusted:    'text-blue-400',
  developing: 'text-violet-400',
  at_risk:    'text-red-400',
}
const TIER_LABEL: Record<string, string> = {
  elite:      '🟢 Elite',
  trusted:    '🔵 Trusted',
  developing: '🟡 Developing',
  at_risk:    '🔴 At Risk',
}
```

- [ ] **Step 4: Replace the inline tier render with `TierBadge`**

In `app/page.tsx`, replace this block:

```tsx
                          {player.sentinel_tier && (
                            <p className={`text-[11px] ${TIER_STYLE[player.sentinel_tier] ?? 'text-slate-400'}`}>
                              {TIER_LABEL[player.sentinel_tier] ?? player.sentinel_tier}
                            </p>
                          )}
```

with:

```tsx
                          <TierBadge tier={player.sentinel_tier} />
```

- [ ] **Step 5: Verify typecheck, lint, build**

Run: `npx tsc --noEmit` → clean (no more references to `TIER_STYLE`/`TIER_LABEL`).
Run: `npm run lint` → no warnings/errors.
Run: `npm run build` → home route compiles.

- [ ] **Step 6: Commit**

```bash
git add components/player/TierBadge.tsx app/page.tsx
git commit -m "refactor: extract shared TierBadge, use it on the home page"
```

---

## Task 3: LeaderboardTable component

**Files:**
- Create: `components/rankings/LeaderboardTable.tsx`

**Interfaces:**
- Consumes: `RankedPlayer` from `@/lib/rankings/leaderboard`; `TierBadge` from `@/components/player/TierBadge`.
- Produces: `LeaderboardTable({ players: RankedPlayer[]; currentUserId: string | null })`.

- [ ] **Step 1: Write `LeaderboardTable`**

Create `components/rankings/LeaderboardTable.tsx`:

```tsx
import { TierBadge } from '@/components/player/TierBadge'
import type { RankedPlayer } from '@/lib/rankings/leaderboard'

export function LeaderboardTable({
  players,
  currentUserId,
}: {
  players: RankedPlayer[]
  currentUserId: string | null
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-800 text-[11px] uppercase tracking-widest text-slate-500">
            <th className="px-3 py-3 text-left">#</th>
            <th className="px-2 py-3 text-left">Player</th>
            <th className="px-2 py-3 text-right">W</th>
            <th className="px-2 py-3 text-right">Win%</th>
            <th className="hidden px-2 py-3 text-right sm:table-cell">Titles</th>
            <th className="hidden px-2 py-3 text-right sm:table-cell">GD</th>
            <th className="hidden px-3 py-3 text-right sm:table-cell">Score</th>
          </tr>
        </thead>
        <tbody>
          {players.map((pl) => {
            // A logged-in user with 0 matches is excluded by the page query, so there
            // is simply no row here to highlight — expected, not a bug.
            const isMe = currentUserId != null && pl.id === currentUserId
            const name = pl.displayName ?? pl.username ?? 'Anonymous'
            const initial = (name[0] ?? '?').toUpperCase()
            return (
              <tr
                key={pl.id}
                className={`border-b border-slate-800/50 transition-colors last:border-0 ${
                  isMe ? 'bg-violet-500/10' : 'hover:bg-slate-800/40'
                }`}
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
                        {name}
                        {isMe && <span className="ml-1 text-[11px] text-violet-400">(you)</span>}
                      </p>
                      <TierBadge tier={pl.sentinelTier} />
                    </div>
                  </div>
                </td>
                <td className="px-2 py-3.5 text-right font-bold text-emerald-400">{pl.wins}</td>
                <td className="px-2 py-3.5 text-right text-slate-300">{Math.round(pl.winRate * 100)}%</td>
                <td className="hidden px-2 py-3.5 text-right text-slate-400 sm:table-cell">{pl.totalTitles}</td>
                <td className="hidden px-2 py-3.5 text-right text-slate-400 sm:table-cell">
                  {pl.goalDiff > 0 ? `+${pl.goalDiff}` : pl.goalDiff}
                </td>
                <td className="hidden px-3 py-3.5 text-right font-bold text-white sm:table-cell">
                  {pl.sentinelScore}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 2: Verify typecheck & lint**

Run: `npx tsc --noEmit` → clean.
Run: `npm run lint` → no warnings/errors.

- [ ] **Step 3: Commit**

```bash
git add components/rankings/LeaderboardTable.tsx
git commit -m "feat: LeaderboardTable (responsive, top-3 medals, self-row highlight)"
```

---

## Task 4: Rankings page

**Files:**
- Create: `app/(public)/rankings/page.tsx`

**Interfaces:**
- Consumes: `rankPlayers`/`PlayerStatsInput` from `@/lib/rankings/leaderboard`; `LeaderboardTable`; `EmptyState` from `@/components/shared/EmptyState`; `createClient` from `@/lib/supabase/server`.

- [ ] **Step 1: Write the page**

Create `app/(public)/rankings/page.tsx`:

```tsx
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { rankPlayers, type PlayerStatsInput } from '@/lib/rankings/leaderboard'
import { LeaderboardTable } from '@/components/rankings/LeaderboardTable'
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

export default async function RankingsPage() {
  const supabase = createClient()
  const [{ data: profiles }, { data: { user } }] = await Promise.all([
    supabase
      .from('profiles')
      .select(
        'id, username, display_name, avatar_url, country, wins, losses, total_matches, goals_scored, goals_conceded, total_titles, sentinel_score, sentinel_tier',
      )
      .gt('total_matches', 0)
      .order('wins', { ascending: false })
      .limit(200),
    supabase.auth.getUser(),
  ])

  const players = rankPlayers(
    (profiles ?? []).map(
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
        totalTitles: p.total_titles,
        sentinelScore: p.sentinel_score,
        sentinelTier: p.sentinel_tier,
      }),
    ),
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
        <LeaderboardTable players={players} currentUserId={user?.id ?? null} />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify typecheck, lint, build**

Run: `npx tsc --noEmit` → clean.
Run: `npm run lint` → no warnings/errors.
Run: `npm run build` → `/rankings` compiles as a dynamic route.

- [ ] **Step 3: Commit**

```bash
git add "app/(public)/rankings/page.tsx"
git commit -m "feat: rankings page (overall leaderboard + empty state)"
```

---

## Task 5: Roadmap + full verification + push

**Files:**
- Modify: `ROADMAP.md` (mark #6 ✅)

- [ ] **Step 1: Full local verification**

Run: `npx tsc --noEmit && npm run lint && npm test && npm run build` → all green (expect `Test Files 12 passed`, `/rankings` present).

- [ ] **Step 2: Mark the task done**

In `ROADMAP.md`, change the row:
`| 6 | Leaderboard | \`/rankings\` | ⬜ |`
to `… | ✅ |`.

- [ ] **Step 3: Commit & push**

```bash
git add ROADMAP.md
git commit -m "chore: mark v1.0 #6 (leaderboard) done"
git push origin main
```

- [ ] **Step 4: Post-deploy manual check**

On the deployed URL, open `/rankings`:
- With no players having matches → "Rankings coming soon" empty state.
- (Once profiles have match stats) verify wins order + tiebreakers, top-3 medals, tier badges, responsive columns at 375px, and that a logged-in ranked user sees their own row highlighted with "(you)".

---

## Self-Review

**Spec coverage:**
- Overall-only, built to extend (pure `rankPlayers` + isolated fetch, no tab chrome) → Tasks 1, 4. ✅
- Rank wins→win%→titles→GD, exclude 0-match → Tasks 1, 4. ✅
- Fetch profiles (`total_matches > 0`, limit 200, order wins) + current user → Task 4. ✅
- `LeaderboardTable`: responsive columns (`hidden sm:table-cell`), top-3 medals, self-row highlight w/ comment → Task 3. ✅
- Shared null-safe `TierBadge` + home refactor removing inline maps → Task 2. ✅
- Empty state via shared `EmptyState` → Task 4. ✅
- SEO `metadata` + OG → Task 4. ✅

**Placeholder scan:** No TBD/TODO; all code complete. ✅

**Type consistency:** `PlayerStatsInput`/`RankedPlayer` fields are defined once (Task 1) and mapped identically in Task 4; `LeaderboardTable` and `TierBadge` prop shapes match their consumers; `sentinelTier: string | null` flows through to `TierBadge`. Win% uses `Math.round(winRate * 100)` in the one place it's rendered. ✅
