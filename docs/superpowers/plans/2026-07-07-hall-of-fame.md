# Hall of Fame Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the all-time `/hall-of-fame` page — a Champions wall (derived from completed tournaments), plus single MVP and Golden Boot awards.

**Architecture:** A pure, unit-tested awards module (`lib/hall-of-fame/awards.ts`) computes the three winners from plain inputs, reusing the existing `getChampion` winner rule and a new shared eligibility gate. A Server Component page runs Supabase queries, maps rows into the pure helpers, and renders two presentational components. No placeholders — real empty states per section.

**Tech Stack:** Next.js 14 App Router (Server Components), TypeScript, Tailwind, Supabase server client, Vitest.

## Global Constraints

- Mobile-first, design for 375px width and scale up.
- Server Components by default; only add `"use client"` for interactivity (none needed here).
- Eligibility gate for any ranked/awarded player: `total_matches >= 1`, expressed via the shared `RANKING_MIN_MATCHES` constant — never a bare literal.
- Champions source only from completed tournaments whose final match is also completed. Never from `profiles.total_titles`.
- Player names render UN-linked (the `/players/[username]` page does not exist yet). Tournaments link to `/tournaments/[slug]`.
- Avatars use the initial-letter circle pattern (`bg-slate-700` circle with the name's uppercased first letter), matching `LeaderboardTable` and the home page. No `avatar_url` images, no `next/image`.
- Test command: `npx vitest run <path>`. Type check: `npx tsc --noEmit`. Build: `npm run build`.
- Each commit message ends with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

### Task 1: Shared eligibility gate + rankings refactor

Introduce the single source of truth for player eligibility and switch the existing rankings page onto it, so the Hall of Fame and rankings can never drift.

**Files:**
- Modify: `lib/rankings/leaderboard.ts` (append constant + predicate)
- Modify: `lib/rankings/leaderboard.test.ts` (add predicate tests)
- Modify: `app/(public)/rankings/page.tsx:29` (swap `.gt('total_matches', 0)` → `.gte('total_matches', RANKING_MIN_MATCHES)`)

**Interfaces:**
- Consumes: existing `PlayerStatsInput` from `lib/rankings/leaderboard.ts`.
- Produces:
  - `export const RANKING_MIN_MATCHES = 1`
  - `export function isRankingEligible(p: { totalMatches: number }): boolean`

- [ ] **Step 1: Write the failing test**

Add to the end of `lib/rankings/leaderboard.test.ts` (and extend the import on line 2):

```typescript
import { rankPlayers, isRankingEligible, RANKING_MIN_MATCHES, type PlayerStatsInput } from './leaderboard'

// ... existing tests unchanged ...

describe('isRankingEligible', () => {
  it('excludes players with zero matches', () => {
    expect(isRankingEligible({ totalMatches: 0 })).toBe(false)
  })

  it('includes players at the minimum and above', () => {
    expect(isRankingEligible({ totalMatches: RANKING_MIN_MATCHES })).toBe(true)
    expect(isRankingEligible({ totalMatches: 5 })).toBe(true)
  })

  it('RANKING_MIN_MATCHES is 1 (at least one match)', () => {
    expect(RANKING_MIN_MATCHES).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/rankings/leaderboard.test.ts`
Expected: FAIL — `isRankingEligible` / `RANKING_MIN_MATCHES` is not exported (import error).

- [ ] **Step 3: Write minimal implementation**

Append to `lib/rankings/leaderboard.ts`:

```typescript
// Minimum matches a player must have completed to appear in any ranking or award.
// Value equals the semantic minimum (1 = at least one match) so the constant never
// contradicts its name. Shared by the rankings page and the Hall of Fame.
export const RANKING_MIN_MATCHES = 1

export function isRankingEligible(p: { totalMatches: number }): boolean {
  return p.totalMatches >= RANKING_MIN_MATCHES
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/rankings/leaderboard.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Refactor the rankings page onto the shared gate**

In `app/(public)/rankings/page.tsx`, update the import on line 3 and the query filter.

Change the import:

```typescript
import { rankPlayers, isRankingEligible, RANKING_MIN_MATCHES, type PlayerStatsInput } from '@/lib/rankings/leaderboard'
```

Change the filter (currently `.gt('total_matches', 0)`):

```typescript
      .gte('total_matches', RANKING_MIN_MATCHES)
```

(`isRankingEligible` is imported now so Task 4's shared usage is consistent; the page query itself uses the `.gte` form. Leaving the import in place is fine — it will be used if a future in-memory filter is added. If lint flags it as unused, remove `isRankingEligible` from this import and keep only `RANKING_MIN_MATCHES`.)

- [ ] **Step 6: Verify types and the rankings test still pass**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npx vitest run lib/rankings/leaderboard.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/rankings/leaderboard.ts lib/rankings/leaderboard.test.ts "app/(public)/rankings/page.tsx"
git commit -m "$(cat <<'EOF'
feat: shared ranking eligibility gate (RANKING_MIN_MATCHES)

Single source of truth for total_matches >= 1; rankings page now
uses it so Hall of Fame awards can't drift from the leaderboard.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: MVP + Golden Boot pure helpers

Create the awards module with the two single-winner selectors.

**Files:**
- Create: `lib/hall-of-fame/awards.ts`
- Create: `lib/hall-of-fame/awards.test.ts`

**Interfaces:**
- Consumes: `PlayerStatsInput`, `isRankingEligible` from `lib/rankings/leaderboard.ts`.
- Produces:
  - `pickMVP(players: PlayerStatsInput[]): PlayerStatsInput | null`
  - `pickGoldenBoot(players: PlayerStatsInput[]): PlayerStatsInput | null`

- [ ] **Step 1: Write the failing test**

Create `lib/hall-of-fame/awards.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { pickMVP, pickGoldenBoot } from './awards'
import type { PlayerStatsInput } from '@/lib/rankings/leaderboard'

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

describe('pickMVP', () => {
  it('returns null when no eligible players', () => {
    expect(pickMVP([])).toBeNull()
    expect(pickMVP([p({ id: 'a', totalMatches: 0, sentinelScore: 99 })])).toBeNull()
  })

  it('picks the highest sentinel score', () => {
    const r = pickMVP([
      p({ id: 'a', totalMatches: 3, sentinelScore: 80 }),
      p({ id: 'b', totalMatches: 3, sentinelScore: 92 }),
    ])
    expect(r?.id).toBe('b')
  })

  it('at launch (flat 70 scores) resolves to most wins', () => {
    const r = pickMVP([
      p({ id: 'a', totalMatches: 5, wins: 2, sentinelScore: 70 }),
      p({ id: 'b', totalMatches: 5, wins: 4, sentinelScore: 70 }),
    ])
    expect(r?.id).toBe('b')
  })

  it('breaks a score+wins tie by win rate', () => {
    const r = pickMVP([
      p({ id: 'a', totalMatches: 10, wins: 6, sentinelScore: 70 }), // 60%
      p({ id: 'b', totalMatches: 8, wins: 6, sentinelScore: 70 }), // 75%
    ])
    expect(r?.id).toBe('b')
  })

  it('excludes ineligible players from selection', () => {
    const r = pickMVP([
      p({ id: 'a', totalMatches: 0, sentinelScore: 100 }),
      p({ id: 'b', totalMatches: 1, sentinelScore: 71 }),
    ])
    expect(r?.id).toBe('b')
  })
})

describe('pickGoldenBoot', () => {
  it('returns null when no eligible players', () => {
    expect(pickGoldenBoot([])).toBeNull()
    expect(pickGoldenBoot([p({ id: 'a', totalMatches: 0, goalsScored: 50 })])).toBeNull()
  })

  it('picks the highest goals scored', () => {
    const r = pickGoldenBoot([
      p({ id: 'a', totalMatches: 3, goalsScored: 12 }),
      p({ id: 'b', totalMatches: 3, goalsScored: 20 }),
    ])
    expect(r?.id).toBe('b')
  })

  it('breaks a goals tie by wins', () => {
    const r = pickGoldenBoot([
      p({ id: 'a', totalMatches: 5, goalsScored: 15, wins: 2 }),
      p({ id: 'b', totalMatches: 5, goalsScored: 15, wins: 4 }),
    ])
    expect(r?.id).toBe('b')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/hall-of-fame/awards.test.ts`
Expected: FAIL — cannot find module `./awards`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/hall-of-fame/awards.ts`:

```typescript
import { isRankingEligible, type PlayerStatsInput } from '@/lib/rankings/leaderboard'

function winRate(p: PlayerStatsInput): number {
  return p.totalMatches > 0 ? p.wins / p.totalMatches : 0
}

// Most Valuable Player: highest Sentinel Score among eligible players. Ties break by
// wins then win rate — so at launch, when every score is the default 70, MVP resolves
// to most wins with no special-case code.
export function pickMVP(players: PlayerStatsInput[]): PlayerStatsInput | null {
  const eligible = players.filter(isRankingEligible)
  if (eligible.length === 0) return null
  return [...eligible].sort(
    (a, b) =>
      b.sentinelScore - a.sentinelScore ||
      b.wins - a.wins ||
      winRate(b) - winRate(a),
  )[0]
}

// Golden Boot: most goals scored among eligible players, ties broken by wins.
export function pickGoldenBoot(players: PlayerStatsInput[]): PlayerStatsInput | null {
  const eligible = players.filter(isRankingEligible)
  if (eligible.length === 0) return null
  return [...eligible].sort(
    (a, b) => b.goalsScored - a.goalsScored || b.wins - a.wins,
  )[0]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/hall-of-fame/awards.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/hall-of-fame/awards.ts lib/hall-of-fame/awards.test.ts
git commit -m "$(cat <<'EOF'
feat: MVP + Golden Boot award selectors

Pure helpers over PlayerStatsInput using the shared eligibility gate.
MVP = Sentinel Score, wins/win-rate tiebreak; Golden Boot = goals, wins tiebreak.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Champions derivation

Add `deriveChampions` to the awards module, reusing `getChampion`.

**Files:**
- Modify: `lib/hall-of-fame/awards.ts` (append types + function)
- Modify: `lib/hall-of-fame/awards.test.ts` (append champions tests)

**Interfaces:**
- Consumes: `getChampion`, `BracketMatch` from `lib/tournaments/bracket.ts`.
- Produces:
  - `interface ChampionInput { tournamentId: string; slug: string; title: string; gameName: string | null; tournamentEnd: string | null; finalMatch: BracketMatch | null }`
  - `interface ChampionEntry { tournamentId: string; slug: string; title: string; gameName: string | null; date: string | null; champion: { id: string; name: string } }`
  - `deriveChampions(inputs: ChampionInput[]): ChampionEntry[]`

- [ ] **Step 1: Write the failing test**

Append to `lib/hall-of-fame/awards.test.ts` (extend the import from `./awards` to add `deriveChampions` and `type ChampionInput`):

```typescript
import { pickMVP, pickGoldenBoot, deriveChampions, type ChampionInput } from './awards'
import type { BracketMatch } from '@/lib/tournaments/bracket'

function finalMatch(over: Partial<BracketMatch>): BracketMatch {
  return {
    id: 'm',
    round: 'final',
    group_id: null,
    groupName: null,
    status: 'completed',
    score_a: 2,
    score_b: 1,
    scheduled_at: null,
    playerA: { id: 'pa', name: 'Ada' },
    playerB: { id: 'pb', name: 'Bill' },
    ...over,
  }
}

function champInput(over: Partial<ChampionInput> & { tournamentId: string }): ChampionInput {
  return {
    slug: over.tournamentId,
    title: `Cup ${over.tournamentId}`,
    gameName: 'DLS',
    tournamentEnd: '2026-01-01',
    finalMatch: finalMatch({}),
    ...over,
  }
}

describe('deriveChampions', () => {
  it('returns [] for empty input', () => {
    expect(deriveChampions([])).toEqual([])
  })

  it('emits the final winner as the champion', () => {
    const r = deriveChampions([champInput({ tournamentId: 't1' })])
    expect(r).toHaveLength(1)
    expect(r[0].champion).toEqual({ id: 'pa', name: 'Ada' })
    expect(r[0].slug).toBe('t1')
  })

  it('skips a tournament whose final is not completed', () => {
    const r = deriveChampions([
      champInput({ tournamentId: 't1', finalMatch: finalMatch({ status: 'scheduled' }) }),
    ])
    expect(r).toEqual([])
  })

  it('skips a tournament with a null final match', () => {
    const r = deriveChampions([champInput({ tournamentId: 't1', finalMatch: null })])
    expect(r).toEqual([])
  })

  it('skips a drawn or null-score final', () => {
    const draw = deriveChampions([
      champInput({ tournamentId: 't1', finalMatch: finalMatch({ score_a: 1, score_b: 1 }) }),
    ])
    expect(draw).toEqual([])
    const nullScore = deriveChampions([
      champInput({ tournamentId: 't2', finalMatch: finalMatch({ score_a: null }) }),
    ])
    expect(nullScore).toEqual([])
  })

  it('orders most-recent-first with nulls last', () => {
    const r = deriveChampions([
      champInput({ tournamentId: 'old', tournamentEnd: '2025-01-01' }),
      champInput({ tournamentId: 'none', tournamentEnd: null }),
      champInput({ tournamentId: 'new', tournamentEnd: '2026-06-01' }),
    ])
    expect(r.map((c) => c.tournamentId)).toEqual(['new', 'old', 'none'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/hall-of-fame/awards.test.ts`
Expected: FAIL — `deriveChampions` / `ChampionInput` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `lib/hall-of-fame/awards.ts` (add the import at the top of the file):

```typescript
import { getChampion, type BracketMatch } from '@/lib/tournaments/bracket'

export interface ChampionInput {
  tournamentId: string
  slug: string
  title: string
  gameName: string | null
  tournamentEnd: string | null
  finalMatch: BracketMatch | null
}

export interface ChampionEntry {
  tournamentId: string
  slug: string
  title: string
  gameName: string | null
  date: string | null
  champion: { id: string; name: string }
}

// One champion per completed tournament with a completed, decisive final.
// getChampion enforces round='final' + status='completed' and guards draws/null scores,
// so the winner rule is reused, never reimplemented. Ordered most-recent-first, nulls last.
export function deriveChampions(inputs: ChampionInput[]): ChampionEntry[] {
  return inputs
    .flatMap((inp) => {
      if (!inp.finalMatch) return []
      const w = getChampion([inp.finalMatch])
      if (!w) return []
      return [
        {
          tournamentId: inp.tournamentId,
          slug: inp.slug,
          title: inp.title,
          gameName: inp.gameName,
          date: inp.tournamentEnd,
          champion: { id: w.id, name: w.name },
        },
      ]
    })
    .sort((a, b) => {
      if (a.date == null) return b.date == null ? 0 : 1
      if (b.date == null) return -1
      return b.date.localeCompare(a.date)
    })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/hall-of-fame/awards.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/hall-of-fame/awards.ts lib/hall-of-fame/awards.test.ts
git commit -m "$(cat <<'EOF'
feat: deriveChampions from completed tournament finals

Reuses getChampion (round=final + status=completed, draw-guarded);
orders most-recent-first. No total_titles counter involved.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Presentational components

Two focused, presentational components. This codebase does not unit-test components (only `lib/` has tests), so these are verified by `tsc` and by the page in Task 5.

**Files:**
- Create: `components/hall-of-fame/AwardCard.tsx`
- Create: `components/hall-of-fame/ChampionCard.tsx`

**Interfaces:**
- Consumes: `TierBadge` from `components/player/TierBadge.tsx`; `ChampionEntry` from `lib/hall-of-fame/awards.ts`.
- Produces:
  - `AwardCard(props: { label: string; icon: string; name: string; metricLabel: string; metricValue: string | number; tier?: string | null })`
  - `ChampionCard(props: { entry: ChampionEntry })`

- [ ] **Step 1: Create `AwardCard.tsx`**

```tsx
import { TierBadge } from '@/components/player/TierBadge'

export function AwardCard({
  label,
  icon,
  name,
  metricLabel,
  metricValue,
  tier,
}: {
  label: string
  icon: string
  name: string
  metricLabel: string
  metricValue: string | number
  tier?: string | null
}) {
  const initial = (name[0] ?? '?').toUpperCase()
  return (
    <div className="flex-1 rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <p className="text-xs font-bold uppercase tracking-widest text-violet-400/80">
        {icon} {label}
      </p>
      <div className="mt-4 flex items-center gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-slate-700 text-base font-bold text-white">
          {initial}
        </div>
        <div className="min-w-0">
          <p className="truncate text-lg font-black leading-tight text-white">{name}</p>
          {tier !== undefined && <TierBadge tier={tier ?? null} />}
        </div>
      </div>
      <div className="mt-4 flex items-baseline gap-1.5">
        <span className="text-2xl font-black text-white">{metricValue}</span>
        <span className="text-xs text-slate-400">{metricLabel}</span>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create `ChampionCard.tsx`**

```tsx
import Link from 'next/link'
import type { ChampionEntry } from '@/lib/hall-of-fame/awards'

function formatDate(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
}

export function ChampionCard({ entry }: { entry: ChampionEntry }) {
  const initial = (entry.champion.name[0] ?? '?').toUpperCase()
  const date = formatDate(entry.date)
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-lg">
        🏆
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-700 text-[11px] font-bold text-white">
            {initial}
          </div>
          <p className="truncate font-black text-white">{entry.champion.name}</p>
        </div>
        <Link
          href={`/tournaments/${entry.slug}`}
          className="mt-1 block truncate text-sm text-violet-400 hover:text-violet-300"
        >
          {entry.title}
        </Link>
        <p className="mt-0.5 text-xs text-slate-500">
          {entry.gameName ?? 'Champion'}
          {date ? ` · ${date}` : ''}
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/hall-of-fame/AwardCard.tsx components/hall-of-fame/ChampionCard.tsx
git commit -m "$(cat <<'EOF'
feat: Hall of Fame AwardCard + ChampionCard components

Initial-circle avatars (codebase convention), tournament links only.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Hall of Fame page + wiring

Assemble the Server Component: query, map into helpers, render sections with real empty states, add metadata, and mark the roadmap task done.

**Files:**
- Create: `app/(public)/hall-of-fame/page.tsx`
- Modify: `ROADMAP.md:19` (task #7 status ⬜ → ✅)

**Interfaces:**
- Consumes: `createClient` (`lib/supabase/server.ts`), `RANKING_MIN_MATCHES` + `PlayerStatsInput` (`lib/rankings/leaderboard.ts`), `pickMVP`/`pickGoldenBoot`/`deriveChampions`/`ChampionInput` (`lib/hall-of-fame/awards.ts`), `BracketMatch` (`lib/tournaments/bracket.ts`), `AwardCard`, `ChampionCard`, `EmptyState`.

- [ ] **Step 1: Create the page**

Create `app/(public)/hall-of-fame/page.tsx`:

```tsx
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { RANKING_MIN_MATCHES, type PlayerStatsInput } from '@/lib/rankings/leaderboard'
import {
  pickMVP,
  pickGoldenBoot,
  deriveChampions,
  type ChampionInput,
} from '@/lib/hall-of-fame/awards'
import type { BracketMatch } from '@/lib/tournaments/bracket'
import { AwardCard } from '@/components/hall-of-fame/AwardCard'
import { ChampionCard } from '@/components/hall-of-fame/ChampionCard'
import { EmptyState } from '@/components/shared/EmptyState'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sentinelx.gg'

export const metadata: Metadata = {
  title: 'Hall of Fame — Sentinel X',
  description:
    "Sentinel X champions, MVP, and Golden Boot — the all-time honors of Nigeria's home of mobile esports.",
  openGraph: {
    title: 'Hall of Fame — Sentinel X',
    description: 'Champions, MVP, and Golden Boot — the all-time honors of Sentinel X.',
    url: `${SITE_URL}/hall-of-fame`,
    siteName: 'Sentinel X',
    type: 'website',
  },
}

type ProfileRef = { id?: string; username: string | null; display_name: string | null } | null

function nameOf(p: ProfileRef): string {
  return p?.display_name ?? p?.username ?? 'TBD'
}

// Supabase to-one embeds can arrive as an object or a single-element array; normalize.
function firstGameName(games: unknown): string | null {
  if (Array.isArray(games)) return (games[0] as { name?: string } | undefined)?.name ?? null
  return (games as { name?: string } | null)?.name ?? null
}

export default async function HallOfFamePage() {
  const supabase = createClient()

  // Awards: eligible profiles. Champions: completed tournaments + their completed finals.
  const [{ data: profileRows }, { data: tournamentRows }] = await Promise.all([
    supabase
      .from('profiles')
      .select(
        'id, username, display_name, avatar_url, country, wins, losses, total_matches, goals_scored, goals_conceded, total_titles, sentinel_score, sentinel_tier',
      )
      .gte('total_matches', RANKING_MIN_MATCHES)
      .limit(500),
    supabase
      .from('tournaments')
      .select('id, slug, title, tournament_end, games(name)')
      .eq('status', 'completed'),
  ])

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
    totalTitles: p.total_titles,
    sentinelScore: p.sentinel_score,
    sentinelTier: p.sentinel_tier,
  }))

  const mvp = pickMVP(players)
  const goldenBoot = pickGoldenBoot(players)

  // Fetch completed final matches for the completed tournaments, then attach to each.
  const tournaments = (tournamentRows ?? []) as unknown as {
    id: string
    slug: string
    title: string
    tournament_end: string | null
    games: unknown
  }[]
  const tournamentIds = tournaments.map((t) => t.id)

  const { data: finalRows } =
    tournamentIds.length > 0
      ? await supabase
          .from('matches')
          .select(
            'id, tournament_id, round, status, score_a, score_b, ' +
              'player_a:profiles!matches_player_a_id_fkey(id, username, display_name), ' +
              'player_b:profiles!matches_player_b_id_fkey(id, username, display_name)',
          )
          .in('tournament_id', tournamentIds)
          .eq('round', 'final')
          .eq('status', 'completed')
      : { data: [] as unknown[] }

  // Map tournament_id -> its completed final as a BracketMatch.
  const finalByTournament = new Map<string, BracketMatch>()
  for (const raw of (finalRows as unknown[] | null) ?? []) {
    const m = raw as {
      id: string
      tournament_id: string
      round: string
      status: string
      score_a: number | null
      score_b: number | null
      player_a: ProfileRef
      player_b: ProfileRef
    }
    finalByTournament.set(m.tournament_id, {
      id: m.id,
      round: m.round,
      group_id: null,
      groupName: null,
      status: m.status,
      score_a: m.score_a,
      score_b: m.score_b,
      scheduled_at: null,
      playerA: { id: m.player_a?.id ?? '', name: nameOf(m.player_a) },
      playerB: { id: m.player_b?.id ?? '', name: nameOf(m.player_b) },
    })
  }

  const championInputs: ChampionInput[] = tournaments.map((t) => ({
    tournamentId: t.id,
    slug: t.slug,
    title: t.title,
    gameName: firstGameName(t.games),
    tournamentEnd: t.tournament_end,
    finalMatch: finalByTournament.get(t.id) ?? null,
  }))
  const champions = deriveChampions(championInputs)

  const hasAwards = mvp != null || goldenBoot != null
  const hasChampions = champions.length > 0

  return (
    <div className="mx-auto max-w-3xl px-4 pb-20">
      <div className="py-8">
        <h1 className="text-2xl font-black text-white">Hall of Fame</h1>
        <p className="mt-1 text-sm text-slate-400">
          Champions, MVP, and the Golden Boot — Sentinel X&apos;s all-time honors.
        </p>
      </div>

      {!hasAwards && !hasChampions ? (
        <EmptyState
          icon="🏆"
          title="The Hall of Fame awaits its first legends"
          body="Champions and awards appear here once tournaments are played and won."
        />
      ) : (
        <>
          <section className="mb-10">
            <h2 className="mb-4 text-base font-bold text-white">🏅 Awards</h2>
            {hasAwards ? (
              <div className="flex flex-col gap-4 sm:flex-row">
                {mvp && (
                  <AwardCard
                    label="MVP"
                    icon="⭐"
                    name={mvp.displayName ?? mvp.username ?? 'Anonymous'}
                    metricLabel="Sentinel Score"
                    metricValue={mvp.sentinelScore}
                    tier={mvp.sentinelTier}
                  />
                )}
                {goldenBoot && (
                  <AwardCard
                    label="Golden Boot"
                    icon="👟"
                    name={goldenBoot.displayName ?? goldenBoot.username ?? 'Anonymous'}
                    metricLabel="goals scored"
                    metricValue={goldenBoot.goalsScored}
                  />
                )}
              </div>
            ) : (
              <EmptyState
                icon="🏅"
                title="Awards unlock once matches are played"
                body="MVP and the Golden Boot are decided from completed matches."
              />
            )}
          </section>

          <section className="mb-10">
            <h2 className="mb-4 text-base font-bold text-white">🏆 Champions</h2>
            {hasChampions ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {champions.map((c) => (
                  <ChampionCard key={c.tournamentId} entry={c} />
                ))}
              </div>
            ) : (
              <EmptyState
                icon="🏆"
                title="No champions crowned yet"
                body="Winners appear here when tournaments finish and finals are confirmed."
              />
            )}
          </section>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no errors for the new files (warnings tolerated only if pre-existing elsewhere).

- [ ] **Step 4: Full test suite**

Run: `npx vitest run`
Expected: PASS — all suites including the new awards tests.

- [ ] **Step 5: Production build**

Run: `npm run build`
Expected: build succeeds and `/hall-of-fame` appears in the route list as a static/server page.

- [ ] **Step 6: Mark the roadmap task done**

In `ROADMAP.md`, change the task #7 row (line 19) status from `⬜` to `✅`:

```markdown
| 7 | Hall of Fame | `/hall-of-fame` | ✅ |
```

- [ ] **Step 7: Commit**

```bash
git add "app/(public)/hall-of-fame/page.tsx" ROADMAP.md
git commit -m "$(cat <<'EOF'
feat: Hall of Fame page (v1.0 #7)

All-time Champions wall (from completed tournament finals), MVP, and
Golden Boot with per-section empty states. Marks roadmap #7 done.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- Champions wall (completed tournaments + completed final, `getChampion` reuse, most-recent-first, tournament-linked, un-linked names) → Tasks 3 + 5. ✅
- MVP (Sentinel Score, wins/win-rate tiebreak, flat-70 → wins) → Task 2. ✅
- Golden Boot (goals, wins tiebreak) → Task 2. ✅
- Best Goal deferred → not built (correct). ✅
- Shared eligibility gate `total_matches >= 1`, defined once, rankings refactored onto it → Task 1. ✅
- `lib/hall-of-fame/awards.ts` pure/unit-tested; components in `components/hall-of-fame/`; reuse `TierBadge` + `EmptyState` → Tasks 2–5. ✅
- Per-section + whole-page empty states, no "coming soon" → Task 5. ✅
- `generateMetadata`/OpenGraph → Task 5 (static `metadata` export, matching the rankings page which also uses a static export). ✅
- Vitest coverage for MVP/Golden Boot tiebreaks + `deriveChampions` skip/order/empty → Tasks 2, 3. ✅
- Initial-circle avatars, tournament link only, mobile-first → Tasks 4, 5. ✅
- No per-page WhatsApp share (matches rankings) → honored (page has none). ✅

**Placeholder scan:** No "TBD"/"handle edge cases"/"similar to" — every code step contains full code. ✅

**Type consistency:** `pickMVP`/`pickGoldenBoot` return `PlayerStatsInput | null` (consumed in Task 5 via `.displayName`/`.sentinelScore`/`.goalsScored`/`.sentinelTier` — all real `PlayerStatsInput` fields). `deriveChampions` returns `ChampionEntry[]` consumed by `ChampionCard` (`entry.champion.name`, `entry.slug`, `entry.title`, `entry.gameName`, `entry.date` — all match). `ChampionInput` fields built in Task 5 match Task 3's definition. `BracketMatch` shape built in Task 5 matches `lib/tournaments/bracket.ts`. `RANKING_MIN_MATCHES` used in Tasks 1 + 5. ✅

Note: the spec calls `metadata` "`generateMetadata` + OpenGraph"; the rankings page it mirrors uses a static `metadata` export (the page has no dynamic params), so the plan uses a static export — functionally equivalent, matches the sibling page.
