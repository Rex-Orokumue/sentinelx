# Bracket Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the public, read-only bracket page (`/tournaments/[slug]/bracket`) showing group standings + global fixtures (tabbed) and a stacked-round knockout tree.

**Architecture:** A Server Component page fetches groups, memberships, and matches, normalizes matches into one `BracketMatch[]`, runs pure helpers (`sortStandings`, `splitFixturesByState`, `orderKnockoutRounds`, `getChampion`), and passes serializable data to presentational children. The only client boundary is `GroupStage` (Table/Fixtures tabs + a "Show results" collapse). Read-only, no realtime.

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase (`@supabase/ssr` anon server client), Tailwind, vitest.

## Global Constraints

- Mobile-first, design for 375px and scale up. **No `xs:` breakpoint exists** — hide columns with `hidden sm:table-cell` (Tailwind's first breakpoint is `sm` = 640px).
- Server Components by default; the ONLY `"use client"` file is `GroupStage.tsx`.
- Read-only page. No writes, no realtime. "Live" reflects admin-set `status='live'`, which can lag reality.
- Standings order: **points desc → goal difference desc → goals-for desc**. `advancingCount` defaults to **2**.
- Knockout round order source of truth: `ROUND_ORDER = ['round_of_32','round_of_16','quarter_final','semi_final','final']`.
- Group `disputed`/`cancelled` matches surface in a fourth Fixtures bucket at the bottom; knockout disputed/cancelled stay in their round list.
- `matches.player_a_id`/`player_b_id` are NOT NULL. Profile FK embed names: `matches_player_a_id_fkey`, `matches_player_b_id_fkey`.
- All needed tables (`groups`, `group_memberships`, `matches`, `profiles`) have `public_read` RLS. No migration.
- Tests colocated `*.test.ts`, vitest node env, `describe/it/expect`, pure-function style. Run `npm test`.
- `MatchCard` links to `/matches/[id]` (Match Centre #5 — dead until then, acceptable).

---

## File Structure

- Create `lib/tournaments/standings.ts` — `sortStandings` + `StandingRow`/`MembershipInput` types.
- Create `lib/tournaments/bracket.ts` — `BracketMatch` type, `ROUND_ORDER`, `ROUND_LABELS`, `splitFixturesByState`, `orderKnockoutRounds`, `getChampion`.
- Create `components/bracket/MatchCard.tsx` — presentational match card (shared).
- Create `components/bracket/StandingsTable.tsx` — presentational standings table.
- Create `components/bracket/KnockoutBracket.tsx` — presentational stacked rounds.
- Create `components/bracket/GroupStage.tsx` — client: Table/Fixtures tabs + collapse.
- Create `app/(public)/tournaments/[slug]/bracket/page.tsx` — fetch, normalize, assemble.
- Tests: `lib/tournaments/standings.test.ts`, `lib/tournaments/bracket.test.ts`.

---

## Task 1: Standings sort helper

**Files:**
- Create: `lib/tournaments/standings.ts`
- Test: `lib/tournaments/standings.test.ts`

**Interfaces:**
- Produces:
  - `MembershipInput = { playerId: string; name: string; wins: number; draws: number; losses: number; goalsFor: number; goalsAgainst: number; points: number }`
  - `StandingRow = MembershipInput's derived view` with fields: `playerId, name, played, wins, draws, losses, goalsFor, goalsAgainst, goalDiff, points, rank, advancing`
  - `sortStandings(memberships: MembershipInput[], advancingCount?: number): StandingRow[]` (default `advancingCount = 2`)

- [ ] **Step 1: Write the failing test**

Create `lib/tournaments/standings.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { sortStandings, type MembershipInput } from './standings'

function m(over: Partial<MembershipInput> & { playerId: string; name: string }): MembershipInput {
  return { wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, points: 0, ...over }
}

describe('sortStandings', () => {
  it('orders by points, then goal difference, then goals for', () => {
    const rows = sortStandings([
      m({ playerId: 'a', name: 'A', points: 6, goalsFor: 5, goalsAgainst: 4 }), // GD +1
      m({ playerId: 'b', name: 'B', points: 9, goalsFor: 8, goalsAgainst: 1 }), // GD +7
      m({ playerId: 'c', name: 'C', points: 6, goalsFor: 9, goalsAgainst: 2 }), // GD +7, GF 9
      m({ playerId: 'd', name: 'D', points: 6, goalsFor: 6, goalsAgainst: 1 }), // GD +5
    ])
    expect(rows.map((r) => r.playerId)).toEqual(['b', 'c', 'd', 'a'])
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4])
  })

  it('derives played and goalDiff', () => {
    const [row] = sortStandings([
      m({ playerId: 'a', name: 'A', wins: 2, draws: 1, losses: 0, goalsFor: 7, goalsAgainst: 2, points: 7 }),
    ])
    expect(row.played).toBe(3)
    expect(row.goalDiff).toBe(5)
  })

  it('flags the top 2 as advancing by default', () => {
    const rows = sortStandings([
      m({ playerId: 'a', name: 'A', points: 9 }),
      m({ playerId: 'b', name: 'B', points: 6 }),
      m({ playerId: 'c', name: 'C', points: 3 }),
    ])
    expect(rows.map((r) => r.advancing)).toEqual([true, true, false])
  })

  it('honors a custom advancingCount', () => {
    const rows = sortStandings(
      [
        m({ playerId: 'a', name: 'A', points: 9 }),
        m({ playerId: 'b', name: 'B', points: 6 }),
        m({ playerId: 'c', name: 'C', points: 3 }),
      ],
      1,
    )
    expect(rows.map((r) => r.advancing)).toEqual([true, false, false])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/tournaments/standings.test.ts`
Expected: FAIL — cannot resolve `./standings`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/tournaments/standings.ts`:

```ts
export interface MembershipInput {
  playerId: string
  name: string
  wins: number
  draws: number
  losses: number
  goalsFor: number
  goalsAgainst: number
  points: number
}

export interface StandingRow {
  playerId: string
  name: string
  played: number
  wins: number
  draws: number
  losses: number
  goalsFor: number
  goalsAgainst: number
  goalDiff: number
  points: number
  rank: number
  advancing: boolean
}

// Order: points desc, then goal difference desc, then goals-for desc.
// advancingCount defaults to 2 (top-2 advance) but is a parameter so a future
// format (e.g. best third-place) needs no surgery.
export function sortStandings(
  memberships: MembershipInput[],
  advancingCount = 2,
): StandingRow[] {
  return memberships
    .map((s) => ({
      ...s,
      played: s.wins + s.draws + s.losses,
      goalDiff: s.goalsFor - s.goalsAgainst,
    }))
    .sort(
      (a, b) =>
        b.points - a.points ||
        b.goalDiff - a.goalDiff ||
        b.goalsFor - a.goalsFor,
    )
    .map((s, i) => ({
      ...s,
      rank: i + 1,
      advancing: i < advancingCount,
    }))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lib/tournaments/standings.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck & commit**

Run: `npx tsc --noEmit` → clean.

```bash
git add lib/tournaments/standings.ts lib/tournaments/standings.test.ts
git commit -m "feat: sortStandings helper (points > GD > GF, advancingCount)"
```

---

## Task 2: Bracket helpers (rounds, fixtures, champion)

**Files:**
- Create: `lib/tournaments/bracket.ts`
- Test: `lib/tournaments/bracket.test.ts`

**Interfaces:**
- Produces:
  - `BracketMatch = { id: string; round: string; group_id: string | null; groupName: string | null; status: string; score_a: number | null; score_b: number | null; scheduled_at: string | null; playerA: { id: string; name: string }; playerB: { id: string; name: string } }`
  - `ROUND_ORDER: readonly string[]`, `ROUND_LABELS: Record<string,string>`
  - `splitFixturesByState(matches: BracketMatch[]): { live: BracketMatch[]; upcoming: BracketMatch[]; completed: BracketMatch[]; disputedOrCancelled: BracketMatch[] }`
  - `orderKnockoutRounds(matches: BracketMatch[]): { round: string; label: string; matches: BracketMatch[] }[]`
  - `getChampion(matches: BracketMatch[]): { id: string; name: string } | null`

- [ ] **Step 1: Write the failing test**

Create `lib/tournaments/bracket.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  splitFixturesByState,
  orderKnockoutRounds,
  getChampion,
  type BracketMatch,
} from './bracket'

function match(over: Partial<BracketMatch> & { id: string }): BracketMatch {
  return {
    round: 'group',
    group_id: 'g1',
    groupName: 'Group A',
    status: 'scheduled',
    score_a: null,
    score_b: null,
    scheduled_at: null,
    playerA: { id: 'pa', name: 'A' },
    playerB: { id: 'pb', name: 'B' },
    ...over,
  }
}

describe('splitFixturesByState', () => {
  it('buckets by status and puts disputed + cancelled together', () => {
    const res = splitFixturesByState([
      match({ id: '1', status: 'live' }),
      match({ id: '2', status: 'scheduled' }),
      match({ id: '3', status: 'completed' }),
      match({ id: '4', status: 'disputed' }),
      match({ id: '5', status: 'cancelled' }),
    ])
    expect(res.live.map((m) => m.id)).toEqual(['1'])
    expect(res.upcoming.map((m) => m.id)).toEqual(['2'])
    expect(res.completed.map((m) => m.id)).toEqual(['3'])
    expect(res.disputedOrCancelled.map((m) => m.id)).toEqual(['4', '5'])
  })

  it('sorts upcoming by scheduled_at with nulls last', () => {
    const res = splitFixturesByState([
      match({ id: 'late', status: 'scheduled', scheduled_at: '2026-07-10T18:00:00Z' }),
      match({ id: 'none', status: 'scheduled', scheduled_at: null }),
      match({ id: 'early', status: 'scheduled', scheduled_at: '2026-07-10T15:00:00Z' }),
    ])
    expect(res.upcoming.map((m) => m.id)).toEqual(['early', 'late', 'none'])
  })
})

describe('orderKnockoutRounds', () => {
  it('returns rounds in canonical order regardless of input order, omitting empty rounds', () => {
    const rounds = orderKnockoutRounds([
      match({ id: 'f', round: 'final' }),
      match({ id: 'q1', round: 'quarter_final' }),
      match({ id: 'q2', round: 'quarter_final' }),
      match({ id: 's', round: 'semi_final' }),
    ])
    expect(rounds.map((r) => r.round)).toEqual(['quarter_final', 'semi_final', 'final'])
    expect(rounds[0].label).toBe('Quarter-finals')
    expect(rounds[0].matches.map((m) => m.id)).toEqual(['q1', 'q2'])
  })
})

describe('getChampion', () => {
  it('returns the winner of a completed final', () => {
    const champ = getChampion([
      match({
        id: 'f',
        round: 'final',
        status: 'completed',
        score_a: 3,
        score_b: 1,
        playerA: { id: 'pa', name: 'Alpha' },
        playerB: { id: 'pb', name: 'Bravo' },
      }),
    ])
    expect(champ).toEqual({ id: 'pa', name: 'Alpha' })
  })

  it('picks player B when B wins', () => {
    const champ = getChampion([
      match({ id: 'f', round: 'final', status: 'completed', score_a: 0, score_b: 2 }),
    ])
    expect(champ?.id).toBe('pb')
  })

  it('returns null when the final is not completed or absent', () => {
    expect(getChampion([match({ id: 'f', round: 'final', status: 'live', score_a: 1, score_b: 0 })])).toBeNull()
    expect(getChampion([match({ id: 's', round: 'semi_final', status: 'completed', score_a: 2, score_b: 0 })])).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/tournaments/bracket.test.ts`
Expected: FAIL — cannot resolve `./bracket`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/tournaments/bracket.ts`:

```ts
export interface BracketMatch {
  id: string
  round: string
  group_id: string | null
  groupName: string | null
  status: string
  score_a: number | null
  score_b: number | null
  scheduled_at: string | null
  playerA: { id: string; name: string }
  playerB: { id: string; name: string }
}

// Canonical knockout order — the single source of truth for round sorting,
// independent of DB insertion/return order.
export const ROUND_ORDER = [
  'round_of_32',
  'round_of_16',
  'quarter_final',
  'semi_final',
  'final',
] as const

export const ROUND_LABELS: Record<string, string> = {
  round_of_32: 'Round of 32',
  round_of_16: 'Round of 16',
  quarter_final: 'Quarter-finals',
  semi_final: 'Semi-finals',
  final: 'Final',
}

// A match is only "live" when an admin has set status = 'live' in the DB. With
// realtime out of scope for v1.0, the pulsing "Live" indicator reflects
// admin-confirmed state, not the actual match state — it can lag.
export function splitFixturesByState(matches: BracketMatch[]): {
  live: BracketMatch[]
  upcoming: BracketMatch[]
  completed: BracketMatch[]
  disputedOrCancelled: BracketMatch[]
} {
  const live = matches.filter((m) => m.status === 'live')
  const completed = matches.filter((m) => m.status === 'completed')
  const disputedOrCancelled = matches.filter(
    (m) => m.status === 'disputed' || m.status === 'cancelled',
  )
  const upcoming = matches
    .filter((m) => m.status === 'scheduled')
    .sort((a, b) => {
      if (a.scheduled_at == null) return b.scheduled_at == null ? 0 : 1
      if (b.scheduled_at == null) return -1
      return a.scheduled_at.localeCompare(b.scheduled_at)
    })
  return { live, upcoming, completed, disputedOrCancelled }
}

export function orderKnockoutRounds(matches: BracketMatch[]): {
  round: string
  label: string
  matches: BracketMatch[]
}[] {
  return ROUND_ORDER.flatMap((round) => {
    const inRound = matches.filter((m) => m.round === round)
    if (inRound.length === 0) return []
    return [{ round, label: ROUND_LABELS[round] ?? round, matches: inRound }]
  })
}

export function getChampion(matches: BracketMatch[]): { id: string; name: string } | null {
  const final = matches.find((m) => m.round === 'final' && m.status === 'completed')
  if (!final || final.score_a == null || final.score_b == null) return null
  if (final.score_a === final.score_b) return null
  return final.score_a > final.score_b ? final.playerA : final.playerB
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lib/tournaments/bracket.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck & commit**

Run: `npx tsc --noEmit` → clean.

```bash
git add lib/tournaments/bracket.ts lib/tournaments/bracket.test.ts
git commit -m "feat: bracket helpers (ROUND_ORDER, fixtures split, rounds, champion)"
```

---

## Task 3: Presentational components (MatchCard, StandingsTable, KnockoutBracket)

**Files:**
- Create: `components/bracket/MatchCard.tsx`
- Create: `components/bracket/StandingsTable.tsx`
- Create: `components/bracket/KnockoutBracket.tsx`

**Interfaces:**
- Consumes: `BracketMatch` from `lib/tournaments/bracket.ts`; `StandingRow` from `lib/tournaments/standings.ts`.
- Produces:
  - `MatchCard({ match: BracketMatch; showGroup?: boolean })`
  - `StandingsTable({ groupName: string; rows: StandingRow[] })`
  - `KnockoutBracket({ rounds: { round: string; label: string; matches: BracketMatch[] }[] })`

- [ ] **Step 1: Write `MatchCard`**

Create `components/bracket/MatchCard.tsx`:

```tsx
import Link from 'next/link'
import type { BracketMatch } from '@/lib/tournaments/bracket'

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  live:      { label: 'LIVE',      cls: 'bg-red-500/20 text-red-400 border-red-500/30' },
  scheduled: { label: 'UPCOMING',  cls: 'bg-slate-600/30 text-slate-300 border-slate-600/40' },
  completed: { label: 'FT',        cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  disputed:  { label: 'DISPUTED',  cls: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
  cancelled: { label: 'CANCELLED', cls: 'bg-slate-700/40 text-slate-500 border-slate-700/50' },
}

export function MatchCard({ match, showGroup = false }: { match: BracketMatch; showGroup?: boolean }) {
  const badge = STATUS_BADGE[match.status] ?? STATUS_BADGE.scheduled
  const hasScore = match.score_a != null && match.score_b != null
  const aWon = hasScore && match.score_a! > match.score_b!
  const bWon = hasScore && match.score_b! > match.score_a!

  return (
    <Link
      href={`/matches/${match.id}`}
      className="block rounded-xl border border-slate-800 bg-slate-900 p-3 transition-colors hover:border-violet-500/40"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold ${badge.cls}`}>
          {match.status === 'live' && (
            <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" />
          )}
          {badge.label}
        </span>
        {showGroup && match.groupName && (
          <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
            {match.groupName}
          </span>
        )}
      </div>
      <PlayerRow name={match.playerA.name} score={match.score_a} win={aWon} />
      <PlayerRow name={match.playerB.name} score={match.score_b} win={bWon} />
    </Link>
  )
}

function PlayerRow({ name, score, win }: { name: string; score: number | null; win: boolean }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className={`truncate text-sm ${win ? 'font-bold text-white' : 'text-slate-300'}`}>{name}</span>
      <span className={`ml-2 shrink-0 text-sm tabular-nums ${win ? 'font-bold text-white' : 'text-slate-400'}`}>
        {score ?? '–'}
      </span>
    </div>
  )
}
```

- [ ] **Step 2: Write `StandingsTable`**

Create `components/bracket/StandingsTable.tsx` (W/D/L hidden below `sm`, not `xs`):

```tsx
import type { StandingRow } from '@/lib/tournaments/standings'

export function StandingsTable({ groupName, rows }: { groupName: string; rows: StandingRow[] }) {
  return (
    <div className="mb-6">
      <h3 className="mb-2 text-sm font-bold text-white">{groupName}</h3>
      <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-[11px] uppercase tracking-widest text-slate-500">
              <th className="px-3 py-2.5 text-left">#</th>
              <th className="px-2 py-2.5 text-left">Player</th>
              <th className="px-2 py-2.5 text-center">P</th>
              <th className="hidden px-2 py-2.5 text-center sm:table-cell">W</th>
              <th className="hidden px-2 py-2.5 text-center sm:table-cell">D</th>
              <th className="hidden px-2 py-2.5 text-center sm:table-cell">L</th>
              <th className="px-2 py-2.5 text-center">GD</th>
              <th className="px-3 py-2.5 text-right">Pts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.playerId}
                className={`border-b border-slate-800/50 last:border-0 ${r.advancing ? 'bg-emerald-500/[0.06]' : ''}`}
              >
                <td className="px-3 py-2.5 font-bold text-slate-400">{r.advancing ? '✅' : r.rank}</td>
                <td className="px-2 py-2.5 font-semibold text-white">{r.name}</td>
                <td className="px-2 py-2.5 text-center text-slate-400">{r.played}</td>
                <td className="hidden px-2 py-2.5 text-center text-slate-400 sm:table-cell">{r.wins}</td>
                <td className="hidden px-2 py-2.5 text-center text-slate-400 sm:table-cell">{r.draws}</td>
                <td className="hidden px-2 py-2.5 text-center text-slate-400 sm:table-cell">{r.losses}</td>
                <td className="px-2 py-2.5 text-center text-slate-400">
                  {r.goalDiff > 0 ? `+${r.goalDiff}` : r.goalDiff}
                </td>
                <td className="px-3 py-2.5 text-right font-bold text-white">{r.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Write `KnockoutBracket`**

Create `components/bracket/KnockoutBracket.tsx`:

```tsx
import type { BracketMatch } from '@/lib/tournaments/bracket'
import { MatchCard } from './MatchCard'

export function KnockoutBracket({
  rounds,
}: {
  rounds: { round: string; label: string; matches: BracketMatch[] }[]
}) {
  return (
    <section className="mb-10">
      <h2 className="mb-4 text-base font-bold text-white">Knockout</h2>
      <div className="space-y-6">
        {rounds.map((r) => (
          <div key={r.round}>
            <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-300">{r.label}</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {r.matches.map((m) => (
                <MatchCard key={m.id} match={m} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
```

- [ ] **Step 4: Verify typecheck & lint**

Run: `npx tsc --noEmit` → clean.
Run: `npm run lint` → no warnings/errors.

- [ ] **Step 5: Commit**

```bash
git add components/bracket/MatchCard.tsx components/bracket/StandingsTable.tsx components/bracket/KnockoutBracket.tsx
git commit -m "feat: presentational bracket components (MatchCard, StandingsTable, KnockoutBracket)"
```

---

## Task 4: GroupStage client component (tabs + collapse)

**Files:**
- Create: `components/bracket/GroupStage.tsx`

**Interfaces:**
- Consumes: `StandingRow` from `lib/tournaments/standings.ts`; `BracketMatch` from `lib/tournaments/bracket.ts`; `StandingsTable`, `MatchCard`.
- Produces:
  - `GroupStage({ standings: { groupName: string; rows: StandingRow[] }[]; fixtures: { live: BracketMatch[]; upcoming: BracketMatch[]; completed: BracketMatch[]; disputedOrCancelled: BracketMatch[] } })`

- [ ] **Step 1: Write `GroupStage`**

Create `components/bracket/GroupStage.tsx`:

```tsx
'use client'
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { StandingRow } from '@/lib/tournaments/standings'
import type { BracketMatch } from '@/lib/tournaments/bracket'
import { StandingsTable } from './StandingsTable'
import { MatchCard } from './MatchCard'

type Buckets = {
  live: BracketMatch[]
  upcoming: BracketMatch[]
  completed: BracketMatch[]
  disputedOrCancelled: BracketMatch[]
}

export function GroupStage({
  standings,
  fixtures,
}: {
  standings: { groupName: string; rows: StandingRow[] }[]
  fixtures: Buckets
}) {
  const [tab, setTab] = useState<'table' | 'fixtures'>('table')
  const [showCompleted, setShowCompleted] = useState(false)

  const totalFixtures =
    fixtures.live.length +
    fixtures.upcoming.length +
    fixtures.completed.length +
    fixtures.disputedOrCancelled.length

  return (
    <section className="mb-10">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-bold text-white">Group Stage</h2>
        <div className="flex gap-1 rounded-lg border border-slate-800 bg-slate-900 p-1">
          <TabButton active={tab === 'table'} onClick={() => setTab('table')}>Table</TabButton>
          <TabButton active={tab === 'fixtures'} onClick={() => setTab('fixtures')}>Fixtures</TabButton>
        </div>
      </div>

      {tab === 'table' ? (
        standings.map((g) => <StandingsTable key={g.groupName} groupName={g.groupName} rows={g.rows} />)
      ) : totalFixtures === 0 ? (
        <p className="text-sm text-slate-500">No group fixtures scheduled yet.</p>
      ) : (
        <div className="space-y-6">
          {fixtures.live.length > 0 && (
            <FixtureGroup title="🔴 Live">
              {fixtures.live.map((m) => <MatchCard key={m.id} match={m} showGroup />)}
            </FixtureGroup>
          )}
          {fixtures.upcoming.length > 0 && (
            <FixtureGroup title="⏳ Upcoming">
              {fixtures.upcoming.map((m) => <MatchCard key={m.id} match={m} showGroup />)}
            </FixtureGroup>
          )}
          {fixtures.completed.length > 0 && (
            <div>
              <button
                onClick={() => setShowCompleted((v) => !v)}
                className="mb-3 text-sm font-bold text-slate-300 transition-colors hover:text-white"
              >
                🏁 Completed ({fixtures.completed.length}) — {showCompleted ? 'Hide' : 'Show results'}
              </button>
              {showCompleted && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {fixtures.completed.map((m) => <MatchCard key={m.id} match={m} showGroup />)}
                </div>
              )}
            </div>
          )}
          {fixtures.disputedOrCancelled.length > 0 && (
            <FixtureGroup title="🚫 Disputed / Cancelled">
              {fixtures.disputedOrCancelled.map((m) => <MatchCard key={m.id} match={m} showGroup />)}
            </FixtureGroup>
          )}
        </div>
      )}
    </section>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-xs font-bold transition-colors ${
        active ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white'
      }`}
    >
      {children}
    </button>
  )
}

function FixtureGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="mb-3 text-sm font-bold text-white">{title}</h3>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </div>
  )
}
```

- [ ] **Step 2: Verify typecheck & lint**

Run: `npx tsc --noEmit` → clean.
Run: `npm run lint` → no warnings/errors.

- [ ] **Step 3: Commit**

```bash
git add components/bracket/GroupStage.tsx
git commit -m "feat: GroupStage client component (Table/Fixtures tabs + collapse)"
```

---

## Task 5: Bracket page (fetch, normalize, assemble)

**Files:**
- Create: `app/(public)/tournaments/[slug]/bracket/page.tsx`

**Interfaces:**
- Consumes: `sortStandings`/`MembershipInput` from `lib/tournaments/standings.ts`; `splitFixturesByState`, `orderKnockoutRounds`, `getChampion`, `BracketMatch` from `lib/tournaments/bracket.ts`; `GroupStage`, `KnockoutBracket`; `createClient` from `lib/supabase/server.ts`.
- Produces: the route + `generateMetadata`.

- [ ] **Step 1: Write the page**

Create `app/(public)/tournaments/[slug]/bracket/page.tsx`:

```tsx
import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { sortStandings, type MembershipInput } from '@/lib/tournaments/standings'
import {
  splitFixturesByState,
  orderKnockoutRounds,
  getChampion,
  type BracketMatch,
} from '@/lib/tournaments/bracket'
import { GroupStage } from '@/components/bracket/GroupStage'
import { KnockoutBracket } from '@/components/bracket/KnockoutBracket'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sentinelx.gg'

type ProfileRef = { id?: string; username: string | null; display_name: string | null } | null

function nameOf(p: ProfileRef): string {
  return p?.display_name ?? p?.username ?? 'TBD'
}

async function getTournament(slug: string) {
  const supabase = createClient()
  const { data } = await supabase
    .from('tournaments')
    .select('id, title, slug, status')
    .eq('slug', slug)
    .maybeSingle()
  if (!data || data.status === 'draft') return null
  return data
}

export async function generateMetadata({
  params,
}: {
  params: { slug: string }
}): Promise<Metadata> {
  const t = await getTournament(params.slug)
  if (!t) return { title: 'Bracket — Sentinel X' }
  const title = `Bracket — ${t.title} | Sentinel X`
  const description = `Group standings and knockout bracket for ${t.title} on Sentinel X.`
  return {
    title,
    description,
    openGraph: { title, description, url: `${SITE_URL}/tournaments/${t.slug}/bracket`, siteName: 'Sentinel X', type: 'website' },
  }
}

export default async function BracketPage({ params }: { params: { slug: string } }) {
  const t = await getTournament(params.slug)
  if (!t) notFound()

  const supabase = createClient()
  const { data: groups } = await supabase
    .from('groups')
    .select('id, name')
    .eq('tournament_id', t.id)
    .order('name')

  const groupIds = (groups ?? []).map((g) => g.id)
  const groupNameById = new Map((groups ?? []).map((g) => [g.id, g.name]))

  const [membershipsRes, matchesRes] = await Promise.all([
    groupIds.length > 0
      ? supabase
          .from('group_memberships')
          .select('group_id, player_id, wins, draws, losses, goals_for, goals_against, points, profiles(username, display_name)')
          .in('group_id', groupIds)
      : Promise.resolve({ data: [] as unknown[] }),
    supabase
      .from('matches')
      .select(
        'id, round, group_id, status, score_a, score_b, scheduled_at, ' +
          'player_a:profiles!matches_player_a_id_fkey(id, username, display_name), ' +
          'player_b:profiles!matches_player_b_id_fkey(id, username, display_name)',
      )
      .eq('tournament_id', t.id),
  ])

  // Normalize matches into BracketMatch[] once.
  const allMatches: BracketMatch[] = ((matchesRes.data as unknown[] | null) ?? []).map((raw) => {
    const m = raw as {
      id: string
      round: string
      group_id: string | null
      status: string
      score_a: number | null
      score_b: number | null
      scheduled_at: string | null
      player_a: ProfileRef
      player_b: ProfileRef
    }
    return {
      id: m.id,
      round: m.round,
      group_id: m.group_id,
      groupName: m.group_id ? groupNameById.get(m.group_id) ?? null : null,
      status: m.status,
      score_a: m.score_a,
      score_b: m.score_b,
      scheduled_at: m.scheduled_at,
      playerA: { id: m.player_a?.id ?? '', name: nameOf(m.player_a) },
      playerB: { id: m.player_b?.id ?? '', name: nameOf(m.player_b) },
    }
  })

  // Standings per group.
  const standings = (groups ?? []).map((g) => {
    const rows = ((membershipsRes.data as unknown[] | null) ?? [])
      .filter((raw) => (raw as { group_id: string }).group_id === g.id)
      .map((raw): MembershipInput => {
        const gm = raw as {
          player_id: string
          wins: number
          draws: number
          losses: number
          goals_for: number
          goals_against: number
          points: number
          profiles: ProfileRef
        }
        return {
          playerId: gm.player_id,
          name: nameOf(gm.profiles),
          wins: gm.wins,
          draws: gm.draws,
          losses: gm.losses,
          goalsFor: gm.goals_for,
          goalsAgainst: gm.goals_against,
          points: gm.points,
        }
      })
    return { groupName: g.name, rows: sortStandings(rows) }
  })

  const groupMatches = allMatches.filter((m) => m.group_id != null)
  const knockoutMatches = allMatches.filter((m) => m.round !== 'group')
  const fixtures = splitFixturesByState(groupMatches)
  const rounds = orderKnockoutRounds(knockoutMatches)
  const champion = getChampion(allMatches)

  const hasGroups = (groups ?? []).length > 0
  const hasKnockout = rounds.length > 0
  const isEmpty = !hasGroups && !hasKnockout

  return (
    <div className="mx-auto max-w-3xl px-4 pb-20">
      <Link
        href={`/tournaments/${t.slug}`}
        className="mt-6 mb-4 inline-block text-sm text-violet-400 hover:text-violet-300"
      >
        ← {t.title}
      </Link>
      <h1 className="mb-6 text-2xl font-black text-white">Bracket</h1>

      {champion && (
        <div className="mb-6 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-5 py-4 text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-amber-400/80">Champion</p>
          <p className="mt-1 text-xl font-black text-white">🏆 {champion.name}</p>
        </div>
      )}

      {isEmpty ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 py-12 text-center">
          <p className="text-3xl">🗂️</p>
          <p className="mt-3 font-bold text-white">Bracket not published yet</p>
          <p className="mt-1 text-sm text-slate-500">
            It&apos;ll appear here once registration closes and the admin sets it up.
          </p>
        </div>
      ) : (
        <>
          {hasGroups && <GroupStage standings={standings} fixtures={fixtures} />}
          {hasKnockout && <KnockoutBracket rounds={rounds} />}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify typecheck, lint, build**

Run: `npx tsc --noEmit` → clean.
Run: `npm run lint` → no warnings/errors.
Run: `npm run build` → `/tournaments/[slug]/bracket` compiles as a dynamic route.

- [ ] **Step 3: Commit**

```bash
git add "app/(public)/tournaments/[slug]/bracket/page.tsx"
git commit -m "feat: bracket page (groups + knockout, champion, empty state)"
```

---

## Task 6: Roadmap update + full verification + push

**Files:**
- Modify: `ROADMAP.md` (mark #4 ✅)

- [ ] **Step 1: Full local verification**

Run: `npx tsc --noEmit && npm run lint && npm test && npm run build` → all green (expect `Test Files 9 passed`, bracket route present).

- [ ] **Step 2: Mark the task done**

In `ROADMAP.md`, change the row:
`| 4 | Bracket page — groups + knockout, admin-confirmed updates | \`/tournaments/[slug]/bracket\` | ⬜ |`
to `… | ✅ |`.

- [ ] **Step 3: Commit & push**

```bash
git add ROADMAP.md
git commit -m "chore: mark v1.0 #4 (bracket page) done"
git push origin main
```

- [ ] **Step 4: Post-deploy manual check**

On the deployed URL, open a tournament's `/bracket`:
- With no groups/matches → "Bracket not published yet".
- (Once #9 admin tooling exists) verify Table/Fixtures tabs, top-2 ✅ highlight, Live/Upcoming/Completed/Disputed buckets, stacked knockout rounds, and the champion banner after a completed final.

---

## Self-Review

**Spec coverage:**
- Read-only page, single client boundary (`GroupStage`) → Tasks 4, 5. ✅
- Data fetch (tournament/groups/memberships/matches, split group vs knockout) → Task 5. ✅
- Group Stage: Table tab (standings, top-2 highlight) + Fixtures tab (global Live/Upcoming/Completed collapse/Disputed) → Tasks 1, 3, 4. ✅
- Knockout stacked rounds in ROUND_ORDER → Tasks 2, 3. ✅
- Champion banner via `getChampion` → Tasks 2, 5. ✅
- Empty state → Task 5. ✅
- Pure helpers `sortStandings(advancingCount=2)`, `splitFixturesByState` (+disputedOrCancelled, admin-lag comment), `orderKnockoutRounds`, `getChampion` → Tasks 1, 2. ✅
- SEO `generateMetadata` → Task 5. ✅
- No migration (public_read verified) → Global Constraints. ✅
- `hidden sm:table-cell` (no `xs:`) → Task 3. ✅

**Placeholder scan:** No TBD/TODO; every code step is complete. ✅

**Type consistency:** `BracketMatch`, `StandingRow`, `MembershipInput`, the fixtures bucket shape `{ live, upcoming, completed, disputedOrCancelled }`, and `{ round, label, matches }` are defined once (Tasks 1–2) and consumed with identical shapes in Tasks 3–5. `sortStandings` default `advancingCount = 2`. FK embed aliases `matches_player_a_id_fkey` / `_b_` match the DB. ✅
