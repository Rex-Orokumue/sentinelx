# Admin Bracket Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin close registration and auto-generate the initial bracket (group stage for 9–64, first knockout round for ≤8), re-roll it, and publish it live.

**Architecture:** A knockout-support migration (nullable match player slots + `'bye'` status) plus pure draw helpers underpin three server actions using the service-role client. A shared bracket-view loader renders both a new admin bracket page (with an action bar) and the existing public bracket page (now staff-gated while unpublished). Later knockout rounds are out of scope (sub-project 5).

**Tech Stack:** Next.js 14.2 App Router, TypeScript, Tailwind, Supabase (server + service-role clients), Vitest. Forms use `useFormState` from `react-dom`.

## Global Constraints

- Mobile-first; Server Components except `BracketActions` (`"use client"`).
- All bracket actions are `requireStaff`-gated and re-check tournament status server-side; bulk writes use the service-role `createAdminClient()` (same pattern as `lib/tournaments/confirm.ts`).
- Only **paid** registrations (`payment_status = 'paid'`) are drawn. `< 2` blocks closing ("Need at least 2 paid players to close registration."); `> 64` blocks it ("At most 64 players are supported.").
- Seeding: order paid players by `sentinel_score` **desc, random tiebreak**, then feed the pure helpers. Flat scores → effectively random; re-roll re-randomises.
- Group stage generates ALL round-robin matches; ≤8 generates the **first knockout round only**. A bye is a terminal single-player row (`player_b_id = null`, `status = 'bye'`, advancing player = a top seed). Never write later rounds.
- Transitions owned here: `registration_open → registration_closed` (close, auto-generates) and `registration_closed → active` (publish, locks re-roll). Re-roll only while `registration_closed`.
- Migration relaxes `matches.player_a_id`/`player_b_id` to nullable and adds `'bye'` to the status CHECK. Downstream null guards: `lib/dashboard/fixtures.ts` (add `'bye'` to `RESOLVED`), `lib/matches/actions.ts` + match page (reject/ hide submission for `'bye'`).
- Do NOT mark roadmap #9 done (sub-project 3 of 6).
- Test: `npx vitest run <path>`. Type: `npx tsc --noEmit`. Lint: `npx next lint --file <path>`. Build: `npm run build`.
- Each commit message ends with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

### Task 1: Knockout-support migration + downstream null guards

**Files:**
- Create: `supabase/migrations/006_knockout_support.sql`
- Modify: `lib/supabase/types.ts` (regenerated — matches player ids become nullable)
- Modify: `lib/dashboard/fixtures.ts` + `lib/dashboard/fixtures.test.ts`
- Modify: `lib/matches/actions.ts`
- Modify: `app/(public)/matches/[id]/page.tsx`

**Interfaces:**
- Produces: nullable `matches.player_a_id`/`player_b_id`, `'bye'` status. No new exports.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/006_knockout_support.sql`:

```sql
-- Knockout support: brackets materialize one round at a time (round N+1's players
-- are unknown until round N is verified) and byes are one-sided rows. Allow null
-- player slots and a 'bye' status. Safe because these nulls only occur on knockout
-- TBD/bye rows; group + played matches always set both players.
ALTER TABLE public.matches ALTER COLUMN player_a_id DROP NOT NULL;
ALTER TABLE public.matches ALTER COLUMN player_b_id DROP NOT NULL;

ALTER TABLE public.matches DROP CONSTRAINT matches_status_check;
ALTER TABLE public.matches
  ADD CONSTRAINT matches_status_check
  CHECK (status IN ('scheduled', 'live', 'completed', 'disputed', 'cancelled', 'bye'));
```

- [ ] **Step 2: Apply the migration and regenerate types**

Apply via the Supabase MCP `apply_migration` tool (project `itxubrkbropttfdackmi`, name `006_knockout_support`, the SQL above). Then regenerate `lib/supabase/types.ts` via the MCP `generate_typescript_types` tool and overwrite the file. Confirm `matches` now types `player_a_id: string | null` and `player_b_id: string | null` in its `Row`.

- [ ] **Step 3: Write the failing fixtures guard test**

In `lib/dashboard/fixtures.test.ts`, add inside the `describe('bucketFixtures — awaitingMyResult', ...)` block:

```typescript
  it('does NOT flag a bye row even if its scheduledAt is in the past', () => {
    const r = bucketFixtures(
      [m({ id: 'b', status: 'bye', scheduledAt: '2026-07-01T10:00:00Z' })],
      new Set(),
      NOW,
    )
    expect(r.completed[0].awaitingMyResult).toBe(false)
  })
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npx vitest run lib/dashboard/fixtures.test.ts`
Expected: FAIL — the bye row (past `scheduledAt`, not yet in `RESOLVED`) is flagged `true`.

- [ ] **Step 5: Add `'bye'` to the resolved set**

In `lib/dashboard/fixtures.ts`, change the `RESOLVED` constant:

```typescript
const RESOLVED = new Set(['completed', 'verified', 'cancelled', 'disputed', 'bye'])
```

- [ ] **Step 6: Run it to verify it passes**

Run: `npx vitest run lib/dashboard/fixtures.test.ts`
Expected: PASS (all fixtures tests, including the new bye case).

- [ ] **Step 7: Guard the result-submission action**

In `lib/matches/actions.ts`, inside `submitMatchResult`, immediately after the existing
`if (!match) return { error: 'Match not found.' }` line, add:

```typescript
  if (match.status === 'bye') return { error: 'This is a bye — there is no result to submit.' }
```

- [ ] **Step 8: Guard the match page**

In `app/(public)/matches/[id]/page.tsx`:

Add a `bye` entry to the `STATUS` map:

```typescript
  bye:       { label: 'BYE',       cls: 'bg-slate-700/40 text-slate-400 border-slate-700/50' },
```

Change the `MatchRow` type's player id fields to nullable:

```typescript
  player_a_id: string | null
  player_b_id: string | null
```

Add `m.status !== 'bye'` to the `canSubmit` guard:

```typescript
  const canSubmit =
    isParticipant &&
    m.status !== 'cancelled' &&
    m.status !== 'bye' &&
    !resultConfirmed &&
    (!myResult || myResult.status === 'pending')
```

- [ ] **Step 9: Verify and commit**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npx vitest run`
Expected: all suites pass.

```bash
git add supabase/migrations/006_knockout_support.sql lib/supabase/types.ts lib/dashboard/fixtures.ts lib/dashboard/fixtures.test.ts lib/matches/actions.ts "app/(public)/matches/[id]/page.tsx"
git commit -m "$(cat <<'EOF'
feat: knockout-support migration (nullable player slots + bye status)

Relax matches player_a_id/player_b_id to nullable and add 'bye' status.
Guard the downstream null surface: fixtures RESOLVED set, match result
submission action + page.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Pure draw helpers

**Files:**
- Create: `lib/tournaments/draw.ts`
- Create: `lib/tournaments/draw.test.ts`

**Interfaces:**
- Produces: `groupCountFor`, `snakeDistribute`, `roundRobinPairs`, `knockoutRound1` for Task 3.

- [ ] **Step 1: Write the failing test**

Create `lib/tournaments/draw.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { groupCountFor, snakeDistribute, roundRobinPairs, knockoutRound1 } from './draw'

describe('groupCountFor', () => {
  it('maps registered count to group count per the table', () => {
    expect(groupCountFor(2)).toBe(0)
    expect(groupCountFor(8)).toBe(0)
    expect(groupCountFor(9)).toBe(2)
    expect(groupCountFor(16)).toBe(2)
    expect(groupCountFor(17)).toBe(4)
    expect(groupCountFor(32)).toBe(4)
    expect(groupCountFor(33)).toBe(8)
    expect(groupCountFor(64)).toBe(8)
  })
})

describe('snakeDistribute', () => {
  it('snakes players across groups and places each once', () => {
    const g = snakeDistribute(['a', 'b', 'c', 'd', 'e', 'f'], 2)
    expect(g).toEqual([
      ['a', 'd', 'e'],
      ['b', 'c', 'f'],
    ])
    expect(g.flat().sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
  })
})

describe('roundRobinPairs', () => {
  it('yields every unordered pair once', () => {
    expect(roundRobinPairs(['a', 'b', 'c'])).toEqual([
      ['a', 'b'],
      ['a', 'c'],
      ['b', 'c'],
    ])
  })
  it('produces s*(s-1)/2 pairs', () => {
    expect(roundRobinPairs(['a', 'b', 'c', 'd']).length).toBe(6)
  })
})

describe('knockoutRound1', () => {
  it('pairs a full power-of-two bracket with no byes', () => {
    const r = knockoutRound1(['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'])
    expect(r.round).toBe('quarter_final')
    expect(r.byePlayerIds).toEqual([])
    expect(r.matches.length).toBe(4)
  })
  it('gives byes to the top seeds when not a power of two', () => {
    const r = knockoutRound1(['s1', 's2', 's3', 's4', 's5', 's6'])
    expect(r.round).toBe('quarter_final')
    expect(r.byePlayerIds).toEqual(['s1', 's2'])
    expect(r.matches).toEqual([
      ['s3', 's6'],
      ['s4', 's5'],
    ])
  })
  it('handles a 3-player semifinal with one bye', () => {
    const r = knockoutRound1(['s1', 's2', 's3'])
    expect(r.round).toBe('semi_final')
    expect(r.byePlayerIds).toEqual(['s1'])
    expect(r.matches).toEqual([['s2', 's3']])
  })
  it('handles a 2-player final', () => {
    const r = knockoutRound1(['s1', 's2'])
    expect(r.round).toBe('final')
    expect(r.byePlayerIds).toEqual([])
    expect(r.matches).toEqual([['s1', 's2']])
  })
  it('handles 5 and 7 players', () => {
    expect(knockoutRound1(['a', 'b', 'c', 'd', 'e']).byePlayerIds).toEqual(['a', 'b', 'c'])
    expect(knockoutRound1(['a', 'b', 'c', 'd', 'e']).matches).toEqual([['d', 'e']])
    expect(knockoutRound1(['a', 'b', 'c', 'd', 'e', 'f', 'g']).byePlayerIds).toEqual(['a'])
    expect(knockoutRound1(['a', 'b', 'c', 'd', 'e', 'f', 'g']).matches.length).toBe(3)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/tournaments/draw.test.ts`
Expected: FAIL — cannot find module `./draw`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/tournaments/draw.ts`:

```typescript
// Group count from the registered (paid) player count. 0 => straight knockout.
export function groupCountFor(n: number): 0 | 2 | 4 | 8 {
  if (n <= 8) return 0
  if (n <= 16) return 2
  if (n <= 32) return 4
  return 8 // 33–64
}

// Snake draft: row 0 fills groups left→right, row 1 right→left, etc.
export function snakeDistribute(orderedPlayerIds: string[], groups: number): string[][] {
  const out: string[][] = Array.from({ length: groups }, () => [])
  orderedPlayerIds.forEach((id, i) => {
    const row = Math.floor(i / groups)
    const pos = i % groups
    const g = row % 2 === 0 ? pos : groups - 1 - pos
    out[g].push(id)
  })
  return out
}

// Every unordered pair once (all-play-all).
export function roundRobinPairs(playerIds: string[]): [string, string][] {
  const pairs: [string, string][] = []
  for (let i = 0; i < playerIds.length; i++) {
    for (let j = i + 1; j < playerIds.length; j++) pairs.push([playerIds[i], playerIds[j]])
  }
  return pairs
}

function nextPow2(n: number): number {
  let p = 1
  while (p < n) p *= 2
  return p
}

// First knockout round from seeded players. bracketSize = next power of 2 >= n;
// the top (bracketSize - n) seeds get byes; the rest pair highest-vs-lowest.
export function knockoutRound1(orderedPlayerIds: string[]): {
  round: 'final' | 'semi_final' | 'quarter_final'
  matches: [string, string][]
  byePlayerIds: string[]
} {
  const n = orderedPlayerIds.length
  const size = nextPow2(n)
  const byes = size - n
  const byePlayerIds = orderedPlayerIds.slice(0, byes)
  const playing = orderedPlayerIds.slice(byes)
  const matches: [string, string][] = []
  for (let i = 0, j = playing.length - 1; i < j; i++, j--) matches.push([playing[i], playing[j]])
  const round = size <= 2 ? 'final' : size <= 4 ? 'semi_final' : 'quarter_final'
  return { round, matches, byePlayerIds }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/tournaments/draw.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/tournaments/draw.ts lib/tournaments/draw.test.ts
git commit -m "$(cat <<'EOF'
feat: pure bracket draw helpers

groupCountFor, snakeDistribute, roundRobinPairs, knockoutRound1
(byes to top seeds, power-of-two padding).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Bracket generation server actions

**Files:**
- Create: `lib/tournaments/bracket-admin-actions.ts`

**Interfaces:**
- Consumes: `requireStaff` (`@/lib/admin/auth`), `createAdminClient` (`@/lib/supabase/admin`), the Task 2 draw helpers.
- Produces: `type BracketState`, `closeRegistration`, `generateBracket`, `publishBracket` for Task 4.

Verified via `tsc`/`lint`; exercised by the Task 5 build.

- [ ] **Step 1: Write the implementation**

Create `lib/tournaments/bracket-admin-actions.ts`:

```typescript
'use server'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaff } from '@/lib/admin/auth'
import { groupCountFor, snakeDistribute, roundRobinPairs, knockoutRound1 } from './draw'

export type BracketState = { error?: string; success?: boolean } | undefined

type Admin = ReturnType<typeof createAdminClient>

// Paid players ordered by sentinel_score desc, ties broken randomly.
async function seededPaidPlayers(admin: Admin, tournamentId: string): Promise<string[]> {
  const { data: regs } = await admin
    .from('tournament_registrations')
    .select('player_id')
    .eq('tournament_id', tournamentId)
    .eq('payment_status', 'paid')
  const ids = (regs ?? []).map((r) => r.player_id)
  if (ids.length === 0) return []
  const { data: profs } = await admin.from('profiles').select('id, sentinel_score').in('id', ids)
  const scoreById = new Map((profs ?? []).map((p) => [p.id, p.sentinel_score]))
  return ids
    .map((id) => ({ id, score: scoreById.get(id) ?? 0, r: Math.random() }))
    .sort((a, b) => b.score - a.score || a.r - b.r)
    .map((x) => x.id)
}

async function clearBracket(admin: Admin, tournamentId: string): Promise<void> {
  // Groups cascade to memberships + group matches; then remove knockout matches.
  await admin.from('groups').delete().eq('tournament_id', tournamentId)
  await admin.from('matches').delete().eq('tournament_id', tournamentId).is('group_id', null)
}

async function generate(admin: Admin, tournamentId: string, seeded: string[]): Promise<void> {
  await clearBracket(admin, tournamentId)
  const g = groupCountFor(seeded.length)

  if (g === 0) {
    const { round, matches, byePlayerIds } = knockoutRound1(seeded)
    const rows = [
      ...matches.map(([a, b]) => ({
        tournament_id: tournamentId,
        round,
        group_id: null,
        player_a_id: a,
        player_b_id: b,
        status: 'scheduled',
      })),
      ...byePlayerIds.map((pid) => ({
        tournament_id: tournamentId,
        round,
        group_id: null,
        player_a_id: pid,
        player_b_id: null,
        status: 'bye',
      })),
    ]
    if (rows.length > 0) await admin.from('matches').insert(rows)
    return
  }

  const groups = snakeDistribute(seeded, g)
  for (let i = 0; i < groups.length; i++) {
    const { data: grp } = await admin
      .from('groups')
      .insert({ tournament_id: tournamentId, name: `Group ${String.fromCharCode(65 + i)}` })
      .select('id')
      .single()
    if (!grp) continue
    await admin
      .from('group_memberships')
      .insert(groups[i].map((pid) => ({ group_id: grp.id, player_id: pid })))
    const pairs = roundRobinPairs(groups[i])
    if (pairs.length > 0) {
      await admin.from('matches').insert(
        pairs.map(([a, b]) => ({
          tournament_id: tournamentId,
          round: 'group',
          group_id: grp.id,
          player_a_id: a,
          player_b_id: b,
          status: 'scheduled',
        })),
      )
    }
  }
}

function revalidateAdmin(tournamentId: string): void {
  revalidatePath(`/admin/tournaments/${tournamentId}/bracket`)
  revalidatePath('/admin/tournaments')
}

export async function closeRegistration(
  _prev: BracketState,
  formData: FormData,
): Promise<BracketState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing tournament.' }

  const admin = createAdminClient()
  const { data: t } = await admin.from('tournaments').select('status').eq('id', id).maybeSingle()
  if (!t) return { error: 'Tournament not found.' }
  if (t.status !== 'registration_open') return { error: 'Registration is not open.' }

  const seeded = await seededPaidPlayers(admin, id)
  if (seeded.length < 2) return { error: 'Need at least 2 paid players to close registration.' }
  if (seeded.length > 64) return { error: 'At most 64 players are supported.' }

  await admin.from('tournaments').update({ status: 'registration_closed' }).eq('id', id)
  await generate(admin, id, seeded)
  revalidateAdmin(id)
  return { success: true }
}

export async function generateBracket(
  _prev: BracketState,
  formData: FormData,
): Promise<BracketState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing tournament.' }

  const admin = createAdminClient()
  const { data: t } = await admin.from('tournaments').select('status').eq('id', id).maybeSingle()
  if (!t) return { error: 'Tournament not found.' }
  if (t.status !== 'registration_closed') return { error: 'The bracket is locked.' }

  const seeded = await seededPaidPlayers(admin, id)
  if (seeded.length < 2) return { error: 'Need at least 2 paid players.' }
  if (seeded.length > 64) return { error: 'At most 64 players are supported.' }

  await generate(admin, id, seeded)
  revalidateAdmin(id)
  return { success: true }
}

export async function publishBracket(
  _prev: BracketState,
  formData: FormData,
): Promise<BracketState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing tournament.' }

  const admin = createAdminClient()
  const { data: t } = await admin
    .from('tournaments')
    .select('status, slug')
    .eq('id', id)
    .maybeSingle()
  if (!t) return { error: 'Tournament not found.' }
  if (t.status !== 'registration_closed')
    return { error: 'Only a finalized bracket can be published.' }

  const { count } = await admin
    .from('matches')
    .select('*', { count: 'exact', head: true })
    .eq('tournament_id', id)
  if (!count) return { error: 'Generate a bracket before publishing.' }

  await admin.from('tournaments').update({ status: 'active' }).eq('id', id)
  revalidateAdmin(id)
  revalidatePath(`/tournaments/${t.slug}`)
  revalidatePath(`/tournaments/${t.slug}/bracket`)
  return { success: true }
}
```

- [ ] **Step 2: Verify types and lint**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npx next lint --file lib/tournaments/bracket-admin-actions.ts`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add lib/tournaments/bracket-admin-actions.ts
git commit -m "$(cat <<'EOF'
feat: bracket generation server actions

closeRegistration (auto-generate), generateBracket (re-roll), and
publishBracket (lock -> active). Seeded draw, service-role writes.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Shared bracket view + admin bracket page + actions

**Files:**
- Create: `lib/tournaments/bracket-view.ts`
- Create: `components/admin/BracketActions.tsx`
- Create: `app/admin/tournaments/[id]/bracket/page.tsx`
- Modify: `components/admin/TournamentListRow.tsx` (add a Bracket link)

**Interfaces:**
- Consumes: `sortStandings` (`./standings`), `splitFixturesByState`/`orderKnockoutRounds`/`getChampion`/`BracketMatch` (`./bracket`), the Task 3 actions, `GroupStage`/`KnockoutBracket` (`@/components/bracket/`).
- Produces: `loadBracketView(supabase, tournamentId)` and `interface BracketView` for Task 5; `BracketActions` for the admin page.

- [ ] **Step 1: Create the shared bracket-view loader**

Create `lib/tournaments/bracket-view.ts`:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import { sortStandings, type MembershipInput, type StandingRow } from './standings'
import {
  splitFixturesByState,
  orderKnockoutRounds,
  getChampion,
  type BracketMatch,
} from './bracket'

type ProfileRef = { id?: string; username: string | null; display_name: string | null } | null
function nameOf(p: ProfileRef): string {
  return p?.display_name ?? p?.username ?? 'TBD'
}

export interface BracketView {
  standings: { groupName: string; rows: StandingRow[] }[]
  fixtures: ReturnType<typeof splitFixturesByState>
  rounds: ReturnType<typeof orderKnockoutRounds>
  champion: { id: string; name: string } | null
  hasGroups: boolean
  hasKnockout: boolean
}

// Loads and shapes a tournament's groups, standings, and matches for the bracket
// components. Shared by the public bracket page and the admin bracket page.
export async function loadBracketView(
  supabase: SupabaseClient<Database>,
  tournamentId: string,
): Promise<BracketView> {
  const { data: groups } = await supabase
    .from('groups')
    .select('id, name')
    .eq('tournament_id', tournamentId)
    .order('name')

  const groupIds = (groups ?? []).map((g) => g.id)
  const groupNameById = new Map((groups ?? []).map((g) => [g.id, g.name]))

  const [membershipsRes, matchesRes] = await Promise.all([
    groupIds.length > 0
      ? supabase
          .from('group_memberships')
          .select(
            'group_id, player_id, wins, draws, losses, goals_for, goals_against, points, profiles(username, display_name)',
          )
          .in('group_id', groupIds)
      : Promise.resolve({ data: [] as unknown[] }),
    supabase
      .from('matches')
      .select(
        'id, round, group_id, status, score_a, score_b, scheduled_at, ' +
          'player_a:profiles!matches_player_a_id_fkey(id, username, display_name), ' +
          'player_b:profiles!matches_player_b_id_fkey(id, username, display_name)',
      )
      .eq('tournament_id', tournamentId),
  ])

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

  return {
    standings,
    fixtures: splitFixturesByState(groupMatches),
    rounds: orderKnockoutRounds(knockoutMatches),
    champion: getChampion(allMatches),
    hasGroups: (groups ?? []).length > 0,
    hasKnockout: orderKnockoutRounds(knockoutMatches).length > 0,
  }
}
```

- [ ] **Step 2: Create the `BracketActions` component**

Create `components/admin/BracketActions.tsx`:

```tsx
'use client'
import { useFormState } from 'react-dom'
import {
  closeRegistration,
  generateBracket,
  publishBracket,
  type BracketState,
} from '@/lib/tournaments/bracket-admin-actions'

export function BracketActions({ tournamentId, status }: { tournamentId: string; status: string }) {
  const [closeState, closeAction] = useFormState<BracketState, FormData>(
    closeRegistration,
    undefined,
  )
  const [rollState, rollAction] = useFormState<BracketState, FormData>(generateBracket, undefined)
  const [pubState, pubAction] = useFormState<BracketState, FormData>(publishBracket, undefined)
  const err = closeState?.error || rollState?.error || pubState?.error

  return (
    <div className="mb-6 rounded-2xl border border-slate-800 bg-slate-900 p-4">
      {status === 'registration_open' && (
        <form action={closeAction}>
          <input type="hidden" name="id" value={tournamentId} />
          <button
            type="submit"
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-bold text-white hover:bg-violet-500"
          >
            Close registration & generate bracket
          </button>
        </form>
      )}
      {status === 'registration_closed' && (
        <div className="flex flex-wrap items-center gap-2">
          <form action={rollAction}>
            <input type="hidden" name="id" value={tournamentId} />
            <button
              type="submit"
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-bold text-slate-200 hover:border-slate-500"
            >
              Re-roll draw
            </button>
          </form>
          <form action={pubAction}>
            <input type="hidden" name="id" value={tournamentId} />
            <button
              type="submit"
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500"
            >
              Publish bracket
            </button>
          </form>
          <p className="w-full text-xs text-slate-500">
            Preview below is staff-only until you publish.
          </p>
        </div>
      )}
      {(status === 'active' || status === 'completed') && (
        <p className="text-sm font-semibold text-slate-400">Bracket is live — locked.</p>
      )}
      {err && <p className="mt-2 text-sm text-red-400">{err}</p>}
    </div>
  )
}
```

- [ ] **Step 3: Create the admin bracket page**

Create `app/admin/tournaments/[id]/bracket/page.tsx`:

```tsx
import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { loadBracketView } from '@/lib/tournaments/bracket-view'
import { BracketActions } from '@/components/admin/BracketActions'
import { GroupStage } from '@/components/bracket/GroupStage'
import { KnockoutBracket } from '@/components/bracket/KnockoutBracket'

export const metadata: Metadata = { title: 'Bracket · Admin · SentinelX' }

export default async function AdminBracketPage({ params }: { params: { id: string } }) {
  await requireStaff()
  const supabase = createClient()
  const { data: t } = await supabase
    .from('tournaments')
    .select('id, title, status')
    .eq('id', params.id)
    .maybeSingle()
  if (!t) notFound()

  const view = await loadBracketView(supabase, t.id)

  return (
    <section>
      <Link href="/admin/tournaments" className="text-sm text-violet-400 hover:text-violet-300">
        ← Tournaments
      </Link>
      <h2 className="mb-4 mt-2 text-base font-bold text-white">
        {t.title} · <span className="text-slate-400">{t.status.replace(/_/g, ' ')}</span>
      </h2>

      <BracketActions tournamentId={t.id} status={t.status} />

      {!view.hasGroups && !view.hasKnockout ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center text-sm text-slate-500">
          No bracket yet. Close registration to generate one.
        </p>
      ) : (
        <>
          {view.hasGroups && <GroupStage standings={view.standings} fixtures={view.fixtures} />}
          {view.hasKnockout && <KnockoutBracket rounds={view.rounds} />}
        </>
      )}
    </section>
  )
}
```

- [ ] **Step 4: Add a Bracket link to the tournament row**

In `components/admin/TournamentListRow.tsx`, add a Bracket link next to Edit (inside the
`flex shrink-0 items-center gap-2` action group, immediately after the Edit `Link`):

```tsx
          <Link
            href={`/admin/tournaments/${t.id}/bracket`}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-300 hover:border-slate-500"
          >
            Bracket
          </Link>
```

- [ ] **Step 5: Verify types and lint**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npx next lint --file lib/tournaments/bracket-view.ts --file components/admin/BracketActions.tsx --file "app/admin/tournaments/[id]/bracket/page.tsx" --file components/admin/TournamentListRow.tsx`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add lib/tournaments/bracket-view.ts components/admin/BracketActions.tsx "app/admin/tournaments/[id]/bracket" components/admin/TournamentListRow.tsx
git commit -m "$(cat <<'EOF'
feat: admin bracket page + shared bracket view

loadBracketView (shared with the public page), BracketActions bar
(close/re-roll/publish), and a Bracket link on the tournament row.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Public bracket preview gate + refactor onto shared view

**Files:**
- Modify: `app/(public)/tournaments/[slug]/bracket/page.tsx`

**Interfaces:**
- Consumes: `loadBracketView` (Task 4), `getStaffContext` (`@/lib/admin/auth`).

- [ ] **Step 1: Refactor the public bracket page onto the shared loader + add the gate**

Replace the body of the default export in `app/(public)/tournaments/[slug]/bracket/page.tsx`.
Update the `getTournament` select to include `status`, add the imports, and rewrite the
component. The full new file:

```tsx
import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getStaffContext } from '@/lib/admin/auth'
import { loadBracketView } from '@/lib/tournaments/bracket-view'
import { GroupStage } from '@/components/bracket/GroupStage'
import { KnockoutBracket } from '@/components/bracket/KnockoutBracket'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sentinelx.gg'

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
    openGraph: {
      title,
      description,
      url: `${SITE_URL}/tournaments/${t.slug}/bracket`,
      siteName: 'Sentinel X',
      type: 'website',
    },
  }
}

export default async function BracketPage({ params }: { params: { slug: string } }) {
  const t = await getTournament(params.slug)
  if (!t) notFound()

  // A generated-but-unpublished bracket (registration_closed) is a staff-only preview.
  const isPreview = t.status === 'registration_closed'
  if (isPreview) {
    const ctx = await getStaffContext()
    if (!ctx?.isStaff) {
      return (
        <div className="mx-auto max-w-3xl px-4 pb-20">
          <Link
            href={`/tournaments/${t.slug}`}
            className="mt-6 mb-4 inline-block text-sm text-violet-400 hover:text-violet-300"
          >
            ← {t.title}
          </Link>
          <h1 className="mb-6 text-2xl font-black text-white">Bracket</h1>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 py-12 text-center">
            <p className="text-3xl">🗂️</p>
            <p className="mt-3 font-bold text-white">Bracket is being finalized</p>
            <p className="mt-1 text-sm text-slate-500">
              It&apos;ll appear here once the admin publishes it.
            </p>
          </div>
        </div>
      )
    }
  }

  const supabase = createClient()
  const view = await loadBracketView(supabase, t.id)
  const isEmpty = !view.hasGroups && !view.hasKnockout

  return (
    <div className="mx-auto max-w-3xl px-4 pb-20">
      <Link
        href={`/tournaments/${t.slug}`}
        className="mt-6 mb-4 inline-block text-sm text-violet-400 hover:text-violet-300"
      >
        ← {t.title}
      </Link>
      <h1 className="mb-6 text-2xl font-black text-white">Bracket</h1>

      {view.champion && (
        <div className="mb-6 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-5 py-4 text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-amber-400/80">Champion</p>
          <p className="mt-1 text-xl font-black text-white">🏆 {view.champion.name}</p>
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
          {view.hasGroups && <GroupStage standings={view.standings} fixtures={view.fixtures} />}
          {view.hasKnockout && <KnockoutBracket rounds={view.rounds} />}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify types and lint**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npx next lint --file "app/(public)/tournaments/[slug]/bracket/page.tsx"`
Expected: clean.

- [ ] **Step 3: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — all suites including `lib/tournaments/draw.test.ts` and the fixtures bye test.

- [ ] **Step 4: Production build**

Run: `npm run build`
Expected: build succeeds; `/admin/tournaments/[id]/bracket` appears in the route list and the public bracket route still builds.

- [ ] **Step 5: Commit**

```bash
git add "app/(public)/tournaments/[slug]/bracket/page.tsx"
git commit -m "$(cat <<'EOF'
feat: public bracket preview gate + shared view (#9 sub-project 3)

Refactor the public bracket page onto loadBracketView and hide a
generated-but-unpublished (registration_closed) bracket from non-staff.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- Migration (nullable player slots + `'bye'`) + downstream guards (fixtures RESOLVED, match submission action + page) → Task 1. ✅
- Pure draw helpers (groupCountFor / snakeDistribute / roundRobinPairs / knockoutRound1 with byes to top seeds) → Task 2. ✅
- Seeded draw (score desc, random tiebreak), paid-only, 2–64 guards → Task 3. ✅
- closeRegistration (auto-generate), generateBracket (re-roll), publishBracket (→ active), service-role writes, status re-checks → Task 3. ✅
- Group stage = all round-robin; ≤8 = round 1 only; bye = terminal single-player row → Task 3. ✅
- Admin bracket page reusing GroupStage/KnockoutBracket + action bar; Bracket link on the row → Task 4. ✅
- Shared `loadBracketView` used by both admin and public pages (DRY) → Tasks 4, 5. ✅
- Public preview gate (registration_closed staff-only) → Task 5. ✅
- No `#9` done marker → honored. ✅

**Placeholder scan:** No "TBD"/"handle edge cases"/"similar to" — full code in every step (`'TBD'` appears only as a runtime display fallback). ✅

**Type consistency:** Task 2's four helpers are consumed with matching signatures in Task 3's `generate`. `BracketState` + the three actions (Task 3) are consumed by `BracketActions` (Task 4). `loadBracketView(supabase, id)` / `BracketView` (Task 4) consumed by the admin page (Task 4) and the public page (Task 5). `GroupStage`/`KnockoutBracket` props (`standings`, `fixtures`, `rounds`) match the existing components. Column/status literals (`payment_status='paid'`, `round='group'`, `status` in `scheduled`/`bye`, tournament statuses) verified against the schema. Match page `MatchRow` player ids widened to `string | null` to match the migration. ✅

Note: `closeRegistration` both transitions status AND generates; if generation partially fails mid-loop the status is already `registration_closed` — acceptable because re-roll (`generateBracket`) fully clears and regenerates, so the admin recovers by pressing Re-roll. Documented here so it isn't mistaken for a bug.
