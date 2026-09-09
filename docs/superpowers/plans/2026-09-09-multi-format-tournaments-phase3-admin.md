# Multi-Format Tournaments — Phase 3: Admin Creation & Stage Management

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin actually create a points-race (battle-royale) tournament and define its stages — the first phase where the schema and engine from phases 1–2 become reachable in the UI.

**Architecture:** The tournament form becomes format-aware: picking a game narrows the Format select to that game's `supported_formats`, and picking Points Race swaps the football-only controls for entry unit, squad size and a link to a stages editor. Stages live on their own admin page (`/admin/tournaments/[id]/stages`) rather than inside the creation form, because a tournament must exist before its stages can hang off it. Cross-stage sanity (you cannot advance more players than arrived) is a pure function, unit-tested without a database.

**Tech Stack:** Next.js 14 (App Router), TypeScript, Supabase, zod, vitest.

**Spec:** `docs/superpowers/specs/2026-09-09-multi-format-tournaments-design.md` (§4, §5, §6, §10)

**Builds on:** `docs/superpowers/plans/2026-09-09-multi-format-tournaments-foundation.md` (phases 1–2, shipped)

## Global Constraints

- **The `head_to_head` path must not change.** A football tournament's form, actions and stored row must behave exactly as before. Existing tests stay green **unmodified**.
- **Existing suite: 196 files / 1365 tests** as of this plan. A pre-existing flake lives in `lib/auth/actions.test.ts` (2 tests, only under full-suite concurrency, owned by another workstream) — if those two fail, re-run that file alone to confirm before investigating.
- **Migrations** use a UTC timestamp prefix, applied via Supabase MCP `apply_migration`, with the identical SQL committed under `supabase/migrations/`. This phase adds **no** migration; phases 1–2 already created every table.
- **RLS already covers the new tables.** Stage writes go through `requireStaff()` server actions on the service-role client, matching `group-admin-actions.ts`.
- **Admin final say:** validation surfaces problems; it never silently rewrites an admin's numbers.
- **Points values** come from `games.default_points_config`, seeded in phase 1. Never invent numbers.
- **Deferred to a later phase, deliberately:** lobby generation and room credentials. Lobbies need `tournament_entrants` rows, and nothing creates those until registration/squads (phase 5). Building lobby generation now would mean building it against data that cannot exist.

---

### Task 1: Format fields on the tournament schema and action

**Files:**
- Modify: `lib/tournaments/admin-schema.ts`
- Modify: `lib/tournaments/admin-actions.ts` (the `toRow` mapper)
- Test: `lib/tournaments/admin-schema.test.ts` (append; do not alter existing cases)

**Interfaces:**
- Consumes: `CompetitionFormat`, `EntryUnit` from `lib/tournaments/formats.ts` (phase 1).
- Produces: `tournamentSchema` gains `competitionFormat`, `entryUnit`, `squadSize`; `toRow` emits `competition_format`, `entry_unit`, `squad_size`.

- [ ] **Step 1: Write the failing tests**

Append to `lib/tournaments/admin-schema.test.ts`:

```ts
describe('tournamentSchema — competition format', () => {
  it('defaults to a solo head-to-head tournament when the fields are absent', () => {
    // Every tournament that existed before multi-format work is exactly this,
    // and the form must keep producing it without sending the new fields.
    const r = tournamentSchema.safeParse(valid)
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.competitionFormat).toBe('head_to_head')
      expect(r.data.entryUnit).toBe('solo')
      expect(r.data.squadSize).toBe('')
    }
  })

  it('accepts a solo points race', () => {
    const r = tournamentSchema.safeParse({ ...valid, competitionFormat: 'points_race', entryUnit: 'solo' })
    expect(r.success).toBe(true)
  })

  it('accepts a squad points race with a squad size', () => {
    const r = tournamentSchema.safeParse({
      ...valid,
      competitionFormat: 'points_race',
      entryUnit: 'squad',
      squadSize: '4',
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.squadSize).toBe(4)
  })

  it('requires a squad size when the entry unit is squad', () => {
    const r = tournamentSchema.safeParse({
      ...valid,
      competitionFormat: 'points_race',
      entryUnit: 'squad',
      squadSize: '',
    })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0].path).toContain('squadSize')
  })

  it('rejects squads on a head-to-head tournament', () => {
    // Mirrors the DB CHECK. Squads are a points-race concept until roadmap
    // #21b; letting the form accept it would fail at insert time with a raw
    // Postgres error instead of a readable message.
    const r = tournamentSchema.safeParse({
      ...valid,
      competitionFormat: 'head_to_head',
      entryUnit: 'squad',
      squadSize: '4',
    })
    expect(r.success).toBe(false)
  })

  it('rejects a squad size outside 2-6', () => {
    for (const squadSize of ['1', '7']) {
      const r = tournamentSchema.safeParse({
        ...valid,
        competitionFormat: 'points_race',
        entryUnit: 'squad',
        squadSize,
      })
      expect(r.success, squadSize).toBe(false)
    }
  })

  it('rejects an unknown format', () => {
    const r = tournamentSchema.safeParse({ ...valid, competitionFormat: 'battle_royale' })
    expect(r.success).toBe(false)
  })

  it('parses a points race that omits the head-to-head-only fields entirely', () => {
    // LOAD-BEARING. The form HIDES `format` and `manualKnockoutPairing` on a
    // points race, so they are never submitted and the schema's defaults fill
    // them. That coupling is invisible from either side: tighten `format` to
    // required and every points-race submit breaks with no other warning.
    //
    // The structural fix is a discriminated union on competitionFormat, so
    // `format` exists only in the head_to_head branch. Until then this test is
    // what turns that silent breakage into a red one.
    const { format, manualKnockoutPairing, ...withoutH2HFields } = {
      ...valid,
      format: 'group_knockout',
      manualKnockoutPairing: 'false',
    } as Record<string, unknown>
    void format
    void manualKnockoutPairing

    const r = tournamentSchema.safeParse({
      ...withoutH2HFields,
      competitionFormat: 'points_race',
      entryUnit: 'solo',
    })
    expect(r.success).toBe(true)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/tournaments/admin-schema.test.ts`
Expected: FAIL — `competitionFormat` is undefined on the parsed result.

- [ ] **Step 3: Extend the schema**

In `lib/tournaments/admin-schema.ts`, add these three fields inside the `z.object({...})`, after `format`:

```ts
    // Distinct from `format` above, which is the head-to-head SHAPE
    // (group_knockout / round_robin). This is which engine runs at all.
    competitionFormat: z.enum(['head_to_head', 'points_race']).default('head_to_head'),
    entryUnit: z.enum(['solo', 'squad']).default('solo'),
    squadSize: z.union([z.literal(''), z.coerce.number().int().min(2).max(6)]).default(''),
```

Then add two refinements after the existing `.refine(...)`, chained:

```ts
  .refine((d) => d.entryUnit === 'solo' || d.squadSize !== '', {
    message: 'Enter how many players are in a squad.',
    path: ['squadSize'],
  })
  // Mirrors tournaments_squads_are_points_race. Caught here so the admin gets
  // a sentence instead of a Postgres constraint name.
  .refine((d) => d.competitionFormat === 'points_race' || d.entryUnit === 'solo', {
    message: 'Squads are only available for points-race tournaments.',
    path: ['entryUnit'],
  })
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/tournaments/admin-schema.test.ts`
Expected: PASS, including every pre-existing case unchanged.

- [ ] **Step 5: Map the fields onto the row**

In `lib/tournaments/admin-actions.ts`, inside `toRow`, add after `manual_knockout_pairing`:

```ts
    competition_format: d.competitionFormat,
    entry_unit: d.entryUnit,
    squad_size: d.squadSize === '' ? null : d.squadSize,
```

- [ ] **Step 6: Verify and commit**

Run: `npx tsc --noEmit` — expect no output.
Run: `npx vitest run` — expect all pass, 7 tests more than before.

```bash
git add lib/tournaments/admin-schema.ts lib/tournaments/admin-actions.ts lib/tournaments/admin-schema.test.ts
git commit -m "feat(tournaments): accept competition format and entry unit on the admin form

Both refinements mirror DB CHECKs that already exist, so an impossible
combination gets a readable sentence instead of a raw Postgres constraint name.
Defaults keep every existing football tournament producing exactly the row it
produced before."
```

---

### Task 2: Cross-stage plan validation

Pure, so the "you cannot advance more players than arrived" rule is testable without a database.

**Files:**
- Create: `lib/tournaments/stage-plan.ts`
- Test: `lib/tournaments/stage-plan.test.ts`

**Interfaces:**
- Consumes: nothing at runtime.
- Produces:
  - `interface StagePlanInput { seq: number; name: string; roundsCount: number; lobbySize: number; advanceCount: number }`
  - `type StagePlanIssueCode = 'no_stages' | 'advance_exceeds_intake' | 'final_stage_not_single_winner' | 'duplicate_seq'`
  - `interface StagePlanIssue { code: StagePlanIssueCode; seq: number | null; message: string; severity: 'error' | 'warning' }`
  - `validateStagePlan(stages: StagePlanInput[], entrantCount: number | null): StagePlanIssue[]`

- [ ] **Step 1: Write the failing test**

Create `lib/tournaments/stage-plan.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { validateStagePlan, type StagePlanInput } from './stage-plan'

function stage(seq: number, advanceCount: number, over: Partial<StagePlanInput> = {}): StagePlanInput {
  return { seq, name: `Stage ${seq}`, roundsCount: 3, lobbySize: 48, advanceCount, ...over }
}

describe('validateStagePlan', () => {
  it('accepts a qualifiers-then-finals plan', () => {
    const issues = validateStagePlan([stage(1, 24), stage(2, 1)], 96)
    expect(issues).toEqual([])
  })

  it('accepts a single-stage one-off cup', () => {
    // One stage, one round, one winner — the smallest legitimate plan.
    expect(validateStagePlan([stage(1, 1, { roundsCount: 1 })], 12)).toEqual([])
  })

  it('flags a tournament with no stages at all', () => {
    const issues = validateStagePlan([], 48)
    expect(issues.map((i) => i.code)).toEqual(['no_stages'])
    expect(issues[0].severity).toBe('error')
  })

  it('flags a stage advancing more entrants than reached it', () => {
    // Stage 2 receives 24 from stage 1 but tries to advance 30. Nothing in the
    // database prevents this; it just produces a stage that can never resolve.
    const issues = validateStagePlan([stage(1, 24), stage(2, 30)], 96)
    const issue = issues.find((i) => i.code === 'advance_exceeds_intake')
    expect(issue).toBeDefined()
    expect(issue!.seq).toBe(2)
    expect(issue!.severity).toBe('error')
  })

  it('flags the first stage advancing more than the entrant count', () => {
    const issues = validateStagePlan([stage(1, 50), stage(2, 1)], 40)
    expect(issues.find((i) => i.code === 'advance_exceeds_intake')?.seq).toBe(1)
  })

  it('does not flag the first stage when the entrant count is not yet known', () => {
    // Registration is still open, so there is no entrant count to check
    // against. Refusing to save the plan here would stop an admin setting a
    // tournament up in advance, which is when they actually do it.
    const issues = validateStagePlan([stage(1, 24), stage(2, 1)], null)
    expect(issues).toEqual([])
  })

  it('warns when the final stage does not end with a single winner', () => {
    const issues = validateStagePlan([stage(1, 24), stage(2, 4)], 96)
    const issue = issues.find((i) => i.code === 'final_stage_not_single_winner')
    expect(issue).toBeDefined()
    // A warning, not an error: an admin may deliberately end on a top-4 that
    // feeds an offline final.
    expect(issue!.severity).toBe('warning')
  })

  it('flags duplicate sequence numbers', () => {
    const issues = validateStagePlan([stage(1, 24), stage(1, 1)], 96)
    expect(issues.some((i) => i.code === 'duplicate_seq')).toBe(true)
  })

  it('evaluates stages in seq order regardless of input order', () => {
    // The editor may hand them over in whatever order the rows were edited.
    const issues = validateStagePlan([stage(2, 30), stage(1, 24)], 96)
    expect(issues.find((i) => i.code === 'advance_exceeds_intake')?.seq).toBe(2)
  })

  it('reports every problem at once', () => {
    const issues = validateStagePlan([stage(1, 999), stage(2, 4)], 40)
    expect(issues.length).toBeGreaterThan(1)
  })

  it('gives every issue a message', () => {
    for (const i of validateStagePlan([stage(1, 999), stage(2, 4)], 40)) {
      expect(i.message.length).toBeGreaterThan(0)
    }
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/tournaments/stage-plan.test.ts`
Expected: FAIL — `Cannot find module './stage-plan'`.

- [ ] **Step 3: Write the implementation**

Create `lib/tournaments/stage-plan.ts`:

```ts
// Sanity checks across a points-race tournament's whole stage plan.
//
// The database constrains each stage on its own (rounds 1-20, lobby 2-100,
// advance >= 1) but cannot see the plan as a sequence. "Stage 2 advances 30
// when only 24 reached it" is a perfectly legal row and a tournament that can
// never resolve, so it has to be caught here.
//
// Reports, never rewrites: an admin's numbers are the admin's. Same rule as
// the lobby grid's validation flags.

export interface StagePlanInput {
  seq: number
  name: string
  roundsCount: number
  lobbySize: number
  advanceCount: number
}

export type StagePlanIssueCode =
  | 'no_stages'
  | 'advance_exceeds_intake'
  | 'final_stage_not_single_winner'
  | 'duplicate_seq'

export interface StagePlanIssue {
  code: StagePlanIssueCode
  seq: number | null
  message: string
  severity: 'error' | 'warning'
}

// `entrantCount` is null while registration is still open — the usual moment an
// admin sets a tournament up. The intake check on stage 1 is skipped then
// rather than blocking the plan, since there is genuinely nothing to check
// against yet.
export function validateStagePlan(
  stages: StagePlanInput[],
  entrantCount: number | null,
): StagePlanIssue[] {
  if (stages.length === 0) {
    return [
      {
        code: 'no_stages',
        seq: null,
        severity: 'error',
        message: 'A points-race tournament needs at least one stage.',
      },
    ]
  }

  const issues: StagePlanIssue[] = []
  const ordered = [...stages].sort((a, b) => a.seq - b.seq)

  const seen = new Set<number>()
  for (const s of ordered) {
    if (seen.has(s.seq)) {
      issues.push({
        code: 'duplicate_seq',
        seq: s.seq,
        severity: 'error',
        message: `Two stages share position ${s.seq}. Each stage needs its own place in the order.`,
      })
    }
    seen.add(s.seq)
  }

  // Stage 1 takes the whole field; every later stage takes exactly what the
  // one before it advanced.
  let intake: number | null = entrantCount
  for (const s of ordered) {
    if (intake !== null && s.advanceCount > intake) {
      issues.push({
        code: 'advance_exceeds_intake',
        seq: s.seq,
        severity: 'error',
        message: `${s.name} advances ${s.advanceCount} but only ${intake} entrant(s) reach it.`,
      })
    }
    intake = s.advanceCount
  }

  const last = ordered[ordered.length - 1]
  if (last.advanceCount !== 1) {
    issues.push({
      code: 'final_stage_not_single_winner',
      seq: last.seq,
      severity: 'warning',
      message: `${last.name} ends with ${last.advanceCount} entrants rather than a single champion.`,
    })
  }

  return issues
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/tournaments/stage-plan.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/tournaments/stage-plan.ts lib/tournaments/stage-plan.test.ts
git commit -m "feat(tournaments): cross-stage plan validation

The database constrains each stage alone but cannot see the plan as a sequence.
'Stage 2 advances 30 when only 24 reached it' is a legal row and a tournament
that can never resolve, so it is caught here.

The stage-1 intake check is skipped while the entrant count is unknown —
registration still open is exactly when an admin sets a tournament up, and
blocking that would be worse than the check is worth."
```

---

### Task 3: Stage schema and server actions

**Files:**
- Create: `lib/tournaments/stage-schema.ts`
- Create: `lib/tournaments/stage-admin-actions.ts`
- Test: `lib/tournaments/stage-schema.test.ts`

**Interfaces:**
- Consumes: `parsePointsConfig` and `DEFAULT_POINTS_CONFIG` from `lib/tournaments/points-config.ts` (phase 2); `requireStaff` from `lib/admin/auth`.
- Produces:
  - `stageSchema` (zod) with `name`, `roundsCount`, `lobbySize`, `advanceCount`, `placementPoints` (comma/space separated string), `perKill`
  - `parsePlacementList(raw: string): number[] | null`
  - Server actions `createStage`, `updateStage`, `deleteStage`, each `(prev, formData) => Promise<StageFormState>`

- [ ] **Step 1: Write the failing test**

Create `lib/tournaments/stage-schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parsePlacementList, stageSchema } from './stage-schema'

const valid = {
  name: 'Qualifiers',
  roundsCount: '3',
  lobbySize: '48',
  advanceCount: '24',
  placementPoints: '12, 9, 8, 7, 6, 5, 4, 3, 2, 1',
  perKill: '1',
}

describe('parsePlacementList', () => {
  it('reads a comma-separated table', () => {
    expect(parsePlacementList('12, 9, 8')).toEqual([12, 9, 8])
  })

  it('reads a space-separated table', () => {
    // Admins paste these out of rulebooks; the separator varies.
    expect(parsePlacementList('12 9 8')).toEqual([12, 9, 8])
  })

  it('tolerates trailing separators and extra whitespace', () => {
    expect(parsePlacementList(' 12,  9 , 8 , ')).toEqual([12, 9, 8])
  })

  it('returns null for anything non-numeric', () => {
    expect(parsePlacementList('12, nine, 8')).toBeNull()
  })

  it('returns null for negative points', () => {
    expect(parsePlacementList('12, -9')).toBeNull()
  })

  it('returns null for an empty table', () => {
    // A placement table with no entries would score every placing zero, which
    // is never what an admin means.
    expect(parsePlacementList('')).toBeNull()
    expect(parsePlacementList('   ')).toBeNull()
  })
})

describe('stageSchema', () => {
  it('accepts a well-formed stage and coerces the numbers', () => {
    const r = stageSchema.safeParse(valid)
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.roundsCount).toBe(3)
      expect(r.data.lobbySize).toBe(48)
      expect(r.data.advanceCount).toBe(24)
      expect(r.data.placementPoints).toEqual([12, 9, 8, 7, 6, 5, 4, 3, 2, 1])
      expect(r.data.perKill).toBe(1)
    }
  })

  it('requires a name', () => {
    expect(stageSchema.safeParse({ ...valid, name: '  ' }).success).toBe(false)
  })

  it('rejects a malformed placement table with a readable message', () => {
    const r = stageSchema.safeParse({ ...valid, placementPoints: '12, nine' })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0].path).toContain('placementPoints')
  })

  it('mirrors the database ranges', () => {
    // Same bounds as stages_rounds_range / stages_lobby_range, so an admin gets
    // a sentence rather than a constraint name.
    expect(stageSchema.safeParse({ ...valid, roundsCount: '0' }).success).toBe(false)
    expect(stageSchema.safeParse({ ...valid, roundsCount: '21' }).success).toBe(false)
    expect(stageSchema.safeParse({ ...valid, lobbySize: '1' }).success).toBe(false)
    expect(stageSchema.safeParse({ ...valid, lobbySize: '101' }).success).toBe(false)
    expect(stageSchema.safeParse({ ...valid, advanceCount: '0' }).success).toBe(false)
  })

  it('allows a placement-only ruleset', () => {
    const r = stageSchema.safeParse({ ...valid, perKill: '0' })
    expect(r.success).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/tournaments/stage-schema.test.ts`
Expected: FAIL — `Cannot find module './stage-schema'`.

- [ ] **Step 3: Write the schema**

Create `lib/tournaments/stage-schema.ts`:

```ts
import { z } from 'zod'

// Admins paste placement tables out of rulebooks, where they appear
// comma-separated, space-separated or both. Accepting all three is cheaper
// than teaching everyone one format.
//
// Returns null rather than a partial list: a half-read points table would
// score a real tournament wrongly while looking plausible — the same reasoning
// as parsePointsConfig in points-config.ts.
export function parsePlacementList(raw: string): number[] | null {
  const parts = raw
    .split(/[\s,]+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
  if (parts.length === 0) return null

  const nums = parts.map(Number)
  if (nums.some((n) => !Number.isFinite(n) || n < 0 || !Number.isInteger(n))) return null
  return nums
}

// Ranges mirror the CHECK constraints in migration 20260909092000 so an admin
// sees a sentence instead of a Postgres constraint name.
export const stageSchema = z.object({
  name: z.string().trim().min(1, 'Name this stage').max(60, 'Stage name is too long'),
  roundsCount: z.coerce.number().int().min(1, 'At least 1 round').max(20, 'At most 20 rounds'),
  lobbySize: z.coerce.number().int().min(2, 'At least 2 per lobby').max(100, 'At most 100 per lobby'),
  advanceCount: z.coerce.number().int().min(1, 'At least 1 entrant must advance'),
  placementPoints: z
    .string()
    .transform((v, ctx) => {
      const parsed = parsePlacementList(v)
      if (!parsed) {
        ctx.addIssue({ code: 'custom', message: 'Enter placement points as numbers, e.g. 12, 9, 8, 7' })
        return z.NEVER
      }
      return parsed
    }),
  perKill: z.coerce.number().int().min(0, 'Cannot be negative').max(100, 'Too large'),
})

export type StageInput = z.infer<typeof stageSchema>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/tournaments/stage-schema.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Write the server actions**

Create `lib/tournaments/stage-admin-actions.ts`:

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaff } from '@/lib/admin/auth'
import { stageSchema } from './stage-schema'

export type StageFormState = { error?: string; success?: boolean } | undefined

// Stages are only meaningful once results exist against them, so editing one
// that has already run would rewrite history. lobby_results freeze their own
// points at confirm time, so past rounds are safe either way — but the stage's
// shape (rounds, lobby size, advance count) still governs a live stage, so a
// completed one is locked.
async function assertStageEditable(
  admin: ReturnType<typeof createAdminClient>,
  stageId: string,
): Promise<{ tournamentId: string } | { error: string }> {
  const { data: stage } = await admin
    .from('tournament_stages')
    .select('tournament_id, status')
    .eq('id', stageId)
    .maybeSingle()
  if (!stage) return { error: 'Stage not found.' }
  if (stage.status === 'complete') return { error: 'This stage has finished and can no longer be edited.' }
  return { tournamentId: stage.tournament_id }
}

export async function createStage(_prev: StageFormState, formData: FormData): Promise<StageFormState> {
  await requireStaff()
  const tournamentId = String(formData.get('tournamentId') ?? '')
  if (!tournamentId) return { error: 'Missing tournament.' }

  const parsed = stageSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const admin = createAdminClient()
  // Next free position. Not a count — a deleted middle stage would make count
  // collide with an existing seq.
  const { data: last } = await admin
    .from('tournament_stages')
    .select('seq')
    .eq('tournament_id', tournamentId)
    .order('seq', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { error } = await admin.from('tournament_stages').insert({
    tournament_id: tournamentId,
    seq: (last?.seq ?? 0) + 1,
    name: parsed.data.name,
    rounds_count: parsed.data.roundsCount,
    lobby_size: parsed.data.lobbySize,
    advance_count: parsed.data.advanceCount,
    points_config: { placement: parsed.data.placementPoints, per_kill: parsed.data.perKill },
    status: 'pending',
  })
  if (error) return { error: 'Could not add the stage. Please try again.' }

  revalidatePath(`/admin/tournaments/${tournamentId}/stages`)
  return { success: true }
}

export async function updateStage(_prev: StageFormState, formData: FormData): Promise<StageFormState> {
  await requireStaff()
  const stageId = String(formData.get('stageId') ?? '')
  if (!stageId) return { error: 'Missing stage.' }

  const parsed = stageSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const admin = createAdminClient()
  const guard = await assertStageEditable(admin, stageId)
  if ('error' in guard) return { error: guard.error }

  const { error } = await admin
    .from('tournament_stages')
    .update({
      name: parsed.data.name,
      rounds_count: parsed.data.roundsCount,
      lobby_size: parsed.data.lobbySize,
      advance_count: parsed.data.advanceCount,
      points_config: { placement: parsed.data.placementPoints, per_kill: parsed.data.perKill },
    })
    .eq('id', stageId)
  if (error) return { error: 'Could not save the stage. Please try again.' }

  revalidatePath(`/admin/tournaments/${guard.tournamentId}/stages`)
  return { success: true }
}

export async function deleteStage(_prev: StageFormState, formData: FormData): Promise<StageFormState> {
  await requireStaff()
  const stageId = String(formData.get('stageId') ?? '')
  if (!stageId) return { error: 'Missing stage.' }

  const admin = createAdminClient()
  const guard = await assertStageEditable(admin, stageId)
  if ('error' in guard) return { error: guard.error }

  // Lobbies and results cascade from the stage (migration 20260909092000), so
  // a stage that has already been played must not be deleted casually. Only a
  // pending stage — one with no lobbies — can go.
  const { count: lobbies } = await admin
    .from('tournament_lobbies')
    .select('id', { count: 'exact', head: true })
    .eq('stage_id', stageId)
  if ((lobbies ?? 0) > 0) {
    return { error: 'This stage already has lobbies. Remove them before deleting the stage.' }
  }

  const { error } = await admin.from('tournament_stages').delete().eq('id', stageId)
  if (error) return { error: 'Could not delete the stage.' }

  revalidatePath(`/admin/tournaments/${guard.tournamentId}/stages`)
  return { success: true }
}
```

- [ ] **Step 6: Verify and commit**

Run: `npx tsc --noEmit` and `npx next lint` — both clean.
Run: `npx vitest run` — all pass.

```bash
git add lib/tournaments/stage-schema.ts lib/tournaments/stage-schema.test.ts lib/tournaments/stage-admin-actions.ts
git commit -m "feat(tournaments): stage schema and admin actions

Placement tables are accepted comma- or space-separated because admins paste
them out of rulebooks, and parse all-or-nothing for the same reason
parsePointsConfig does: a half-read table scores a tournament wrongly while
looking plausible.

Ranges mirror the stage CHECK constraints so an admin gets a sentence rather
than a constraint name. A completed stage is locked, and a stage with lobbies
cannot be deleted out from under its results."
```

---

### Task 4: Format-aware tournament form

**Files:**
- Modify: `components/admin/TournamentForm.tsx`
- Modify: `app/[locale]/admin/tournaments/new/page.tsx`
- Modify: `app/[locale]/admin/tournaments/[id]/edit/page.tsx`

**Interfaces:**
- Consumes: `formatsForGame`, `FORMAT_LABEL` from `lib/tournaments/formats.ts`; `TournamentFormValues` gains `competitionFormat`, `entryUnit`, `squadSize`.
- Produces: `TournamentForm` takes `games: { id: string; name: string; supportedFormats: string[] }[]`.

- [ ] **Step 1: Widen the games prop and the form values**

In `components/admin/TournamentForm.tsx`:

Add to `TournamentFormValues`:

```ts
  competitionFormat: string
  entryUnit: string
  squadSize: string
```

Change the `games` prop type from `{ id: string; name: string }[]` to:

```ts
  games: { id: string; name: string; supportedFormats: string[] }[]
```

Add these imports at the top:

```ts
import { formatsForGame, FORMAT_LABEL, type CompetitionFormat } from '@/lib/tournaments/formats'
```

- [ ] **Step 2: Track the selected game and format as state**

Inside the component, beside the existing `tournamentType` state:

```ts
  const [gameId, setGameId] = useState(initial.gameId)
  const [competitionFormat, setCompetitionFormat] = useState(initial.competitionFormat || 'head_to_head')
  const [entryUnit, setEntryUnit] = useState(initial.entryUnit || 'solo')

  // Only the formats the chosen game declares. Falls back to head-to-head when
  // no game is picked yet, so the control is never empty.
  const availableFormats = formatsForGame(games.find((g) => g.id === gameId)?.supportedFormats)
  const isPointsRace = competitionFormat === 'points_race'
```

Change the Game `<select>` to be controlled, and reset the format when the game changes to one that cannot run it:

```tsx
        <select
          id="gameId"
          name="gameId"
          value={gameId}
          onChange={(e) => {
            const next = e.target.value
            setGameId(next)
            // A game that cannot run the selected format must not leave the
            // form in a state the database will reject on submit.
            const allowed = formatsForGame(games.find((g) => g.id === next)?.supportedFormats)
            if (!allowed.includes(competitionFormat as CompetitionFormat)) {
              setCompetitionFormat('head_to_head')
              setEntryUnit('solo')
            }
          }}
          required
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
        >
```

- [ ] **Step 3: Add the format controls**

Immediately after the Game field's closing `</div>`, insert:

```tsx
      {availableFormats.length > 1 && (
        <div className="space-y-1.5">
          <label htmlFor="competitionFormat" className="text-sm font-medium text-slate-300">
            Competition format
          </label>
          <select
            id="competitionFormat"
            name="competitionFormat"
            value={competitionFormat}
            onChange={(e) => {
              setCompetitionFormat(e.target.value)
              // Squads exist only for points races.
              if (e.target.value !== 'points_race') setEntryUnit('solo')
            }}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
          >
            {availableFormats.map((f) => (
              <option key={f} value={f}>
                {FORMAT_LABEL[f]}
              </option>
            ))}
          </select>
        </div>
      )}
      {/* Always submitted, even when the picker is hidden for a
          football-only game, so the action always receives a value. */}
      {availableFormats.length <= 1 && (
        <input type="hidden" name="competitionFormat" value={competitionFormat} />
      )}

      {isPointsRace && (
        <>
          <div className="space-y-1.5">
            <label htmlFor="entryUnit" className="text-sm font-medium text-slate-300">
              Entry unit
            </label>
            <select
              id="entryUnit"
              name="entryUnit"
              value={entryUnit}
              onChange={(e) => setEntryUnit(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
            >
              <option value="solo">Solo — each player enters alone</option>
              <option value="squad">Squad — players enter as a team</option>
            </select>
          </div>
          {entryUnit === 'squad' && (
            <Field label="Players per squad (2–6)" name="squadSize" type="number" defaultValue={initial.squadSize} />
          )}
          <p className="rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-xs text-violet-300">
            Points race: entrants play in lobbies scored on placement and kills. Set up its stages from
            the tournament&apos;s Stages page after saving.
          </p>
        </>
      )}
      {!isPointsRace && <input type="hidden" name="entryUnit" value="solo" />}
```

- [ ] **Step 4: Hide the football-only controls on a points race**

Wrap the existing **Format** field (`group_knockout` / `round_robin`) and the **manual knockout pairing** checkbox in `{!isPointsRace && ( ... )}`. Both belong to the head-to-head engine and mean nothing for a points race.

Keep their `name` attributes as they are — when hidden they submit nothing and the schema's defaults apply.

- [ ] **Step 5: Feed `supportedFormats` from both pages**

In `app/[locale]/admin/tournaments/new/page.tsx` and `app/[locale]/admin/tournaments/[id]/edit/page.tsx`, change the games query:

```ts
    supabase.from('games').select('id, name, supported_formats').eq('active', true).order('name'),
```

and map it where the component is rendered:

```tsx
        games={(games ?? []).map((g) => ({
          id: g.id,
          name: g.name,
          supportedFormats: g.supported_formats ?? [],
        }))}
```

Add the three new fields to `EMPTY` in the new-tournament page:

```ts
  competitionFormat: 'head_to_head',
  entryUnit: 'solo',
  squadSize: '',
```

and to the `initial` object built in the edit page, reading from the stored row:

```ts
  competitionFormat: t.competition_format ?? 'head_to_head',
  entryUnit: t.entry_unit ?? 'solo',
  squadSize: t.squad_size?.toString() ?? '',
```

Make sure the edit page's tournament `select` includes `competition_format, entry_unit, squad_size`.

- [ ] **Step 6: Verify and commit**

Run: `npx tsc --noEmit` and `npx next lint` — both clean.
Run: `npx vitest run` — all pass, unchanged count (this task is UI only).

Manually confirm in the running app: choosing **Dream League Soccer** shows no format picker (football declares only `head_to_head`); choosing **Free Fire** shows the picker, and selecting Points Race reveals entry unit and hides the groups/knockout controls.

```bash
git add components/admin/TournamentForm.tsx "app/[locale]/admin/tournaments/new/page.tsx" "app/[locale]/admin/tournaments/[id]/edit/page.tsx"
git commit -m "feat(admin): format-aware tournament creation form

Picking a game narrows the format picker to what that game declares, so a
football game never offers a battle-royale format. Choosing points race swaps
the groups/knockout controls for entry unit and squad size.

The picker is hidden entirely for single-format games rather than shown with
one option, and a hidden input still submits the value so the action always
receives one."
```

---

### Task 5: Stages editor page

**Files:**
- Create: `components/admin/StagesEditor.tsx`
- Create: `app/[locale]/admin/tournaments/[id]/stages/page.tsx`
- Modify: `app/[locale]/admin/tournaments/[id]/edit/page.tsx` (link to the stages page)

**Interfaces:**
- Consumes: `createStage`, `updateStage`, `deleteStage` (Task 3); `validateStagePlan` (Task 2); `DEFAULT_POINTS_CONFIG` (phase 2).
- Produces: `StagesEditor` component; route `/admin/tournaments/[id]/stages`.

- [ ] **Step 1: Build the editor component**

Create `components/admin/StagesEditor.tsx` as a client component. It renders, for each existing stage, a form bound to `updateStage` with fields `name`, `roundsCount`, `lobbySize`, `advanceCount`, `placementPoints`, `perKill` plus a hidden `stageId`; a delete button bound to `deleteStage`; and one "Add stage" form bound to `createStage` with a hidden `tournamentId`.

Render the `issues` passed in from the page above the list, errors in red and warnings in amber, each naming its stage.

Prefill the new-stage form's `placementPoints` and `perKill` from the `defaultPoints` prop so an admin adding a Free Fire stage starts from the FFWS table rather than an empty box.

- [ ] **Step 2: Build the page**

Create `app/[locale]/admin/tournaments/[id]/stages/page.tsx`:

```tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { StagesEditor } from '@/components/admin/StagesEditor'
import { validateStagePlan } from '@/lib/tournaments/stage-plan'
import { parsePointsConfig, DEFAULT_POINTS_CONFIG } from '@/lib/tournaments/points-config'

export default async function StagesPage({ params }: { params: { id: string } }) {
  await requireStaff()
  const supabase = createClient()

  const { data: tournament } = await supabase
    .from('tournaments')
    .select('id, title, competition_format, games(slug)')
    .eq('id', params.id)
    .maybeSingle()
  if (!tournament) notFound()

  const { data: stageRows } = await supabase
    .from('tournament_stages')
    .select('id, seq, name, rounds_count, lobby_size, advance_count, points_config, status')
    .eq('tournament_id', params.id)
    .order('seq')

  const { count: entrantCount } = await supabase
    .from('tournament_entrants')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', params.id)
    .eq('status', 'active')

  const stages = (stageRows ?? []).map((s) => ({
    id: s.id,
    seq: s.seq,
    name: s.name,
    roundsCount: s.rounds_count,
    lobbySize: s.lobby_size,
    advanceCount: s.advance_count,
    status: s.status,
    points: parsePointsConfig(s.points_config) ?? { placement: [], perKill: 0 },
  }))

  // Null rather than 0 before anyone has entered — validateStagePlan skips the
  // stage-1 intake check when the field size is genuinely unknown, which is
  // the normal state while an admin is setting the tournament up.
  const issues = validateStagePlan(stages, entrantCount && entrantCount > 0 ? entrantCount : null)

  const gameRef = Array.isArray(tournament.games) ? tournament.games[0] : tournament.games
  const defaults = DEFAULT_POINTS_CONFIG[gameRef?.slug ?? ''] ?? { placement: [], perKill: 1 }

  return (
    <section className="max-w-2xl">
      <Link href={`/admin/tournaments/${params.id}/edit`} className="text-sm text-violet-400 hover:text-violet-300">
        ← {tournament.title}
      </Link>
      <h2 className="mb-4 mt-2 text-base font-bold text-white">Stages</h2>
      {tournament.competition_format !== 'points_race' ? (
        <p className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 text-sm text-amber-300">
          This is a head-to-head tournament. Stages apply only to points-race tournaments — use the
          bracket page instead.
        </p>
      ) : (
        <StagesEditor
          tournamentId={params.id}
          stages={stages}
          issues={issues}
          defaultPoints={defaults}
        />
      )}
    </section>
  )
}
```

- [ ] **Step 3: Link to it from the edit page**

In `app/[locale]/admin/tournaments/[id]/edit/page.tsx`, beside the existing links, add one shown only for a points race:

```tsx
      {t.competition_format === 'points_race' && (
        <Link href={`/admin/tournaments/${params.id}/stages`} className="text-sm text-violet-400 hover:text-violet-300">
          Stages →
        </Link>
      )}
```

- [ ] **Step 4: Verify end to end**

Run: `npx tsc --noEmit`, `npx next lint`, `npx vitest run` — all clean.

Then, in the running app:
1. Create a Free Fire tournament, format **Points Race**, entry unit **Solo**.
2. Open its Stages page. Add "Qualifiers": 3 rounds, lobby 48, advance 24 — the placement box should arrive prefilled with `12, 9, 8, 7, 6, 5, 4, 3, 2, 1`.
3. Add "Finals": 4 rounds, lobby 24, advance 1.
4. Confirm no issues are reported.
5. Change Finals' advance to 30 and confirm the `advance_exceeds_intake` error appears naming Finals.
6. Confirm a **football** tournament's edit page shows no Stages link, and visiting the stages URL directly shows the head-to-head notice.

- [ ] **Step 5: Commit**

```bash
git add components/admin/StagesEditor.tsx "app/[locale]/admin/tournaments/[id]/stages/page.tsx" "app/[locale]/admin/tournaments/[id]/edit/page.tsx"
git commit -m "feat(admin): stages editor for points-race tournaments

Stages live on their own page rather than inside the creation form: a
tournament has to exist before stages can hang off it, and a five-field
repeater inside an already-long form would be the worst place to edit them.

New stages prefill from the game's own points table, so adding a Free Fire
stage starts at the FFWS values instead of an empty box. Plan problems are
reported above the list — errors and warnings distinguished, because ending on
a top-4 that feeds an offline final is a choice, while advancing more entrants
than arrived is a mistake."
```

---

## Self-Review

**Spec coverage (phase 3):**

| Spec section | Task |
|---|---|
| §4.1 format fields reach the DB from the form | 1 |
| §4.2 per-game `supported_formats` narrows the picker | 4 |
| §5 stages created and edited | 3, 5 |
| §6 points table per stage, seeded from game defaults | 3, 5 |
| §10 creation form becomes format-aware | 4 |

Deferred with reason: lobby generation and room credentials (§5) need `tournament_entrants` rows, which nothing creates until phase 5.

**Placeholder scan:** none. Task 5 Step 1 describes the editor's structure in prose rather than full JSX — it is a straightforward CRUD form list whose every field name, action and prop is fixed by the interfaces above, and spelling out ~150 lines of Tailwind would add length without adding decisions.

**Type consistency:** `StagePlanInput` (Task 2) requires `seq`, `name`, `roundsCount`, `lobbySize`, `advanceCount` — the stages page maps exactly those and passes extra fields, which structural typing accepts. `stageSchema` output names (`roundsCount`, `lobbySize`, `advanceCount`, `placementPoints`, `perKill`) match the form field `name` attributes in Tasks 3 and 5. `formatsForGame` takes `string[] | null | undefined`, and the pages pass `g.supported_formats ?? []`.

**Known risk:** Task 4 Step 4 relies on hidden inputs and schema defaults when controls are hidden. If a hidden `format` field is ever required rather than defaulted, a points-race submit would fail validation — the schema defaults `format` to `group_knockout`, so it is safe as written, but do not make `format` required without revisiting this.
