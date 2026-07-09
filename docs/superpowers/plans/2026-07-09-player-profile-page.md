# Player Profile Page (#10b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the public `/players/[username]` profile — identity, Sentinel Score/tier, leaderboard-consistent rank, stats, achievements, and recent match history — over the data #10a populates, and wire it into the app.

**Architecture:** A server component fetches the profile by username (404 if missing), the rank (one Postgres function), recent matches, and titles; pure helpers in `lib/players/profile.ts` transform/format (unit-tested); four presentational components render the sections. Rank matches the `/rankings` order exactly via a `player_rank()` SQL function.

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind, Supabase (server client + RPC), Vitest.

## Global Constraints

- Mobile-first (375px up). Reuse `Avatar`, `TierBadge`, `EmptyState`.
- Rank must equal the player's `/rankings` position: order is **wins → win rate → titles → goal difference** (`rankPlayers` in `lib/rankings/leaderboard.ts`). The SQL tiebreak mirrors it — keep both in sync.
- Titles reuse `getChampion` from `lib/tournaments/bracket` — never reimplement the winner rule.
- Dates render via `lib/format` WAT helpers (`formatDate`, `formatMonthYear`).
- Username lookup is exact-match; unknown → `notFound()`.
- SEO: `generateMetadata` + OpenGraph + inline JSON-LD (required by CLAUDE.md for player pages).
- Tests: Vitest, colocated `*.test.ts`; run one file with `npx vitest run <path>`.

---

### Task 1: Rank Postgres function + types

**Files:**
- Create: `supabase/migrations/009_player_rank.sql`
- Modify: `lib/supabase/types.ts` (regenerated)

**Interfaces:**
- Produces: `supabase.rpc('player_rank', { uname })` → `number | null` (null = unranked/unknown). Consumed by Task 4.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/009_player_rank.sql`:

```sql
-- Rank of a player among eligible players (total_matches >= 1), matching the
-- /rankings order: wins → win rate → titles → goal difference. Returns NULL for
-- an unranked player (0 matches) or unknown username.
-- NOTE: this tiebreak MUST mirror rankPlayers() in lib/rankings/leaderboard.ts.
CREATE OR REPLACE FUNCTION public.player_rank(uname text)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  WITH p AS (
    SELECT wins, total_matches, total_titles, goals_scored, goals_conceded
    FROM public.profiles
    WHERE username = uname
  )
  SELECT CASE
    WHEN p.total_matches < 1 THEN NULL
    ELSE (
      SELECT count(*) + 1
      FROM public.profiles o, p
      WHERE o.total_matches >= 1
        AND (
          o.wins > p.wins
          OR (o.wins = p.wins
              AND o.wins::float / o.total_matches > p.wins::float / p.total_matches)
          OR (o.wins = p.wins
              AND o.wins::float / o.total_matches = p.wins::float / p.total_matches
              AND o.total_titles > p.total_titles)
          OR (o.wins = p.wins
              AND o.wins::float / o.total_matches = p.wins::float / p.total_matches
              AND o.total_titles = p.total_titles
              AND (o.goals_scored - o.goals_conceded) > (p.goals_scored - p.goals_conceded))
        )
    )
  END
  FROM p;
$$;
```

- [ ] **Step 2: Apply to the live project**

Apply via Supabase MCP `apply_migration` (name: `player_rank`, the SQL above).

- [ ] **Step 3: Verify the function**

Run via MCP `execute_sql`:
```sql
SELECT public.player_rank('rexorokumue') AS rank;
```
Expected: a row returns (an integer, or `null` if that player has 0 matches / doesn't exist). No error.

- [ ] **Step 4: Regenerate TypeScript types**

Run Supabase MCP `generate_typescript_types` for project `itxubrkbropttfdackmi` and overwrite `lib/supabase/types.ts` with the result, so `player_rank` appears under `Database['public']['Functions']` and the `.rpc()` call type-checks.

- [ ] **Step 5: Type-check + commit**

Run: `npx tsc --noEmit` → no errors.

```bash
git add supabase/migrations/009_player_rank.sql lib/supabase/types.ts
git commit -m "feat: player_rank() leaderboard-consistent rank function (#10b)"
```

---

### Task 2: Pure helpers + view types

**Files:**
- Create: `lib/players/profile.ts`
- Test: `lib/players/profile.test.ts`

**Interfaces:**
- Produces:
  - `winPercent(wins: number, total: number): string`
  - `goalDifference(scored: number, conceded: number): number`
  - `matchOutcome(playerId: string, m: MatchSides): 'win' | 'loss' | 'draw'`
  - Types `ProfileView`, `ProfileMatch`, `ProfileTitle`, `MatchSides`. Consumed by Tasks 3, 4.

- [ ] **Step 1: Write the failing test**

Create `lib/players/profile.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { winPercent, goalDifference, matchOutcome } from './profile'

describe('winPercent', () => {
  it('rounds wins over total to a percent', () => {
    expect(winPercent(2, 3)).toBe('67%')
    expect(winPercent(1, 1)).toBe('100%')
  })
  it('is 0% with no matches', () => {
    expect(winPercent(0, 0)).toBe('0%')
  })
})

describe('goalDifference', () => {
  it('subtracts conceded from scored', () => {
    expect(goalDifference(9, 4)).toBe(5)
    expect(goalDifference(2, 6)).toBe(-4)
  })
})

describe('matchOutcome', () => {
  const m = { player_a_id: 'A', player_b_id: 'B', score_a: 3, score_b: 1 }
  it('reads from the player perspective (A)', () => {
    expect(matchOutcome('A', m)).toBe('win')
  })
  it('reads from the player perspective (B)', () => {
    expect(matchOutcome('B', m)).toBe('loss')
  })
  it('detects a draw', () => {
    expect(matchOutcome('A', { ...m, score_a: 2, score_b: 2 })).toBe('draw')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/players/profile.test.ts`
Expected: FAIL — cannot resolve `./profile`.

- [ ] **Step 3: Write the implementation**

Create `lib/players/profile.ts`:

```ts
export interface MatchSides {
  player_a_id: string
  player_b_id: string
  score_a: number
  score_b: number
}

export interface ProfileView {
  id: string
  username: string
  displayName: string | null
  avatarUrl: string | null
  country: string | null
  createdAt: string | null
  sentinelScore: number
  sentinelTier: string | null
  totalMatches: number
  wins: number
  losses: number
  goalsScored: number
  goalsConceded: number
  totalTitles: number
  rank: number | null // null = unranked
}

export interface ProfileMatch {
  id: string
  opponentName: string
  playerScore: number
  opponentScore: number
  outcome: 'win' | 'loss' | 'draw'
  tournamentTitle: string | null
  completedAt: string | null
}

export interface ProfileTitle {
  tournamentTitle: string
  tournamentSlug: string
  gameName: string | null
  date: string | null
}

export function winPercent(wins: number, total: number): string {
  if (total <= 0) return '0%'
  return `${Math.round((wins / total) * 100)}%`
}

export function goalDifference(scored: number, conceded: number): number {
  return scored - conceded
}

export function matchOutcome(playerId: string, m: MatchSides): 'win' | 'loss' | 'draw' {
  const isA = m.player_a_id === playerId
  const mine = isA ? m.score_a : m.score_b
  const theirs = isA ? m.score_b : m.score_a
  if (mine > theirs) return 'win'
  if (mine < theirs) return 'loss'
  return 'draw'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/players/profile.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/players/profile.ts lib/players/profile.test.ts
git commit -m "feat: player profile helpers + view types (#10b)"
```

---

### Task 3: Profile section components

**Files:**
- Create: `components/player/ProfileHeader.tsx`
- Create: `components/player/ProfileStats.tsx`
- Create: `components/player/ProfileAchievements.tsx`
- Create: `components/player/ProfileMatchHistory.tsx`

**Interfaces:**
- Consumes: `ProfileView`, `ProfileMatch`, `ProfileTitle` (Task 2); `winPercent`, `goalDifference` (Task 2); `Avatar`, `TierBadge`, `EmptyState`; `formatDate`, `formatMonthYear` (`lib/format`).
- Produces: `<ProfileHeader profile />`, `<ProfileStats profile />`, `<ProfileAchievements titles />`, `<ProfileMatchHistory matches />`. Consumed by Task 4.

- [ ] **Step 1: ProfileHeader**

Create `components/player/ProfileHeader.tsx`:

```tsx
import { Avatar } from '@/components/shared/Avatar'
import { TierBadge } from '@/components/player/TierBadge'
import { formatMonthYear } from '@/lib/format'
import type { ProfileView } from '@/lib/players/profile'

export function ProfileHeader({ profile }: { profile: ProfileView }) {
  const name = profile.displayName ?? profile.username
  const since = formatMonthYear(profile.createdAt)
  return (
    <header className="flex flex-col items-center gap-3 py-8 text-center sm:flex-row sm:items-center sm:gap-5 sm:text-left">
      <Avatar
        avatarUrl={profile.avatarUrl}
        displayName={profile.displayName}
        username={profile.username}
        size={72}
        className="text-2xl"
      />
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-2xl font-black text-white">{name}</h1>
        <p className="text-sm text-slate-400">
          @{profile.username}
          {profile.country ? ` · ${profile.country}` : ''}
          {since ? ` · since ${since}` : ''}
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-3 sm:justify-start">
          <span className="rounded-lg bg-slate-800 px-3 py-1 text-sm font-bold text-white">
            {profile.sentinelScore}
            <span className="text-slate-500">/100</span>
          </span>
          <TierBadge tier={profile.sentinelTier} />
          <span className="text-sm font-semibold text-violet-400">
            {profile.rank != null ? `Ranked #${profile.rank}` : 'Unranked'}
          </span>
        </div>
      </div>
    </header>
  )
}
```

- [ ] **Step 2: ProfileStats**

Create `components/player/ProfileStats.tsx`:

```tsx
import { winPercent, goalDifference } from '@/lib/players/profile'
import type { ProfileView } from '@/lib/players/profile'

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-3 text-center">
      <p className="text-lg font-black text-white">{value}</p>
      <p className="mt-0.5 text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
    </div>
  )
}

export function ProfileStats({ profile }: { profile: ProfileView }) {
  const gd = goalDifference(profile.goalsScored, profile.goalsConceded)
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-base font-bold text-white">Stats</h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Matches" value={profile.totalMatches} />
        <Stat label="Wins" value={profile.wins} />
        <Stat label="Losses" value={profile.losses} />
        <Stat label="Win rate" value={winPercent(profile.wins, profile.totalMatches)} />
        <Stat label="Goals for" value={profile.goalsScored} />
        <Stat label="Goals against" value={profile.goalsConceded} />
        <Stat label="Goal diff" value={gd > 0 ? `+${gd}` : gd} />
        <Stat label="Titles" value={profile.totalTitles} />
      </div>
    </section>
  )
}
```

- [ ] **Step 3: ProfileAchievements**

Create `components/player/ProfileAchievements.tsx`:

```tsx
import Link from 'next/link'
import { EmptyState } from '@/components/shared/EmptyState'
import { formatMonthYear } from '@/lib/format'
import type { ProfileTitle } from '@/lib/players/profile'

export function ProfileAchievements({ titles }: { titles: ProfileTitle[] }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-base font-bold text-white">Achievements</h2>
      {titles.length === 0 ? (
        <EmptyState icon="🏆" title="No titles yet" body="Win a tournament to claim your first title." />
      ) : (
        <div className="space-y-2">
          {titles.map((t) => {
            const date = formatMonthYear(t.date)
            return (
              <Link
                key={t.tournamentSlug}
                href={`/tournaments/${t.tournamentSlug}`}
                className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4 transition-colors hover:border-violet-500/40"
              >
                <span className="text-2xl">🏆</span>
                <div className="min-w-0">
                  <p className="truncate font-bold text-white">{t.tournamentTitle}</p>
                  <p className="text-xs text-slate-500">
                    Champion{t.gameName ? ` · ${t.gameName}` : ''}{date ? ` · ${date}` : ''}
                  </p>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 4: ProfileMatchHistory**

Create `components/player/ProfileMatchHistory.tsx`:

```tsx
import Link from 'next/link'
import { EmptyState } from '@/components/shared/EmptyState'
import { formatDate } from '@/lib/format'
import type { ProfileMatch } from '@/lib/players/profile'

const OUTCOME: Record<string, { label: string; cls: string }> = {
  win: { label: 'W', cls: 'bg-emerald-500/20 text-emerald-400' },
  loss: { label: 'L', cls: 'bg-red-500/20 text-red-400' },
  draw: { label: 'D', cls: 'bg-slate-600/40 text-slate-300' },
}

export function ProfileMatchHistory({ matches }: { matches: ProfileMatch[] }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-base font-bold text-white">Recent matches</h2>
      {matches.length === 0 ? (
        <EmptyState icon="🎮" title="No matches yet" body="Completed matches will show up here." />
      ) : (
        <div className="space-y-2">
          {matches.map((m) => {
            const o = OUTCOME[m.outcome]
            const when = formatDate(m.completedAt)
            return (
              <Link
                key={m.id}
                href={`/matches/${m.id}`}
                className="flex items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4 transition-colors hover:border-slate-600"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${o.cls}`}>
                    {o.label}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-white">vs {m.opponentName}</p>
                    <p className="truncate text-xs text-slate-500">
                      {m.tournamentTitle ?? 'Match'}{when ? ` · ${when}` : ''}
                    </p>
                  </div>
                </div>
                <span className="shrink-0 font-bold tabular-nums text-white">
                  {m.playerScore}–{m.opponentScore}
                </span>
              </Link>
            )
          })}
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 5: Build + commit**

Run: `npm run build`
Expected: compiles (components unused until Task 4 — that's fine).

```bash
git add components/player/ProfileHeader.tsx components/player/ProfileStats.tsx components/player/ProfileAchievements.tsx components/player/ProfileMatchHistory.tsx
git commit -m "feat: player profile section components (#10b)"
```

---

### Task 4: The profile page (data + SEO)

**Files:**
- Create: `app/(public)/players/[username]/page.tsx`
- Delete: `app/(public)/players/[username]/.gitkeep`

**Interfaces:**
- Consumes: everything from Tasks 1–3, plus `createClient` (`@/lib/supabase/server`), `getChampion`/`BracketMatch` (`@/lib/tournaments/bracket`), `matchOutcome` (Task 2).

- [ ] **Step 1: Write the page**

Create `app/(public)/players/[username]/page.tsx`:

```tsx
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getChampion, type BracketMatch } from '@/lib/tournaments/bracket'
import { matchOutcome, type ProfileView, type ProfileMatch, type ProfileTitle } from '@/lib/players/profile'
import { ProfileHeader } from '@/components/player/ProfileHeader'
import { ProfileStats } from '@/components/player/ProfileStats'
import { ProfileAchievements } from '@/components/player/ProfileAchievements'
import { ProfileMatchHistory } from '@/components/player/ProfileMatchHistory'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sentinelx.gg'
const PROFILE_COLS =
  'id, username, display_name, avatar_url, country, created_at, sentinel_score, sentinel_tier, ' +
  'total_matches, wins, losses, goals_scored, goals_conceded, total_titles'

type ProfileRow = {
  id: string
  username: string
  display_name: string | null
  avatar_url: string | null
  country: string | null
  created_at: string | null
  sentinel_score: number
  sentinel_tier: string | null
  total_matches: number
  wins: number
  losses: number
  goals_scored: number
  goals_conceded: number
  total_titles: number
}

type NameRef = { username: string | null; display_name: string | null } | { username: string | null; display_name: string | null }[] | null
function firstName(x: NameRef): string {
  const r = Array.isArray(x) ? x[0] ?? null : x
  return r?.display_name ?? r?.username ?? 'TBD'
}
type TitleRef = { title: string; slug: string; tournament_end: string | null; game: { name: string } | { name: string }[] | null } | { title: string; slug: string; tournament_end: string | null; game: { name: string } | { name: string }[] | null }[] | null
function firstTitle(x: TitleRef) {
  return Array.isArray(x) ? x[0] ?? null : x
}
function gameName(g: { name: string } | { name: string }[] | null): string | null {
  const r = Array.isArray(g) ? g[0] ?? null : g
  return r?.name ?? null
}

async function loadProfile(username: string): Promise<ProfileRow | null> {
  const supabase = createClient()
  const { data } = await supabase.from('profiles').select(PROFILE_COLS).eq('username', username).maybeSingle()
  return (data as ProfileRow | null) ?? null
}

export async function generateMetadata({ params }: { params: { username: string } }): Promise<Metadata> {
  const p = await loadProfile(params.username)
  if (!p) return { title: 'Player not found — SentinelX Esports' }
  const name = p.display_name ?? p.username
  const title = `${name} (@${p.username}) — SentinelX Esports`
  const description = `Sentinel Score ${p.sentinel_score} · ${p.wins}W–${p.losses}L · ${p.total_titles} titles on Sentinel X.`
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `${SITE_URL}/players/${p.username}`,
      siteName: 'SentinelX Esports',
      type: 'profile',
    },
  }
}

export default async function PlayerProfilePage({ params }: { params: { username: string } }) {
  const supabase = createClient()
  const p = await loadProfile(params.username)
  if (!p) notFound()

  const [{ data: rankData }, { data: rawMatches }, { data: rawFinals }] = await Promise.all([
    supabase.rpc('player_rank', { uname: p.username }),
    supabase
      .from('matches')
      .select(
        'id, score_a, score_b, completed_at, player_a_id, player_b_id, ' +
          'tournament:tournaments(title), ' +
          'player_a:profiles!matches_player_a_id_fkey(username, display_name), ' +
          'player_b:profiles!matches_player_b_id_fkey(username, display_name)',
      )
      .eq('status', 'completed')
      .or(`player_a_id.eq.${p.id},player_b_id.eq.${p.id}`)
      .order('completed_at', { ascending: false })
      .limit(10),
    supabase
      .from('matches')
      .select(
        'round, status, score_a, score_b, player_a_id, player_b_id, ' +
          'tournament:tournaments(title, slug, tournament_end, game:games(name))',
      )
      .eq('round', 'final')
      .eq('status', 'completed')
      .or(`player_a_id.eq.${p.id},player_b_id.eq.${p.id}`),
  ])

  const profile: ProfileView = {
    id: p.id,
    username: p.username,
    displayName: p.display_name,
    avatarUrl: p.avatar_url,
    country: p.country,
    createdAt: p.created_at,
    sentinelScore: p.sentinel_score,
    sentinelTier: p.sentinel_tier,
    totalMatches: p.total_matches,
    wins: p.wins,
    losses: p.losses,
    goalsScored: p.goals_scored,
    goalsConceded: p.goals_conceded,
    totalTitles: p.total_titles,
    rank: (rankData as number | null) ?? null,
  }

  const matches: ProfileMatch[] = (rawMatches ?? [])
    .filter((m) => m.player_a_id && m.player_b_id && m.score_a != null && m.score_b != null)
    .map((m) => {
      const isA = m.player_a_id === p.id
      return {
        id: m.id,
        opponentName: firstName(isA ? (m.player_b as NameRef) : (m.player_a as NameRef)),
        playerScore: (isA ? m.score_a : m.score_b) as number,
        opponentScore: (isA ? m.score_b : m.score_a) as number,
        outcome: matchOutcome(p.id, {
          player_a_id: m.player_a_id as string,
          player_b_id: m.player_b_id as string,
          score_a: m.score_a as number,
          score_b: m.score_b as number,
        }),
        tournamentTitle: firstTitleName(m.tournament as { title: string } | { title: string }[] | null),
        completedAt: m.completed_at,
      }
    })

  const titles: ProfileTitle[] = (rawFinals ?? [])
    .filter((f) => {
      const champ = getChampion([toBracketFinal(f)])
      return champ?.id === p.id
    })
    .map((f) => {
      const t = firstTitle(f.tournament as TitleRef)
      return {
        tournamentTitle: t?.title ?? 'Tournament',
        tournamentSlug: t?.slug ?? '',
        gameName: gameName(t?.game ?? null),
        date: t?.tournament_end ?? null,
      }
    })

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    mainEntity: {
      '@type': 'Person',
      name: p.display_name ?? p.username,
      alternateName: p.username,
      url: `${SITE_URL}/players/${p.username}`,
    },
  }

  return (
    <div className="mx-auto max-w-2xl px-4 pb-20">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <ProfileHeader profile={profile} />
      <ProfileStats profile={profile} />
      <ProfileAchievements titles={titles} />
      <ProfileMatchHistory matches={matches} />
    </div>
  )
}

function firstTitleName(x: { title: string } | { title: string }[] | null): string | null {
  const r = Array.isArray(x) ? x[0] ?? null : x
  return r?.title ?? null
}

function toBracketFinal(f: {
  round: string
  status: string
  score_a: number | null
  score_b: number | null
  player_a_id: string | null
  player_b_id: string | null
}): BracketMatch {
  return {
    id: '',
    round: f.round,
    group_id: null,
    groupName: null,
    status: f.status,
    score_a: f.score_a,
    score_b: f.score_b,
    scheduled_at: null,
    playerA: { id: f.player_a_id ?? '', name: '' },
    playerB: { id: f.player_b_id ?? '', name: '' },
  }
}
```

- [ ] **Step 2: Remove the route stub**

```bash
git rm "app/(public)/players/[username]/.gitkeep"
```

- [ ] **Step 3: Build**

Run: `npx tsc --noEmit && npm run build`
Expected: compiles; `/players/[username]` appears in the route list.

- [ ] **Step 4: Commit**

```bash
git add "app/(public)/players/[username]/page.tsx"
git commit -m "feat: player profile page — data, sections, SEO/JSON-LD (#10b)"
```

---

### Task 5: Wire the profile into the app

**Files:**
- Modify: `components/shared/AccountMenu.tsx`
- Modify: `components/rankings/LeaderboardTable.tsx`

**Interfaces:** consumes the profile route `/players/[username]`.

- [ ] **Step 1: Point "My Profile" at the real profile**

In `components/shared/AccountMenu.tsx`, replace:

```tsx
          {/* My Profile → /players/[username] once #10b ships; /dashboard until then */}
          <MenuLink href="/dashboard" onNavigate={() => setOpen(false)}>My Profile</MenuLink>
```

with:

```tsx
          <MenuLink
            href={session.username ? `/players/${session.username}` : '/dashboard'}
            onNavigate={() => setOpen(false)}
          >
            My Profile
          </MenuLink>
```

- [ ] **Step 2: Link leaderboard names to profiles**

In `components/rankings/LeaderboardTable.tsx`, add the import at the top:

```tsx
import Link from 'next/link'
```

Then replace the name paragraph:

```tsx
                      <p className="truncate font-semibold leading-tight text-white">
                        {name}
                        {isMe && <span className="ml-1 text-[11px] text-violet-400">(you)</span>}
                      </p>
```

with a version that links when a username exists:

```tsx
                      <p className="truncate font-semibold leading-tight text-white">
                        {pl.username ? (
                          <Link href={`/players/${pl.username}`} className="hover:text-violet-300">
                            {name}
                          </Link>
                        ) : (
                          name
                        )}
                        {isMe && <span className="ml-1 text-[11px] text-violet-400">(you)</span>}
                      </p>
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: compiles.

- [ ] **Step 4: Commit**

```bash
git add components/shared/AccountMenu.tsx components/rankings/LeaderboardTable.tsx
git commit -m "feat: link My Profile + leaderboard names to /players/[username] (#10b)"
```

---

### Task 6: Full verification + push

**Files:** none.

- [ ] **Step 1: Full test + build gate**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: all tests pass (incl. `lib/players/profile.test.ts`), no type errors, build lists `/players/[username]`.

- [ ] **Step 2: Confirm the rank function against live data**

Via Supabase MCP `execute_sql`, spot-check the function returns a value consistent with `/rankings` for a known player (or `null` when everyone has 0 matches — the current live state, in which case profiles correctly show "Unranked"):
```sql
SELECT username, wins, total_matches, public.player_rank(username) AS rank
FROM public.profiles ORDER BY wins DESC LIMIT 5;
```

- [ ] **Step 3: Push**

```bash
git push origin main
```

---

## Self-Review

- **Spec coverage:** §2 route/loading → Task 4; §3 rank function → Task 1, consumed Task 4; §4 four components → Task 3, assembled Task 4; §5 SEO/JSON-LD → Task 4; §6 pure helpers + tests → Task 2; §7 wiring (AccountMenu + leaderboard links) → Task 5; §8 scope respected (no score-history/edit/per-game). All covered.
- **Placeholder scan:** none — every code step is complete. The one seam ("My Profile" → dashboard fallback) is real behavior, not a placeholder.
- **Type consistency:** `ProfileView`/`ProfileMatch`/`ProfileTitle`/`MatchSides` defined in Task 2 are consumed with identical field names in Tasks 3–4. `matchOutcome(playerId, MatchSides)` call in Task 4 matches its Task 2 signature. `getChampion(BracketMatch[])` shaped via `toBracketFinal` matches the existing `lib/tournaments/bracket` interface. `supabase.rpc('player_rank', { uname })` matches the Task 1 function name/param. `pl.username` used in Task 5 exists on `RankedPlayer` (extends `PlayerStatsInput`).
- **Note on Supabase embedded joins:** one-to-one embeds (`tournament:tournaments(...)`, `player_a:profiles!fk(...)`) may type as object or array depending on the relationship inference; the `first*`/`Array.isArray` guards in Task 4 handle both, matching the pattern already used in the dashboard and admin pages.
