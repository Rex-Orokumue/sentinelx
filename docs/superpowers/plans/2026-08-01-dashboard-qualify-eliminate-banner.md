# Dashboard Qualify/Eliminate Banner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show every player, on their own dashboard, whether they qualified for the knockout stage or were eliminated — for the current state of every tournament they're in, and automatically as future rounds resolve.

**Architecture:** A pure function, `computeTournamentStatus`, derives a qualify/eliminate banner per tournament from data the dashboard already loads (`matches`, `group_memberships`) — no new table, column, or write path. The dashboard page fetches the small amount of extra group data the function needs, calls it once per tournament the player is in, and renders the results as banner cards above the existing "Active matches" fixture list.

**Tech Stack:** Next.js 14 App Router (Server Component), Supabase, TypeScript, Vitest.

**Full design:** `docs/superpowers/specs/2026-08-01-dashboard-qualify-eliminate-banner-design.md`

## Global Constraints

- No new database table, column, or write path — the status is derived live at dashboard render time from existing `matches` and `group_memberships` rows, never stored.
- The banner is suppressed once a tournament's `status` is `'completed'` — a stale "eliminated after Group Stage" card must not linger on a player's dashboard indefinitely.
- The banner is not dismissible and carries no read/unread state — nothing to persist.
- Top-2-per-group advancement (`sortStandings`'s default `advancingCount`) is the only advancement rule — do not special-case any group size.
- Out of scope, do not build: a bell/WhatsApp notification for this event, a "Champion" banner for winning the final, any backfill/migration for tournaments that already resolved before this ships.

---

## Task 1: `computeTournamentStatus` pure function + tests

**Files:**
- Create: `lib/dashboard/tournament-status.ts`
- Test: `lib/dashboard/tournament-status.test.ts`

**Interfaces:**
- Consumes: `sortStandings`, `type MembershipInput` from `lib/tournaments/standings.ts`; `matchWinnerId`, `nextRoundName`, `type AdvanceMatch` from `lib/tournaments/advancement.ts`; `ROUND_ORDER` from `lib/tournaments/bracket.ts`.
- Produces (used by Task 2): `export interface KnockoutMatchInput extends AdvanceMatch { round: string }`, `export interface TournamentStatusInput { tournamentId, tournamentTitle, tournamentSlug, tournamentStatus, groupId, groupComplete, groupStandings, knockoutMatches }`, `export type TournamentBanner = { kind: 'qualified'; tournamentTitle: string; tournamentSlug: string; round: string; awaitingOpponent: boolean } | { kind: 'eliminated'; tournamentTitle: string; tournamentSlug: string; round: string } | null`, `export function computeTournamentStatus(playerId: string, input: TournamentStatusInput): TournamentBanner`.

- [ ] **Step 1: Write the failing tests**

Create `lib/dashboard/tournament-status.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  computeTournamentStatus,
  type TournamentStatusInput,
  type KnockoutMatchInput,
} from './tournament-status'
import type { MembershipInput } from '@/lib/tournaments/standings'

function baseInput(over: Partial<TournamentStatusInput> = {}): TournamentStatusInput {
  return {
    tournamentId: 't1',
    tournamentTitle: 'DLS Cup',
    tournamentSlug: 'dls-cup',
    tournamentStatus: 'active',
    groupId: null,
    groupComplete: false,
    groupStandings: [],
    knockoutMatches: [],
    ...over,
  }
}

function knockoutMatch(over: Partial<KnockoutMatchInput>): KnockoutMatchInput {
  return {
    round: 'round_of_16',
    status: 'completed',
    score_a: 1,
    score_b: 0,
    player_a_id: 'me',
    player_b_id: 'opp',
    ...over,
  }
}

function membership(over: Partial<MembershipInput> & { playerId: string }): MembershipInput {
  return { name: '', wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, points: 0, ...over }
}

describe('computeTournamentStatus', () => {
  it('returns null once the tournament has completed', () => {
    expect(
      computeTournamentStatus(
        'me',
        baseInput({
          tournamentStatus: 'completed',
          groupId: 'g1',
          groupComplete: true,
          groupStandings: [membership({ playerId: 'me', points: 9 })],
        }),
      ),
    ).toBeNull()
  })

  it('returns null with no matches and no group', () => {
    expect(computeTournamentStatus('me', baseInput())).toBeNull()
  })

  it('returns null while the group is still incomplete', () => {
    expect(
      computeTournamentStatus(
        'me',
        baseInput({ groupId: 'g1', groupComplete: false, groupStandings: [membership({ playerId: 'me', points: 3 })] }),
      ),
    ).toBeNull()
  })

  it('qualifies a top-2 finisher once the group is complete', () => {
    const result = computeTournamentStatus(
      'me',
      baseInput({
        groupId: 'g1',
        groupComplete: true,
        groupStandings: [
          membership({ playerId: 'me', points: 9 }),
          membership({ playerId: 'b', points: 6 }),
          membership({ playerId: 'c', points: 3 }),
        ],
      }),
    )
    expect(result).toEqual({
      kind: 'qualified',
      tournamentTitle: 'DLS Cup',
      tournamentSlug: 'dls-cup',
      round: 'knockout stage',
      awaitingOpponent: true,
    })
  })

  it('eliminates a finisher outside the top 2', () => {
    const result = computeTournamentStatus(
      'me',
      baseInput({
        groupId: 'g1',
        groupComplete: true,
        groupStandings: [
          membership({ playerId: 'a', points: 9 }),
          membership({ playerId: 'b', points: 6 }),
          membership({ playerId: 'me', points: 3 }),
        ],
      }),
    )
    expect(result).toEqual({
      kind: 'eliminated',
      tournamentTitle: 'DLS Cup',
      tournamentSlug: 'dls-cup',
      round: 'group',
    })
  })

  it('qualifies with a real opponent already scheduled', () => {
    const result = computeTournamentStatus(
      'me',
      baseInput({
        knockoutMatches: [knockoutMatch({ status: 'scheduled', player_a_id: 'me', score_a: null, score_b: null })],
      }),
    )
    expect(result).toEqual({
      kind: 'qualified',
      tournamentTitle: 'DLS Cup',
      tournamentSlug: 'dls-cup',
      round: 'round_of_16',
      awaitingOpponent: false,
    })
  })

  it('treats a live match the same as scheduled', () => {
    const result = computeTournamentStatus(
      'me',
      baseInput({
        knockoutMatches: [knockoutMatch({ status: 'live', player_a_id: 'me', score_a: null, score_b: null })],
      }),
    )
    expect(result).toMatchObject({ kind: 'qualified', awaitingOpponent: false })
  })

  it('qualifies a bye with no opponent assigned', () => {
    const result = computeTournamentStatus(
      'me',
      baseInput({
        knockoutMatches: [
          knockoutMatch({ status: 'bye', player_a_id: 'me', player_b_id: null, score_a: null, score_b: null }),
        ],
      }),
    )
    expect(result).toEqual({
      kind: 'qualified',
      tournamentTitle: 'DLS Cup',
      tournamentSlug: 'dls-cup',
      round: 'round_of_16',
      awaitingOpponent: true,
    })
  })

  it('qualifies a winner even before the next round is generated', () => {
    // Real production case: Codexempire beat Cristiano 2-0 in round_of_16 while
    // 6 other round_of_16 matches were still scheduled, so no quarter_final row
    // existed for them yet. advanceKnockout waits for the whole round to resolve.
    const result = computeTournamentStatus(
      'me',
      baseInput({
        knockoutMatches: [
          knockoutMatch({ round: 'round_of_16', status: 'completed', player_a_id: 'me', player_b_id: 'opp', score_a: 2, score_b: 0 }),
        ],
      }),
    )
    expect(result).toEqual({
      kind: 'qualified',
      tournamentTitle: 'DLS Cup',
      tournamentSlug: 'dls-cup',
      round: 'quarter_final',
      awaitingOpponent: true,
    })
  })

  it('eliminates a knockout loser', () => {
    const result = computeTournamentStatus(
      'me',
      baseInput({
        knockoutMatches: [knockoutMatch({ player_a_id: 'opp', player_b_id: 'me', score_a: 4, score_b: 1 })],
      }),
    )
    expect(result).toEqual({
      kind: 'eliminated',
      tournamentTitle: 'DLS Cup',
      tournamentSlug: 'dls-cup',
      round: 'round_of_16',
    })
  })

  it('eliminates both players on a forfeited match', () => {
    const result = computeTournamentStatus(
      'me',
      baseInput({ knockoutMatches: [knockoutMatch({ status: 'forfeited', score_a: null, score_b: null })] }),
    )
    expect(result).toEqual({
      kind: 'eliminated',
      tournamentTitle: 'DLS Cup',
      tournamentSlug: 'dls-cup',
      round: 'round_of_16',
    })
  })

  it('returns null for winning the final', () => {
    const result = computeTournamentStatus(
      'me',
      baseInput({
        knockoutMatches: [
          knockoutMatch({ round: 'final', player_a_id: 'me', player_b_id: 'opp', score_a: 3, score_b: 1 }),
        ],
      }),
    )
    expect(result).toBeNull()
  })

  it('picks the furthest round when the player has two knockout rows', () => {
    const result = computeTournamentStatus(
      'me',
      baseInput({
        knockoutMatches: [
          knockoutMatch({ round: 'round_of_16', status: 'completed', player_a_id: 'me', player_b_id: 'opp', score_a: 2, score_b: 0 }),
          knockoutMatch({ round: 'quarter_final', status: 'scheduled', player_a_id: 'me', player_b_id: 'opp2', score_a: null, score_b: null }),
        ],
      }),
    )
    expect(result).toEqual({
      kind: 'qualified',
      tournamentTitle: 'DLS Cup',
      tournamentSlug: 'dls-cup',
      round: 'quarter_final',
      awaitingOpponent: false,
    })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/dashboard/tournament-status.test.ts`
Expected: FAIL — `Cannot find module './tournament-status'`

- [ ] **Step 3: Implement `lib/dashboard/tournament-status.ts`**

```ts
import { sortStandings, type MembershipInput } from '@/lib/tournaments/standings'
import { matchWinnerId, nextRoundName, type AdvanceMatch } from '@/lib/tournaments/advancement'
import { ROUND_ORDER } from '@/lib/tournaments/bracket'

export interface KnockoutMatchInput extends AdvanceMatch {
  round: string
}

export interface TournamentStatusInput {
  tournamentId: string
  tournamentTitle: string
  tournamentSlug: string
  tournamentStatus: string
  groupId: string | null
  groupComplete: boolean
  groupStandings: MembershipInput[]
  knockoutMatches: KnockoutMatchInput[]
}

export type TournamentBanner =
  | {
      kind: 'qualified'
      tournamentTitle: string
      tournamentSlug: string
      round: string
      // No fixture card exists yet for this round (a bye, or the rest of the
      // previous round hasn't resolved) — the banner is their only signal.
      awaitingOpponent: boolean
    }
  | { kind: 'eliminated'; tournamentTitle: string; tournamentSlug: string; round: string }
  | null

function roundIndex(round: string): number {
  return ROUND_ORDER.indexOf(round as (typeof ROUND_ORDER)[number])
}

function latestKnockoutMatch(matches: KnockoutMatchInput[]): KnockoutMatchInput | null {
  if (matches.length === 0) return null
  return matches.reduce((latest, m) => (roundIndex(m.round) > roundIndex(latest.round) ? m : latest))
}

export function computeTournamentStatus(
  playerId: string,
  input: TournamentStatusInput,
): TournamentBanner {
  // A tournament that already finished shouldn't keep telling a player they
  // were eliminated or qualified weeks later — final placements live on the
  // bracket / Hall of Fame pages by then.
  if (input.tournamentStatus === 'completed') return null

  const latest = latestKnockoutMatch(input.knockoutMatches)
  if (latest) {
    const base = { tournamentTitle: input.tournamentTitle, tournamentSlug: input.tournamentSlug }

    if (latest.status === 'bye') {
      return { kind: 'qualified', ...base, round: latest.round, awaitingOpponent: true }
    }
    if (latest.status === 'scheduled' || latest.status === 'live') {
      return { kind: 'qualified', ...base, round: latest.round, awaitingOpponent: false }
    }
    if (latest.status === 'forfeited') {
      return { kind: 'eliminated', ...base, round: latest.round }
    }
    if (latest.status === 'completed') {
      if (matchWinnerId(latest) === playerId) {
        const next = nextRoundName(latest.round)
        if (next === null) return null // won the final — champion messaging is out of scope
        return { kind: 'qualified', ...base, round: next, awaitingOpponent: true }
      }
      return { kind: 'eliminated', ...base, round: latest.round }
    }
    return null
  }

  if (input.groupId === null) return null
  if (!input.groupComplete) return null

  const row = sortStandings(input.groupStandings).find((r) => r.playerId === playerId)
  if (!row) return null

  const base = { tournamentTitle: input.tournamentTitle, tournamentSlug: input.tournamentSlug }
  return row.advancing
    ? { kind: 'qualified', ...base, round: 'knockout stage', awaitingOpponent: true }
    : { kind: 'eliminated', ...base, round: 'group' }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/dashboard/tournament-status.test.ts`
Expected: PASS — 14 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard/tournament-status.ts lib/dashboard/tournament-status.test.ts
git commit -m "feat: derive per-tournament qualify/eliminate status"
```

---

## Task 2: Banner component + dashboard wiring

**Files:**
- Create: `components/dashboard/TournamentStatusBanner.tsx`
- Modify: `app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `TournamentBanner`, `computeTournamentStatus`, `KnockoutMatchInput`, `TournamentStatusInput` from Task 1 (`lib/dashboard/tournament-status.ts`); `MembershipInput` from `lib/tournaments/standings.ts`; `ROUND_LABELS` from `lib/tournaments/bracket.ts`; `isTournamentPublished` from `lib/dashboard/fixtures.ts` (already imported in `page.tsx`).
- Produces: `export function TournamentStatusBanners({ banners }: { banners: NonNullable<TournamentBanner>[] })`, a Server-Component-safe presentational component (no client hooks needed — it's static markup, no interactivity).

No automated tests for this task — this codebase has no `*.test.tsx` component tests (verified: `Glob **/*.test.tsx` returns nothing). Verification is manual, in a running dev server, per CLAUDE.md's rule for UI changes.

- [ ] **Step 1: Create the banner component**

Create `components/dashboard/TournamentStatusBanner.tsx`:

```tsx
import Link from 'next/link'
import type { TournamentBanner } from '@/lib/dashboard/tournament-status'
import { ROUND_LABELS } from '@/lib/tournaments/bracket'

function bannerCopy(banner: NonNullable<TournamentBanner>): string {
  if (banner.kind === 'eliminated') {
    const roundLabel = banner.round === 'group' ? 'Group Stage' : ROUND_LABELS[banner.round] ?? banner.round
    return `You were eliminated from ${banner.tournamentTitle} after the ${roundLabel}. Thanks for competing! 🎮`
  }
  if (banner.round === 'knockout stage') {
    return `🎉 You made the knockout stage in ${banner.tournamentTitle} — the draw will appear here once every group finishes.`
  }
  const roundLabel = ROUND_LABELS[banner.round] ?? banner.round
  return banner.awaitingOpponent
    ? `🎉 You advanced to the ${roundLabel} in ${banner.tournamentTitle} — sit tight for your next fixture.`
    : `🎉 You advanced to the ${roundLabel} in ${banner.tournamentTitle}!`
}

export function TournamentStatusBanners({ banners }: { banners: NonNullable<TournamentBanner>[] }) {
  if (banners.length === 0) return null
  return (
    <div className="mb-5 space-y-2">
      {banners.map((banner) => (
        <Link
          key={`${banner.tournamentSlug}-${banner.kind}`}
          href={`/tournaments/${banner.tournamentSlug}/bracket`}
          className={`block rounded-2xl border p-4 text-sm font-semibold transition-colors ${
            banner.kind === 'qualified'
              ? 'border-emerald-800 bg-emerald-950/40 text-emerald-300 hover:border-emerald-600'
              : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-600'
          }`}
        >
          {bannerCopy(banner)}
        </Link>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Add `score_a`/`score_b` to the dashboard's matches query**

In `app/dashboard/page.tsx`, the `matches` query currently reads (around line 118):

```ts
    supabase
      .from('matches')
      .select(
        'id, status, scheduled_at, is_full_day, round, tournament_id, player_a_id, player_b_id, ' +
          'player_a:profiles!matches_player_a_id_fkey(id, username, display_name, country), ' +
          'player_b:profiles!matches_player_b_id_fkey(id, username, display_name, country), ' +
          'tournament:tournaments(title, slug, status, data_support_text, data_support_whatsapp)',
      )
      .or(`player_a_id.eq.${user.id},player_b_id.eq.${user.id}`),
```

Change the first line of the select string to add `score_a, score_b`:

```ts
    supabase
      .from('matches')
      .select(
        'id, status, scheduled_at, is_full_day, round, tournament_id, player_a_id, player_b_id, score_a, score_b, ' +
          'player_a:profiles!matches_player_a_id_fkey(id, username, display_name, country), ' +
          'player_b:profiles!matches_player_b_id_fkey(id, username, display_name, country), ' +
          'tournament:tournaments(title, slug, status, data_support_text, data_support_whatsapp)',
      )
      .or(`player_a_id.eq.${user.id},player_b_id.eq.${user.id}`),
```

Then update the `rawMatches` type cast (around line 208) to add the two fields:

```ts
  const rawMatches = ((matchesRes.data as unknown[] | null) ?? []) as {
    id: string
    status: string
    scheduled_at: string | null
    is_full_day: boolean
    round: string
    tournament_id: string
    player_a_id: string
    player_b_id: string
    score_a: number | null
    score_b: number | null
    player_a: ProfileRef
    player_b: ProfileRef
    tournament: TournamentRef
  }[]
```

- [ ] **Step 3: Add the group-membership query for the signed-in player**

Add a 15th entry to the existing `Promise.all` array (the one starting `const [profileRes, matchesRes, ...] = await Promise.all([`). Add it right after `friendliesRes`'s query:

```ts
    supabase
      .from('friendly_matches')
      .select('id, status, challenger_id, opponent_id')
      .or(`challenger_id.eq.${user.id},opponent_id.eq.${user.id}`),
    supabase
      .from('group_memberships')
      .select('group_id, groups(tournament_id)')
      .eq('player_id', user.id),
  ])
```

And add `myGroupMembershipsRes` to the destructuring array at the top:

```ts
  const [
    profileRes,
    matchesRes,
    resultsRes,
    regsRes,
    walletRes,
    walletRequestsRes,
    listingsRes,
    ordersRes,
    salesRes,
    kycRes,
    banks,
    referralsRes,
    friendsRes,
    friendliesRes,
    myGroupMembershipsRes,
  ] = await Promise.all([
```

- [ ] **Step 4: Build the tournament status inputs and compute banners**

Add this block in `app/dashboard/page.tsx` after `const fixtures = bucketFixtures(...)` (around line 264) and before the `dataSupportEligibility` block. It needs `visibleMatches`, `rawMatches`, `firstTournament`, and `isTournamentPublished`, all already in scope:

```ts
  type GroupTournamentRef = { tournament_id: string } | { tournament_id: string }[] | null
  function firstGroupTournamentId(g: GroupTournamentRef): string | null {
    const row = Array.isArray(g) ? g[0] ?? null : g
    return row?.tournament_id ?? null
  }

  const myGroupRows = ((myGroupMembershipsRes.data as unknown[] | null) ?? []) as {
    group_id: string
    groups: GroupTournamentRef
  }[]
  const groupIdByTournamentId = new Map<string, string>()
  for (const r of myGroupRows) {
    const tId = firstGroupTournamentId(r.groups)
    if (tId) groupIdByTournamentId.set(tId, r.group_id)
  }
  const myGroupIds = Array.from(new Set(myGroupRows.map((r) => r.group_id)))

  const [groupStandingsRes, groupMatchesRes] =
    myGroupIds.length > 0
      ? await Promise.all([
          supabase
            .from('group_memberships')
            .select('group_id, player_id, wins, draws, losses, goals_for, goals_against, points')
            .in('group_id', myGroupIds),
          supabase.from('matches').select('group_id, status').in('group_id', myGroupIds).eq('round', 'group'),
        ])
      : [
          { data: [] as { group_id: string; player_id: string; wins: number; draws: number; losses: number; goals_for: number; goals_against: number; points: number }[] },
          { data: [] as { group_id: string; status: string }[] },
        ]

  const groupCompleteById = new Map<string, boolean>()
  const groupStandingsById = new Map<string, MembershipInput[]>()
  for (const groupId of myGroupIds) {
    const matchRows = (groupMatchesRes.data ?? []).filter((m) => m.group_id === groupId)
    groupCompleteById.set(groupId, matchRows.length > 0 && matchRows.every((m) => m.status === 'completed'))
    groupStandingsById.set(
      groupId,
      (groupStandingsRes.data ?? [])
        .filter((r) => r.group_id === groupId)
        .map((r) => ({
          playerId: r.player_id,
          name: '',
          wins: r.wins,
          draws: r.draws,
          losses: r.losses,
          goalsFor: r.goals_for,
          goalsAgainst: r.goals_against,
          points: r.points,
        })),
    )
  }

  const knockoutMatchesByTournament = new Map<string, KnockoutMatchInput[]>()
  for (const mm of visibleMatches) {
    if (mm.round === 'group') continue
    const list = knockoutMatchesByTournament.get(mm.tournament_id) ?? []
    list.push({
      round: mm.round,
      status: mm.status,
      score_a: mm.score_a,
      score_b: mm.score_b,
      player_a_id: mm.player_a_id,
      player_b_id: mm.player_b_id,
    })
    knockoutMatchesByTournament.set(mm.tournament_id, list)
  }

  // Built from rawMatches (not visibleMatches) so an unpublished tournament's
  // title/status is still resolvable here — but such a tournament is then
  // deliberately skipped below via isTournamentPublished, same privacy rule
  // the rest of this page already applies to fixtures.
  const tournamentRefById = new Map<string, { title: string; slug: string; status: string }>()
  for (const mm of rawMatches) {
    const t = firstTournament(mm.tournament)
    if (t) tournamentRefById.set(mm.tournament_id, { title: t.title, slug: t.slug, status: t.status })
  }

  const tournamentIdsToEvaluate = new Set<string>([
    ...knockoutMatchesByTournament.keys(),
    ...groupIdByTournamentId.keys(),
  ])

  const tournamentBanners: NonNullable<TournamentBanner>[] = []
  for (const tournamentId of tournamentIdsToEvaluate) {
    const ref = tournamentRefById.get(tournamentId)
    if (!ref || !isTournamentPublished(ref.status)) continue
    const groupId = groupIdByTournamentId.get(tournamentId) ?? null
    const banner = computeTournamentStatus(user.id, {
      tournamentId,
      tournamentTitle: ref.title,
      tournamentSlug: ref.slug,
      tournamentStatus: ref.status,
      groupId,
      groupComplete: groupId ? groupCompleteById.get(groupId) ?? false : false,
      groupStandings: groupId ? groupStandingsById.get(groupId) ?? [] : [],
      knockoutMatches: knockoutMatchesByTournament.get(tournamentId) ?? [],
    })
    if (banner) tournamentBanners.push(banner)
  }
```

Add the new imports at the top of the file, alongside the existing ones:

```ts
import {
  computeTournamentStatus,
  type KnockoutMatchInput,
  type TournamentBanner,
} from '@/lib/dashboard/tournament-status'
import type { MembershipInput } from '@/lib/tournaments/standings'
import { TournamentStatusBanners } from '@/components/dashboard/TournamentStatusBanner'
```

- [ ] **Step 5: Render the banners above the fixture list**

In the JSX, find (around line 397):

```tsx
      <CollapsibleSection id="matches" title="Active matches" defaultOpen>
        <ActiveFixtures fixtures={{ live: fixtures.live, upcoming: fixtures.upcoming }} />
      </CollapsibleSection>
```

Change to:

```tsx
      <CollapsibleSection id="matches" title="Active matches" defaultOpen>
        <TournamentStatusBanners banners={tournamentBanners} />
        <ActiveFixtures fixtures={{ live: fixtures.live, upcoming: fixtures.upcoming }} />
      </CollapsibleSection>
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Manual verification against real, currently-live data**

Run `npm run dev`, then check both branches this feature exists for:

**a) Banner logic against production shape (no real login needed):** temporarily replace the `tournamentBanners` variable's last line with a hardcoded array covering all five copy variants, e.g.:

```ts
tournamentBanners.push(
  { kind: 'qualified', tournamentTitle: 'Test Cup', tournamentSlug: 'test', round: 'round_of_16', awaitingOpponent: false },
  { kind: 'qualified', tournamentTitle: 'Test Cup', tournamentSlug: 'test', round: 'quarter_final', awaitingOpponent: true },
  { kind: 'qualified', tournamentTitle: 'Test Cup', tournamentSlug: 'test', round: 'knockout stage', awaitingOpponent: true },
  { kind: 'eliminated', tournamentTitle: 'Test Cup', tournamentSlug: 'test', round: 'group' },
  { kind: 'eliminated', tournamentTitle: 'Test Cup', tournamentSlug: 'test', round: 'round_of_16' },
)
```

Load `/dashboard` while logged in as any account, confirm all 5 banners render with the expected copy and colors above the fixture list, then delete this hardcoded block.

**b) Confirm it's live against the real dashboard query** by checking the SQL this task's new queries should reproduce, so you know what a real logged-in player *should* see. The tournament `dls-26-pre-season-2-championship-tournament` (status `active`) currently has, per Supabase:
  - `Codexempire` — beat `Cristiano` 2-0 in `round_of_16`, no `quarter_final` row yet (6 other `round_of_16` matches still `scheduled`) → should see the *"advanced to the Quarter-finals ... sit tight"* banner.
  - `Cristiano` — should see *"eliminated ... in the Round of 16"*.
  - `Muizz` — has a `round_of_16` match scheduled vs `Joe` → should see *"advanced to the Round of 16 in ...!"* (no "sit tight" — real opponent already assigned).
  - `quingvonne` (display name "Hooligans", Group G) — group fully completed, finished 3rd of 4 → should see *"eliminated ... after the Group Stage"*.
  - `Arole` (Group G) — group fully completed, finished 1st, already has a `round_of_16` match vs `Chinech1` → should see *"advanced to the Round of 16 in ...!"*.

  If you have Supabase dashboard access, you can verify these accounts' `auth.users` and generate a magic sign-in link for one of them to check the real rendered page directly, instead of only checking the hardcoded stand-in from (a).

- [ ] **Step 8: Commit**

```bash
git add components/dashboard/TournamentStatusBanner.tsx app/dashboard/page.tsx
git commit -m "feat: qualify/eliminate banner on the player dashboard"
```
