# Admin Knockout Pairing Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give admins opt-in control over knockout-round pairings — hold auto-generation for manual arrangement, and rearrange an already-generated (unplayed) round — plus close the signup gap that let nameless players into brackets.

**Architecture:** A per-tournament `manual_knockout_pairing` flag makes `advanceKnockout` / `recomputeGroupAndMaybeAdvance` skip next-round insertion. The admin bracket page detects a "round ready to arrange", shows a pairing editor pre-filled with the default pairing, and a server action validates the chosen assignment against a server-re-derived participant set before inserting. A sibling action rearranges an existing all-unplayed round in place and re-notifies affected players. Independently, tournament registration is refused for a caller with no claimed username.

**Tech Stack:** Next.js 14 App Router, TypeScript, Server Actions with `useFormState`, Supabase (service-role `createAdminClient` for writes), Zod, Vitest, Tailwind.

**Spec:** `docs/superpowers/specs/2026-08-30-admin-knockout-pairing-control-design.md`

## Global Constraints

- Mobile-first, design for 375px width (CLAUDE.md rule 1).
- All writes to `matches` / `tournaments` / `tournament_registrations` go through `createAdminClient()` (service role) inside a Server Action whose own `requireStaff()` / auth checks are the trust boundary — the client is never trusted for participant lists, counts, or round names (CLAUDE.md rules 3, 4).
- Bracket updates only ever happen on an explicit admin action, never auto-derived from player submissions (CLAUDE.md rule 5).
- Knockout round names must come from `roundNameForBracketSize` / `nextRoundName` — never hand-picked (`lib/tournaments/draw.ts` header warning: a mis-named round pays the full prize pool twice).
- Every knockout `matches` row: `round` from the canonical set, `group_id: null`, `status` `'scheduled'` for a pair or `'bye'` for a single player, scheduling from `nextRoundScheduledAt`.
- New notification code reuses the existing `'fixture_assigned'` `NotificationType` — do not add a union member.
- Server Actions used with `useFormState` keep the `(_prev, formData) => Promise<State>` signature.
- Migrations: next number is `075`. Apply via the Supabase MCP `apply_migration` tool (the CLI is intermittently unreachable on this machine — see memory `project_supabase_connectivity_gotcha`).

---

## File Structure

**New files:**
- `supabase/migrations/075_manual_knockout_pairing.sql` — add the flag column.
- `lib/tournaments/knockout-pairing.ts` — pure helpers: slot-shape math, default assignment, assignment validation, pending-round detection, rearrangeable-round detection.
- `lib/tournaments/knockout-pairing.test.ts` — unit tests for the above.
- `lib/tournaments/knockout-pairing-actions.ts` — `createKnockoutRound`, `swapKnockoutPairing` server actions.
- `lib/tournaments/knockout-pairing-actions.test.ts` — action tests with a mocked admin client.
- `components/admin/KnockoutPairingEditor.tsx` — client editor, used for both "create" and "rearrange".

**Modified files:**
- `lib/supabase/types.ts` — `manual_knockout_pairing` in `tournaments` Row/Insert/Update.
- `lib/tournaments/admin-schema.ts` — `manualKnockoutPairing` field.
- `lib/tournaments/admin-actions.ts` — `parseForm` + `toRow` carry the flag.
- `components/admin/TournamentForm.tsx` + `TournamentFormValues` — checkbox.
- `app/[locale]/admin/tournaments/new/page.tsx` — `EMPTY` gets `manualKnockoutPairing: false`.
- `app/[locale]/admin/tournaments/[id]/edit/page.tsx` — `initial` maps `t.manual_knockout_pairing`.
- `lib/matches/verify-actions.ts` — gate both auto-generators.
- `lib/matches/verify-actions.test.ts` — gate tests.
- `components/admin/AdminBracketView.tsx` — render the editor(s).
- `app/[locale]/admin/tournaments/[id]/bracket/page.tsx` — compute pending / rearrangeable round, pass down.
- `lib/tournaments/actions.ts` — `registerForTournament` username gate; `RegisterState` gains `needsUsername`.
- `components/tournament/RegistrationPanel.tsx` — claim-username CTA.
- `app/[locale]/(public)/tournaments/[slug]/page.tsx` — load caller `username`, pass `hasUsername`.
- `app/[locale]/(auth)/onboarding/username/page.tsx` + `lib/onboarding/actions.ts` — honour `?next=`.
- `lib/tournaments/actions.test.ts` (create if absent) — gate test.
- `lib/onboarding/actions.test.ts` (extend if present, else create) — `next` sanitisation test.

---

## Task 1: Add the `manual_knockout_pairing` flag (schema → form)

**Files:**
- Create: `supabase/migrations/075_manual_knockout_pairing.sql`
- Modify: `lib/supabase/types.ts` (tournaments Row ~2240, Insert ~2270, Update ~2300)
- Modify: `lib/tournaments/admin-schema.ts`
- Modify: `lib/tournaments/admin-actions.ts` (`parseForm` ~18-41, `toRow` ~44-68)
- Modify: `components/admin/TournamentForm.tsx` (`TournamentFormValues` ~6-28; add control near the `format` select ~140-152)
- Modify: `app/[locale]/admin/tournaments/new/page.tsx` (`EMPTY` ~10-31)
- Modify: `app/[locale]/admin/tournaments/[id]/edit/page.tsx` (`initial` ~29-51)
- Test: `lib/tournaments/admin-schema.test.ts`

**Interfaces:**
- Produces: `tournaments.manual_knockout_pairing boolean not null default false`; `TournamentInput.manualKnockoutPairing: boolean` (zod `.default(false)`); form field name `manualKnockoutPairing` with value `"true"` when checked.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/075_manual_knockout_pairing.sql`:

```sql
-- 075_manual_knockout_pairing.sql
-- Opt-in: when true, a finished knockout round (or the finished group stage)
-- does NOT auto-generate the next round. The admin arranges each round's
-- pairings in the bracket page's pairing editor, and createKnockoutRound
-- inserts + notifies. Default false = unchanged auto-advancement.
-- See lib/matches/verify-actions.ts (advanceKnockout / recomputeGroupAndMaybeAdvance)
-- and lib/tournaments/knockout-pairing-actions.ts.

alter table public.tournaments
  add column manual_knockout_pairing boolean not null default false;
```

- [ ] **Step 2: Apply the migration**

Use the Supabase MCP `apply_migration` tool: name `075_manual_knockout_pairing`, the SQL above. Confirm success with `list_migrations` (075 present) or `execute_sql`: `select column_name from information_schema.columns where table_name='tournaments' and column_name='manual_knockout_pairing';` — expect one row.

- [ ] **Step 3: Update generated types**

In `lib/supabase/types.ts`, add `manual_knockout_pairing: boolean` to the `tournaments` `Row` block (alphabetical order — right after `invitation_only: boolean`), and `manual_knockout_pairing?: boolean` to both the `Insert` and `Update` blocks (after their `invitation_only?: boolean`).

- [ ] **Step 4: Write the failing schema test**

In `lib/tournaments/admin-schema.test.ts`, add:

```ts
it('defaults manualKnockoutPairing to false when absent', () => {
  const r = tournamentSchema.safeParse({
    title: 'T', gameId: '00000000-0000-0000-0000-000000000000',
    registrationFee: 0, prizePool: 0, tournamentType: 'open',
  })
  expect(r.success).toBe(true)
  if (r.success) expect(r.data.manualKnockoutPairing).toBe(false)
})

it('coerces a "true" checkbox value to boolean true', () => {
  const r = tournamentSchema.safeParse({
    title: 'T', gameId: '00000000-0000-0000-0000-000000000000',
    registrationFee: 0, prizePool: 0, tournamentType: 'open',
    manualKnockoutPairing: 'true',
  })
  expect(r.success && r.data.manualKnockoutPairing).toBe(true)
})
```

(If the existing test file has a different shape for the minimal valid object, match it — check the other `tournamentSchema` tests in the file first.)

- [ ] **Step 5: Run the test to verify it fails**

Run: `npx vitest run lib/tournaments/admin-schema.test.ts`
Expected: FAIL — `manualKnockoutPairing` is `undefined`.

- [ ] **Step 6: Add the schema field**

In `lib/tournaments/admin-schema.ts`, inside the `z.object({...})` (next to `format`):

```ts
    manualKnockoutPairing: z
      .union([z.literal('true'), z.literal('false'), z.literal(''), z.boolean()])
      .transform((v) => v === true || v === 'true')
      .default(false),
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run lib/tournaments/admin-schema.test.ts`
Expected: PASS.

- [ ] **Step 8: Thread the field through the create/update action**

In `lib/tournaments/admin-actions.ts` `parseForm`, add to the object passed to `tournamentSchema.safeParse`:

```ts
    manualKnockoutPairing: formData.get('manualKnockoutPairing') ?? 'false',
```

In `toRow`, add to the returned object:

```ts
    manual_knockout_pairing: d.manualKnockoutPairing,
```

- [ ] **Step 9: Add the form control**

In `components/admin/TournamentForm.tsx`:
- Add `manualKnockoutPairing: boolean` to `TournamentFormValues`.
- After the `format` `<select>` block (~line 152), add:

```tsx
      <label className="flex items-start gap-2 text-sm text-slate-300">
        <input
          type="checkbox"
          name="manualKnockoutPairing"
          value="true"
          defaultChecked={initial.manualKnockoutPairing}
          className="mt-0.5 accent-violet-600"
        />
        <span>
          Arrange knockout pairings manually
          <span className="mt-0.5 block text-xs text-slate-500">
            Completed rounds won&apos;t auto-generate the next round — you&apos;ll
            arrange each round&apos;s fixtures on the bracket page before players
            are notified.
          </span>
        </span>
      </label>
```

- [ ] **Step 10: Set the field in both page `initial` objects**

`app/[locale]/admin/tournaments/new/page.tsx` — add `manualKnockoutPairing: false,` to `EMPTY`.
`app/[locale]/admin/tournaments/[id]/edit/page.tsx` — add `manualKnockoutPairing: t.manual_knockout_pairing,` to `initial`.

- [ ] **Step 11: Typecheck + full test run**

Run: `npx tsc --noEmit && npx vitest run lib/tournaments/`
Expected: no type errors; all pass.

- [ ] **Step 12: Commit**

```bash
git add supabase/migrations/075_manual_knockout_pairing.sql lib/supabase/types.ts lib/tournaments/admin-schema.ts lib/tournaments/admin-schema.test.ts lib/tournaments/admin-actions.ts components/admin/TournamentForm.tsx "app/[locale]/admin/tournaments/new/page.tsx" "app/[locale]/admin/tournaments/[id]/edit/page.tsx"
git commit -m "feat(tournaments): add manual_knockout_pairing flag"
```

---

## Task 2: Pure pairing helpers — shape, default, validation

**Files:**
- Create: `lib/tournaments/knockout-pairing.ts`
- Test: `lib/tournaments/knockout-pairing.test.ts`

**Interfaces:**
- Consumes: `knockoutRound1` (`lib/tournaments/draw.ts` — `(orderedPlayerIds: string[]) => { round: KnockoutRoundName; matches: [string,string][]; byePlayerIds: string[] }`), `pairWinners` (`lib/tournaments/advancement.ts` — `(byeWinnerIds: string[], matchWinnerIds: string[]) => { pairs: [string,string][]; leftover: string | null }`).
- Produces:
  - `interface SlotShape { byeCount: number; matchCount: number }`
  - `interface PairingAssignment { byePlayerIds: string[]; matchPairs: [string, string][] }`
  - `type AssignmentCheck = { ok: true } | { ok: false; reason: string }`
  - `defaultAssignmentFirstRound(orderedParticipantIds: string[]): PairingAssignment`
  - `defaultAssignmentNextRound(byeWinnerIds: string[], matchWinnerIds: string[]): PairingAssignment`
  - `shapeOf(assignment: PairingAssignment): SlotShape`
  - `validateAssignment(trueParticipantIds: string[], shape: SlotShape, assignment: PairingAssignment): AssignmentCheck`

- [ ] **Step 1: Write the failing tests**

Create `lib/tournaments/knockout-pairing.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  defaultAssignmentFirstRound,
  defaultAssignmentNextRound,
  shapeOf,
  validateAssignment,
} from './knockout-pairing'

describe('defaultAssignmentFirstRound', () => {
  it('pairs 8 participants into 4 matches, no byes', () => {
    const a = defaultAssignmentFirstRound(['1', '2', '3', '4', '5', '6', '7', '8'])
    expect(a.byePlayerIds).toEqual([])
    expect(a.matchPairs).toEqual([
      ['1', '8'],
      ['2', '7'],
      ['3', '6'],
      ['4', '5'],
    ])
  })
  it('gives the top seeds byes when the count is not a power of two (12 -> 4 byes + 4 matches)', () => {
    const a = defaultAssignmentFirstRound(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'])
    expect(a.byePlayerIds).toEqual(['1', '2', '3', '4'])
    expect(a.matchPairs).toEqual([
      ['5', '12'],
      ['6', '11'],
      ['7', '10'],
      ['8', '9'],
    ])
  })
})

describe('defaultAssignmentNextRound', () => {
  it('interleaves byes with match-winners then pairs (4 byes + 4 winners)', () => {
    const a = defaultAssignmentNextRound(['b1', 'b2', 'b3', 'b4'], ['w1', 'w2', 'w3', 'w4'])
    expect(a.byePlayerIds).toEqual([])
    expect(a.matchPairs).toEqual([
      ['b1', 'w1'],
      ['b2', 'w2'],
      ['b3', 'w3'],
      ['b4', 'w4'],
    ])
  })
  it('leaves the last player out as a bye when the advancer count is odd', () => {
    const a = defaultAssignmentNextRound(['b1'], ['w1', 'w2'])
    expect(a.matchPairs).toEqual([['b1', 'w1']])
    expect(a.byePlayerIds).toEqual(['w2'])
  })
  it('handles no byes (later rounds)', () => {
    const a = defaultAssignmentNextRound([], ['w1', 'w2', 'w3', 'w4'])
    expect(a).toEqual({ byePlayerIds: [], matchPairs: [['w1', 'w2'], ['w3', 'w4']] })
  })
})

describe('shapeOf', () => {
  it('counts slots', () => {
    expect(shapeOf({ byePlayerIds: ['x'], matchPairs: [['a', 'b'], ['c', 'd']] })).toEqual({
      byeCount: 1,
      matchCount: 2,
    })
  })
})

describe('validateAssignment', () => {
  const truth = ['a', 'b', 'c', 'd']
  const shape = { byeCount: 0, matchCount: 2 }

  it('accepts a valid permutation', () => {
    expect(
      validateAssignment(truth, shape, { byePlayerIds: [], matchPairs: [['a', 'c'], ['b', 'd']] }),
    ).toEqual({ ok: true })
  })
  it('rejects a duplicated player', () => {
    const r = validateAssignment(truth, shape, { byePlayerIds: [], matchPairs: [['a', 'a'], ['b', 'd']] })
    expect(r.ok).toBe(false)
  })
  it('rejects an unknown player', () => {
    const r = validateAssignment(truth, shape, { byePlayerIds: [], matchPairs: [['a', 'z'], ['b', 'd']] })
    expect(r.ok).toBe(false)
  })
  it('rejects a missing player', () => {
    const r = validateAssignment(truth, shape, { byePlayerIds: [], matchPairs: [['a', 'b'], ['c', '']] })
    expect(r.ok).toBe(false)
  })
  it('rejects the wrong bye count', () => {
    const r = validateAssignment(truth, { byeCount: 1, matchCount: 2 }, {
      byePlayerIds: [], matchPairs: [['a', 'b'], ['c', 'd']],
    })
    expect(r.ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/tournaments/knockout-pairing.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helpers**

Create `lib/tournaments/knockout-pairing.ts`:

```ts
import { knockoutRound1 } from './draw'
import { pairWinners } from './advancement'

export interface SlotShape {
  byeCount: number
  matchCount: number
}

export interface PairingAssignment {
  byePlayerIds: string[]
  matchPairs: [string, string][]
}

export type AssignmentCheck = { ok: true } | { ok: false; reason: string }

// Editor pre-fill for the FIRST knockout round: mirrors knockoutRound1
// (top (2^k - n) seeds get byes, the rest pair highest-vs-lowest).
export function defaultAssignmentFirstRound(orderedParticipantIds: string[]): PairingAssignment {
  const { matches, byePlayerIds } = knockoutRound1(orderedParticipantIds)
  return { byePlayerIds, matchPairs: matches }
}

// Editor pre-fill for a SUBSEQUENT knockout round: mirrors pairWinners
// (interleave the previous round's bye-winners with its match-winners, pair
// sequentially, the odd one out gets a bye).
export function defaultAssignmentNextRound(
  byeWinnerIds: string[],
  matchWinnerIds: string[],
): PairingAssignment {
  const { pairs, leftover } = pairWinners(byeWinnerIds, matchWinnerIds)
  return { byePlayerIds: leftover ? [leftover] : [], matchPairs: pairs }
}

export function shapeOf(assignment: PairingAssignment): SlotShape {
  return { byeCount: assignment.byePlayerIds.length, matchCount: assignment.matchPairs.length }
}

// Every true participant used exactly once; slot counts respected; no blanks.
export function validateAssignment(
  trueParticipantIds: string[],
  shape: SlotShape,
  assignment: PairingAssignment,
): AssignmentCheck {
  if (assignment.byePlayerIds.length !== shape.byeCount)
    return { ok: false, reason: `Expected ${shape.byeCount} bye slot(s).` }
  if (assignment.matchPairs.length !== shape.matchCount)
    return { ok: false, reason: `Expected ${shape.matchCount} match(es).` }

  const used = [...assignment.byePlayerIds, ...assignment.matchPairs.flat()]
  if (used.some((id) => !id)) return { ok: false, reason: 'Every slot must have a player.' }

  const truth = new Set(trueParticipantIds)
  for (const id of used) {
    if (!truth.has(id)) return { ok: false, reason: 'That player is not in this round.' }
  }
  if (used.length !== trueParticipantIds.length)
    return { ok: false, reason: 'Wrong number of players for this round.' }
  if (new Set(used).size !== used.length)
    return { ok: false, reason: 'A player is in more than one slot.' }

  return { ok: true }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/tournaments/knockout-pairing.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/tournaments/knockout-pairing.ts lib/tournaments/knockout-pairing.test.ts
git commit -m "feat(tournaments): pure knockout pairing helpers"
```

---

## Task 3: Gate the auto-generators on the flag

**Files:**
- Modify: `lib/matches/verify-actions.ts` — `recomputeGroupAndMaybeAdvance` (~81-187), `advanceKnockout` (~190-259)
- Test: `lib/matches/verify-actions.test.ts`

**Interfaces:**
- Consumes: `tournaments.manual_knockout_pairing` (Task 1).
- Produces: unchanged function signatures; both become no-ops for next-round insertion when the flag is on. `advanceKnockout` still runs `roundResolved` / third-place / completion via `confirmResult`'s other calls (those are separate calls in `confirmResult`, not inside `advanceKnockout`).

- [ ] **Step 1: Write the failing tests**

In `lib/matches/verify-actions.test.ts`, add a fake admin for the group-knockout gate and two tests:

```ts
// Group-knockout advance path, flag ON: recomputeGroupStats runs (empty group),
// then the manual-pairing gate must stop before any groups/advancer query.
function fakeAdminForManualPairingGroup() {
  return {
    from(table: string) {
      if (table === 'group_memberships')
        return { select: () => ({ eq: async () => ({ data: [] }) }) }
      if (table === 'tournaments')
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { format: 'group_knockout', manual_knockout_pairing: true },
              }),
            }),
          }),
        }
      if (table === 'matches')
        return {
          select: (_c: unknown, opts?: unknown) =>
            opts
              ? { eq: () => ({ neq: async () => ({ count: 0 }) }), }
              : { eq: () => ({ eq: async () => ({ data: [] }) }) },
        }
      if (table === 'groups') throw new Error('must not reach advancer collection when flag is on')
      throw new Error(`unexpected table ${table}`)
    },
  }
}

describe('recomputeGroupAndMaybeAdvance — manual_knockout_pairing', () => {
  it('does not generate the first knockout round when the flag is on', async () => {
    const { notifyNewFixtures } = await import('@/lib/notifications/fixture-created')
    vi.mocked(notifyNewFixtures).mockClear()
    const admin = fakeAdminForManualPairingGroup()
    await expect(
      recomputeGroupAndMaybeAdvance(admin as never, 't1', 'g1'),
    ).resolves.toBeUndefined()
    expect(notifyNewFixtures).not.toHaveBeenCalled()
  })
})

function fakeAdminForAdvanceKnockoutFlag(flag: boolean) {
  return {
    from(table: string) {
      if (table === 'tournaments')
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: { manual_knockout_pairing: flag } }) }),
          }),
        }
      if (table === 'matches') {
        if (flag) throw new Error('must not query matches when flag is on')
        return { select: () => ({ eq: () => ({ eq: async () => ({ data: [] }) }) }) }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

describe('advanceKnockout — manual_knockout_pairing', () => {
  it('returns early without touching matches when the flag is on', async () => {
    const { advanceKnockout } = await import('./verify-actions')
    const admin = fakeAdminForAdvanceKnockoutFlag(true)
    await expect(advanceKnockout(admin as never, 't1', 'quarter_final')).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run lib/matches/verify-actions.test.ts`
Expected: FAIL — `recomputeGroupAndMaybeAdvance` currently queries `groups`; `advanceKnockout` currently queries `matches` first and has no `tournaments` select.

- [ ] **Step 3: Gate `recomputeGroupAndMaybeAdvance`**

In `lib/matches/verify-actions.ts`, change the `tour` select to include the flag and add the gate right after the `round_robin` branch returns:

```ts
  const { data: tour } = await admin
    .from('tournaments')
    .select('format, manual_knockout_pairing')
    .eq('id', tournamentId)
    .maybeSingle()
  if (tour?.format === 'round_robin') {
    // ... unchanged round_robin block ...
  }

  // Manual knockout pairing: hold the first knockout round for the admin to
  // arrange on the bracket page (createKnockoutRound). Standings above are
  // already refreshed; nothing else to do here.
  if (tour?.manual_knockout_pairing) return
```

- [ ] **Step 4: Gate `advanceKnockout`**

At the very top of `advanceKnockout`, before the existing `roundMatches` query:

```ts
export async function advanceKnockout(admin: Admin, tournamentId: string, round: string): Promise<void> {
  const { data: t } = await admin
    .from('tournaments')
    .select('manual_knockout_pairing')
    .eq('id', tournamentId)
    .maybeSingle()
  if (t?.manual_knockout_pairing) return
  // ... existing body unchanged ...
```

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run lib/matches/verify-actions.test.ts`
Expected: PASS (all existing tests still green too).

- [ ] **Step 6: Commit**

```bash
git add lib/matches/verify-actions.ts lib/matches/verify-actions.test.ts
git commit -m "feat(tournaments): hold knockout generation when manual pairing is on"
```

---

## Task 4: Pending-round + rearrangeable-round detection

**Files:**
- Modify: `lib/tournaments/knockout-pairing.ts`
- Modify: `lib/tournaments/knockout-pairing.test.ts`

**Interfaces:**
- Consumes: `BracketMatch` (`lib/tournaments/bracket.ts` — `{ id, round, status, score_a, score_b, playerA: {id,name}, playerB: {id,name} }`), `ROUND_ORDER` + `ROUND_LABELS` (`lib/tournaments/bracket.ts`), `orderKnockoutRounds` output shape, `matchWinnerId` + `roundResolved` + `nextRoundName` (`lib/tournaments/advancement.ts`), `collectAdvancers` (`lib/tournaments/results.ts`), `roundNameForBracketSize` + `nextPow2` (`lib/tournaments/draw.ts`).
- Produces:
  - `interface PairingParticipant { id: string; name: string; source: string }`
  - `interface PendingKnockoutRound { round: string; label: string; shape: SlotShape; participants: PairingParticipant[]; defaultAssignment: PairingAssignment }`
  - `computePendingKnockoutRound(input: PendingInput): PendingKnockoutRound | null`
  - `interface RearrangeableKnockoutRound { round: string; label: string; shape: SlotShape; participants: PairingParticipant[]; currentAssignment: PairingAssignment; matchIdByPairIndex: string[]; byeMatchIdByIndex: string[] }`
  - `computeRearrangeableKnockoutRound(input: RearrangeInput): RearrangeableKnockoutRound | null`
  - Both inputs (`PendingInput`, `RearrangeInput`) exported — see code below.

- [ ] **Step 1: Write the failing tests**

Append to `lib/tournaments/knockout-pairing.test.ts`:

```ts
import {
  computePendingKnockoutRound,
  computeRearrangeableKnockoutRound,
} from './knockout-pairing'
import type { BracketMatch } from './bracket'

function bm(over: Partial<BracketMatch>): BracketMatch {
  return {
    id: 'm', round: 'round_of_16', group_id: null, groupName: null,
    status: 'completed', score_a: 1, score_b: 0, scheduled_at: null, is_full_day: true,
    playerA: { id: 'a', name: 'A' }, playerB: { id: 'b', name: 'B' }, ...over,
  }
}

describe('computePendingKnockoutRound', () => {
  it('returns null when the flag is off', () => {
    expect(
      computePendingKnockoutRound({
        manualPairingEnabled: false, hasGroups: true, groupStageComplete: true,
        standings: [], knockoutRounds: [],
      }),
    ).toBeNull()
  })

  it('proposes the first knockout round from group advancers once the group stage is done', () => {
    const standings = [
      { groupName: 'Group A', rows: [
        { playerId: 'a1', name: 'A1', advancing: true },
        { playerId: 'a2', name: 'A2', advancing: true },
        { playerId: 'a3', name: 'A3', advancing: false },
      ]},
      { groupName: 'Group B', rows: [
        { playerId: 'b1', name: 'B1', advancing: true },
        { playerId: 'b2', name: 'B2', advancing: true },
      ]},
    ]
    const p = computePendingKnockoutRound({
      manualPairingEnabled: true, hasGroups: true, groupStageComplete: true,
      standings, knockoutRounds: [],
    })
    expect(p?.round).toBe('semi_final') // 4 advancers -> bracket size 4
    expect(p?.participants.map((x) => x.id)).toEqual(['a1', 'b1', 'a2', 'b2']) // winners then runners-up
    expect(p?.shape).toEqual({ byeCount: 0, matchCount: 2 })
    expect(p?.defaultAssignment.matchPairs).toEqual([['a1', 'b2'], ['b1', 'a2']])
  })

  it('waits for the group stage to finish', () => {
    expect(
      computePendingKnockoutRound({
        manualPairingEnabled: true, hasGroups: true, groupStageComplete: false,
        standings: [{ groupName: 'A', rows: [
          { playerId: 'a1', name: 'A1', advancing: true },
          { playerId: 'a2', name: 'A2', advancing: true },
        ]}],
        knockoutRounds: [],
      }),
    ).toBeNull()
  })

  it('proposes the next round once the current round is fully resolved', () => {
    const qf = [
      bm({ id: 'q1', round: 'quarter_final', playerA: { id: 'w1', name: 'W1' }, playerB: { id: 'l1', name: 'L1' }, score_a: 2, score_b: 0 }),
      bm({ id: 'q2', round: 'quarter_final', playerA: { id: 'l2', name: 'L2' }, playerB: { id: 'w2', name: 'W2' }, score_a: 0, score_b: 1 }),
      bm({ id: 'q3', round: 'quarter_final', playerA: { id: 'w3', name: 'W3' }, playerB: { id: 'l3', name: 'L3' }, score_a: 3, score_b: 1 }),
      bm({ id: 'q4', round: 'quarter_final', playerA: { id: 'w4', name: 'W4' }, playerB: { id: 'l4', name: 'L4' }, score_a: 5, score_b: 2 }),
    ]
    const p = computePendingKnockoutRound({
      manualPairingEnabled: true, hasGroups: true, groupStageComplete: true,
      standings: [], knockoutRounds: [{ round: 'quarter_final', matches: qf }],
    })
    expect(p?.round).toBe('semi_final')
    expect(p?.participants.map((x) => x.id).sort()).toEqual(['w1', 'w2', 'w3', 'w4'])
    expect(p?.shape).toEqual({ byeCount: 0, matchCount: 2 })
  })

  it('returns null when the next round already exists', () => {
    const qf = [bm({ id: 'q1', round: 'quarter_final', score_a: 1, score_b: 0 })]
    const sf = [bm({ id: 's1', round: 'semi_final', status: 'scheduled', score_a: null, score_b: null })]
    expect(
      computePendingKnockoutRound({
        manualPairingEnabled: true, hasGroups: true, groupStageComplete: true,
        standings: [], knockoutRounds: [
          { round: 'quarter_final', matches: qf },
          { round: 'semi_final', matches: sf },
        ],
      }),
    ).toBeNull()
  })

  it('returns null when the current round is not resolved', () => {
    const qf = [
      bm({ id: 'q1', round: 'quarter_final', status: 'scheduled', score_a: null, score_b: null }),
    ]
    expect(
      computePendingKnockoutRound({
        manualPairingEnabled: true, hasGroups: true, groupStageComplete: true,
        standings: [], knockoutRounds: [{ round: 'quarter_final', matches: qf }],
      }),
    ).toBeNull()
  })

  it('returns null after the final', () => {
    const f = [bm({ id: 'f1', round: 'final', score_a: 2, score_b: 1 })]
    expect(
      computePendingKnockoutRound({
        manualPairingEnabled: true, hasGroups: true, groupStageComplete: true,
        standings: [], knockoutRounds: [{ round: 'final', matches: f }],
      }),
    ).toBeNull()
  })
})

describe('computeRearrangeableKnockoutRound', () => {
  it('offers the most advanced all-unplayed knockout round', () => {
    const qf = [
      bm({ id: 'q1', round: 'quarter_final', status: 'scheduled', score_a: null, score_b: null,
        playerA: { id: 'p1', name: 'P1' }, playerB: { id: 'p2', name: 'P2' } }),
      bm({ id: 'q2', round: 'quarter_final', status: 'scheduled', score_a: null, score_b: null,
        playerA: { id: 'p3', name: 'P3' }, playerB: { id: 'p4', name: 'P4' } }),
    ]
    const r = computeRearrangeableKnockoutRound({ knockoutRounds: [{ round: 'quarter_final', matches: qf }] })
    expect(r?.round).toBe('quarter_final')
    expect(r?.participants.map((x) => x.id).sort()).toEqual(['p1', 'p2', 'p3', 'p4'])
    expect(r?.currentAssignment.matchPairs).toEqual([['p1', 'p2'], ['p3', 'p4']])
    expect(r?.matchIdByPairIndex).toEqual(['q1', 'q2'])
  })

  it('returns null when any match in the round has been played', () => {
    const qf = [
      bm({ id: 'q1', round: 'quarter_final', status: 'completed', score_a: 1, score_b: 0 }),
      bm({ id: 'q2', round: 'quarter_final', status: 'scheduled', score_a: null, score_b: null }),
    ]
    expect(
      computeRearrangeableKnockoutRound({ knockoutRounds: [{ round: 'quarter_final', matches: qf }] }),
    ).toBeNull()
  })

  it('returns null when there are no knockout rounds', () => {
    expect(computeRearrangeableKnockoutRound({ knockoutRounds: [] })).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/tournaments/knockout-pairing.test.ts`
Expected: FAIL — new exports missing.

- [ ] **Step 3: Implement the detectors**

Append to `lib/tournaments/knockout-pairing.ts`:

```ts
import type { BracketMatch } from './bracket'
import { ROUND_ORDER, ROUND_LABELS } from './bracket'
import { matchWinnerId, roundResolved, nextRoundName } from './advancement'
import { collectAdvancers } from './results'
import { roundNameForBracketSize, nextPow2 } from './draw'

export interface PairingParticipant {
  id: string
  name: string
  source: string
}

export interface PendingKnockoutRound {
  round: string
  label: string
  shape: SlotShape
  participants: PairingParticipant[]
  defaultAssignment: PairingAssignment
}

interface StandingGroup {
  groupName: string
  rows: { playerId: string; name: string; advancing: boolean }[]
}

export interface PendingInput {
  manualPairingEnabled: boolean
  hasGroups: boolean
  groupStageComplete: boolean
  standings: StandingGroup[]
  knockoutRounds: { round: string; matches: BracketMatch[] }[]
}

const knockoutIndex = (round: string) =>
  ROUND_ORDER.indexOf(round as (typeof ROUND_ORDER)[number])

// The advancing knockout round that still needs to be created, or null.
export function computePendingKnockoutRound(input: PendingInput): PendingKnockoutRound | null {
  if (!input.manualPairingEnabled) return null

  const existing = new Set(input.knockoutRounds.map((r) => r.round))

  // First knockout round: group stage done, no knockout rounds yet.
  if (input.hasGroups && input.knockoutRounds.length === 0) {
    if (!input.groupStageComplete) return null
    const nameById = new Map<string, string>()
    for (const g of input.standings) for (const r of g.rows) nameById.set(r.playerId, r.name)
    const advancerIds = collectAdvancers(
      input.standings.map((g) => g.rows.map((r) => ({ playerId: r.playerId, advancing: r.advancing }))),
    )
    if (advancerIds.length < 2) return null
    const round = roundNameForBracketSize(nextPow2(advancerIds.length))
    const def = defaultAssignmentFirstRound(advancerIds)
    return {
      round,
      label: ROUND_LABELS[round] ?? round,
      shape: shapeOf(def),
      participants: advancerIds.map((id, i) => ({
        id,
        name: nameById.get(id) ?? 'Player',
        source: i < input.standings.length ? 'Group winner' : 'Group runner-up',
      })),
      defaultAssignment: def,
    }
  }

  // Subsequent round: find the most advanced resolved round whose successor
  // exists in ROUND_ORDER and has not been created.
  const resolvedRounds = input.knockoutRounds
    .filter((r) => knockoutIndex(r.round) !== -1 && roundResolved(toAdvance(r.matches)))
    .sort((a, b) => knockoutIndex(b.round) - knockoutIndex(a.round))

  for (const r of resolvedRounds) {
    const next = nextRoundName(r.round)
    if (!next || existing.has(next)) continue
    const byeWinners = r.matches
      .filter((m) => m.status === 'bye')
      .map((m) => m.playerA.id)
      .filter(Boolean)
    const decided = r.matches.filter((m) => m.status === 'completed')
    const matchWinners = decided.map((m) => winnerOf(m)).filter((x): x is string => !!x)
    const nameById = new Map<string, string>()
    for (const m of r.matches) {
      if (m.playerA.id) nameById.set(m.playerA.id, m.playerA.name)
      if (m.playerB.id) nameById.set(m.playerB.id, m.playerB.name)
    }
    const participantIds = [...byeWinners, ...matchWinners]
    if (participantIds.length < 2) return null
    const def = defaultAssignmentNextRound(byeWinners, matchWinners)
    return {
      round: next,
      label: ROUND_LABELS[next] ?? next,
      shape: shapeOf(def),
      participants: participantIds.map((id) => ({
        id,
        name: nameById.get(id) ?? 'Player',
        source: byeWinners.includes(id) ? 'Bye' : 'Round winner',
      })),
      defaultAssignment: def,
    }
  }
  return null
}

export interface RearrangeableKnockoutRound {
  round: string
  label: string
  shape: SlotShape
  participants: PairingParticipant[]
  currentAssignment: PairingAssignment
  matchIdByPairIndex: string[]
  byeMatchIdByIndex: string[]
}

export interface RearrangeInput {
  knockoutRounds: { round: string; matches: BracketMatch[] }[]
}

// The most advanced knockout round whose matches are ALL still unplayed
// (scheduled or bye, no score) — safe to re-pair in place.
export function computeRearrangeableKnockoutRound(
  input: RearrangeInput,
): RearrangeableKnockoutRound | null {
  const candidates = input.knockoutRounds
    .filter((r) => knockoutIndex(r.round) !== -1 && r.matches.length > 0)
    .filter((r) =>
      r.matches.every(
        (m) =>
          (m.status === 'scheduled' || m.status === 'bye') &&
          m.score_a == null &&
          m.score_b == null,
      ),
    )
    .sort((a, b) => knockoutIndex(b.round) - knockoutIndex(a.round))

  const r = candidates[0]
  if (!r) return null

  const pairMatches = r.matches.filter((m) => m.status === 'scheduled')
  const byeMatches = r.matches.filter((m) => m.status === 'bye')
  const nameById = new Map<string, string>()
  for (const m of r.matches) {
    if (m.playerA.id) nameById.set(m.playerA.id, m.playerA.name)
    if (m.playerB.id) nameById.set(m.playerB.id, m.playerB.name)
  }
  const currentAssignment: PairingAssignment = {
    byePlayerIds: byeMatches.map((m) => m.playerA.id),
    matchPairs: pairMatches.map((m) => [m.playerA.id, m.playerB.id] as [string, string]),
  }
  const participantIds = [
    ...currentAssignment.byePlayerIds,
    ...currentAssignment.matchPairs.flat(),
  ]
  return {
    round: r.round,
    label: ROUND_LABELS[r.round] ?? r.round,
    shape: shapeOf(currentAssignment),
    participants: participantIds.map((id) => ({
      id,
      name: nameById.get(id) ?? 'Player',
      source: currentAssignment.byePlayerIds.includes(id) ? 'Bye' : 'Player',
    })),
    currentAssignment,
    matchIdByPairIndex: pairMatches.map((m) => m.id),
    byeMatchIdByIndex: byeMatches.map((m) => m.id),
  }
}

// --- local adapters ---
type AdvanceLike = {
  status: string
  score_a: number | null
  score_b: number | null
  player_a_id: string | null
  player_b_id: string | null
}
function toAdvance(matches: BracketMatch[]): AdvanceLike[] {
  return matches.map((m) => ({
    status: m.status,
    score_a: m.score_a,
    score_b: m.score_b,
    player_a_id: m.playerA.id || null,
    player_b_id: m.playerB.id || null,
  }))
}
function winnerOf(m: BracketMatch): string | null {
  return matchWinnerId({
    status: m.status,
    score_a: m.score_a,
    score_b: m.score_b,
    player_a_id: m.playerA.id || null,
    player_b_id: m.playerB.id || null,
  })
}
```

Note: the first-round `source` label ("Group winner" vs "runner-up") uses `collectAdvancers`' known ordering — all winners first (one per group), then all runners-up — so index `< groupCount` ⇒ winner.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/tournaments/knockout-pairing.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add lib/tournaments/knockout-pairing.ts lib/tournaments/knockout-pairing.test.ts
git commit -m "feat(tournaments): detect pending / rearrangeable knockout rounds"
```

---

## Task 5: `createKnockoutRound` server action

**Files:**
- Create: `lib/tournaments/knockout-pairing-actions.ts`
- Create: `lib/tournaments/knockout-pairing-actions.test.ts`

**Interfaces:**
- Consumes: `createAdminClient` (`lib/supabase/admin.ts`), `requireStaff` (`lib/admin/auth.ts`), `loadBracketView` (`lib/tournaments/bracket-view.ts` — `(supabase, tournamentId, format) => Promise<BracketView>`; `BracketView.fixtures` is `{ live, upcoming, completed, disputedOrCancelled }`, `BracketView.standings` is `{ groupId, groupName, rows: StandingRow[] }[]` where `StandingRow` has `playerId`, `name`, `advancing`), `computePendingKnockoutRound` + `validateAssignment` (Tasks 2/4), `nextRoundScheduledAt` (`lib/tournaments/round-schedule.ts`), `notifyNewFixtures` (`lib/notifications/fixture-created.ts` — `(admin, NewFixtureRow[])`), `revalidatePath`.
- Produces:
  - `type KnockoutPairingState = { error?: string; success?: boolean } | undefined`
  - `createKnockoutRound(_prev: KnockoutPairingState, formData: FormData): Promise<KnockoutPairingState>` — reads `tournamentId`, `round`, `assignment` (JSON string `{ byePlayerIds: string[]; matchPairs: [string,string][] }`).

- [ ] **Step 1: Write the failing tests**

Create `lib/tournaments/knockout-pairing-actions.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/admin/auth', () => ({ requireStaff: vi.fn().mockResolvedValue({ userId: 'staff' }) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/notifications/fixture-created', () => ({ notifyNewFixtures: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const PENDING = {
  round: 'semi_final',
  label: 'Semi-finals',
  shape: { byeCount: 0, matchCount: 2 },
  participants: [
    { id: 'w1', name: 'W1', source: 'Round winner' },
    { id: 'w2', name: 'W2', source: 'Round winner' },
    { id: 'w3', name: 'W3', source: 'Round winner' },
    { id: 'w4', name: 'W4', source: 'Round winner' },
  ],
  defaultAssignment: { byePlayerIds: [], matchPairs: [['w1', 'w2'], ['w3', 'w4']] },
}

vi.mock('@/lib/tournaments/bracket-view', () => ({
  loadBracketView: vi.fn().mockResolvedValue({
    standings: [], rounds: [], fixtures: { live: [], upcoming: [], completed: [], disputedOrCancelled: [] },
    projected: [], champion: null, thirdPlace: null, hasGroups: true, hasKnockout: true,
  }),
}))
vi.mock('@/lib/tournaments/knockout-pairing', async (orig) => ({
  ...(await orig<typeof import('@/lib/tournaments/knockout-pairing')>()),
  computePendingKnockoutRound: vi.fn(() => PENDING),
}))
vi.mock('@/lib/tournaments/round-schedule', () => ({ nextRoundScheduledAt: vi.fn().mockResolvedValue(null) }))

function fd(obj: Record<string, string>) {
  const f = new FormData()
  for (const [k, v] of Object.entries(obj)) f.set(k, v)
  return f
}

function fakeAdmin(insertSpy: (rows: unknown) => void, tournamentFormat = 'group_knockout') {
  return {
    from(table: string) {
      if (table === 'tournaments')
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { format: tournamentFormat, slug: 's' } }) }) }) }
      if (table === 'matches')
        return {
          select: (_c: unknown, opts?: unknown) =>
            opts
              ? { eq: () => ({ eq: async () => ({ count: 0 }) }) } // round-exists check -> 0
              : { eq: () => ({ eq: async () => ({ data: [] }) }) },
          insert: (rows: unknown) => {
            insertSpy(rows)
            return { select: async () => ({ data: (rows as unknown[]).map((_, i) => ({ id: `new${i}`, player_a_id: 'x', player_b_id: 'y', scheduled_at: null, is_full_day: true })) }) }
          },
        }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

describe('createKnockoutRound', () => {
  it('rejects an assignment that is not a permutation of the true participants', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    vi.mocked(createAdminClient).mockReturnValue(fakeAdmin(() => {}) as never)
    const { createKnockoutRound } = await import('./knockout-pairing-actions')
    const r = await createKnockoutRound(undefined, fd({
      tournamentId: 't1', round: 'semi_final',
      assignment: JSON.stringify({ byePlayerIds: [], matchPairs: [['w1', 'w1'], ['w3', 'w4']] }),
    }))
    expect(r?.error).toBeTruthy()
  })

  it('rejects when the submitted round is not the pending round', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    vi.mocked(createAdminClient).mockReturnValue(fakeAdmin(() => {}) as never)
    const { createKnockoutRound } = await import('./knockout-pairing-actions')
    const r = await createKnockoutRound(undefined, fd({
      tournamentId: 't1', round: 'final',
      assignment: JSON.stringify({ byePlayerIds: [], matchPairs: [['w1', 'w2'], ['w3', 'w4']] }),
    }))
    expect(r?.error).toBeTruthy()
  })

  it('inserts scheduled rows for a valid assignment and notifies', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const { notifyNewFixtures } = await import('@/lib/notifications/fixture-created')
    vi.mocked(notifyNewFixtures).mockClear()
    let inserted: unknown = null
    vi.mocked(createAdminClient).mockReturnValue(fakeAdmin((rows) => { inserted = rows }) as never)
    const { createKnockoutRound } = await import('./knockout-pairing-actions')
    const r = await createKnockoutRound(undefined, fd({
      tournamentId: 't1', round: 'semi_final',
      assignment: JSON.stringify({ byePlayerIds: [], matchPairs: [['w1', 'w3'], ['w2', 'w4']] }),
    }))
    expect(r?.success).toBe(true)
    expect(Array.isArray(inserted) && (inserted as unknown[]).length).toBe(2)
    expect((inserted as Array<Record<string, unknown>>)[0]).toMatchObject({ round: 'semi_final', status: 'scheduled', group_id: null })
    expect(notifyNewFixtures).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/tournaments/knockout-pairing-actions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `createKnockoutRound`**

Create `lib/tournaments/knockout-pairing-actions.ts`:

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaff } from '@/lib/admin/auth'
import { loadBracketView } from './bracket-view'
import {
  computePendingKnockoutRound,
  computeRearrangeableKnockoutRound,
  validateAssignment,
  type PairingAssignment,
} from './knockout-pairing'
import { nextRoundScheduledAt } from './round-schedule'
import { notifyNewFixtures } from '@/lib/notifications/fixture-created'
import { notifyInApp } from '@/lib/notifications/inbox'
import { pushToPlayer } from '@/lib/notifications/push'

export type KnockoutPairingState = { error?: string; success?: boolean } | undefined

type Admin = ReturnType<typeof createAdminClient>

const assignmentSchema = z.object({
  byePlayerIds: z.array(z.string().uuid()),
  matchPairs: z.array(z.tuple([z.string().uuid(), z.string().uuid()])),
})

function parseAssignment(raw: FormDataEntryValue | null): PairingAssignment | null {
  if (typeof raw !== 'string') return null
  try {
    const parsed = assignmentSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

function revalidate(tournamentId: string, slug: string | null): void {
  revalidatePath(`/admin/tournaments/${tournamentId}/bracket`)
  revalidatePath(`/admin/tournaments/${tournamentId}/matches`)
  if (slug) {
    revalidatePath(`/tournaments/${slug}`)
    revalidatePath(`/tournaments/${slug}/bracket`)
  }
}

async function groupStageComplete(view: Awaited<ReturnType<typeof loadBracketView>>): Promise<boolean> {
  return (
    view.hasGroups &&
    view.fixtures.completed.length > 0 &&
    view.fixtures.live.length === 0 &&
    view.fixtures.upcoming.length === 0 &&
    view.fixtures.disputedOrCancelled.length === 0
  )
}

export async function createKnockoutRound(
  _prev: KnockoutPairingState,
  formData: FormData,
): Promise<KnockoutPairingState> {
  await requireStaff()
  const tournamentId = String(formData.get('tournamentId') ?? '')
  const round = String(formData.get('round') ?? '')
  const assignment = parseAssignment(formData.get('assignment'))
  if (!tournamentId || !round) return { error: 'Missing tournament or round.' }
  if (!assignment) return { error: 'Could not read the pairing. Please try again.' }

  const admin = createAdminClient()
  const { data: t } = await admin
    .from('tournaments')
    .select('format, slug')
    .eq('id', tournamentId)
    .maybeSingle()
  if (!t) return { error: 'Tournament not found.' }

  const view = await loadBracketView(admin, tournamentId, t.format)
  const pending = computePendingKnockoutRound({
    manualPairingEnabled: true,
    hasGroups: view.hasGroups,
    groupStageComplete: await groupStageComplete(view),
    standings: view.standings.map((g) => ({
      groupName: g.groupName,
      rows: g.rows.map((r) => ({ playerId: r.playerId, name: r.name, advancing: r.advancing })),
    })),
    knockoutRounds: view.rounds.map((r) => ({ round: r.round, matches: r.matches })),
  })
  if (!pending) return { error: 'No knockout round is ready to be created right now.' }
  if (pending.round !== round)
    return { error: `The round ready to create is ${pending.label}, not ${round}.` }

  const check = validateAssignment(
    pending.participants.map((p) => p.id),
    pending.shape,
    assignment,
  )
  if (!check.ok) return { error: check.reason }

  // Idempotency: never insert into a round that already has rows.
  const { count: existing } = await admin
    .from('matches')
    .select('*', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)
    .eq('round', round)
  if (existing && existing > 0) return { error: 'This round has already been created.' }

  const roundDate = await nextRoundScheduledAt(admin, tournamentId)
  const schedule = roundDate ? { scheduled_at: roundDate, is_full_day: true } : {}
  const rows = [
    ...assignment.matchPairs.map(([a, b]) => ({
      tournament_id: tournamentId,
      round,
      group_id: null,
      player_a_id: a,
      player_b_id: b,
      status: 'scheduled',
      ...schedule,
    })),
    ...assignment.byePlayerIds.map((pid) => ({
      tournament_id: tournamentId,
      round,
      group_id: null,
      player_a_id: pid,
      player_b_id: null,
      status: 'bye',
      ...schedule,
    })),
  ]

  const { data: insertedRows, error } = await admin
    .from('matches')
    .insert(rows)
    .select('id, player_a_id, player_b_id, scheduled_at, is_full_day')
  if (error) return { error: 'Could not create the round. Please try again.' }

  await notifyNewFixtures(
    admin,
    (insertedRows ?? []).map((m) => ({
      id: m.id,
      tournamentId,
      playerAId: m.player_a_id as string,
      playerBId: m.player_b_id,
      scheduledAt: m.scheduled_at,
      isFullDay: m.is_full_day,
    })),
  )

  revalidate(tournamentId, t.slug)
  return { success: true }
}
```

(The `notifyInApp` / `pushToPlayer` imports are used by Task 6 in the same file — add them now to avoid a second edit.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/tournaments/knockout-pairing-actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/tournaments/knockout-pairing-actions.ts lib/tournaments/knockout-pairing-actions.test.ts
git commit -m "feat(tournaments): createKnockoutRound action"
```

---

## Task 6: `swapKnockoutPairing` server action

**Files:**
- Modify: `lib/tournaments/knockout-pairing-actions.ts`
- Modify: `lib/tournaments/knockout-pairing-actions.test.ts`

**Interfaces:**
- Consumes: same imports as Task 5 plus `computeRearrangeableKnockoutRound` (Task 4), `notifyInApp` (`lib/notifications/inbox.ts`), `pushToPlayer` (`lib/notifications/push.ts`).
- Produces: `swapKnockoutPairing(_prev: KnockoutPairingState, formData: FormData): Promise<KnockoutPairingState>` — reads `tournamentId`, `round`, `assignment` (same JSON shape).

- [ ] **Step 1: Write the failing tests**

Append to `lib/tournaments/knockout-pairing-actions.test.ts`:

```ts
import type { BracketMatch } from './bracket'

function kmatch(over: Partial<BracketMatch>): BracketMatch {
  return {
    id: 'm', round: 'quarter_final', group_id: null, groupName: null,
    status: 'scheduled', score_a: null, score_b: null, scheduled_at: null, is_full_day: true,
    playerA: { id: 'a', name: 'A' }, playerB: { id: 'b', name: 'B' }, ...over,
  }
}

describe('swapKnockoutPairing', () => {
  const QF: BracketMatch[] = [
    kmatch({ id: 'q1', playerA: { id: 'p1', name: 'P1' }, playerB: { id: 'p2', name: 'P2' } }),
    kmatch({ id: 'q2', playerA: { id: 'p3', name: 'P3' }, playerB: { id: 'p4', name: 'P4' } }),
  ]

  function withRounds(matches: BracketMatch[]) {
    return {
      standings: [], rounds: [{ round: 'quarter_final', label: 'Quarter-finals', matches }],
      fixtures: { live: [], upcoming: [], completed: [], disputedOrCancelled: [] },
      projected: [], champion: null, thirdPlace: null, hasGroups: true, hasKnockout: true,
    }
  }

  it('rejects when a match in the round is already played', async () => {
    const { loadBracketView } = await import('@/lib/tournaments/bracket-view')
    vi.mocked(loadBracketView).mockResolvedValueOnce(
      withRounds([kmatch({ id: 'q1', status: 'completed', score_a: 1, score_b: 0 }), QF[1]]) as never,
    )
    const { createAdminClient } = await import('@/lib/supabase/admin')
    vi.mocked(createAdminClient).mockReturnValue({
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { format: 'group_knockout', slug: 's' } }) }) }) }),
    } as never)
    const { swapKnockoutPairing } = await import('./knockout-pairing-actions')
    const r = await swapKnockoutPairing(undefined, fd({
      tournamentId: 't1', round: 'quarter_final',
      assignment: JSON.stringify({ byePlayerIds: [], matchPairs: [['p1', 'p3'], ['p2', 'p4']] }),
    }))
    expect(r?.error).toBeTruthy()
  })

  it('updates changed rows in place and notifies only affected players', async () => {
    const { loadBracketView } = await import('@/lib/tournaments/bracket-view')
    vi.mocked(loadBracketView).mockResolvedValueOnce(withRounds(QF) as never)
    const updates: Array<{ id: string; row: Record<string, unknown> }> = []
    const inApp: string[] = []
    const { createAdminClient } = await import('@/lib/supabase/admin')
    vi.mocked(createAdminClient).mockReturnValue({
      from: (table: string) => {
        if (table === 'tournaments')
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { format: 'group_knockout', slug: 's' } }) }) }) }
        if (table === 'matches')
          return {
            update: (row: Record<string, unknown>) => ({
              eq: async (_col: string, id: string) => { updates.push({ id, row }); return { error: null } },
            }),
          }
        if (table === 'profiles')
          return { select: () => ({ in: async () => ({ data: [
            { id: 'p1', username: 'P1', display_name: 'P1' }, { id: 'p2', username: 'P2', display_name: 'P2' },
            { id: 'p3', username: 'P3', display_name: 'P3' }, { id: 'p4', username: 'P4', display_name: 'P4' },
          ] }) }) }
        throw new Error(`unexpected ${table}`)
      },
    } as never)
    const { notifyInApp } = await import('@/lib/notifications/inbox')
    vi.mocked(notifyInApp).mockImplementation(async ({ playerId }) => { inApp.push(playerId) })

    const { swapKnockoutPairing } = await import('./knockout-pairing-actions')
    // Swap so q1 becomes P1 v P3 and q2 becomes P2 v P4 — all four players change opponent.
    const r = await swapKnockoutPairing(undefined, fd({
      tournamentId: 't1', round: 'quarter_final',
      assignment: JSON.stringify({ byePlayerIds: [], matchPairs: [['p1', 'p3'], ['p2', 'p4']] }),
    }))
    expect(r?.success).toBe(true)
    expect(updates.map((u) => u.id).sort()).toEqual(['q1', 'q2'])
    expect(inApp.sort()).toEqual(['p1', 'p2', 'p3', 'p4'])
  })

  it('is a no-op with no updates when the assignment matches the current pairing', async () => {
    const { loadBracketView } = await import('@/lib/tournaments/bracket-view')
    vi.mocked(loadBracketView).mockResolvedValueOnce(withRounds(QF) as never)
    const updates: string[] = []
    const { createAdminClient } = await import('@/lib/supabase/admin')
    vi.mocked(createAdminClient).mockReturnValue({
      from: (table: string) => {
        if (table === 'tournaments')
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { format: 'group_knockout', slug: 's' } }) }) }) }
        if (table === 'matches')
          return { update: () => ({ eq: async (_c: string, id: string) => { updates.push(id); return { error: null } } }) }
        if (table === 'profiles')
          return { select: () => ({ in: async () => ({ data: [] }) }) }
        throw new Error(`unexpected ${table}`)
      },
    } as never)
    const { swapKnockoutPairing } = await import('./knockout-pairing-actions')
    const r = await swapKnockoutPairing(undefined, fd({
      tournamentId: 't1', round: 'quarter_final',
      assignment: JSON.stringify({ byePlayerIds: [], matchPairs: [['p1', 'p2'], ['p3', 'p4']] }),
    }))
    expect(r?.success).toBe(true)
    expect(updates).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/tournaments/knockout-pairing-actions.test.ts`
Expected: FAIL — `swapKnockoutPairing` not exported.

- [ ] **Step 3: Implement `swapKnockoutPairing`**

Append to `lib/tournaments/knockout-pairing-actions.ts`:

```ts
export async function swapKnockoutPairing(
  _prev: KnockoutPairingState,
  formData: FormData,
): Promise<KnockoutPairingState> {
  await requireStaff()
  const tournamentId = String(formData.get('tournamentId') ?? '')
  const round = String(formData.get('round') ?? '')
  const assignment = parseAssignment(formData.get('assignment'))
  if (!tournamentId || !round) return { error: 'Missing tournament or round.' }
  if (!assignment) return { error: 'Could not read the pairing. Please try again.' }

  const admin = createAdminClient()
  const { data: t } = await admin
    .from('tournaments')
    .select('format, slug')
    .eq('id', tournamentId)
    .maybeSingle()
  if (!t) return { error: 'Tournament not found.' }

  const view = await loadBracketView(admin, tournamentId, t.format)
  const rearrangeable = computeRearrangeableKnockoutRound({
    knockoutRounds: view.rounds.map((r) => ({ round: r.round, matches: r.matches })),
  })
  if (!rearrangeable || rearrangeable.round !== round)
    return { error: 'This round can no longer be rearranged — results may already be in.' }

  const check = validateAssignment(
    rearrangeable.participants.map((p) => p.id),
    rearrangeable.shape,
    assignment,
  )
  if (!check.ok) return { error: check.reason }

  // Map new assignment onto the existing rows, slot by slot. Match rows keep
  // their ids/schedules; only (player_a_id, player_b_id, status) can change.
  type RowChange = { id: string; player_a_id: string; player_b_id: string | null; status: string }
  const desired: RowChange[] = [
    ...assignment.matchPairs.map((pair, i) => ({
      id: rearrangeable.matchIdByPairIndex[i] ?? rearrangeable.byeMatchIdByIndex[i - rearrangeable.matchIdByPairIndex.length],
      player_a_id: pair[0],
      player_b_id: pair[1],
      status: 'scheduled',
    })),
    ...assignment.byePlayerIds.map((pid, i) => ({
      id: rearrangeable.byeMatchIdByIndex[i] ?? rearrangeable.matchIdByPairIndex[i + assignment.matchPairs.length],
      player_a_id: pid,
      player_b_id: null,
      status: 'bye',
    })),
  ]

  const before = new Map(
    [
      ...rearrangeable.currentAssignment.matchPairs.map((p, i) => [
        rearrangeable.matchIdByPairIndex[i],
        { a: p[0], b: p[1] as string | null, status: 'scheduled' },
      ]),
      ...rearrangeable.currentAssignment.byePlayerIds.map((pid, i) => [
        rearrangeable.byeMatchIdByIndex[i],
        { a: pid, b: null as string | null, status: 'bye' },
      ]),
    ] as [string, { a: string; b: string | null; status: string }][],
  )

  const changedPlayerIds = new Set<string>()
  for (const d of desired) {
    const prev = before.get(d.id)
    if (prev && prev.a === d.player_a_id && prev.b === d.player_b_id && prev.status === d.status) continue
    const { error } = await admin
      .from('matches')
      .update({ player_a_id: d.player_a_id, player_b_id: d.player_b_id, status: d.status })
      .eq('id', d.id)
    if (error) return { error: 'Could not save the new pairing. Please try again.' }
    for (const pid of [d.player_a_id, d.player_b_id, prev?.a, prev?.b]) if (pid) changedPlayerIds.add(pid)
  }

  if (changedPlayerIds.size > 0) {
    const ids = Array.from(changedPlayerIds)
    const { data: profiles } = await admin.from('profiles').select('id, username, display_name').in('id', ids)
    const nameById = new Map(
      (profiles ?? []).map((p) => [p.id, p.display_name ?? p.username ?? 'Player']),
    )
    // Re-derive each changed player's new opponent from `desired`.
    const opponentOf = (pid: string): string | null => {
      for (const d of desired) {
        if (d.player_a_id === pid) return d.player_b_id
        if (d.player_b_id === pid) return d.player_a_id
      }
      return null
    }
    for (const pid of ids) {
      const opp = opponentOf(pid)
      const body = opp
        ? `Your ${rearrangeable.label} fixture changed — you now play ${nameById.get(opp) ?? 'your opponent'}.`
        : `Your ${rearrangeable.label} fixture changed — you now have a bye.`
      await notifyInApp({ playerId: pid, type: 'fixture_assigned', title: 'Fixture updated', body, link: `/tournaments/${t.slug}/bracket` })
      void pushToPlayer(pid, 'match_assigned', { title: 'Fixture updated', body }, { url: `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sentinelx.gg'}/tournaments/${t.slug}/bracket` })
    }
  }

  revalidate(tournamentId, t.slug)
  return { success: true }
}
```

Note on `pushToPlayer` signature — confirm against `lib/notifications/push.ts` before writing; it is called elsewhere as `pushToPlayer(playerId, type, { title, body }, { url })`. Match the real signature.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/tournaments/knockout-pairing-actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + full lib test run**

Run: `npx tsc --noEmit && npx vitest run lib/`
Expected: clean; all pass.

- [ ] **Step 6: Commit**

```bash
git add lib/tournaments/knockout-pairing-actions.ts lib/tournaments/knockout-pairing-actions.test.ts
git commit -m "feat(tournaments): swapKnockoutPairing action with affected-player re-notify"
```

---

## Task 7: Pairing editor UI + bracket page wiring

**Files:**
- Create: `components/admin/KnockoutPairingEditor.tsx`
- Modify: `components/admin/AdminBracketView.tsx`
- Modify: `app/[locale]/admin/tournaments/[id]/bracket/page.tsx`

**Interfaces:**
- Consumes: `createKnockoutRound`, `swapKnockoutPairing`, `KnockoutPairingState` (Tasks 5/6); `computePendingKnockoutRound`, `computeRearrangeableKnockoutRound` (Task 4); `loadBracketView` output already loaded by the page.
- Produces: `<KnockoutPairingEditor mode="create" | "rearrange" tournamentId round label participants shape defaultAssignment />` — a client component; `participants: { id: string; name: string; source: string }[]`, `shape: { byeCount: number; matchCount: number }`, `defaultAssignment: { byePlayerIds: string[]; matchPairs: [string,string][] }`.

- [ ] **Step 1: Build the editor component**

Create `components/admin/KnockoutPairingEditor.tsx`:

```tsx
'use client'
import { useMemo, useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import {
  createKnockoutRound,
  swapKnockoutPairing,
  type KnockoutPairingState,
} from '@/lib/tournaments/knockout-pairing-actions'

interface Participant { id: string; name: string; source: string }
interface Assignment { byePlayerIds: string[]; matchPairs: [string, string][] }

// Flat list of slot positions: byeCount single slots, then matchCount*2 slots.
function flatten(a: Assignment): string[] {
  return [...a.byePlayerIds, ...a.matchPairs.flat()]
}
function unflatten(flat: string[], byeCount: number): Assignment {
  const byePlayerIds = flat.slice(0, byeCount)
  const rest = flat.slice(byeCount)
  const matchPairs: [string, string][] = []
  for (let i = 0; i + 1 < rest.length; i += 2) matchPairs.push([rest[i], rest[i + 1]])
  return { byePlayerIds, matchPairs }
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-xl bg-violet-600 px-6 py-3 text-sm font-bold text-white hover:bg-violet-500 disabled:opacity-60"
    >
      {pending ? 'Saving…' : label}
    </button>
  )
}

export function KnockoutPairingEditor({
  mode,
  tournamentId,
  round,
  label,
  participants,
  shape,
  defaultAssignment,
}: {
  mode: 'create' | 'rearrange'
  tournamentId: string
  round: string
  label: string
  participants: Participant[]
  shape: { byeCount: number; matchCount: number }
  defaultAssignment: Assignment
}) {
  const action = mode === 'create' ? createKnockoutRound : swapKnockoutPairing
  const [state, formAction] = useFormState<KnockoutPairingState, FormData>(action, undefined)
  const [flat, setFlat] = useState<string[]>(() => flatten(defaultAssignment))

  const nameById = useMemo(
    () => new Map(participants.map((p) => [p.id, p.name])),
    [participants],
  )
  const slotCount = shape.byeCount + shape.matchCount * 2
  const dupes = flat.filter((id, i) => id && flat.indexOf(id) !== i)
  const missing = participants.filter((p) => !flat.includes(p.id))
  const valid = flat.length === slotCount && flat.every(Boolean) && dupes.length === 0 && missing.length === 0

  const setSlot = (i: number, id: string) => {
    setFlat((cur) => {
      const next = [...cur]
      next[i] = id
      return next
    })
  }

  const options = participants
  const slotLabel = (i: number) =>
    i < shape.byeCount
      ? `Bye ${i + 1}`
      : `Match ${Math.floor((i - shape.byeCount) / 2) + 1} · ${(i - shape.byeCount) % 2 === 0 ? 'Home' : 'Away'}`

  const assignment = unflatten(flat, shape.byeCount)

  return (
    <div className="rounded-2xl border border-violet-500/30 bg-violet-500/5 p-4">
      <p className="text-sm font-bold text-white">
        {mode === 'create' ? `Arrange the ${label}` : `Rearrange the ${label}`}
      </p>
      <p className="mt-0.5 text-xs text-slate-400">
        {mode === 'create'
          ? 'Set who plays whom, then create the round. Players are notified once you create it.'
          : 'Change the pairings for this unplayed round. Affected players are re-notified.'}
      </p>

      <form action={formAction} className="mt-3 space-y-2">
        <input type="hidden" name="tournamentId" value={tournamentId} />
        <input type="hidden" name="round" value={round} />
        <input type="hidden" name="assignment" value={JSON.stringify(assignment)} />

        {Array.from({ length: slotCount }, (_, i) => (
          <label key={i} className="flex items-center gap-2 text-sm">
            <span className="w-28 shrink-0 text-xs text-slate-500">{slotLabel(i)}</span>
            <select
              value={flat[i] ?? ''}
              onChange={(e) => setSlot(i, e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
            >
              <option value="">—</option>
              {options.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.source})
                </option>
              ))}
            </select>
          </label>
        ))}

        {!valid && (
          <p className="text-xs text-amber-400">
            {dupes.length > 0
              ? `${nameById.get(dupes[0]) ?? 'A player'} is in more than one slot.`
              : missing.length > 0
                ? `Not placed yet: ${missing.map((m) => m.name).join(', ')}.`
                : 'Fill every slot.'}
          </p>
        )}
        {state?.error && <p className="text-xs text-red-400">{state.error}</p>}
        {state?.success && (
          <p className="text-xs text-emerald-400">
            {mode === 'create' ? 'Round created and players notified.' : 'Pairings updated.'}
          </p>
        )}

        <fieldset disabled={!valid} className="disabled:opacity-60">
          <SubmitButton label={mode === 'create' ? `Create ${label}` : `Save ${label} pairings`} />
        </fieldset>
      </form>
    </div>
  )
}
```

- [ ] **Step 2: Wire detection into the bracket page**

In `app/[locale]/admin/tournaments/[id]/bracket/page.tsx`:

- Add to the `tournaments` select: `manual_knockout_pairing`.
- After `loadBracketView`, compute:

```tsx
import {
  computePendingKnockoutRound,
  computeRearrangeableKnockoutRound,
} from '@/lib/tournaments/knockout-pairing'

// ... after `const view = await loadBracketView(...)`
const groupStageDone =
  view.hasGroups &&
  view.fixtures.completed.length > 0 &&
  view.fixtures.live.length === 0 &&
  view.fixtures.upcoming.length === 0 &&
  view.fixtures.disputedOrCancelled.length === 0

const pendingRound = t.manual_knockout_pairing
  ? computePendingKnockoutRound({
      manualPairingEnabled: true,
      hasGroups: view.hasGroups,
      groupStageComplete: groupStageDone,
      standings: view.standings.map((g) => ({
        groupName: g.groupName,
        rows: g.rows.map((r) => ({ playerId: r.playerId, name: r.name, advancing: r.advancing })),
      })),
      knockoutRounds: view.rounds.map((r) => ({ round: r.round, matches: r.matches })),
    })
  : null

const rearrangeableRound = computeRearrangeableKnockoutRound({
  knockoutRounds: view.rounds.map((r) => ({ round: r.round, matches: r.matches })),
})
```

- Pass `pendingRound` and `rearrangeableRound` to `<AdminBracketView ... />`.

- [ ] **Step 3: Render in `AdminBracketView`**

In `components/admin/AdminBracketView.tsx`, add the two optional props and render the editor above `<BracketTree>`:

```tsx
import { KnockoutPairingEditor } from './KnockoutPairingEditor'
// ...props: pendingRound?: PendingKnockoutRound | null; rearrangeableRound?: RearrangeableKnockoutRound | null; (import the types from '@/lib/tournaments/knockout-pairing')

{pendingRound && (
  <div className="mb-4">
    <KnockoutPairingEditor
      mode="create"
      tournamentId={tournamentId}
      round={pendingRound.round}
      label={pendingRound.label}
      participants={pendingRound.participants}
      shape={pendingRound.shape}
      defaultAssignment={pendingRound.defaultAssignment}
    />
  </div>
)}

{!pendingRound && rearrangeableRound && (
  <details className="mb-4">
    <summary className="cursor-pointer text-xs font-semibold text-slate-400 hover:text-slate-200">
      Rearrange the {rearrangeableRound.label} pairings
    </summary>
    <div className="mt-2">
      <KnockoutPairingEditor
        mode="rearrange"
        tournamentId={tournamentId}
        round={rearrangeableRound.round}
        label={rearrangeableRound.label}
        participants={rearrangeableRound.participants}
        shape={rearrangeableRound.shape}
        defaultAssignment={rearrangeableRound.currentAssignment}
      />
    </div>
  </details>
)}
```

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit && npx next build`
Expected: no type errors; build succeeds. (If `next build` is too slow for the loop, `npx tsc --noEmit` plus `npx eslint components/admin/KnockoutPairingEditor.tsx components/admin/AdminBracketView.tsx "app/[locale]/admin/tournaments/[id]/bracket/page.tsx"` is the minimum.)

- [ ] **Step 5: Manual QA (document result in the commit message)**

On a local/staging tournament with `manual_knockout_pairing = true`:
1. Complete the group stage → the "Arrange the …" editor appears; default pairing matches old auto behaviour.
2. Swap two players, Create → rows inserted, players get a "New fixture" notification, editor disappears, bracket shows the round.
3. Before playing any match in that round, open "Rearrange …", swap, Save → rows update in place (same match URLs), only affected players get "Fixture updated".
4. Play one match in the round → the "Rearrange" affordance disappears.

- [ ] **Step 6: Commit**

```bash
git add components/admin/KnockoutPairingEditor.tsx components/admin/AdminBracketView.tsx "app/[locale]/admin/tournaments/[id]/bracket/page.tsx"
git commit -m "feat(admin): knockout pairing editor on the bracket page"
```

---

## Task 8: Registration username gate

**Files:**
- Modify: `lib/tournaments/actions.ts` — `RegisterState` (~14), `registerForTournament` (after the `if (!user)` at ~37)
- Modify: `app/[locale]/(auth)/onboarding/username/page.tsx`
- Modify: `lib/onboarding/actions.ts` — `claimUsername`
- Modify: `app/[locale]/(public)/tournaments/[slug]/page.tsx` — load `username` (~87-99), pass `hasUsername`
- Modify: `components/tournament/RegistrationPanel.tsx` — `hasUsername` prop + CTA
- Test: `lib/tournaments/actions.test.ts` (create if absent)
- Test: `lib/onboarding/actions.test.ts` (create if absent)

**Interfaces:**
- Consumes: `usernameSchema` (`lib/auth/schema.ts`).
- Produces:
  - `RegisterState = { error?: string; needsUsername?: boolean } | undefined`
  - `safeInternalPath(next: string | null | undefined, fallback: string): string` — exported from `lib/onboarding/actions.ts`, returns `next` only if it starts with `/` and not `//`.

- [ ] **Step 1: Write the failing test for the registration gate**

Create `lib/tournaments/actions.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/paystack/server', () => ({ initializeTransaction: vi.fn(), buildReference: vi.fn() }))
vi.mock('@/lib/coins/service', () => ({ getCoinBalance: vi.fn(), recordCoinTransaction: vi.fn() }))
vi.mock('@/lib/referrals/credit', () => ({ settleReferralForPaidEntry: vi.fn() }))

function fd(obj: Record<string, string>) {
  const f = new FormData()
  for (const [k, v] of Object.entries(obj)) f.set(k, v)
  return f
}

describe('registerForTournament — username gate', () => {
  it('refuses and returns needsUsername when the caller has no claimed username', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({
      auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
      from: (table: string) => {
        if (table === 'profiles')
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { username: null } }) }) }) }
        throw new Error(`unexpected ${table}`)
      },
    } as never)
    const { registerForTournament } = await import('./actions')
    const r = await registerForTournament(undefined, fd({
      tournamentId: 't1', displayName: 'X', whatsapp: '+2340000000000', clubName: 'C', ignTag: '',
    }))
    expect(r?.needsUsername).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/tournaments/actions.test.ts`
Expected: FAIL — no `needsUsername`, and it currently proceeds past the profile check.

- [ ] **Step 3: Add the gate**

In `lib/tournaments/actions.ts`:

```ts
export type RegisterState = { error?: string; needsUsername?: boolean } | undefined
```

Right after `if (!user) return { error: 'Please log in to register.' }`:

```ts
  const { data: callerProfile } = await supabase
    .from('profiles')
    .select('username')
    .eq('id', user.id)
    .maybeSingle()
  if (!callerProfile?.username) {
    return { error: 'Claim a username before registering.', needsUsername: true }
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/tournaments/actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test for `safeInternalPath`**

Create `lib/onboarding/actions.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { safeInternalPath } from './actions'

describe('safeInternalPath', () => {
  it('keeps a relative in-app path', () => {
    expect(safeInternalPath('/tournaments/abc', '/dashboard')).toBe('/tournaments/abc')
  })
  it('rejects a protocol-relative or absolute URL', () => {
    expect(safeInternalPath('//evil.com', '/dashboard')).toBe('/dashboard')
    expect(safeInternalPath('https://evil.com', '/dashboard')).toBe('/dashboard')
  })
  it('falls back when empty or missing', () => {
    expect(safeInternalPath('', '/dashboard')).toBe('/dashboard')
    expect(safeInternalPath(null, '/dashboard')).toBe('/dashboard')
  })
})
```

- [ ] **Step 6: Run to verify it fails**

Run: `npx vitest run lib/onboarding/actions.test.ts`
Expected: FAIL — `safeInternalPath` not exported.

- [ ] **Step 7: Honour `?next=` in the onboarding flow**

In `lib/onboarding/actions.ts`:

```ts
export function safeInternalPath(next: string | null | undefined, fallback: string): string {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//')) return fallback
  return next
}
```

- Add a hidden `next` field read in `claimUsername`: change the final `redirect('/dashboard')` to:

```ts
  const next = safeInternalPath(formData.get('next') as string | null, '/dashboard')
  redirect(next)
```

- In `components/onboarding/ClaimUsernameForm.tsx`, accept an optional `next` prop and render `<input type="hidden" name="next" value={next} />` when set.
- In `app/[locale]/(auth)/onboarding/username/page.tsx`, read `searchParams.next`, pass `safeInternalPath(searchParams.next, '')` (empty ⇒ omit) to `ClaimUsernameForm`, and when the profile already has a username redirect to `safeInternalPath(searchParams.next, '/dashboard')` instead of the hard `/dashboard`.

```tsx
export default async function ClaimUsernamePage({
  searchParams,
}: {
  searchParams: { next?: string }
}) {
  // ...
  if (profile?.username) redirect(safeInternalPath(searchParams.next, '/dashboard'))
  // ...
  const next = safeInternalPath(searchParams.next, '')
  return (
    // ...
    <ClaimUsernameForm defaultUsername={defaultUsername} next={next || undefined} />
  )
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `npx vitest run lib/onboarding/actions.test.ts`
Expected: PASS.

- [ ] **Step 9: Surface the CTA in the registration panel**

In `app/[locale]/(public)/tournaments/[slug]/page.tsx`:
- Add `username` to the logged-in `profiles` select (`.select('display_name, whatsapp_number, username')`).
- Compute `const hasUsername = !!profile?.username` (default `true` when no `user`, so guests still see the normal login CTA).
- Pass `hasUsername={hasUsername}` to `<RegistrationPanel />`.

In `components/tournament/RegistrationPanel.tsx`:
- Add `hasUsername: boolean` to the props.
- In the `can_register` / `complete_payment` branch, before rendering `<RegisterForm>`, when `!hasUsername`:

```tsx
if ((view === 'can_register' || view === 'complete_payment') && !hasUsername) {
  return (
    <div className={box}>
      <p className="text-sm text-slate-300">Claim your SentinelX username before registering.</p>
      <Link
        href={`/onboarding/username?next=/tournaments/${slug}`}
        className="mt-3 block w-full rounded-xl bg-violet-600 px-7 py-3.5 text-center text-sm font-bold text-white hover:bg-violet-500"
      >
        Choose your username
      </Link>
    </div>
  )
}
```

- Also handle the server-action fallback: in `RegisterForm`, when `state?.needsUsername`, render the same link (covers the race where the profile lost its username between page load and submit). Minimal: `{state?.needsUsername && <Link href={`/onboarding/username?next=/tournaments/${slug}`} className="...">Choose your username →</Link>}` near the error line. Pass `slug` into `RegisterForm` for this.

- [ ] **Step 10: Typecheck + targeted tests + build**

Run: `npx tsc --noEmit && npx vitest run lib/tournaments/ lib/onboarding/ && npx next build`
Expected: clean; all pass; build succeeds.

- [ ] **Step 11: Commit**

```bash
git add lib/tournaments/actions.ts lib/tournaments/actions.test.ts lib/onboarding/actions.ts lib/onboarding/actions.test.ts components/onboarding/ClaimUsernameForm.tsx "app/[locale]/(auth)/onboarding/username/page.tsx" "app/[locale]/(public)/tournaments/[slug]/page.tsx" components/tournament/RegistrationPanel.tsx
git commit -m "feat(tournaments): require a claimed username to register"
```

---

## Task 9: Final verification

- [ ] **Step 1: Full test suite**

Run: `npx vitest run`
Expected: all green. (If the repo root has linked worktrees on disk, run from the worktree — see memory `project_vitest_nested_worktree_double_count`.)

- [ ] **Step 2: Typecheck + lint + build**

Run: `npx tsc --noEmit && npx eslint . --max-warnings 0 && npx next build`
Expected: clean.

- [ ] **Step 3: Spec cross-check**

Re-read `docs/superpowers/specs/2026-08-30-admin-knockout-pairing-control-design.md`. Confirm each of Parts 1/2/3 and the Testing section maps to a committed task. Note any deviation in the final commit.

- [ ] **Step 4: Merge to main and push** (per memory `feedback_always_push` — do this once verification passes, without prompting)

```bash
git checkout main && git merge --no-ff <feature-branch> && git push origin main
```

---

## Self-Review

**Spec coverage:**
- Part 1 flag → Task 1. Held generation → Task 3. Pending detection → Task 4. Editor → Task 7. `createKnockoutRound` + pure helpers → Tasks 2, 5. ✓
- Part 2 `swapKnockoutPairing` + in-place update + re-notify affected only → Task 6. Editor reuse (`details` disclosure) → Task 7. ✓
- Part 3 registration gate (action + form) + `/onboarding/username` `next` handling → Task 8. ✓
- Testing section (pure units, action-level, generator gating, registration gate) → Tasks 2, 4, 5, 6, 3, 8. ✓
- "Not in this fix" (no broad backfill) — respected; no task touches other NULL-username profiles. ✓

**Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N". Two explicit "confirm the real signature before writing" notes (`pushToPlayer`, minimal-valid `tournamentSchema` object) are verification instructions, not placeholders — the surrounding code is concrete.

**Type consistency:** `PairingAssignment` `{ byePlayerIds, matchPairs }`, `SlotShape` `{ byeCount, matchCount }`, `KnockoutPairingState`, `RegisterState` `{ error?, needsUsername? }`, `safeInternalPath` — all defined once (Tasks 2/5/8) and used with the same shape in later tasks. `computePendingKnockoutRound` / `computeRearrangeableKnockoutRound` input shapes match between Task 4 (definition), Task 5/6 (actions), and Task 7 (page).
