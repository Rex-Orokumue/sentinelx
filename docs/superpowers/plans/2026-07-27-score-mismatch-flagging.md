# Score Mismatch Flagging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When two players submit disagreeing scores for the same match, an admin sees an explicit warning — in the results queue list before opening the match, and again on the per-match review page — instead of having to notice the discrepancy by eye.

**Architecture:** One new pure predicate (`hasScoreMismatch`) reuses the equality check `prefillScore` already has. The results-queue page fetches actual submitted scores instead of just a count and threads a `hasMismatch` flag through `ReviewMatchInput`; the per-match review page computes the same flag from data it already fetches. Both surfaces render a warning when it's true. No change to how an admin actually confirms or disputes a result.

**Tech Stack:** Next.js 14 Server Components, Vitest, TypeScript.

## Global Constraints

- `prefillScore`'s existing return behavior must not change — the extraction of `scoresMatch` is behavior-preserving; all of its existing tests pass unchanged.
- No automatic Sentinel Score penalty or status transition from a flagged mismatch — admin-driven only, via the existing Confirm/Dispute actions.
- Design source of truth: `docs/superpowers/specs/2026-07-27-score-mismatch-flagging-design.md`.

---

### Task 1: `hasScoreMismatch` — `lib/matches/verify.ts`

**Files:**
- Modify: `lib/matches/verify.ts`
- Test: `lib/matches/verify.test.ts`

**Interfaces:**
- Produces: `hasScoreMismatch(submissions: SubmittedScore[]): boolean` — consumed by Task 2 (results queue page) and Task 4 (per-match review page).

- [ ] **Step 1: Write the failing tests**

Add to `lib/matches/verify.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { prefillScore, hasScoreMismatch } from './verify'

// ... existing prefillScore describe block unchanged ...

describe('hasScoreMismatch', () => {
  it('is false when both submissions agree', () => {
    expect(hasScoreMismatch([{ scoreA: 2, scoreB: 1 }, { scoreA: 2, scoreB: 1 }])).toBe(false)
  })

  it('is true when submissions disagree', () => {
    expect(hasScoreMismatch([{ scoreA: 2, scoreB: 1 }, { scoreA: 1, scoreB: 1 }])).toBe(true)
  })

  it('is false with only one submission', () => {
    expect(hasScoreMismatch([{ scoreA: 3, scoreB: 0 }])).toBe(false)
  })

  it('is false with no submissions', () => {
    expect(hasScoreMismatch([])).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `npx vitest run lib/matches/verify.test.ts`
Expected: FAIL — `hasScoreMismatch` is not exported. The existing `prefillScore` tests still pass.

- [ ] **Step 3: Implement**

Replace the full contents of `lib/matches/verify.ts` with:

```typescript
export interface SubmittedScore {
  scoreA: number
  scoreB: number
}

function scoresMatch(a: SubmittedScore, b: SubmittedScore): boolean {
  return a.scoreA === b.scoreA && a.scoreB === b.scoreB
}

// Pre-fill the official score from up to two submissions:
// both agree -> that score; disagree -> null (no anchoring); exactly one -> it; none -> null.
export function prefillScore(
  a: SubmittedScore | null,
  b: SubmittedScore | null,
): SubmittedScore | null {
  if (a && b) return scoresMatch(a, b) ? a : null
  return a ?? b ?? null
}

// True when there are 2+ submissions and at least one disagrees with another —
// a signal of a possible forged/misreported score. False for 0 or 1 submissions
// (nothing to compare yet).
export function hasScoreMismatch(submissions: SubmittedScore[]): boolean {
  if (submissions.length < 2) return false
  return submissions.some((s) => !scoresMatch(s, submissions[0]))
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/matches/verify.test.ts`
Expected: PASS (8 tests: 4 existing `prefillScore` + 4 new `hasScoreMismatch`).

- [ ] **Step 5: Commit**

```bash
git add lib/matches/verify.ts lib/matches/verify.test.ts
git commit -m "feat: add hasScoreMismatch score-conflict detection"
```

---

### Task 2: Thread `hasMismatch` through the results queue

**Files:**
- Modify: `lib/matches/review-queue.ts:1-15` (`ReviewMatchInput`)
- Modify: `lib/matches/review-queue.test.ts:6-20` (`m()` test helper)
- Modify: `app/admin/results/page.tsx`

**Interfaces:**
- Consumes: `hasScoreMismatch` (Task 1, `@/lib/matches/verify`).
- Produces: `ReviewMatchInput.hasMismatch: boolean` — consumed by Task 3 (`AdminResultsQueue`).

- [ ] **Step 1: Add the field to `ReviewMatchInput`**

In `lib/matches/review-queue.ts`, change:

```typescript
export interface ReviewMatchInput {
  id: string
  status: string
  scheduledAt: string | null
  isFullDay: boolean
  autoExpired: boolean
  submissionCount: number
  round: string
  playerAName: string
  playerBName: string
  playerAClubName?: string | null
  playerBClubName?: string | null
  tournamentTitle: string
  tournamentSlug: string
}
```

to:

```typescript
export interface ReviewMatchInput {
  id: string
  status: string
  scheduledAt: string | null
  isFullDay: boolean
  autoExpired: boolean
  submissionCount: number
  hasMismatch: boolean
  round: string
  playerAName: string
  playerBName: string
  playerAClubName?: string | null
  playerBClubName?: string | null
  tournamentTitle: string
  tournamentSlug: string
}
```

(`bucketReviewQueue`'s bucketing logic is untouched — the field just rides along with each row.)

- [ ] **Step 2: Update the test helper**

In `lib/matches/review-queue.test.ts`, change the `m()` helper from:

```typescript
function m(over: Partial<ReviewMatchInput> & { id: string }): ReviewMatchInput {
  return {
    status: 'scheduled',
    scheduledAt: null,
    isFullDay: false,
    autoExpired: false,
    submissionCount: 0,
    round: 'group',
    playerAName: 'A',
    playerBName: 'B',
    tournamentTitle: 'Cup',
    tournamentSlug: 'cup',
    ...over,
  }
}
```

to:

```typescript
function m(over: Partial<ReviewMatchInput> & { id: string }): ReviewMatchInput {
  return {
    status: 'scheduled',
    scheduledAt: null,
    isFullDay: false,
    autoExpired: false,
    submissionCount: 0,
    hasMismatch: false,
    round: 'group',
    playerAName: 'A',
    playerBName: 'B',
    tournamentTitle: 'Cup',
    tournamentSlug: 'cup',
    ...over,
  }
}
```

- [ ] **Step 3: Run the existing review-queue tests to confirm no behavior change**

Run: `npx vitest run lib/matches/review-queue.test.ts`
Expected: PASS (all 7 existing tests, unchanged assertions).

- [ ] **Step 4: Fetch actual scores and compute the flag in the results page**

In `app/admin/results/page.tsx`, change the select from:

```typescript
      .select(
        'id, round, status, scheduled_at, is_full_day, auto_expired, tournament_id, ' +
          'player_a:profiles!matches_player_a_id_fkey(id, username, display_name), ' +
          'player_b:profiles!matches_player_b_id_fkey(id, username, display_name), ' +
          'tournament:tournaments(title, slug), ' +
          'match_results(count)',
      )
```

to:

```typescript
      .select(
        'id, round, status, scheduled_at, is_full_day, auto_expired, tournament_id, ' +
          'player_a:profiles!matches_player_a_id_fkey(id, username, display_name), ' +
          'player_b:profiles!matches_player_b_id_fkey(id, username, display_name), ' +
          'tournament:tournaments(title, slug), ' +
          'match_results(score_a, score_b)',
      )
```

Add the import at the top of the file:

```typescript
import { hasScoreMismatch } from '@/lib/matches/verify'
```

Change the raw-row type and mapping from:

```typescript
    const m = raw as {
      id: string
      round: string
      status: string
      scheduled_at: string | null
      is_full_day: boolean
      auto_expired: boolean
      tournament_id: string
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
      isFullDay: m.is_full_day,
      autoExpired: m.auto_expired,
      submissionCount: m.match_results?.[0]?.count ?? 0,
      round: m.round,
```

to:

```typescript
    const m = raw as {
      id: string
      round: string
      status: string
      scheduled_at: string | null
      is_full_day: boolean
      auto_expired: boolean
      tournament_id: string
      player_a: ProfileRef
      player_b: ProfileRef
      tournament: TournamentRef
      match_results: { score_a: number; score_b: number }[]
    }
    const t = firstT(m.tournament)
    const submissions = m.match_results ?? []
    return {
      id: m.id,
      status: m.status,
      scheduledAt: m.scheduled_at,
      isFullDay: m.is_full_day,
      autoExpired: m.auto_expired,
      submissionCount: submissions.length,
      hasMismatch: hasScoreMismatch(submissions.map((s) => ({ scoreA: s.score_a, scoreB: s.score_b }))),
      round: m.round,
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/matches/review-queue.ts lib/matches/review-queue.test.ts app/admin/results/page.tsx
git commit -m "feat: thread score-mismatch flag through the results queue"
```

---

### Task 3: Badge in the results queue list

**Files:**
- Modify: `components/admin/AdminResultsQueue.tsx:50-75` (`Bucket`)

**Interfaces:** None new — reads `ReviewMatchInput.hasMismatch` (Task 2).

- [ ] **Step 1: Add the badge**

In `components/admin/AdminResultsQueue.tsx`, change the `Bucket` function's item rendering from:

```typescript
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
```

to:

```typescript
        {items.map((m) => (
          <Link
            key={m.id}
            href={`/admin/matches/${m.id}/review`}
            className={`block rounded-2xl border p-4 transition-colors hover:border-slate-600 ${
              m.hasMismatch ? 'border-amber-500/40 bg-amber-500/[0.06]' : 'border-slate-800 bg-slate-900'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="truncate font-bold text-white">
                {m.playerAName} <span className="text-slate-500">vs</span> {m.playerBName}
              </p>
              {m.hasMismatch && (
                <span className="shrink-0 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-400">
                  ⚠️ Mismatch
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate text-xs text-slate-500">
              {m.tournamentTitle} · {m.round.replace(/_/g, ' ')}
            </p>
          </Link>
        ))}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/admin/AdminResultsQueue.tsx
git commit -m "feat: show a mismatch badge on flagged rows in the results queue"
```

---

### Task 4: Warning banner on the per-match review page

**Files:**
- Modify: `app/admin/matches/[id]/review/page.tsx`

**Interfaces:**
- Consumes: `hasScoreMismatch` (Task 1, `@/lib/matches/verify`).

- [ ] **Step 1: Add the import**

At the top of `app/admin/matches/[id]/review/page.tsx`, add:

```typescript
import { prefillScore, hasScoreMismatch } from '@/lib/matches/verify'
```

(replacing the existing `import { prefillScore } from '@/lib/matches/verify'` line — both names now come from the same import.)

- [ ] **Step 2: Compute the flag**

After the existing:

```typescript
  const s0 = submissions[0] ? { scoreA: submissions[0].score_a, scoreB: submissions[0].score_b } : null
  const s1 = submissions[1] ? { scoreA: submissions[1].score_a, scoreB: submissions[1].score_b } : null
  const prefill = prefillScore(s0, s1)
```

add:

```typescript
  const mismatch = hasScoreMismatch(submissions.map((s) => ({ scoreA: s.score_a, scoreB: s.score_b })))
```

- [ ] **Step 3: Render the banner**

Change:

```tsx
      {m.admin_note && (
        <p className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-300">
          Dispute note: {m.admin_note}
        </p>
      )}
```

to:

```tsx
      {m.admin_note && (
        <p className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-300">
          Dispute note: {m.admin_note}
        </p>
      )}

      {mismatch && (
        <p className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm font-semibold text-amber-300">
          ⚠️ Players reported different scores — review the evidence carefully before confirming.
        </p>
      )}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add "app/admin/matches/[id]/review/page.tsx"
git commit -m "feat: warn admin on the review page when submitted scores disagree"
```

---

### Task 5: Final verification

**Files:** None (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 2: Run the production build**

Run: `npm run build`
Expected: clean build, no type errors.

- [ ] **Step 3: Manual verification**

Using the live tournament (or a test one): find a match with two submitted results that disagree
(or submit two conflicting scores as both players via two accounts), then confirm: (a) the
results queue shows the "⚠️ Mismatch" badge and amber-tinted card for that match, (b) opening its
review page shows the warning banner above the submissions list, (c) the admin's confirm form
still behaves exactly as before (no anchoring on the mismatched pair, per existing `prefillScore`
behavior) — this feature adds visibility only, nothing about the actual confirm/dispute flow
changed.
