# Admin Result Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let staff confirm an official match score (updating group standings, generating the knockout stage, advancing knockout rounds, and completing the tournament) or dispute it, from a review queue.

**Architecture:** Pure, unit-tested engines (`results`, `advancement`, `verify`, `review-queue`) do all the logic; two `requireStaff` server actions orchestrate them with service-role writes; a queue page and a per-match review page provide the UI. One nullable-column migration.

**Tech Stack:** Next.js 14.2 App Router, TypeScript, Tailwind, Supabase (server + service-role clients), zod, Vitest. Forms use `useFormState` from `react-dom`.

## Global Constraints

- Mobile-first; only `ResultReviewForms` is `"use client"`.
- All actions `requireStaff` (result verification is not financial); orchestrated multi-row writes use the service-role `createAdminClient()`.
- The match-row write (`score_a/score_b/status='completed'`) is the atomic anchor; standings recompute and next-round generation are idempotent (full recompute / existence-guarded insert).
- Only `completed` (and terminal `bye`) trigger updates; `disputed`/`pending`/`scheduled`/`live` never do.
- Knockout confirm requires a decisive score (`scoreA != scoreB`); group matches allow draws.
- The final is identified by `nextRoundName(current) === null` — never a hardcoded `'final'`.
- Dispute requires a non-empty note, stored in `matches.admin_note`; it makes no standings/bracket change.
- Review queue buckets: Needs review (≥1 submission, scheduled/live), No submission (scheduled, 0 submissions, `scheduled_at` past), Disputed.
- Do NOT mark roadmap #9 done (sub-project 5 of 6).
- Test: `npx vitest run <path>`. Type: `npx tsc --noEmit`. Lint: `npx next lint --file <path>`. Build: `npm run build`.
- Each commit message ends with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

### Task 1: `matches.admin_note` migration + types

**Files:**
- Create: `supabase/migrations/007_match_admin_note.sql`
- Modify: `lib/supabase/types.ts` (regenerated — `matches` gains `admin_note`)

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/007_match_admin_note.sql`:

```sql
-- Stores the mandatory reason when an admin disputes a match result.
ALTER TABLE public.matches ADD COLUMN admin_note text;
```

- [ ] **Step 2: Apply and regenerate types**

Apply via the Supabase MCP `apply_migration` tool (project `itxubrkbropttfdackmi`, name
`007_match_admin_note`, the SQL above). Then regenerate `lib/supabase/types.ts` via the MCP
`generate_typescript_types` tool and overwrite the file. Confirm `matches` now has
`admin_note: string | null` in its `Row`.

- [ ] **Step 3: Verify and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add supabase/migrations/007_match_admin_note.sql lib/supabase/types.ts
git commit -m "$(cat <<'EOF'
feat: matches.admin_note column for dispute reasons

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Group results engine

**Files:**
- Create: `lib/tournaments/results.ts`
- Create: `lib/tournaments/results.test.ts`

**Interfaces:**
- Produces: `interface GroupMatchResult`, `interface PlayerGroupStats`, `computeGroupStats(playerIds, matches)`, `collectAdvancers(standingsPerGroup)` for Task 5.

- [ ] **Step 1: Write the failing test**

Create `lib/tournaments/results.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { computeGroupStats, collectAdvancers, type GroupMatchResult } from './results'

describe('computeGroupStats', () => {
  it('awards 3 for a win, 1 each for a draw, and tallies goals', () => {
    const matches: GroupMatchResult[] = [
      { playerAId: 'a', playerBId: 'b', scoreA: 2, scoreB: 1 }, // a wins
      { playerAId: 'a', playerBId: 'c', scoreA: 1, scoreB: 1 }, // draw
    ]
    const stats = computeGroupStats(['a', 'b', 'c'], matches)
    const a = stats.find((s) => s.playerId === 'a')!
    const b = stats.find((s) => s.playerId === 'b')!
    const c = stats.find((s) => s.playerId === 'c')!
    expect(a).toMatchObject({ points: 4, wins: 1, draws: 1, losses: 0, goalsFor: 3, goalsAgainst: 2 })
    expect(b).toMatchObject({ points: 0, wins: 0, draws: 0, losses: 1, goalsFor: 1, goalsAgainst: 2 })
    expect(c).toMatchObject({ points: 1, wins: 0, draws: 1, losses: 0, goalsFor: 1, goalsAgainst: 1 })
  })
  it('returns a zeroed row for a player with no matches', () => {
    const stats = computeGroupStats(['a', 'b'], [])
    expect(stats).toHaveLength(2)
    expect(stats[0]).toMatchObject({ points: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 })
  })
  it('is idempotent (deterministic for the same input)', () => {
    const m: GroupMatchResult[] = [{ playerAId: 'a', playerBId: 'b', scoreA: 3, scoreB: 0 }]
    expect(computeGroupStats(['a', 'b'], m)).toEqual(computeGroupStats(['a', 'b'], m))
  })
})

describe('collectAdvancers', () => {
  it('lists all group winners, then all runners-up', () => {
    const r = collectAdvancers([
      [
        { playerId: 'a1', advancing: true },
        { playerId: 'a2', advancing: true },
        { playerId: 'a3', advancing: false },
      ],
      [
        { playerId: 'b1', advancing: true },
        { playerId: 'b2', advancing: true },
      ],
    ])
    expect(r).toEqual(['a1', 'b1', 'a2', 'b2'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/tournaments/results.test.ts`
Expected: FAIL — cannot find module `./results`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/tournaments/results.ts`:

```typescript
export interface GroupMatchResult {
  playerAId: string
  playerBId: string
  scoreA: number
  scoreB: number
}

export interface PlayerGroupStats {
  playerId: string
  points: number
  wins: number
  draws: number
  losses: number
  goalsFor: number
  goalsAgainst: number
}

// Recompute every player's stats from a group's completed matches (win 3 / draw 1 / loss 0).
export function computeGroupStats(
  playerIds: string[],
  matches: GroupMatchResult[],
): PlayerGroupStats[] {
  const base = new Map<string, PlayerGroupStats>(
    playerIds.map((id) => [
      id,
      { playerId: id, points: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 },
    ]),
  )
  for (const m of matches) {
    const a = base.get(m.playerAId)
    const b = base.get(m.playerBId)
    if (!a || !b) continue
    a.goalsFor += m.scoreA
    a.goalsAgainst += m.scoreB
    b.goalsFor += m.scoreB
    b.goalsAgainst += m.scoreA
    if (m.scoreA > m.scoreB) {
      a.wins++
      a.points += 3
      b.losses++
    } else if (m.scoreA < m.scoreB) {
      b.wins++
      b.points += 3
      a.losses++
    } else {
      a.draws++
      b.draws++
      a.points++
      b.points++
    }
  }
  return playerIds.map((id) => base.get(id)!)
}

// Seed order for the knockout draw: every group's winner first, then every runner-up.
// Each group's rows must be pre-sorted (rank order); `advancing` marks the top 2.
export function collectAdvancers(
  standingsPerGroup: { playerId: string; advancing: boolean }[][],
): string[] {
  const adv = standingsPerGroup.map((rows) => rows.filter((r) => r.advancing).map((r) => r.playerId))
  const winners = adv.map((ids) => ids[0]).filter(Boolean) as string[]
  const runnersUp = adv.map((ids) => ids[1]).filter(Boolean) as string[]
  return [...winners, ...runnersUp]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/tournaments/results.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/tournaments/results.ts lib/tournaments/results.test.ts
git commit -m "$(cat <<'EOF'
feat: group results engine

computeGroupStats (recompute points/W-D-L/goals) + collectAdvancers
(winners-then-runners-up seed order for the knockout draw).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Knockout advancement engine

**Files:**
- Create: `lib/tournaments/advancement.ts`
- Create: `lib/tournaments/advancement.test.ts`

**Interfaces:**
- Consumes: `ROUND_ORDER` from `./bracket`.
- Produces: `interface AdvanceMatch`, `matchWinnerId(m)`, `roundResolved(matches)`, `pairWinners(byeWinnerIds, matchWinnerIds)`, `nextRoundName(current)` for Task 5.

- [ ] **Step 1: Write the failing test**

Create `lib/tournaments/advancement.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  matchWinnerId,
  roundResolved,
  pairWinners,
  nextRoundName,
  type AdvanceMatch,
} from './advancement'

function mk(over: Partial<AdvanceMatch>): AdvanceMatch {
  return { status: 'completed', score_a: 1, score_b: 0, player_a_id: 'a', player_b_id: 'b', ...over }
}

describe('matchWinnerId', () => {
  it('returns the higher-scoring player for a completed match', () => {
    expect(matchWinnerId(mk({ score_a: 2, score_b: 1 }))).toBe('a')
    expect(matchWinnerId(mk({ score_a: 0, score_b: 3 }))).toBe('b')
  })
  it('returns player_a for a bye', () => {
    expect(matchWinnerId(mk({ status: 'bye', player_b_id: null, score_a: null, score_b: null }))).toBe('a')
  })
  it('returns null for non-terminal, draw, or null-score matches', () => {
    expect(matchWinnerId(mk({ status: 'scheduled' }))).toBeNull()
    expect(matchWinnerId(mk({ status: 'disputed' }))).toBeNull()
    expect(matchWinnerId(mk({ score_a: 1, score_b: 1 }))).toBeNull()
    expect(matchWinnerId(mk({ score_a: null }))).toBeNull()
  })
})

describe('roundResolved', () => {
  it('is true only when every match is completed or bye', () => {
    expect(roundResolved([mk({}), mk({ status: 'bye' })])).toBe(true)
    expect(roundResolved([mk({}), mk({ status: 'disputed' })])).toBe(false)
    expect(roundResolved([mk({}), mk({ status: 'scheduled' })])).toBe(false)
    expect(roundResolved([])).toBe(false)
  })
})

describe('pairWinners', () => {
  it('interleaves byes with match-winners then pairs (n=6 case)', () => {
    // 2 byes + 2 match winners -> [bye1, w1, bye2, w2] -> pairs
    expect(pairWinners(['bye1', 'bye2'], ['w1', 'w2'])).toEqual([
      ['bye1', 'w1'],
      ['bye2', 'w2'],
    ])
  })
  it('handles one bye + three winners (n=7)', () => {
    expect(pairWinners(['bye1'], ['w1', 'w2', 'w3'])).toEqual([
      ['bye1', 'w1'],
      ['w2', 'w3'],
    ])
  })
  it('handles no byes (later rounds)', () => {
    expect(pairWinners([], ['w1', 'w2', 'w3', 'w4'])).toEqual([
      ['w1', 'w2'],
      ['w3', 'w4'],
    ])
  })
})

describe('nextRoundName', () => {
  it('advances through the canonical order', () => {
    expect(nextRoundName('quarter_final')).toBe('semi_final')
    expect(nextRoundName('semi_final')).toBe('final')
  })
  it('returns null for the final or a non-knockout round', () => {
    expect(nextRoundName('final')).toBeNull()
    expect(nextRoundName('group')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/tournaments/advancement.test.ts`
Expected: FAIL — cannot find module `./advancement`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/tournaments/advancement.ts`:

```typescript
import { ROUND_ORDER } from './bracket'

export interface AdvanceMatch {
  status: string
  score_a: number | null
  score_b: number | null
  player_a_id: string | null
  player_b_id: string | null
}

// The advancing player, or null if the match is not yet decided.
export function matchWinnerId(m: AdvanceMatch): string | null {
  if (m.status === 'bye') return m.player_a_id
  if (m.status !== 'completed') return null
  if (m.score_a == null || m.score_b == null || m.score_a === m.score_b) return null
  return m.score_a > m.score_b ? m.player_a_id : m.player_b_id
}

// True only when every match in the round is completed or bye.
export function roundResolved(matches: AdvanceMatch[]): boolean {
  return matches.length > 0 && matches.every((m) => m.status === 'completed' || m.status === 'bye')
}

// Interleave byes with match-winners (so a bye meets a played-match winner), then pair.
export function pairWinners(byeWinnerIds: string[], matchWinnerIds: string[]): [string, string][] {
  const merged: string[] = []
  const maxLen = Math.max(byeWinnerIds.length, matchWinnerIds.length)
  for (let i = 0; i < maxLen; i++) {
    if (i < byeWinnerIds.length) merged.push(byeWinnerIds[i])
    if (i < matchWinnerIds.length) merged.push(matchWinnerIds[i])
  }
  const pairs: [string, string][] = []
  for (let i = 0; i + 1 < merged.length; i += 2) pairs.push([merged[i], merged[i + 1]])
  return pairs
}

// The next knockout round, or null for the final / a non-knockout round.
export function nextRoundName(current: string): string | null {
  const i = ROUND_ORDER.indexOf(current as (typeof ROUND_ORDER)[number])
  if (i === -1 || i === ROUND_ORDER.length - 1) return null
  return ROUND_ORDER[i + 1]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/tournaments/advancement.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/tournaments/advancement.ts lib/tournaments/advancement.test.ts
git commit -m "$(cat <<'EOF'
feat: knockout advancement engine

matchWinnerId, roundResolved (bye/completed only), pairWinners (bye
interleave), nextRoundName (final -> null).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Verify support pures (prefill, schema, queue buckets)

**Files:**
- Create: `lib/matches/verify.ts` + `lib/matches/verify.test.ts`
- Create: `lib/matches/verify-schema.ts`
- Create: `lib/matches/review-queue.ts` + `lib/matches/review-queue.test.ts`

**Interfaces:**
- Produces: `interface SubmittedScore`, `prefillScore(a, b)`; `confirmScoreSchema`; `interface ReviewMatchInput`, `bucketReviewQueue(matches, now)` for Tasks 5–7.

- [ ] **Step 1: Write the failing tests**

Create `lib/matches/verify.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { prefillScore } from './verify'

describe('prefillScore', () => {
  it('pre-fills when both submissions agree', () => {
    expect(prefillScore({ scoreA: 2, scoreB: 1 }, { scoreA: 2, scoreB: 1 })).toEqual({ scoreA: 2, scoreB: 1 })
  })
  it('returns null when submissions disagree (no anchoring)', () => {
    expect(prefillScore({ scoreA: 2, scoreB: 1 }, { scoreA: 1, scoreB: 1 })).toBeNull()
  })
  it('pre-fills from the only submission', () => {
    expect(prefillScore({ scoreA: 3, scoreB: 0 }, null)).toEqual({ scoreA: 3, scoreB: 0 })
    expect(prefillScore(null, { scoreA: 0, scoreB: 4 })).toEqual({ scoreA: 0, scoreB: 4 })
  })
  it('returns null when there are no submissions', () => {
    expect(prefillScore(null, null)).toBeNull()
  })
})
```

Create `lib/matches/review-queue.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { bucketReviewQueue, type ReviewMatchInput } from './review-queue'

const NOW = new Date('2026-07-08T12:00:00Z')

function m(over: Partial<ReviewMatchInput> & { id: string }): ReviewMatchInput {
  return {
    status: 'scheduled',
    scheduledAt: null,
    submissionCount: 0,
    round: 'group',
    playerAName: 'A',
    playerBName: 'B',
    tournamentTitle: 'Cup',
    tournamentSlug: 'cup',
    ...over,
  }
}

describe('bucketReviewQueue', () => {
  it('routes a submitted scheduled/live match to Needs review (regardless of scheduledAt)', () => {
    const r = bucketReviewQueue([m({ id: 's', submissionCount: 1, scheduledAt: null })], NOW)
    expect(r.needsReview.map((x) => x.id)).toEqual(['s'])
  })
  it('routes a past-due unsubmitted scheduled match to No submission', () => {
    const r = bucketReviewQueue(
      [m({ id: 'p', submissionCount: 0, scheduledAt: '2026-07-01T10:00:00Z' })],
      NOW,
    )
    expect(r.noSubmission.map((x) => x.id)).toEqual(['p'])
  })
  it('routes disputed matches to Disputed', () => {
    const r = bucketReviewQueue([m({ id: 'd', status: 'disputed', submissionCount: 0 })], NOW)
    expect(r.disputed.map((x) => x.id)).toEqual(['d'])
  })
  it('excludes a future scheduled match with no submission', () => {
    const r = bucketReviewQueue(
      [m({ id: 'f', submissionCount: 0, scheduledAt: '2026-08-01T10:00:00Z' })],
      NOW,
    )
    expect(r.needsReview.concat(r.noSubmission, r.disputed)).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/matches/verify.test.ts lib/matches/review-queue.test.ts`
Expected: FAIL — modules `./verify` and `./review-queue` not found.

- [ ] **Step 3: Write the three modules**

Create `lib/matches/verify.ts`:

```typescript
export interface SubmittedScore {
  scoreA: number
  scoreB: number
}

// Pre-fill the official score from up to two submissions:
// both agree -> that score; disagree -> null (no anchoring); exactly one -> it; none -> null.
export function prefillScore(
  a: SubmittedScore | null,
  b: SubmittedScore | null,
): SubmittedScore | null {
  if (a && b) return a.scoreA === b.scoreA && a.scoreB === b.scoreB ? a : null
  return a ?? b ?? null
}
```

Create `lib/matches/verify-schema.ts`:

```typescript
import { z } from 'zod'

const score = z.coerce
  .number()
  .int('Whole numbers only')
  .min(0, 'Cannot be negative')
  .max(99, 'Score is too large')

export const confirmScoreSchema = z.object({ scoreA: score, scoreB: score })
export type ConfirmScoreInput = z.infer<typeof confirmScoreSchema>
```

Create `lib/matches/review-queue.ts`:

```typescript
export interface ReviewMatchInput {
  id: string
  status: string
  scheduledAt: string | null
  submissionCount: number
  round: string
  playerAName: string
  playerBName: string
  tournamentTitle: string
  tournamentSlug: string
}

// Split matches (already limited to status scheduled/live/disputed) into three actionable
// buckets. `now` is injected for deterministic tests.
export function bucketReviewQueue(
  matches: ReviewMatchInput[],
  now: Date,
): { needsReview: ReviewMatchInput[]; noSubmission: ReviewMatchInput[]; disputed: ReviewMatchInput[] } {
  const needsReview: ReviewMatchInput[] = []
  const noSubmission: ReviewMatchInput[] = []
  const disputed: ReviewMatchInput[] = []
  for (const mt of matches) {
    if (mt.status === 'disputed') {
      disputed.push(mt)
    } else if (mt.submissionCount >= 1 && (mt.status === 'scheduled' || mt.status === 'live')) {
      needsReview.push(mt)
    } else if (
      mt.status === 'scheduled' &&
      mt.submissionCount === 0 &&
      mt.scheduledAt != null &&
      new Date(mt.scheduledAt).getTime() <= now.getTime()
    ) {
      noSubmission.push(mt)
    }
    // else: future scheduled / live-with-no-submission -> excluded
  }
  return { needsReview, noSubmission, disputed }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/matches/verify.test.ts lib/matches/review-queue.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify types and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add lib/matches/verify.ts lib/matches/verify.test.ts lib/matches/verify-schema.ts lib/matches/review-queue.ts lib/matches/review-queue.test.ts
git commit -m "$(cat <<'EOF'
feat: verify support pures (prefill, confirm schema, queue buckets)

prefillScore (agree/disagree/one/none), confirmScoreSchema, and
bucketReviewQueue (needs review / no submission / disputed).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Verify server actions

**Files:**
- Create: `lib/matches/verify-actions.ts`

**Interfaces:**
- Consumes: `requireStaff`, `createAdminClient`, `confirmScoreSchema`, `computeGroupStats`/`collectAdvancers`, `matchWinnerId`/`roundResolved`/`pairWinners`/`nextRoundName`, `knockoutRound1`, `sortStandings`.
- Produces: `type VerifyState`, `confirmResult`, `disputeResult` for Task 6.

Verified via `tsc`/`lint`; exercised by the Task 7 build and manual testing.

- [ ] **Step 1: Write the implementation**

Create `lib/matches/verify-actions.ts`:

```typescript
'use server'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaff } from '@/lib/admin/auth'
import { confirmScoreSchema } from './verify-schema'
import { computeGroupStats, collectAdvancers, type GroupMatchResult } from '@/lib/tournaments/results'
import {
  matchWinnerId,
  roundResolved,
  pairWinners,
  nextRoundName,
  type AdvanceMatch,
} from '@/lib/tournaments/advancement'
import { knockoutRound1 } from '@/lib/tournaments/draw'
import { sortStandings, type MembershipInput } from '@/lib/tournaments/standings'

export type VerifyState = { error?: string; success?: boolean } | undefined
type Admin = ReturnType<typeof createAdminClient>

function firstStr<T>(x: T | T[] | null): T | null {
  return Array.isArray(x) ? x[0] ?? null : x
}

function revalidateAll(tournamentId: string, slug: string, matchId: string): void {
  revalidatePath('/admin/results')
  revalidatePath(`/admin/matches/${matchId}/review`)
  revalidatePath(`/admin/tournaments/${tournamentId}/bracket`)
  revalidatePath(`/matches/${matchId}`)
  if (slug) {
    revalidatePath(`/tournaments/${slug}`)
    revalidatePath(`/tournaments/${slug}/bracket`)
  }
}

// Recompute one group's standings, then generate the knockout stage if the group stage is done.
async function recomputeGroupAndMaybeAdvance(
  admin: Admin,
  tournamentId: string,
  groupId: string,
): Promise<void> {
  const { data: members } = await admin
    .from('group_memberships')
    .select('player_id')
    .eq('group_id', groupId)
  const playerIds = (members ?? []).map((r) => r.player_id)
  const { data: gm } = await admin
    .from('matches')
    .select('player_a_id, player_b_id, score_a, score_b')
    .eq('group_id', groupId)
    .eq('status', 'completed')
  const results: GroupMatchResult[] = (gm ?? [])
    .filter((r) => r.player_a_id && r.player_b_id && r.score_a != null && r.score_b != null)
    .map((r) => ({
      playerAId: r.player_a_id as string,
      playerBId: r.player_b_id as string,
      scoreA: r.score_a as number,
      scoreB: r.score_b as number,
    }))
  for (const s of computeGroupStats(playerIds, results)) {
    await admin
      .from('group_memberships')
      .update({
        points: s.points,
        wins: s.wins,
        draws: s.draws,
        losses: s.losses,
        goals_for: s.goalsFor,
        goals_against: s.goalsAgainst,
      })
      .eq('group_id', groupId)
      .eq('player_id', s.playerId)
  }

  // Generate the knockout stage once ALL group matches are complete and none exists yet.
  const { count: remaining } = await admin
    .from('matches')
    .select('*', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)
    .eq('round', 'group')
    .neq('status', 'completed')
  if (remaining && remaining > 0) return
  const { count: knockout } = await admin
    .from('matches')
    .select('*', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)
    .neq('round', 'group')
  if (knockout && knockout > 0) return

  const { data: groups } = await admin
    .from('groups')
    .select('id')
    .eq('tournament_id', tournamentId)
    .order('name')
  const standingsPerGroup: { playerId: string; advancing: boolean }[][] = []
  for (const g of groups ?? []) {
    const { data: mem } = await admin
      .from('group_memberships')
      .select('player_id, wins, draws, losses, goals_for, goals_against, points')
      .eq('group_id', g.id)
    const rows: MembershipInput[] = (mem ?? []).map((r) => ({
      playerId: r.player_id,
      name: '',
      wins: r.wins,
      draws: r.draws,
      losses: r.losses,
      goalsFor: r.goals_for,
      goalsAgainst: r.goals_against,
      points: r.points,
    }))
    standingsPerGroup.push(sortStandings(rows))
  }
  const advancers = collectAdvancers(standingsPerGroup)
  if (advancers.length < 2) return
  const { round, matches, byePlayerIds } = knockoutRound1(advancers)
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
}

// Create the next knockout round once the current round is fully resolved.
async function advanceKnockout(admin: Admin, tournamentId: string, round: string): Promise<void> {
  const { data: roundMatches } = await admin
    .from('matches')
    .select('status, score_a, score_b, player_a_id, player_b_id')
    .eq('tournament_id', tournamentId)
    .eq('round', round)
  const rm = (roundMatches ?? []) as AdvanceMatch[]
  if (!roundResolved(rm)) return
  const nr = nextRoundName(round)
  if (nr === null) return // final: tournament completion handled by the caller
  const { count: existing } = await admin
    .from('matches')
    .select('*', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)
    .eq('round', nr)
  if (existing && existing > 0) return

  const byeWinners = rm
    .filter((m) => m.status === 'bye')
    .map((m) => m.player_a_id)
    .filter(Boolean) as string[]
  const matchWinners = rm
    .filter((m) => m.status === 'completed')
    .map((m) => matchWinnerId(m))
    .filter(Boolean) as string[]
  const pairs = pairWinners(byeWinners, matchWinners)
  if (pairs.length === 0) return
  await admin.from('matches').insert(
    pairs.map(([a, b]) => ({
      tournament_id: tournamentId,
      round: nr,
      group_id: null,
      player_a_id: a,
      player_b_id: b,
      status: 'scheduled',
    })),
  )
}

export async function confirmResult(_prev: VerifyState, formData: FormData): Promise<VerifyState> {
  const ctx = await requireStaff()
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing match.' }
  const parsed = confirmScoreSchema.safeParse({
    scoreA: formData.get('scoreA'),
    scoreB: formData.get('scoreB'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const { scoreA, scoreB } = parsed.data

  const admin = createAdminClient()
  const { data: m } = await admin
    .from('matches')
    .select('id, round, group_id, tournament_id, tournament:tournaments(status, slug)')
    .eq('id', id)
    .maybeSingle()
  if (!m) return { error: 'Match not found.' }
  const isKnockout = m.round !== 'group'
  if (isKnockout && scoreA === scoreB) return { error: 'A knockout match cannot end in a draw.' }

  const { error: upErr } = await admin
    .from('matches')
    .update({ score_a: scoreA, score_b: scoreB, status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', id)
  if (upErr) return { error: 'Could not save the result. Please try again.' }
  await admin
    .from('match_results')
    .update({ status: 'verified', verified: true, verified_by: ctx.userId, verified_at: new Date().toISOString() })
    .eq('match_id', id)

  const t = firstStr(m.tournament as { status: string; slug: string } | { status: string; slug: string }[] | null)
  const slug = t?.slug ?? ''

  if (!isKnockout && m.group_id) {
    await recomputeGroupAndMaybeAdvance(admin, m.tournament_id, m.group_id)
  } else if (isKnockout) {
    await advanceKnockout(admin, m.tournament_id, m.round)
    if (nextRoundName(m.round) === null) {
      await admin.from('tournaments').update({ status: 'completed' }).eq('id', m.tournament_id)
    }
  }

  revalidateAll(m.tournament_id, slug, id)
  return { success: true }
}

export async function disputeResult(_prev: VerifyState, formData: FormData): Promise<VerifyState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  const note = String(formData.get('note') ?? '').trim()
  if (!id) return { error: 'Missing match.' }
  if (!note) return { error: 'Enter a reason for the dispute.' }

  const admin = createAdminClient()
  const { data: m } = await admin
    .from('matches')
    .select('id, tournament_id, tournament:tournaments(slug)')
    .eq('id', id)
    .maybeSingle()
  if (!m) return { error: 'Match not found.' }

  const { error } = await admin
    .from('matches')
    .update({ status: 'disputed', admin_note: note })
    .eq('id', id)
  if (error) return { error: 'Could not save the dispute.' }
  await admin.from('match_results').update({ status: 'disputed' }).eq('match_id', id)

  const t = firstStr(m.tournament as { slug: string } | { slug: string }[] | null)
  revalidateAll(m.tournament_id, t?.slug ?? '', id)
  return { success: true }
}
```

- [ ] **Step 2: Verify types and lint**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npx next lint --file lib/matches/verify-actions.ts`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add lib/matches/verify-actions.ts
git commit -m "$(cat <<'EOF'
feat: result verify server actions

confirmResult (atomic score+completed; recompute group + generate
knockout; advance knockout; final -> tournament completed) and
disputeResult (status+note, no bracket change).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Review forms + per-match review page

**Files:**
- Create: `components/admin/ResultReviewForms.tsx`
- Create: `app/admin/matches/[id]/review/page.tsx`

**Interfaces:**
- Consumes: `confirmResult`/`disputeResult`/`VerifyState` (Task 5), `prefillScore` (Task 4), `createClient`/`createAdminClient`, `requireStaff`.
- Produces: `ResultReviewForms({ matchId, playerAName, playerBName, prefill })`.

- [ ] **Step 1: Create the review forms component**

```tsx
'use client'
import { useFormState } from 'react-dom'
import { confirmResult, disputeResult, type VerifyState } from '@/lib/matches/verify-actions'

export function ResultReviewForms({
  matchId,
  playerAName,
  playerBName,
  prefill,
}: {
  matchId: string
  playerAName: string
  playerBName: string
  prefill: { scoreA: number; scoreB: number } | null
}) {
  const [confirmState, confirmAction] = useFormState<VerifyState, FormData>(confirmResult, undefined)
  const [disputeState, disputeAction] = useFormState<VerifyState, FormData>(disputeResult, undefined)

  if (confirmState?.success)
    return (
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5 text-center text-sm font-semibold text-emerald-400">
        ✓ Result confirmed.
      </div>
    )
  if (disputeState?.success)
    return (
      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 text-center text-sm font-semibold text-amber-300">
        Marked disputed — resolve it from the queue when ready.
      </div>
    )

  return (
    <div className="space-y-4">
      <form action={confirmAction} className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <input type="hidden" name="id" value={matchId} />
        <h3 className="text-sm font-bold text-white">Confirm official result</h3>
        <div className="flex items-end gap-3">
          <ScoreField label={playerAName} name="scoreA" defaultValue={prefill?.scoreA} />
          <span className="pb-2 text-slate-500">–</span>
          <ScoreField label={playerBName} name="scoreB" defaultValue={prefill?.scoreB} />
        </div>
        {confirmState?.error && <p className="text-sm text-red-400">{confirmState.error}</p>}
        <button
          type="submit"
          className="w-full rounded-xl bg-violet-600 px-7 py-3 text-sm font-bold text-white hover:bg-violet-500"
        >
          Confirm result
        </button>
      </form>

      <form action={disputeAction} className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <input type="hidden" name="id" value={matchId} />
        <h3 className="text-sm font-bold text-white">Dispute</h3>
        <textarea
          name="note"
          rows={2}
          required
          placeholder="Reason (required) — what needs investigating?"
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-amber-500 focus:outline-none"
        />
        {disputeState?.error && <p className="text-sm text-red-400">{disputeState.error}</p>}
        <button
          type="submit"
          className="rounded-lg border border-amber-500/40 px-4 py-2 text-xs font-bold text-amber-400 hover:bg-amber-500/10"
        >
          Mark disputed
        </button>
      </form>
    </div>
  )
}

function ScoreField({
  label,
  name,
  defaultValue,
}: {
  label: string
  name: string
  defaultValue?: number
}) {
  return (
    <div className="flex-1 space-y-1.5">
      <label htmlFor={name} className="block truncate text-xs font-medium text-slate-400">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type="number"
        min={0}
        max={99}
        required
        defaultValue={defaultValue}
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-center text-lg font-bold text-white focus:border-violet-500 focus:outline-none"
      />
    </div>
  )
}
```

- [ ] **Step 2: Create the review page**

Create `app/admin/matches/[id]/review/page.tsx`:

```tsx
import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaff } from '@/lib/admin/auth'
import { prefillScore } from '@/lib/matches/verify'
import { ResultReviewForms } from '@/components/admin/ResultReviewForms'

export const metadata: Metadata = { title: 'Review · Admin · SentinelX' }

type ProfileRef = { username: string | null; display_name: string | null } | null
function nameOf(p: ProfileRef): string {
  return p?.display_name ?? p?.username ?? 'TBD'
}

export default async function ReviewMatchPage({ params }: { params: { id: string } }) {
  await requireStaff()
  const supabase = createClient()
  const { data: m } = await supabase
    .from('matches')
    .select(
      'id, status, admin_note, ' +
        'player_a:profiles!matches_player_a_id_fkey(username, display_name), ' +
        'player_b:profiles!matches_player_b_id_fkey(username, display_name)',
    )
    .eq('id', params.id)
    .maybeSingle()
  if (!m) notFound()

  const { data: subs } = await supabase
    .from('match_results')
    .select('score_a, score_b, recording_url, screenshot_url, status, submitted_by')
    .eq('match_id', params.id)
    .order('created_at')

  const submissions = (subs ?? []) as {
    score_a: number
    score_b: number
    recording_url: string | null
    screenshot_url: string | null
    status: string
    submitted_by: string
  }[]

  // Signed URLs for each screenshot (service-role).
  const admin = createAdminClient()
  const withUrls = await Promise.all(
    submissions.map(async (s) => {
      let url: string | null = null
      if (s.screenshot_url) {
        const { data } = await admin.storage.from('match-evidence').createSignedUrl(s.screenshot_url, 3600)
        url = data?.signedUrl ?? null
      }
      return { ...s, signedUrl: url }
    }),
  )

  const s0 = submissions[0] ? { scoreA: submissions[0].score_a, scoreB: submissions[0].score_b } : null
  const s1 = submissions[1] ? { scoreA: submissions[1].score_a, scoreB: submissions[1].score_b } : null
  const prefill = prefillScore(s0, s1)

  const playerA = nameOf((m as { player_a: ProfileRef }).player_a)
  const playerB = nameOf((m as { player_b: ProfileRef }).player_b)

  return (
    <section className="max-w-xl">
      <Link href="/admin/results" className="text-sm text-violet-400 hover:text-violet-300">
        ← Results queue
      </Link>
      <h2 className="mb-1 mt-2 text-base font-bold text-white">
        {playerA} vs {playerB}
      </h2>
      <p className="mb-4 text-xs text-slate-500">Status: {m.status}</p>

      {m.admin_note && (
        <p className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-300">
          Dispute note: {m.admin_note}
        </p>
      )}

      <h3 className="mb-2 text-[11px] font-bold uppercase tracking-widest text-slate-500">
        Submissions ({withUrls.length})
      </h3>
      <div className="mb-6 space-y-2">
        {withUrls.length === 0 ? (
          <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4 text-sm text-slate-500">
            No submissions — enter the official score below (e.g. a walkover) or chase the players.
          </p>
        ) : (
          withUrls.map((s, i) => (
            <div key={i} className="rounded-2xl border border-slate-800 bg-slate-900 p-4 text-sm">
              <p className="font-bold text-white">
                Reported {s.score_a} – {s.score_b}{' '}
                <span className="text-xs font-normal text-slate-500">({s.status})</span>
              </p>
              <div className="mt-1 flex gap-3 text-xs">
                {s.signedUrl && (
                  <a href={s.signedUrl} target="_blank" rel="noopener noreferrer" className="text-violet-400 hover:text-violet-300">
                    Screenshot →
                  </a>
                )}
                {s.recording_url && (
                  <a href={s.recording_url} target="_blank" rel="noopener noreferrer" className="text-violet-400 hover:text-violet-300">
                    Recording →
                  </a>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <ResultReviewForms matchId={m.id} playerAName={playerA} playerBName={playerB} prefill={prefill} />
    </section>
  )
}
```

- [ ] **Step 3: Verify types and lint**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npx next lint --file components/admin/ResultReviewForms.tsx --file "app/admin/matches/[id]/review/page.tsx"`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add components/admin/ResultReviewForms.tsx "app/admin/matches/[id]/review"
git commit -m "$(cat <<'EOF'
feat: match review page + confirm/dispute forms

Shows both submissions (signed screenshot URLs) and confirm (prefilled)
+ dispute (mandatory note) forms.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Results queue page + nav + overview link

**Files:**
- Create: `app/admin/results/page.tsx`
- Modify: `lib/admin/nav.ts` (append Results)
- Modify: `app/admin/page.tsx` (link the Pending results card)

**Interfaces:**
- Consumes: `requireStaff`, `bucketReviewQueue`/`ReviewMatchInput` (Task 4), `createClient`.

- [ ] **Step 1: Append the Results nav entry**

In `lib/admin/nav.ts`, extend `ADMIN_NAV`:

```typescript
export const ADMIN_NAV: AdminNavItem[] = [
  { label: 'Overview', href: '/admin', adminOnly: false },
  { label: 'Tournaments', href: '/admin/tournaments', adminOnly: false },
  { label: 'Results', href: '/admin/results', adminOnly: false },
]
```

- [ ] **Step 2: Link the Overview "Pending results" card**

In `app/admin/page.tsx`, give the Pending-results `StatCard` an href:

```tsx
        <StatCard label="Pending results" count={pendingResults.count ?? 0} href="/admin/results" />
```

- [ ] **Step 3: Create the queue page**

Create `app/admin/results/page.tsx`:

```tsx
import Link from 'next/link'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { bucketReviewQueue, type ReviewMatchInput } from '@/lib/matches/review-queue'

export const metadata: Metadata = { title: 'Results · Admin · SentinelX' }

type ProfileRef = { username: string | null; display_name: string | null } | null
type TournamentRef = { title: string; slug: string } | { title: string; slug: string }[] | null
function nameOf(p: ProfileRef): string {
  return p?.display_name ?? p?.username ?? 'TBD'
}
function firstT(t: TournamentRef): { title: string; slug: string } | null {
  return Array.isArray(t) ? t[0] ?? null : t
}

export default async function AdminResultsPage() {
  await requireStaff()
  const supabase = createClient()
  const { data } = await supabase
    .from('matches')
    .select(
      'id, round, status, scheduled_at, ' +
        'player_a:profiles!matches_player_a_id_fkey(username, display_name), ' +
        'player_b:profiles!matches_player_b_id_fkey(username, display_name), ' +
        'tournament:tournaments(title, slug), ' +
        'match_results(count)',
    )
    .in('status', ['scheduled', 'live', 'disputed'])

  const rows: ReviewMatchInput[] = ((data as unknown[] | null) ?? []).map((raw) => {
    const m = raw as {
      id: string
      round: string
      status: string
      scheduled_at: string | null
      player_a: ProfileRef
      player_b: ProfileRef
      tournament: TournamentRef
      match_results: { count: number }[]
    }
    const t = firstT(m.tournament)
    return {
      id: m.id,
      status: m.status,
      scheduledAt: m.scheduled_at,
      submissionCount: m.match_results?.[0]?.count ?? 0,
      round: m.round,
      playerAName: nameOf(m.player_a),
      playerBName: nameOf(m.player_b),
      tournamentTitle: t?.title ?? 'Tournament',
      tournamentSlug: t?.slug ?? '',
    }
  })

  const { needsReview, noSubmission, disputed } = bucketReviewQueue(rows, new Date())

  return (
    <section>
      <h2 className="mb-4 text-base font-bold text-white">Results to verify</h2>
      {needsReview.length + noSubmission.length + disputed.length === 0 ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center text-sm text-slate-500">
          Nothing to review right now.
        </p>
      ) : (
        <div className="space-y-8">
          <Bucket title="Needs review" items={needsReview} />
          <Bucket title="No submission" items={noSubmission} />
          <Bucket title="Disputed" items={disputed} />
        </div>
      )}
    </section>
  )
}

function Bucket({ title, items }: { title: string; items: ReviewMatchInput[] }) {
  if (items.length === 0) return null
  return (
    <div>
      <h3 className="mb-3 text-[11px] font-bold uppercase tracking-widest text-slate-500">
        {title} ({items.length})
      </h3>
      <div className="space-y-2">
        {items.map((m) => (
          <Link
            key={m.id}
            href={`/admin/matches/${m.id}/review`}
            className="block rounded-2xl border border-slate-800 bg-slate-900 p-4 transition-colors hover:border-slate-600"
          >
            <p className="truncate font-bold text-white">
              {m.playerAName} <span className="text-slate-500">vs</span> {m.playerBName}
            </p>
            <p className="mt-0.5 truncate text-xs text-slate-500">
              {m.tournamentTitle} · {m.round.replace(/_/g, ' ')}
            </p>
          </Link>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Verify types and lint**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npx next lint --file app/admin/results/page.tsx --file lib/admin/nav.ts --file app/admin/page.tsx`
Expected: clean.

- [ ] **Step 5: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — all suites including the four new engine test files.

- [ ] **Step 6: Production build**

Run: `npm run build`
Expected: build succeeds; `/admin/results` and `/admin/matches/[id]/review` appear in the route list.

- [ ] **Step 7: Commit**

```bash
git add app/admin/results/page.tsx lib/admin/nav.ts app/admin/page.tsx
git commit -m "$(cat <<'EOF'
feat: results review queue (#9 sub-project 5)

Three-bucket queue (needs review / no submission / disputed), Results
nav entry, and the Overview pending-results card now links here.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- `matches.admin_note` migration + types → Task 1. ✅
- `computeGroupStats` + `collectAdvancers` → Task 2. ✅
- `matchWinnerId`/`roundResolved`/`pairWinners`/`nextRoundName` → Task 3. ✅
- `prefillScore`, `confirmScoreSchema`, `bucketReviewQueue` → Task 4. ✅
- `confirmResult` (atomic write; group recompute + group→knockout generation; knockout advance; final→tournament completed via `nextRoundName===null`; decisive-knockout guard; mark match_results verified) + `disputeResult` (status+note, no bracket change) → Task 5. ✅
- Review page (both submissions, signed screenshots, prefill, confirm/dispute forms) → Task 6. ✅
- Queue page (three buckets), Results nav, Overview card link → Task 7. ✅
- All `requireStaff`; service-role for orchestrated writes; only completed/bye trigger updates → Tasks 5. ✅
- No `#9` done marker → honored. ✅

**Placeholder scan:** No "TBD" (only as a runtime name fallback), no "handle edge cases", no "similar to" — full code in every step. ✅

**Type consistency:** `GroupMatchResult`/`collectAdvancers` (T2) used in T5. `AdvanceMatch` + the four advancement fns (T3) used in T5. `prefillScore`/`SubmittedScore` (T4) used in T6. `confirmScoreSchema` (T4) used in T5. `bucketReviewQueue`/`ReviewMatchInput` (T4) used in T7. `VerifyState`/`confirmResult`/`disputeResult` (T5) used in T6. `MembershipInput`/`sortStandings` and `knockoutRound1` reused from existing modules with their real signatures. Column/status literals (`match_results.status`, `matches.status`, `group_memberships` fields, `round='group'`) verified against `lib/supabase/types.ts`. The `match_results(count)` embed returns `[{ count }]` — read as `m.match_results?.[0]?.count`. ✅

Note: `confirmResult`'s `advanceKnockout` is called before the final check; for the final round `advanceKnockout` early-returns on `nextRoundName===null`, and the caller then sets the tournament completed — the two are ordered so the final never both advances and completes.
