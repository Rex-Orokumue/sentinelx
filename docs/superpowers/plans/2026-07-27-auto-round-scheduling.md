# Automatic Round Scheduling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a bracket round is generated (initial draw, group→knockout advance, or knockout round N→N+1), automatically stamp its matches with a full-day `scheduled_at` date, computed from an admin-set start date and a fixed gap-between-rounds — removing the need to hand-enter a date on every match.

**Architecture:** Two new nullable-by-default columns on `tournaments` (`round_start_date`, `round_gap_days`). A new pure-function module computes the next round's date from "how many distinct rounds already have matches" (never from any match's own `scheduled_at`, so a manually-edited match can't skew later rounds). One shared async helper wraps that computation with the two Supabase reads it needs and is called from all three places `matches` rows get inserted. Two new form inputs on the existing bracket-generation UI capture the admin's start date + gap once; every later automatic round reuses the stored values with no further input.

**Tech Stack:** Next.js 14 Server Actions, Supabase (Postgres + service-role client), Vitest, TypeScript.

## Global Constraints

- Mobile-first Tailwind styling, matching existing admin form patterns (see `components/admin/BracketActions.tsx`, `components/admin/MatchRow.tsx`).
- All Supabase writes from admin actions use the service-role client (`createAdminClient`) — same pattern already used throughout `lib/tournaments/bracket-admin-actions.ts` and `lib/matches/verify-actions.ts`.
- Every date stored in `scheduled_at` for a full-day match is midnight WAT (`Africa/Lagos`, UTC+1, no DST) as a UTC instant — reuse `fromDateLocal`/`addRoundGapDays`, never hand-roll timezone math.
- `round_start_date = null` must be a fully valid, backward-compatible state: matches insert with `scheduled_at: null` exactly as before this feature.
- Migrations are applied against Supabase project `itxubrkbropttfdackmi` via the `mcp__claude_ai_Supabase__apply_migration` tool (the local CLI can be flaky per this repo's known Windows/schannel issue — check MCP tools first).
- Design source of truth: `docs/superpowers/specs/2026-07-27-auto-round-scheduling-design.md`.

---

### Task 1: Migration — `round_start_date` / `round_gap_days` on `tournaments`

**Files:**
- Create: `supabase/migrations/034_round_auto_scheduling.sql`
- Modify: `lib/supabase/types.ts` (regenerated, not hand-edited)

**Interfaces:**
- Produces: `tournaments.round_start_date` (`date | null`), `tournaments.round_gap_days` (`number`, DB default `1`) — consumed by Task 2 (`nextRoundScheduledAt`) and Task 5 (admin form read/write).

- [ ] **Step 1: Write the migration file**

```sql
-- 034_round_auto_scheduling.sql
-- Lets an admin set a tournament-wide round start date + gap between rounds,
-- so bracket generation and knockout advancement can auto-assign each new
-- round's full-day scheduled_at instead of requiring a manual date per match.
ALTER TABLE public.tournaments
  ADD COLUMN round_start_date date,
  ADD COLUMN round_gap_days   integer NOT NULL DEFAULT 1 CHECK (round_gap_days >= 1);
```

- [ ] **Step 2: Apply the migration to the live project**

Use `mcp__claude_ai_Supabase__apply_migration` with `project_id: itxubrkbropttfdackmi`, `name: round_auto_scheduling`, and the SQL body above. If the MCP tool is unavailable, fall back to `mcp__claude_ai_Supabase__execute_sql` with the same statement (per this repo's documented Supabase-connectivity gotcha — MCP tools stay reachable even when the local CLI's TLS check hangs).

- [ ] **Step 3: Verify the columns exist**

Run (via `execute_sql` or MCP): `select column_name, data_type, column_default from information_schema.columns where table_name = 'tournaments' and column_name in ('round_start_date', 'round_gap_days');`
Expected: two rows — `round_start_date` (`date`, no default), `round_gap_days` (`integer`, default `1`).

- [ ] **Step 4: Regenerate TypeScript types**

Run: `npx supabase gen types typescript --project-id itxubrkbropttfdackmi > lib/supabase/types.ts`
(Requires `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` or equivalent auth already configured in this repo's environment — same command as documented in `CLAUDE.md`.) Confirm `tournaments.Row` in the regenerated file now includes `round_start_date: string | null` and `round_gap_days: number`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/034_round_auto_scheduling.sql lib/supabase/types.ts
git commit -m "feat: add round_start_date/round_gap_days columns to tournaments"
```

---

### Task 2: Pure scheduling helpers — `lib/tournaments/round-schedule.ts`

**Files:**
- Create: `lib/tournaments/round-schedule.ts`
- Test: `lib/tournaments/round-schedule.test.ts`

**Interfaces:**
- Consumes: `fromDateLocal` from `lib/format.ts` (existing — `(value: string | null | undefined) => string | null`).
- Produces: `addRoundGapDays(iso: string, days: number): string`, `computeNextRoundDate(roundStartDate: string, roundGapDays: number, roundsGenerated: number): string` — both consumed by Task 3 (`nextRoundScheduledAt`, same file) and directly by this task's tests.

- [ ] **Step 1: Write the failing tests**

```typescript
// lib/tournaments/round-schedule.test.ts
import { describe, it, expect } from 'vitest'
import { addRoundGapDays, computeNextRoundDate } from './round-schedule'

describe('addRoundGapDays', () => {
  it('returns the same instant for 0 days', () => {
    expect(addRoundGapDays('2026-07-13T23:00:00.000Z', 0)).toBe('2026-07-13T23:00:00.000Z')
  })

  it('adds whole calendar days to a midnight-WAT instant', () => {
    // 2026-07-13T23:00:00Z is midnight WAT on 2026-07-14; +1 day lands on
    // midnight WAT 2026-07-15, i.e. 2026-07-14T23:00:00Z.
    expect(addRoundGapDays('2026-07-13T23:00:00.000Z', 1)).toBe('2026-07-14T23:00:00.000Z')
    expect(addRoundGapDays('2026-07-13T23:00:00.000Z', 3)).toBe('2026-07-16T23:00:00.000Z')
  })
})

describe('computeNextRoundDate', () => {
  it('returns round_start_date unmodified when no rounds exist yet', () => {
    expect(computeNextRoundDate('2026-07-14', 1, 0)).toBe('2026-07-13T23:00:00.000Z')
  })

  it('adds gap_days once per already-generated round', () => {
    expect(computeNextRoundDate('2026-07-14', 2, 1)).toBe('2026-07-15T23:00:00.000Z')
    expect(computeNextRoundDate('2026-07-14', 2, 3)).toBe('2026-07-19T23:00:00.000Z')
  })

  it('throws for an invalid round_start_date', () => {
    expect(() => computeNextRoundDate('not-a-date', 1, 0)).toThrow()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/tournaments/round-schedule.test.ts`
Expected: FAIL — `Cannot find module './round-schedule'` (file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```typescript
// lib/tournaments/round-schedule.ts
import { fromDateLocal } from '@/lib/format'

// Pure: add N calendar days to a UTC instant. Safe without timezone
// conversion because WAT (Africa/Lagos, UTC+1) has no DST — same reasoning
// migration 021 (full-day matches) already relies on.
export function addRoundGapDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * 86_400_000).toISOString()
}

// Pure: the scheduled_at (a UTC instant representing midnight WAT) for a
// round about to be generated, given how many rounds already exist for this
// tournament. roundsGenerated=0 means this is the first round, so it lands
// exactly on roundStartDate itself.
export function computeNextRoundDate(
  roundStartDate: string,
  roundGapDays: number,
  roundsGenerated: number,
): string {
  const base = fromDateLocal(roundStartDate)
  if (!base) throw new Error(`Invalid round_start_date: ${roundStartDate}`)
  return addRoundGapDays(base, roundsGenerated * roundGapDays)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/tournaments/round-schedule.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/tournaments/round-schedule.ts lib/tournaments/round-schedule.test.ts
git commit -m "feat: add pure round-date calculation helpers"
```

---

### Task 3: `nextRoundScheduledAt` — impure wrapper in the same file

**Files:**
- Modify: `lib/tournaments/round-schedule.ts` (append to the file created in Task 2)

**Interfaces:**
- Consumes: `computeNextRoundDate` (Task 2, same file); `createAdminClient` from `lib/supabase/admin.ts` (existing, `() => SupabaseClient<Database>`).
- Produces: `nextRoundScheduledAt(admin: Admin, tournamentId: string): Promise<string | null>` — consumed by Task 4 (`bracket-admin-actions.ts`) and Task 6 (`verify-actions.ts`).

No test for this step: it is I/O-bound (two Supabase reads), matching the existing convention in this codebase where impure action-layer functions (`bracket-admin-actions.ts`, `verify-actions.ts`) are exercised via the build and manual admin testing, while their underlying pure logic (here, `computeNextRoundDate`) carries the unit tests.

- [ ] **Step 1: Append the impure wrapper**

```typescript
// Append to lib/tournaments/round-schedule.ts
import { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

// The scheduled_at for the next round of matches about to be generated for
// this tournament, or null if auto-scheduling is off (round_start_date
// unset — admin schedules each match manually, unchanged from before this
// feature).
//
// Deliberately does NOT read any match's scheduled_at (a manually-edited
// match could otherwise skew a MAX()-based calculation). Instead it counts
// distinct `round` values already present — every round is inserted as a
// single atomic batch (recomputeGroupAndMaybeAdvance/advanceKnockout both
// refuse to insert into a round that already has rows — see
// lib/matches/verify-actions.ts), so that count is exactly how many
// round-dates have already been assigned.
export async function nextRoundScheduledAt(
  admin: Admin,
  tournamentId: string,
): Promise<string | null> {
  const { data: t } = await admin
    .from('tournaments')
    .select('round_start_date, round_gap_days')
    .eq('id', tournamentId)
    .maybeSingle()
  if (!t?.round_start_date) return null

  const { data: rows } = await admin
    .from('matches')
    .select('round')
    .eq('tournament_id', tournamentId)
  const roundsGenerated = new Set((rows ?? []).map((r) => r.round)).size

  return computeNextRoundDate(t.round_start_date, t.round_gap_days, roundsGenerated)
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors introduced by this file.

- [ ] **Step 3: Commit**

```bash
git add lib/tournaments/round-schedule.ts
git commit -m "feat: add nextRoundScheduledAt admin-client wrapper"
```

---

### Task 4: Wire into initial bracket generation — `lib/tournaments/bracket-admin-actions.ts`

**Files:**
- Modify: `lib/tournaments/bracket-admin-actions.ts:39-136` (`generate()`, `parseGroupsField`, `closeRegistration`, `generateBracket`)

**Interfaces:**
- Consumes: `nextRoundScheduledAt(admin, tournamentId)` (Task 3, `@/lib/tournaments/round-schedule`).
- Produces: `closeRegistration`/`generateBracket` now also persist `round_start_date`/`round_gap_days` onto `tournaments` before generating — consumed by Task 5 (the form that submits these fields) and by Task 6 (knockout advancement reads them back later).

- [ ] **Step 1: Add the import and two form-field parsers**

In `lib/tournaments/bracket-admin-actions.ts`, add to the top-of-file imports:

```typescript
import { nextRoundScheduledAt } from './round-schedule'
```

Add alongside the existing `parseGroupsField` (after it, before `revalidateAdmin`):

```typescript
function parseRoundStartDate(formData: FormData): string | null {
  const raw = formData.get('roundStartDate')
  return typeof raw === 'string' && raw !== '' ? raw : null
}

function parseRoundGapDays(formData: FormData): number {
  const raw = formData.get('roundGapDays')
  const n = typeof raw === 'string' ? Number(raw) : NaN
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1
}
```

- [ ] **Step 2: Make `generate()` stamp the round it inserts**

Replace the current `generate` function body (lines 39-96) with:

```typescript
async function generate(
  admin: Admin,
  tournamentId: string,
  seeded: string[],
  g: number,
): Promise<void> {
  await clearBracket(admin, tournamentId)
  const roundDate = await nextRoundScheduledAt(admin, tournamentId)
  const schedule = roundDate ? { scheduled_at: roundDate, is_full_day: true } : {}

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
        ...schedule,
      })),
      ...byePlayerIds.map((pid) => ({
        tournament_id: tournamentId,
        round,
        group_id: null,
        player_a_id: pid,
        player_b_id: null,
        status: 'bye',
        ...schedule,
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
          ...schedule,
        })),
      )
    }
  }
}
```

(Only change from the original: the `roundDate`/`schedule` computation right after `clearBracket`, and `...schedule` spread into each of the three row-mapping call sites. `clearBracket` must run first so `nextRoundScheduledAt` sees zero existing matches for this tournament and returns `round_start_date` unmodified, exactly like a first-ever generation.)

- [ ] **Step 3: Persist the two fields in `closeRegistration`**

In `closeRegistration` (around line 127-130), replace:

```typescript
  const g = resolveGroupCount(parseGroupsField(formData), seeded.length)
  await admin.from('tournaments').update({ status: 'registration_closed' }).eq('id', id)
  try {
    await generate(admin, id, seeded, g)
```

with:

```typescript
  const g = resolveGroupCount(parseGroupsField(formData), seeded.length)
  const roundStartDate = parseRoundStartDate(formData)
  const roundGapDays = parseRoundGapDays(formData)
  await admin
    .from('tournaments')
    .update({
      status: 'registration_closed',
      round_start_date: roundStartDate,
      round_gap_days: roundGapDays,
    })
    .eq('id', id)
  try {
    await generate(admin, id, seeded, g)
```

- [ ] **Step 4: Persist the two fields in `generateBracket`**

In `generateBracket` (around line 155-157), replace:

```typescript
  const g = resolveGroupCount(parseGroupsField(formData), seeded.length)
  try {
    await generate(admin, id, seeded, g)
```

with:

```typescript
  const g = resolveGroupCount(parseGroupsField(formData), seeded.length)
  const roundStartDate = parseRoundStartDate(formData)
  const roundGapDays = parseRoundGapDays(formData)
  await admin
    .from('tournaments')
    .update({ round_start_date: roundStartDate, round_gap_days: roundGapDays })
    .eq('id', id)
  try {
    await generate(admin, id, seeded, g)
```

- [ ] **Step 5: Type-check and build**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/tournaments/bracket-admin-actions.ts
git commit -m "feat: auto-stamp scheduled_at on initial bracket generation"
```

---

### Task 5: Admin form — round start date + gap inputs

**Files:**
- Modify: `components/admin/BracketActions.tsx`
- Modify: `app/admin/tournaments/[id]/bracket/page.tsx:14-46`

**Interfaces:**
- Consumes: `lib/format.ts` gains `todayDateLocal(): string` (added in this task's Step 1) for the default value shown on first generation.
- Produces: `BracketActions` now takes two additional props `roundStartDate: string | null` and `roundGapDays: number`; its forms submit `roundStartDate`/`roundGapDays` fields consumed by Task 4's `parseRoundStartDate`/`parseRoundGapDays`.

- [ ] **Step 1: Add `todayDateLocal` to `lib/format.ts`**

Add after `fromDateLocal` (end of file):

```typescript
/** Today's date in WAT as "YYYY-MM-DD", for defaulting a date input. */
export function todayDateLocal(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: TZ })
}
```

- [ ] **Step 2: Write a failing test for it**

Add to `lib/format.test.ts`:

```typescript
import { formatNaira, fromDateLocal, todayDateLocal } from './format'

describe('todayDateLocal', () => {
  it('returns a YYYY-MM-DD string', () => {
    expect(todayDateLocal()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
```

(Update the existing `import { formatNaira, fromDateLocal } from './format'` line at the top of `lib/format.test.ts` to include `todayDateLocal` as shown above, rather than adding a second import line.)

- [ ] **Step 3: Run the test to verify it fails, then passes**

Run: `npx vitest run lib/format.test.ts`
Expected first: FAIL (`todayDateLocal` is not exported). After Step 1's addition is in place: PASS.

- [ ] **Step 4: Update `AdminBracketPage` to fetch and pass the new fields**

In `app/admin/tournaments/[id]/bracket/page.tsx`, change the tournament select (line 16-19) from:

```typescript
  const { data: t } = await supabase
    .from('tournaments')
    .select('id, title, status')
    .eq('id', params.id)
    .maybeSingle()
```

to:

```typescript
  const { data: t } = await supabase
    .from('tournaments')
    .select('id, title, status, round_start_date, round_gap_days')
    .eq('id', params.id)
    .maybeSingle()
```

And change the `<BracketActions ... />` call (line 46) from:

```typescript
      <BracketActions tournamentId={t.id} status={t.status} paidCount={paidCount ?? 0} />
```

to:

```typescript
      <BracketActions
        tournamentId={t.id}
        status={t.status}
        paidCount={paidCount ?? 0}
        roundStartDate={t.round_start_date}
        roundGapDays={t.round_gap_days}
      />
```

- [ ] **Step 5: Add the two inputs to `BracketActions.tsx`**

Change the props type and destructuring (lines 28-36) from:

```typescript
export function BracketActions({
  tournamentId,
  status,
  paidCount,
}: {
  tournamentId: string
  status: string
  paidCount: number
}) {
```

to:

```typescript
export function BracketActions({
  tournamentId,
  status,
  paidCount,
  roundStartDate,
  roundGapDays,
}: {
  tournamentId: string
  status: string
  paidCount: number
  roundStartDate: string | null
  roundGapDays: number
}) {
```

Add the import at the top of the file:

```typescript
import { todayDateLocal } from '@/lib/format'
```

After the existing `groupPicker` constant (after line 67), add:

```typescript
  const roundSchedulingFields = (
    <>
      <label className="flex items-center gap-2 text-sm text-slate-300">
        Round start date
        <input
          type="date"
          name="roundStartDate"
          defaultValue={roundStartDate ?? todayDateLocal()}
          className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-sm text-white"
        />
      </label>
      <label className="flex items-center gap-2 text-sm text-slate-300">
        Days between rounds
        <input
          type="number"
          name="roundGapDays"
          min={1}
          defaultValue={roundGapDays}
          className="w-16 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-sm text-white"
        />
      </label>
    </>
  )
```

Add `{roundSchedulingFields}` to both forms — inside the `registration_open` form right after `{groupPicker}` (around line 74), and inside the re-roll `<form action={rollAction} ...>` right after its `{groupPicker}` (around line 95). Both spots currently read:

```typescript
          {groupPicker}
```

Change each to:

```typescript
          {groupPicker}
          {roundSchedulingFields}
```

- [ ] **Step 6: Run the full test suite and type-check**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add lib/format.ts lib/format.test.ts components/admin/BracketActions.tsx app/admin/tournaments/\[id\]/bracket/page.tsx
git commit -m "feat: add round start date + gap inputs to bracket generation UI"
```

---

### Task 6: Wire into knockout advancement — `lib/matches/verify-actions.ts`

**Files:**
- Modify: `lib/matches/verify-actions.ts:41-179` (`recomputeGroupAndMaybeAdvance`, `advanceKnockout`)

**Interfaces:**
- Consumes: `nextRoundScheduledAt(admin, tournamentId)` (Task 3, `@/lib/tournaments/round-schedule`).

- [ ] **Step 1: Add the import**

At the top of `lib/matches/verify-actions.ts`, add:

```typescript
import { nextRoundScheduledAt } from '@/lib/tournaments/round-schedule'
```

- [ ] **Step 2: Stamp the round in `recomputeGroupAndMaybeAdvance`**

Replace the knockout-round insert at the end of `recomputeGroupAndMaybeAdvance` (lines 118-138):

```typescript
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
```

with:

```typescript
  const advancers = collectAdvancers(standingsPerGroup)
  if (advancers.length < 2) return
  const { round, matches, byePlayerIds } = knockoutRound1(advancers)
  const roundDate = await nextRoundScheduledAt(admin, tournamentId)
  const schedule = roundDate ? { scheduled_at: roundDate, is_full_day: true } : {}
  const rows = [
    ...matches.map(([a, b]) => ({
      tournament_id: tournamentId,
      round,
      group_id: null,
      player_a_id: a,
      player_b_id: b,
      status: 'scheduled',
      ...schedule,
    })),
    ...byePlayerIds.map((pid) => ({
      tournament_id: tournamentId,
      round,
      group_id: null,
      player_a_id: pid,
      player_b_id: null,
      status: 'bye',
      ...schedule,
    })),
  ]
  if (rows.length > 0) await admin.from('matches').insert(rows)
}
```

(This call happens strictly before the new round's rows are inserted, so `nextRoundScheduledAt`'s distinct-round count still reflects only the rounds that existed prior to this insert — the count that must be used to compute this round's own date.)

- [ ] **Step 3: Stamp the round in `advanceKnockout`**

Replace the tail of `advanceKnockout` (lines 159-179):

```typescript
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
```

with:

```typescript
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
  const roundDate = await nextRoundScheduledAt(admin, tournamentId)
  const schedule = roundDate ? { scheduled_at: roundDate, is_full_day: true } : {}
  await admin.from('matches').insert(
    pairs.map(([a, b]) => ({
      tournament_id: tournamentId,
      round: nr,
      group_id: null,
      player_a_id: a,
      player_b_id: b,
      status: 'scheduled',
      ...schedule,
    })),
  )
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/matches/verify-actions.ts
git commit -m "feat: auto-stamp scheduled_at on knockout round advancement"
```

---

### Task 7: End-to-end verification + ROADMAP entry

**Files:**
- Modify: `ROADMAP.md` (append to the "Follow-ups / tech debt" section)

**Interfaces:** None (final integration/documentation task).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests PASS, including `lib/tournaments/round-schedule.test.ts` and the new `lib/format.test.ts` case.

- [ ] **Step 2: Run the production build**

Run: `npm run build`
Expected: builds cleanly, no type errors.

- [ ] **Step 3: Manual admin verification**

Using an existing tournament in `registration_open` status (or a fresh test tournament):
1. Open `/admin/tournaments/[id]/bracket`.
2. Confirm the "Round start date" input is pre-filled with today's date and "Days between rounds" with `1`.
3. Set a start date a few days out, set gap to `2`, click "Close registration & generate".
4. Open `/admin/tournaments/[id]/matches` — confirm every generated match shows the chosen start date with "Full day" mode selected (not blank).
5. If the tournament has a group stage: confirm a match, verify group standings recompute and (once the group stage fully resolves) the newly generated knockout-round-1 matches land on start-date + 2 days.
6. On the Matches page, manually edit one match's date far into the future, then resolve another round to trigger the next auto-advance — confirm the next round's auto-assigned date is unaffected by that manual edit (still exactly `previous-auto-date + gap_days`), proving the distinct-round-count approach ignores per-match overrides as designed.

- [ ] **Step 4: Add the ROADMAP follow-up entry**

Append a new bullet to the "Follow-ups / tech debt" section of `ROADMAP.md` (after the existing "Timezone display (app-wide)" bullet):

```markdown
- ✅ **Automatic round scheduling:** admin sets a round start date + gap-between-rounds once on
  the bracket page; every round generated from then on (initial draw, group→knockout advance,
  each knockout round) is auto-stamped with that round's full-day date via
  `lib/tournaments/round-schedule.ts`, instead of requiring every match to be hand-dated. Computed
  from the count of distinct rounds already generated (never from any match's own `scheduled_at`),
  so a manually-overridden individual match can't skew later auto-scheduled rounds.
```

- [ ] **Step 5: Commit**

```bash
git add ROADMAP.md
git commit -m "docs: log automatic round scheduling in ROADMAP follow-ups"
```
