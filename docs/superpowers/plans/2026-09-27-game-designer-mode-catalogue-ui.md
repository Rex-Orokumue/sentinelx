# Game Designer — Mode Catalogue Admin UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give staff an admin CRUD UI for the Mode → Format/Map/Match Rules catalogue (`game_modes`, `game_mode_formats`, `game_mode_maps`, `game_mode_match_rules`) and for `match_types`, so a new game's competitive shape is a data edit through `/admin/games/[id]` instead of a hand-written SQL migration.

**Architecture:** Extends the existing Game Designer page (`/admin/games/[id]`, built for the registration-fields half) with a Modes section that expands one mode at a time to manage its Formats/Maps/Match Rules, mirroring `RegistrationFieldsPanel`'s exact pattern (staff-write via the regular session client, `is_staff()` RLS, deactivate-over-delete when history exists). `match_types` gets its own small section on the `/admin/games` list page since it has no `game_id`. Getting real "add a new match type" capability out of that last section requires first converting `tournaments.match_type` from a CHECK-constrained enum column into a proper FK (`match_type_id`), the same shape `match_rule_id` already uses — this is Tasks 1–2, a prerequisite cutover, before any new UI is built. Five entities (mode/format/map/matchRule/matchType) get five small, independently-testable action files rather than one large `mode-catalogue-actions.ts`, and five small Panel/Form component pairs rather than one generic form — this deviates from the spec's suggested single-file grouping in favor of the file-per-responsibility shape the codebase already uses for the registration-fields half.

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase (Postgres + RLS), zod, Vitest, `react-dom`'s `useFormState`.

**Spec:** `docs/superpowers/specs/2026-09-27-game-designer-registration-fields-design.md` §5.1 sections 3–7 (Modes, Formats, Maps, Match Rules, Match Types — the registration-fields half, §4 and §5.1–5.2, already shipped in `docs/superpowers/plans/2026-09-27-per-game-registration-fields.md`).

## Global Constraints

- `game_modes` / `game_mode_formats` / `game_mode_maps` / `game_mode_match_rules` / `match_types` RLS: public `SELECT`, `is_staff()`-gated `ALL` — every new action uses the regular session client (`createClient()`), never `createAdminClient()`, per CLAUDE.md rule 9 (none of these tables are on the sensitive-tables list).
- Raw SQL migrations remain a valid, supported way to seed these tables — the UI is an additional writer, not a replacement.
- Deleting a mode/format/map/match-rule/match-type that a past tournament (or, for maps, a past lobby) references must deactivate (`active = false`) instead of hard-deleting — every FK from `tournaments`/`tournament_lobbies` into these tables is `ON DELETE SET NULL` or, for a mode's own children, `ON DELETE CASCADE`, so an unguarded hard delete would silently orphan or destroy historical data.
- A failed history check (a query error, not "zero rows") must not fail open into a hard delete — deactivating a row nobody used costs nothing; wrongly hard-deleting one still in use loses data every page that reads it needs.
- Slugs are derived from `name` via `slugify(name).replace(/-/g, '_')` (mirrors `field_key` generation in the shipped registration-fields half); a unique-constraint violation (`23505`) surfaces as a friendly "already exists" message, never a raw Postgres error.
- No changes to *how* Mode/Format/Map/Match Rules are consumed on the public tournament-creation form's cascading selects (`TournamentForm.tsx`, `lib/tournaments/mode-selection.ts`) beyond the `match_type_id` cutover in Task 2 — this plan only adds the missing *writer* UI.

## Review Focus

- Deleting a Mode whose own row is unreferenced but whose child Format/Map/Match Rule **is** referenced by a tournament must still deactivate, not cascade-delete the mode (which would destroy that child row) — Task 4.
- Deleting a Map referenced only via `tournament_lobbies.map_id` (a per-lobby override), not `tournaments.default_map_id`, must still be caught — Maps are the one entity with two reference points — Task 6.
- The `match_type_id` backfill migration must not drop a currently-set `match_type` value on a live production tournament (head-to-head, including non-mode games like football) — Task 1's verify step.
- A duplicate name within the same scope (a game's modes, a mode's formats/maps/match-rules, or the global match-types list) must surface "already exists," not a raw `23505` bubbling to the admin screen — Tasks 4–8.
- A history-check query that errors (not "found zero rows") must deactivate rather than hard-delete, for every one of the five delete actions, not just the one this pattern was first proven on — Tasks 4–8.

---

## Task 1: Migration — `tournaments.match_type_id` FK, replacing the CHECK-constrained `match_type` enum

**Files:**
- Create: `supabase/migrations/20260928130000_tournament_match_type_fk.sql`

**Interfaces:**
- Produces: `public.tournaments.match_type_id uuid REFERENCES public.match_types(id) ON DELETE SET NULL`, backfilled from the existing `match_type` text column, which is dropped along with `tournaments_match_type_valid`.

- [ ] **Step 1: Write the migration**

```sql
-- tournaments.match_type was a CHECK-constrained enum ('bo1'/'bo3'/'bo5'),
-- the exact "hardcoded enum" shape the whole Game Designer effort exists to
-- remove (see 2026-09-27-game-designer-registration-fields-design.md §1) —
-- and independently duplicated as a hardcoded z.enum in admin-schema.ts.
-- Swapping it for an FK into match_types lets the new Match Types admin
-- section (this plan, Task 8/13) add a genuinely new option with no
-- migration — same trust model match_rule_id already uses: the FK is the
-- validity check, not a CHECK constraint that duplicates match_types' rows.
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS match_type_id uuid REFERENCES public.match_types(id) ON DELETE SET NULL;

-- Backfill by joining on the slug the old column already stored — this must
-- run before the column is dropped, and must preserve every live
-- tournament's match type (head-to-head football tournaments set this too,
-- not only mode-based games).
UPDATE public.tournaments t
   SET match_type_id = mt.id
  FROM public.match_types mt
 WHERE mt.slug = t.match_type;

ALTER TABLE public.tournaments DROP CONSTRAINT IF EXISTS tournaments_match_type_valid;
ALTER TABLE public.tournaments DROP COLUMN IF EXISTS match_type;
```

- [ ] **Step 2: Apply and verify**

Run: `npx supabase db push` (or the project's existing migration-apply flow — see `[[project_supabase_connectivity_gotcha]]` if the CLI can't reach the remote; use the Supabase MCP `apply_migration` tool as the fallback).

Verify:
```sql
select count(*) filter (where match_type_id is not null) as with_type,
       count(*) as total
  from tournaments;
```
Expected: `with_type` equals however many tournaments had a non-null `match_type` before this ran (check with a `select count(*) from tournaments where match_type is not null` run *before* Step 1, if you want a before/after number — otherwise confirm `with_type` is not unexpectedly 0 if any tournament was known to have a match type set). Also confirm `select match_type from tournaments limit 1` now errors with "column does not exist."

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260928130000_tournament_match_type_fk.sql
git commit -m "feat(db): replace tournaments.match_type CHECK enum with match_type_id FK"
```

---

## Task 2: Cut over `match_type` → `match_type_id` across every consumer

**Files:**
- Modify: `lib/tournaments/admin-schema.ts:56-59`
- Modify: `lib/tournaments/admin-form.ts:42`
- Modify: `lib/tournaments/admin-actions.ts:50`
- Modify: `lib/tournaments/mode-catalogue.ts` (add `id` to the `matchTypes` read)
- Modify: `components/admin/TournamentForm.tsx` (interface field + the match-type `<select>`)
- Modify: `app/[locale]/admin/tournaments/new/page.tsx`
- Modify: `app/[locale]/admin/tournaments/[id]/edit/page.tsx`
- Modify: `lib/tournaments/admin-form.test.ts`

**Interfaces:**
- Produces: `TournamentInput.matchTypeId: string` (uuid-or-empty, replacing `matchType`); `ModeCatalogue.matchTypes: { id: string; slug: string; name: string; available: boolean }[]` (adds `id`).

- [ ] **Step 1: `lib/tournaments/admin-schema.ts`** — replace the hardcoded enum with a shape-only FK, matching `matchRuleId`'s existing comment and pattern:

```ts
    // An FK into match_types, same trust model as modeId/formatId/
    // defaultMapId/matchRuleId: the schema checks shape only, and which
    // match types are valid (and which are merely "coming soon") is the
    // catalogue's job — match_types.available gates selectability, not this
    // schema, so enabling Bo3 or adding a new option is a data change, not a
    // code change.
    matchTypeId: z.union([z.literal(''), z.string().uuid()]).default(''),
```
(replaces the existing `matchType: z.union([z.literal(''), z.enum(['bo1', 'bo3', 'bo5'])]).default(''),` line and its old comment)

- [ ] **Step 2: `lib/tournaments/admin-form.ts:42`** — change

```ts
    matchType: formData.get('matchType') ?? '',
```
to
```ts
    matchTypeId: formData.get('matchTypeId') ?? '',
```

- [ ] **Step 3: `lib/tournaments/admin-actions.ts:50`** — change

```ts
    match_type: d.matchType === '' ? null : d.matchType,
```
to
```ts
    match_type_id: d.matchTypeId === '' ? null : d.matchTypeId,
```

- [ ] **Step 4: `lib/tournaments/mode-catalogue.ts`** — add `id` to the `matchTypes` query and mapping:

```ts
export interface ModeCatalogue {
  modes: (ModeOption & { gameId: string })[]
  formats: (FormatOption & { modeId: string })[]
  maps: { id: string; name: string; modeId: string }[]
  matchRules: { id: string; name: string; modeId: string }[]
  matchTypes: { id: string; slug: string; name: string; available: boolean }[]
}
```
and
```ts
    supabase.from('match_types').select('id, slug, name, available').eq('active', true).order('seq'),
```
and
```ts
    matchTypes: (matchTypes.data ?? []).map((t) => ({
      id: t.id,
      slug: t.slug,
      name: t.name,
      available: t.available,
    })),
```

- [ ] **Step 5: `components/admin/TournamentForm.tsx`** — rename the field in `TournamentFormValues`:

```ts
  matchTypeId: string
```
(replaces `matchType: string`)

and the match-type select block:

```tsx
          {selectedMode?.competitionFormat === 'head_to_head' && (
            <div className="space-y-1.5">
              <label htmlFor="matchTypeId" className="text-sm font-medium text-slate-300">Match type</label>
              <select
                id="matchTypeId"
                name="matchTypeId"
                defaultValue={initial.matchTypeId || catalogue.matchTypes.find((t) => t.slug === 'bo1')?.id || ''}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
              >
                {catalogue.matchTypes.map((t) => (
                  <option key={t.id} value={t.id} disabled={!t.available}>
                    {t.name}{t.available ? '' : ' — coming soon'}
                  </option>
                ))}
              </select>
            </div>
          )}
```

- [ ] **Step 6: `app/[locale]/admin/tournaments/new/page.tsx`** — change `matchType: '',` to `matchTypeId: '',` in the default `initial` object.

- [ ] **Step 7: `app/[locale]/admin/tournaments/[id]/edit/page.tsx`** — change

```ts
    matchType: t.match_type ?? '',
```
to
```ts
    matchTypeId: t.match_type_id ?? '',
```

- [ ] **Step 8: Update `lib/tournaments/admin-form.test.ts`** — in the `describe('parseForm — mode, format, map, rules, match type', ...)` block, replace every `matchType`/`'bo1'`/`'bo7'` reference:

```ts
  it('defaults every new field to empty for a football tournament', () => {
    const r = parseForm(footballForm())
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.modeId).toBe('')
      expect(r.data.formatId).toBe('')
      expect(r.data.defaultMapId).toBe('')
      expect(r.data.matchRuleId).toBe('')
      expect(r.data.matchTypeId).toBe('')
    }
  })

  it('carries the five selections through to the parsed result', () => {
    // The bug this guards: parseForm hand-picks fields, so one added to the
    // schema but not here is dropped and the default silently wins.
    const fd = footballForm()
    fd.set('modeId', '33333333-3333-4333-8333-333333333333')
    fd.set('formatId', '44444444-4444-4444-8444-444444444444')
    fd.set('defaultMapId', '55555555-5555-4555-8555-555555555555')
    fd.set('matchRuleId', '66666666-6666-4666-8666-666666666666')
    fd.set('matchTypeId', '77777777-7777-4777-8777-777777777777')
    const r = parseForm(fd)

    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.modeId).toBe('33333333-3333-4333-8333-333333333333')
      expect(r.data.formatId).toBe('44444444-4444-4444-8444-444444444444')
      expect(r.data.defaultMapId).toBe('55555555-5555-4555-8555-555555555555')
      expect(r.data.matchRuleId).toBe('66666666-6666-4666-8666-666666666666')
      expect(r.data.matchTypeId).toBe('77777777-7777-4777-8777-777777777777')
    }
  })

  it('rejects a match type id that is not a uuid', () => {
    // matchTypeId is an FK into match_types, same trust model as
    // modeId/formatId/defaultMapId/matchRuleId: the schema only checks
    // shape, and whether it names a real, available row is the DB's job.
    const fd = footballForm()
    fd.set('matchTypeId', 'nonsense')
    expect(parseForm(fd).success).toBe(false)
  })

  it('rejects a match rule id that is not a uuid', () => {
    const fd = footballForm()
    fd.set('matchRuleId', 'nonsense')
    expect(parseForm(fd).success).toBe(false)
  })
})
```
(this replaces the entire existing block from `describe('parseForm — mode, format, map, rules, match type', ...)` through its closing `})`, including the two `matchType`-enum-specific tests, which no longer apply now that validity is the FK's job)

- [ ] **Step 9: Run the full suite for touched files**

Run: `npx vitest run lib/tournaments/admin-form.test.ts`
Expected: PASS.

- [ ] **Step 10: Regenerate Supabase types**

Run: `npx supabase gen types typescript --project-id <project-id> > lib/supabase/types.ts` (per CLAUDE.md's dev command; substitute the project's actual ref). Confirm `lib/supabase/types.ts` now has `match_type_id` on the `tournaments` row and no `match_type`.

- [ ] **Step 11: Commit**

```bash
git add lib/tournaments/admin-schema.ts lib/tournaments/admin-form.ts lib/tournaments/admin-actions.ts lib/tournaments/mode-catalogue.ts components/admin/TournamentForm.tsx "app/[locale]/admin/tournaments/new/page.tsx" "app/[locale]/admin/tournaments/[id]/edit/page.tsx" lib/tournaments/admin-form.test.ts lib/supabase/types.ts
git commit -m "refactor(tournaments): cut over match_type to match_type_id FK"
```

---

## Task 3: `lib/games/mode-catalogue-schema.ts` — zod schemas for the five entities

**Files:**
- Create: `lib/games/mode-catalogue-schema.ts`
- Test: `lib/games/mode-catalogue-schema.test.ts`

**Interfaces:**
- Produces: `modeSchema`, `formatSchema`, `mapSchema`, `matchRuleSchema`, `matchTypeSchema` (all zod object schemas), plus their inferred `ModeInput`/`FormatInput`/`MapInput`/`MatchRuleInput`/`MatchTypeInput` types.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/games/mode-catalogue-schema.test.ts
import { describe, it, expect } from 'vitest'
import { modeSchema, formatSchema, mapSchema, matchRuleSchema, matchTypeSchema } from './mode-catalogue-schema'

describe('modeSchema', () => {
  it('requires a name', () => {
    expect(modeSchema.safeParse({ name: '', competitionFormat: 'head_to_head' }).success).toBe(false)
  })
  it('rejects a competition format outside the two the DB permits', () => {
    expect(modeSchema.safeParse({ name: 'Battle Royale', competitionFormat: 'nonsense' }).success).toBe(false)
  })
  it('accepts a valid mode', () => {
    expect(modeSchema.safeParse({ name: 'Battle Royale', competitionFormat: 'points_race' }).success).toBe(true)
  })
})

describe('formatSchema', () => {
  it('rejects a team size outside 1-6', () => {
    expect(formatSchema.safeParse({ name: 'Squad', entryUnit: 'squad', teamSize: 8, available: false }).success).toBe(false)
  })
  it('coerces a string team size from form data', () => {
    const r = formatSchema.safeParse({ name: 'Duo', entryUnit: 'squad', teamSize: '2', available: false })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.teamSize).toBe(2)
  })
})

describe('mapSchema', () => {
  it('requires a name', () => {
    expect(mapSchema.safeParse({ name: '' }).success).toBe(false)
  })
})

describe('matchRuleSchema', () => {
  it('requires a name', () => {
    expect(matchRuleSchema.safeParse({ name: '' }).success).toBe(false)
  })
})

describe('matchTypeSchema', () => {
  it('requires a name', () => {
    expect(matchTypeSchema.safeParse({ name: '', available: false }).success).toBe(false)
  })
  it('accepts a valid match type', () => {
    expect(matchTypeSchema.safeParse({ name: 'Best of 7', available: false }).success).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/games/mode-catalogue-schema.test.ts`
Expected: FAIL with "Cannot find module './mode-catalogue-schema'".

- [ ] **Step 3: Write the implementation**

```ts
// lib/games/mode-catalogue-schema.ts
import { z } from 'zod'

export const modeSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60, 'Name is too long'),
  competitionFormat: z.enum(['head_to_head', 'points_race']),
})
export type ModeInput = z.infer<typeof modeSchema>

export const formatSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60, 'Name is too long'),
  entryUnit: z.enum(['solo', 'squad']),
  teamSize: z.coerce.number().int().min(1, 'Team size must be at least 1').max(6, 'Team size is at most 6'),
  available: z.boolean(),
})
export type FormatInput = z.infer<typeof formatSchema>

export const mapSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60, 'Name is too long'),
})
export type MapInput = z.infer<typeof mapSchema>

export const matchRuleSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60, 'Name is too long'),
})
export type MatchRuleInput = z.infer<typeof matchRuleSchema>

export const matchTypeSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60, 'Name is too long'),
  available: z.boolean(),
})
export type MatchTypeInput = z.infer<typeof matchTypeSchema>
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/games/mode-catalogue-schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/games/mode-catalogue-schema.ts lib/games/mode-catalogue-schema.test.ts
git commit -m "feat(games): zod schemas for the mode catalogue's five admin entities"
```

---

## Task 4: `lib/games/mode-actions.ts` — Mode CRUD, with descendant-aware delete

**Files:**
- Create: `lib/games/mode-actions.ts`
- Test: `lib/games/mode-actions.test.ts`

**Interfaces:**
- Consumes: `modeSchema` (Task 3); `slugify` (`lib/tournaments/slug.ts`); `requireStaff` (`lib/admin/auth.ts`).
- Produces: `type ModeActionState = { error?: string; success?: boolean } | undefined`; `createMode`, `updateMode`, `deleteMode`, `reorderModes` — each `(prev: ModeActionState, formData: FormData) => Promise<ModeActionState>`.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/games/mode-actions.test.ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/admin/auth', () => ({ requireStaff: vi.fn().mockResolvedValue({ isAdmin: true }) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createMode, deleteMode, reorderModes } from './mode-actions'

function formDataFrom(obj: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(obj)) fd.set(k, v)
  return fd
}

describe('createMode', () => {
  it('rejects an invalid competition format before touching the database', async () => {
    const result = await createMode(undefined, formDataFrom({ gameId: 'g1', name: 'Battle Royale', competitionFormat: 'nonsense' }))
    expect(result?.error).toBeTruthy()
  })

  it('requires a game', async () => {
    const result = await createMode(undefined, formDataFrom({ name: 'Battle Royale', competitionFormat: 'points_race' }))
    expect(result?.error).toBeTruthy()
  })

  it('maps a duplicate name to a friendly error', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({
      from: () => ({
        select: () => ({ eq: async () => ({ count: 0 }) }),
        insert: async () => ({ error: { code: '23505' } }),
      }),
    } as never)
    const result = await createMode(undefined, formDataFrom({ gameId: 'g1', name: 'Battle Royale', competitionFormat: 'points_race' }))
    expect(result?.error).toMatch(/already exists/)
  })
})

describe('deleteMode', () => {
  it('requires an id', async () => {
    const result = await deleteMode(undefined, formDataFrom({ gameId: 'g1' }))
    expect(result?.error).toBeTruthy()
  })

  it('hard-deletes a mode with no history anywhere in its subtree', async () => {
    const deleteFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const updateFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({
      from: (table: string) => {
        if (table === 'game_modes') return { delete: deleteFn, update: updateFn }
        if (table === 'game_mode_formats') return { select: () => ({ eq: async () => ({ data: [] }) }) }
        if (table === 'game_mode_maps') return { select: () => ({ eq: async () => ({ data: [] }) }) }
        if (table === 'game_mode_match_rules') return { select: () => ({ eq: async () => ({ data: [] }) }) }
        if (table === 'tournaments') return { select: () => ({ eq: () => ({ limit: async () => ({ data: [] }) }), in: () => ({ limit: async () => ({ data: [] }) }) }) }
        if (table === 'tournament_lobbies') return { select: () => ({ in: () => ({ limit: async () => ({ data: [] }) }) }) }
        throw new Error(`unexpected table ${table}`)
      },
    } as never)
    const result = await deleteMode(undefined, formDataFrom({ id: 'm1', gameId: 'g1' }))
    expect(result?.success).toBe(true)
    expect(deleteFn).toHaveBeenCalled()
    expect(updateFn).not.toHaveBeenCalled()
  })

  it('deactivates instead of deleting when a descendant format is referenced by a tournament, even though the mode itself is not', async () => {
    const deleteFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const updateFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({
      from: (table: string) => {
        if (table === 'game_modes') return { delete: deleteFn, update: updateFn }
        if (table === 'game_mode_formats') return { select: () => ({ eq: async () => ({ data: [{ id: 'f1' }] }) }) }
        if (table === 'game_mode_maps') return { select: () => ({ eq: async () => ({ data: [] }) }) }
        if (table === 'game_mode_match_rules') return { select: () => ({ eq: async () => ({ data: [] }) }) }
        if (table === 'tournaments') {
          return {
            select: () => ({
              eq: () => ({ limit: async () => ({ data: [] }) }),
              in: (col: string) => ({
                limit: async () => (col === 'format_id' ? { data: [{ id: 't1' }] } : { data: [] }),
              }),
            }),
          }
        }
        if (table === 'tournament_lobbies') return { select: () => ({ in: () => ({ limit: async () => ({ data: [] }) }) }) }
        throw new Error(`unexpected table ${table}`)
      },
    } as never)
    const result = await deleteMode(undefined, formDataFrom({ id: 'm1', gameId: 'g1' }))
    expect(result?.success).toBe(true)
    expect(updateFn).toHaveBeenCalled()
    expect(deleteFn).not.toHaveBeenCalled()
  })

  it('deactivates instead of deleting when a descendant map is referenced only via tournament_lobbies', async () => {
    const deleteFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const updateFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({
      from: (table: string) => {
        if (table === 'game_modes') return { delete: deleteFn, update: updateFn }
        if (table === 'game_mode_formats') return { select: () => ({ eq: async () => ({ data: [] }) }) }
        if (table === 'game_mode_maps') return { select: () => ({ eq: async () => ({ data: [{ id: 'map1' }] }) }) }
        if (table === 'game_mode_match_rules') return { select: () => ({ eq: async () => ({ data: [] }) }) }
        if (table === 'tournaments') return { select: () => ({ eq: () => ({ limit: async () => ({ data: [] }) }), in: () => ({ limit: async () => ({ data: [] }) }) }) }
        if (table === 'tournament_lobbies') return { select: () => ({ in: () => ({ limit: async () => ({ data: [{ id: 'lobby1' }] }) }) }) }
        throw new Error(`unexpected table ${table}`)
      },
    } as never)
    const result = await deleteMode(undefined, formDataFrom({ id: 'm1', gameId: 'g1' }))
    expect(result?.success).toBe(true)
    expect(updateFn).toHaveBeenCalled()
    expect(deleteFn).not.toHaveBeenCalled()
  })

  it('deactivates rather than hard-deletes when a history check itself fails, since a false negative is destructive', async () => {
    const deleteFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const updateFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({
      from: (table: string) => {
        if (table === 'game_modes') return { delete: deleteFn, update: updateFn }
        if (table === 'game_mode_formats') return { select: () => ({ eq: async () => ({ data: [] }) }) }
        if (table === 'game_mode_maps') return { select: () => ({ eq: async () => ({ data: [] }) }) }
        if (table === 'game_mode_match_rules') return { select: () => ({ eq: async () => ({ data: [] }) }) }
        if (table === 'tournaments') return { select: () => ({ eq: () => ({ limit: async () => ({ data: null, error: { message: 'connection reset' } }) }), in: () => ({ limit: async () => ({ data: [] }) }) }) }
        if (table === 'tournament_lobbies') return { select: () => ({ in: () => ({ limit: async () => ({ data: [] }) }) }) }
        throw new Error(`unexpected table ${table}`)
      },
    } as never)
    const result = await deleteMode(undefined, formDataFrom({ id: 'm1', gameId: 'g1' }))
    expect(result?.success).toBe(true)
    expect(updateFn).toHaveBeenCalled()
    expect(deleteFn).not.toHaveBeenCalled()
  })
})

describe('reorderModes', () => {
  it('updates seq for each id in order', async () => {
    const eqCalls: string[] = []
    const updateFn = vi.fn((patch: { seq: number }) => ({
      eq: async (_col: string, id: string) => {
        eqCalls.push(`${id}:${patch.seq}`)
        return { error: null }
      },
    }))
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({ from: () => ({ update: updateFn }) } as never)
    const result = await reorderModes(undefined, formDataFrom({ gameId: 'g1', orderedIds: JSON.stringify(['a', 'b']) }))
    expect(result?.success).toBe(true)
    expect(eqCalls).toEqual(['a:1', 'b:2'])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/games/mode-actions.test.ts`
Expected: FAIL with "Cannot find module './mode-actions'".

- [ ] **Step 3: Write the implementation**

```ts
// lib/games/mode-actions.ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { modeSchema } from './mode-catalogue-schema'
import { slugify } from '@/lib/tournaments/slug'

export type ModeActionState = { error?: string; success?: boolean } | undefined

function parseForm(formData: FormData) {
  return modeSchema.safeParse({
    name: formData.get('name') ?? '',
    competitionFormat: formData.get('competitionFormat') ?? 'head_to_head',
  })
}

export async function createMode(_prev: ModeActionState, formData: FormData): Promise<ModeActionState> {
  await requireStaff()
  const gameId = String(formData.get('gameId') ?? '')
  if (!gameId) return { error: 'Missing game.' }

  const parsed = parseForm(formData)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const slug = slugify(parsed.data.name).replace(/-/g, '_')
  if (!slug) return { error: 'Enter a name that produces a valid key.' }

  const supabase = createClient()
  const { count } = await supabase.from('game_modes').select('*', { count: 'exact', head: true }).eq('game_id', gameId)
  const { error } = await supabase.from('game_modes').insert({
    game_id: gameId,
    slug,
    name: parsed.data.name,
    competition_format: parsed.data.competitionFormat,
    seq: (count ?? 0) + 1,
  })
  if (error) return { error: error.code === '23505' ? 'A mode with this name already exists for this game.' : 'Could not create the mode.' }

  revalidatePath(`/admin/games/${gameId}`)
  revalidatePath('/admin/tournaments/new')
  return { success: true }
}

export async function updateMode(_prev: ModeActionState, formData: FormData): Promise<ModeActionState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  const gameId = String(formData.get('gameId') ?? '')
  if (!id || !gameId) return { error: 'Missing mode.' }

  const parsed = parseForm(formData)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = createClient()
  const { error } = await supabase
    .from('game_modes')
    .update({ name: parsed.data.name, competition_format: parsed.data.competitionFormat })
    .eq('id', id)
  if (error) return { error: 'Could not update the mode.' }

  revalidatePath(`/admin/games/${gameId}`)
  revalidatePath('/admin/tournaments/new')
  return { success: true }
}

// Deleting a Mode cascades (ON DELETE CASCADE) to its own formats/maps/match
// rules. If the mode itself, or any of those children, is referenced by a
// tournament (or, for a map, a tournament_lobbies row), hard-deleting the
// mode would silently destroy catalogue data a past tournament still points
// to — so this checks every descendant, not just the mode row itself.
export async function deleteMode(_prev: ModeActionState, formData: FormData): Promise<ModeActionState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  const gameId = String(formData.get('gameId') ?? '')
  if (!id || !gameId) return { error: 'Missing mode.' }

  const supabase = createClient()
  const [directRef, formatRows, mapRows, ruleRows] = await Promise.all([
    supabase.from('tournaments').select('id').eq('mode_id', id).limit(1),
    supabase.from('game_mode_formats').select('id').eq('mode_id', id),
    supabase.from('game_mode_maps').select('id').eq('mode_id', id),
    supabase.from('game_mode_match_rules').select('id').eq('mode_id', id),
  ])

  const formatIds = (formatRows.data ?? []).map((r: { id: string }) => r.id)
  const mapIds = (mapRows.data ?? []).map((r: { id: string }) => r.id)
  const ruleIds = (ruleRows.data ?? []).map((r: { id: string }) => r.id)

  const [formatRef, mapRef, lobbyRef, ruleRef] = await Promise.all([
    formatIds.length ? supabase.from('tournaments').select('id').in('format_id', formatIds).limit(1) : Promise.resolve({ data: [] as { id: string }[], error: null }),
    mapIds.length ? supabase.from('tournaments').select('id').in('default_map_id', mapIds).limit(1) : Promise.resolve({ data: [] as { id: string }[], error: null }),
    mapIds.length ? supabase.from('tournament_lobbies').select('id').in('map_id', mapIds).limit(1) : Promise.resolve({ data: [] as { id: string }[], error: null }),
    ruleIds.length ? supabase.from('tournaments').select('id').in('match_rule_id', ruleIds).limit(1) : Promise.resolve({ data: [] as { id: string }[], error: null }),
  ])

  // A failed check must not fail open into a hard delete (which would
  // cascade-destroy the mode's formats/maps/rules) — deactivating a mode
  // nobody used costs nothing, while wrongly cascading one still in use loses
  // catalogue data every tournament page that references it needs.
  const anyError = directRef.error || formatRows.error || mapRows.error || ruleRows.error || formatRef.error || mapRef.error || lobbyRef.error || ruleRef.error
  const hasHistory =
    Boolean(anyError) ||
    (directRef.data ?? []).length > 0 ||
    (formatRef.data ?? []).length > 0 ||
    (mapRef.data ?? []).length > 0 ||
    (lobbyRef.data ?? []).length > 0 ||
    (ruleRef.data ?? []).length > 0

  const { error } = hasHistory
    ? await supabase.from('game_modes').update({ active: false }).eq('id', id)
    : await supabase.from('game_modes').delete().eq('id', id)
  if (error) return { error: 'Could not remove the mode.' }

  revalidatePath(`/admin/games/${gameId}`)
  revalidatePath('/admin/tournaments/new')
  return { success: true }
}

export async function reorderModes(_prev: ModeActionState, formData: FormData): Promise<ModeActionState> {
  await requireStaff()
  const gameId = String(formData.get('gameId') ?? '')
  const orderedIds = JSON.parse(String(formData.get('orderedIds') ?? '[]')) as string[]
  if (!gameId || orderedIds.length === 0) return { error: 'Nothing to reorder.' }

  const supabase = createClient()
  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase.from('game_modes').update({ seq: i + 1 }).eq('id', orderedIds[i])
    if (error) return { error: 'Could not save the new order.' }
  }

  revalidatePath(`/admin/games/${gameId}`)
  return { success: true }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/games/mode-actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/games/mode-actions.ts lib/games/mode-actions.test.ts
git commit -m "feat(games): admin CRUD actions for game_modes, with descendant-aware delete"
```

---

## Task 5: `lib/games/format-actions.ts` — Format CRUD

**Files:**
- Create: `lib/games/format-actions.ts`
- Test: `lib/games/format-actions.test.ts`

**Interfaces:**
- Consumes: `formatSchema` (Task 3).
- Produces: `type FormatActionState`; `createFormat`, `updateFormat`, `deleteFormat`, `reorderFormats`.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/games/format-actions.test.ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/admin/auth', () => ({ requireStaff: vi.fn().mockResolvedValue({ isAdmin: true }) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createFormat, deleteFormat, reorderFormats } from './format-actions'

function formDataFrom(obj: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(obj)) fd.set(k, v)
  return fd
}

describe('createFormat', () => {
  it('rejects a team size outside 1-6 before touching the database', async () => {
    const result = await createFormat(undefined, formDataFrom({ gameId: 'g1', modeId: 'm1', name: '4v4', entryUnit: 'squad', teamSize: '9', available: 'false' }))
    expect(result?.error).toBeTruthy()
  })

  it('requires a mode', async () => {
    const result = await createFormat(undefined, formDataFrom({ gameId: 'g1', name: '1v1', entryUnit: 'solo', teamSize: '1', available: 'true' }))
    expect(result?.error).toBeTruthy()
  })

  it('maps a duplicate name to a friendly error', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({
      from: () => ({
        select: () => ({ eq: async () => ({ count: 0 }) }),
        insert: async () => ({ error: { code: '23505' } }),
      }),
    } as never)
    const result = await createFormat(undefined, formDataFrom({ gameId: 'g1', modeId: 'm1', name: '1v1', entryUnit: 'solo', teamSize: '1', available: 'true' }))
    expect(result?.error).toMatch(/already exists/)
  })
})

describe('deleteFormat', () => {
  it('hard-deletes when no tournament references this format', async () => {
    const deleteFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const updateFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({
      from: (table: string) => {
        if (table === 'game_mode_formats') return { delete: deleteFn, update: updateFn }
        if (table === 'tournaments') return { select: () => ({ eq: () => ({ limit: async () => ({ data: [] }) }) }) }
        throw new Error(`unexpected table ${table}`)
      },
    } as never)
    const result = await deleteFormat(undefined, formDataFrom({ id: 'f1', gameId: 'g1' }))
    expect(result?.success).toBe(true)
    expect(deleteFn).toHaveBeenCalled()
    expect(updateFn).not.toHaveBeenCalled()
  })

  it('deactivates instead of deleting when a tournament references this format', async () => {
    const deleteFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const updateFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({
      from: (table: string) => {
        if (table === 'game_mode_formats') return { delete: deleteFn, update: updateFn }
        if (table === 'tournaments') return { select: () => ({ eq: () => ({ limit: async () => ({ data: [{ id: 't1' }] }) }) }) }
        throw new Error(`unexpected table ${table}`)
      },
    } as never)
    const result = await deleteFormat(undefined, formDataFrom({ id: 'f1', gameId: 'g1' }))
    expect(result?.success).toBe(true)
    expect(updateFn).toHaveBeenCalled()
    expect(deleteFn).not.toHaveBeenCalled()
  })

  it('deactivates rather than hard-deletes when the history check itself fails', async () => {
    const deleteFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const updateFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({
      from: (table: string) => {
        if (table === 'game_mode_formats') return { delete: deleteFn, update: updateFn }
        if (table === 'tournaments') return { select: () => ({ eq: () => ({ limit: async () => ({ data: null, error: { message: 'connection reset' } }) }) }) }
        throw new Error(`unexpected table ${table}`)
      },
    } as never)
    const result = await deleteFormat(undefined, formDataFrom({ id: 'f1', gameId: 'g1' }))
    expect(result?.success).toBe(true)
    expect(updateFn).toHaveBeenCalled()
    expect(deleteFn).not.toHaveBeenCalled()
  })
})

describe('reorderFormats', () => {
  it('updates seq for each id in order', async () => {
    const eqCalls: string[] = []
    const updateFn = vi.fn((patch: { seq: number }) => ({
      eq: async (_col: string, id: string) => {
        eqCalls.push(`${id}:${patch.seq}`)
        return { error: null }
      },
    }))
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({ from: () => ({ update: updateFn }) } as never)
    const result = await reorderFormats(undefined, formDataFrom({ gameId: 'g1', orderedIds: JSON.stringify(['a', 'b']) }))
    expect(result?.success).toBe(true)
    expect(eqCalls).toEqual(['a:1', 'b:2'])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/games/format-actions.test.ts`
Expected: FAIL with "Cannot find module './format-actions'".

- [ ] **Step 3: Write the implementation**

```ts
// lib/games/format-actions.ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { formatSchema } from './mode-catalogue-schema'
import { slugify } from '@/lib/tournaments/slug'

export type FormatActionState = { error?: string; success?: boolean } | undefined

function parseForm(formData: FormData) {
  return formatSchema.safeParse({
    name: formData.get('name') ?? '',
    entryUnit: formData.get('entryUnit') ?? 'solo',
    teamSize: formData.get('teamSize') ?? '1',
    available: formData.get('available') === 'true',
  })
}

export async function createFormat(_prev: FormatActionState, formData: FormData): Promise<FormatActionState> {
  await requireStaff()
  const modeId = String(formData.get('modeId') ?? '')
  const gameId = String(formData.get('gameId') ?? '')
  if (!modeId || !gameId) return { error: 'Missing mode.' }

  const parsed = parseForm(formData)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const slug = slugify(parsed.data.name).replace(/-/g, '_')
  if (!slug) return { error: 'Enter a name that produces a valid key.' }

  const supabase = createClient()
  const { count } = await supabase.from('game_mode_formats').select('*', { count: 'exact', head: true }).eq('mode_id', modeId)
  const { error } = await supabase.from('game_mode_formats').insert({
    mode_id: modeId,
    slug,
    name: parsed.data.name,
    entry_unit: parsed.data.entryUnit,
    team_size: parsed.data.teamSize,
    available: parsed.data.available,
    seq: (count ?? 0) + 1,
  })
  if (error) return { error: error.code === '23505' ? 'A format with this name already exists for this mode.' : 'Could not create the format.' }

  revalidatePath(`/admin/games/${gameId}`)
  revalidatePath('/admin/tournaments/new')
  return { success: true }
}

export async function updateFormat(_prev: FormatActionState, formData: FormData): Promise<FormatActionState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  const gameId = String(formData.get('gameId') ?? '')
  if (!id || !gameId) return { error: 'Missing format.' }

  const parsed = parseForm(formData)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = createClient()
  const { error } = await supabase
    .from('game_mode_formats')
    .update({
      name: parsed.data.name,
      entry_unit: parsed.data.entryUnit,
      team_size: parsed.data.teamSize,
      available: parsed.data.available,
    })
    .eq('id', id)
  if (error) return { error: 'Could not update the format.' }

  revalidatePath(`/admin/games/${gameId}`)
  revalidatePath('/admin/tournaments/new')
  return { success: true }
}

export async function deleteFormat(_prev: FormatActionState, formData: FormData): Promise<FormatActionState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  const gameId = String(formData.get('gameId') ?? '')
  if (!id || !gameId) return { error: 'Missing format.' }

  const supabase = createClient()
  const { data: refs, error: historyError } = await supabase.from('tournaments').select('id').eq('format_id', id).limit(1)
  const hasHistory = Boolean(historyError) || (refs ?? []).length > 0

  const { error } = hasHistory
    ? await supabase.from('game_mode_formats').update({ active: false }).eq('id', id)
    : await supabase.from('game_mode_formats').delete().eq('id', id)
  if (error) return { error: 'Could not remove the format.' }

  revalidatePath(`/admin/games/${gameId}`)
  revalidatePath('/admin/tournaments/new')
  return { success: true }
}

export async function reorderFormats(_prev: FormatActionState, formData: FormData): Promise<FormatActionState> {
  await requireStaff()
  const gameId = String(formData.get('gameId') ?? '')
  const orderedIds = JSON.parse(String(formData.get('orderedIds') ?? '[]')) as string[]
  if (!gameId || orderedIds.length === 0) return { error: 'Nothing to reorder.' }

  const supabase = createClient()
  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase.from('game_mode_formats').update({ seq: i + 1 }).eq('id', orderedIds[i])
    if (error) return { error: 'Could not save the new order.' }
  }

  revalidatePath(`/admin/games/${gameId}`)
  return { success: true }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/games/format-actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/games/format-actions.ts lib/games/format-actions.test.ts
git commit -m "feat(games): admin CRUD actions for game_mode_formats"
```

---

## Task 6: `lib/games/map-actions.ts` — Map CRUD, with the two-reference-point delete check

**Files:**
- Create: `lib/games/map-actions.ts`
- Test: `lib/games/map-actions.test.ts`

**Interfaces:**
- Consumes: `mapSchema` (Task 3).
- Produces: `type MapActionState`; `createMap`, `updateMap`, `deleteMap`, `reorderMaps`.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/games/map-actions.test.ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/admin/auth', () => ({ requireStaff: vi.fn().mockResolvedValue({ isAdmin: true }) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createMap, deleteMap, reorderMaps } from './map-actions'

function formDataFrom(obj: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(obj)) fd.set(k, v)
  return fd
}

describe('createMap', () => {
  it('rejects an empty name before touching the database', async () => {
    const result = await createMap(undefined, formDataFrom({ gameId: 'g1', modeId: 'm1', name: '' }))
    expect(result?.error).toBeTruthy()
  })

  it('maps a duplicate name to a friendly error', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({
      from: () => ({
        select: () => ({ eq: async () => ({ count: 0 }) }),
        insert: async () => ({ error: { code: '23505' } }),
      }),
    } as never)
    const result = await createMap(undefined, formDataFrom({ gameId: 'g1', modeId: 'm1', name: 'Bermuda' }))
    expect(result?.error).toMatch(/already exists/)
  })
})

describe('deleteMap', () => {
  it('hard-deletes when neither a tournament nor a lobby references this map', async () => {
    const deleteFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const updateFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({
      from: (table: string) => {
        if (table === 'game_mode_maps') return { delete: deleteFn, update: updateFn }
        if (table === 'tournaments') return { select: () => ({ eq: () => ({ limit: async () => ({ data: [] }) }) }) }
        if (table === 'tournament_lobbies') return { select: () => ({ eq: () => ({ limit: async () => ({ data: [] }) }) }) }
        throw new Error(`unexpected table ${table}`)
      },
    } as never)
    const result = await deleteMap(undefined, formDataFrom({ id: 'map1', gameId: 'g1' }))
    expect(result?.success).toBe(true)
    expect(deleteFn).toHaveBeenCalled()
    expect(updateFn).not.toHaveBeenCalled()
  })

  it('deactivates instead of deleting when only a lobby overrides to this map — tournaments.default_map_id never pointed at it', async () => {
    const deleteFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const updateFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({
      from: (table: string) => {
        if (table === 'game_mode_maps') return { delete: deleteFn, update: updateFn }
        if (table === 'tournaments') return { select: () => ({ eq: () => ({ limit: async () => ({ data: [] }) }) }) }
        if (table === 'tournament_lobbies') return { select: () => ({ eq: () => ({ limit: async () => ({ data: [{ id: 'lobby1' }] }) }) }) }
        throw new Error(`unexpected table ${table}`)
      },
    } as never)
    const result = await deleteMap(undefined, formDataFrom({ id: 'map1', gameId: 'g1' }))
    expect(result?.success).toBe(true)
    expect(updateFn).toHaveBeenCalled()
    expect(deleteFn).not.toHaveBeenCalled()
  })

  it('deactivates instead of deleting when a tournament\'s default map is this one', async () => {
    const deleteFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const updateFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({
      from: (table: string) => {
        if (table === 'game_mode_maps') return { delete: deleteFn, update: updateFn }
        if (table === 'tournaments') return { select: () => ({ eq: () => ({ limit: async () => ({ data: [{ id: 't1' }] }) }) }) }
        if (table === 'tournament_lobbies') return { select: () => ({ eq: () => ({ limit: async () => ({ data: [] }) }) }) }
        throw new Error(`unexpected table ${table}`)
      },
    } as never)
    const result = await deleteMap(undefined, formDataFrom({ id: 'map1', gameId: 'g1' }))
    expect(result?.success).toBe(true)
    expect(updateFn).toHaveBeenCalled()
    expect(deleteFn).not.toHaveBeenCalled()
  })

  it('deactivates rather than hard-deletes when the history check itself fails', async () => {
    const deleteFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const updateFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({
      from: (table: string) => {
        if (table === 'game_mode_maps') return { delete: deleteFn, update: updateFn }
        if (table === 'tournaments') return { select: () => ({ eq: () => ({ limit: async () => ({ data: null, error: { message: 'connection reset' } }) }) }) }
        if (table === 'tournament_lobbies') return { select: () => ({ eq: () => ({ limit: async () => ({ data: [] }) }) }) }
        throw new Error(`unexpected table ${table}`)
      },
    } as never)
    const result = await deleteMap(undefined, formDataFrom({ id: 'map1', gameId: 'g1' }))
    expect(result?.success).toBe(true)
    expect(updateFn).toHaveBeenCalled()
    expect(deleteFn).not.toHaveBeenCalled()
  })
})

describe('reorderMaps', () => {
  it('updates seq for each id in order', async () => {
    const eqCalls: string[] = []
    const updateFn = vi.fn((patch: { seq: number }) => ({
      eq: async (_col: string, id: string) => {
        eqCalls.push(`${id}:${patch.seq}`)
        return { error: null }
      },
    }))
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({ from: () => ({ update: updateFn }) } as never)
    const result = await reorderMaps(undefined, formDataFrom({ gameId: 'g1', orderedIds: JSON.stringify(['a', 'b']) }))
    expect(result?.success).toBe(true)
    expect(eqCalls).toEqual(['a:1', 'b:2'])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/games/map-actions.test.ts`
Expected: FAIL with "Cannot find module './map-actions'".

- [ ] **Step 3: Write the implementation**

```ts
// lib/games/map-actions.ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { mapSchema } from './mode-catalogue-schema'

export type MapActionState = { error?: string; success?: boolean } | undefined

function parseForm(formData: FormData) {
  return mapSchema.safeParse({ name: formData.get('name') ?? '' })
}

export async function createMap(_prev: MapActionState, formData: FormData): Promise<MapActionState> {
  await requireStaff()
  const modeId = String(formData.get('modeId') ?? '')
  const gameId = String(formData.get('gameId') ?? '')
  if (!modeId || !gameId) return { error: 'Missing mode.' }

  const parsed = parseForm(formData)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = createClient()
  const { count } = await supabase.from('game_mode_maps').select('*', { count: 'exact', head: true }).eq('mode_id', modeId)
  const { error } = await supabase.from('game_mode_maps').insert({
    mode_id: modeId,
    name: parsed.data.name,
    seq: (count ?? 0) + 1,
  })
  if (error) return { error: error.code === '23505' ? 'A map with this name already exists for this mode.' : 'Could not create the map.' }

  revalidatePath(`/admin/games/${gameId}`)
  revalidatePath('/admin/tournaments/new')
  return { success: true }
}

export async function updateMap(_prev: MapActionState, formData: FormData): Promise<MapActionState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  const gameId = String(formData.get('gameId') ?? '')
  if (!id || !gameId) return { error: 'Missing map.' }

  const parsed = parseForm(formData)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = createClient()
  const { error } = await supabase.from('game_mode_maps').update({ name: parsed.data.name }).eq('id', id)
  if (error) return { error: error.code === '23505' ? 'A map with this name already exists for this mode.' : 'Could not update the map.' }

  revalidatePath(`/admin/games/${gameId}`)
  revalidatePath('/admin/tournaments/new')
  return { success: true }
}

// Maps are referenced from two places: tournaments.default_map_id (the
// tournament's default) and tournament_lobbies.map_id (a per-lobby
// override) — every other row in this catalogue only ever has one
// reference point, so this check has one extra leg.
export async function deleteMap(_prev: MapActionState, formData: FormData): Promise<MapActionState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  const gameId = String(formData.get('gameId') ?? '')
  if (!id || !gameId) return { error: 'Missing map.' }

  const supabase = createClient()
  const [tournamentRefs, lobbyRefs] = await Promise.all([
    supabase.from('tournaments').select('id').eq('default_map_id', id).limit(1),
    supabase.from('tournament_lobbies').select('id').eq('map_id', id).limit(1),
  ])
  const hasHistory =
    Boolean(tournamentRefs.error) || Boolean(lobbyRefs.error) || (tournamentRefs.data ?? []).length > 0 || (lobbyRefs.data ?? []).length > 0

  const { error } = hasHistory
    ? await supabase.from('game_mode_maps').update({ active: false }).eq('id', id)
    : await supabase.from('game_mode_maps').delete().eq('id', id)
  if (error) return { error: 'Could not remove the map.' }

  revalidatePath(`/admin/games/${gameId}`)
  revalidatePath('/admin/tournaments/new')
  return { success: true }
}

export async function reorderMaps(_prev: MapActionState, formData: FormData): Promise<MapActionState> {
  await requireStaff()
  const gameId = String(formData.get('gameId') ?? '')
  const orderedIds = JSON.parse(String(formData.get('orderedIds') ?? '[]')) as string[]
  if (!gameId || orderedIds.length === 0) return { error: 'Nothing to reorder.' }

  const supabase = createClient()
  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase.from('game_mode_maps').update({ seq: i + 1 }).eq('id', orderedIds[i])
    if (error) return { error: 'Could not save the new order.' }
  }

  revalidatePath(`/admin/games/${gameId}`)
  return { success: true }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/games/map-actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/games/map-actions.ts lib/games/map-actions.test.ts
git commit -m "feat(games): admin CRUD actions for game_mode_maps, checking both reference points"
```

---

## Task 7: `lib/games/match-rule-actions.ts` — Match Rule CRUD

**Files:**
- Create: `lib/games/match-rule-actions.ts`
- Test: `lib/games/match-rule-actions.test.ts`

**Interfaces:**
- Consumes: `matchRuleSchema` (Task 3).
- Produces: `type MatchRuleActionState`; `createMatchRule`, `updateMatchRule`, `deleteMatchRule`, `reorderMatchRules`.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/games/match-rule-actions.test.ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/admin/auth', () => ({ requireStaff: vi.fn().mockResolvedValue({ isAdmin: true }) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createMatchRule, deleteMatchRule, reorderMatchRules } from './match-rule-actions'

function formDataFrom(obj: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(obj)) fd.set(k, v)
  return fd
}

describe('createMatchRule', () => {
  it('rejects an empty name before touching the database', async () => {
    const result = await createMatchRule(undefined, formDataFrom({ gameId: 'g1', modeId: 'm1', name: '' }))
    expect(result?.error).toBeTruthy()
  })

  it('maps a duplicate name to a friendly error', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({
      from: () => ({
        select: () => ({ eq: async () => ({ count: 0 }) }),
        insert: async () => ({ error: { code: '23505' } }),
      }),
    } as never)
    const result = await createMatchRule(undefined, formDataFrom({ gameId: 'g1', modeId: 'm1', name: 'Headshot only' }))
    expect(result?.error).toMatch(/already exists/)
  })
})

describe('deleteMatchRule', () => {
  it('hard-deletes when no tournament references this rule', async () => {
    const deleteFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const updateFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({
      from: (table: string) => {
        if (table === 'game_mode_match_rules') return { delete: deleteFn, update: updateFn }
        if (table === 'tournaments') return { select: () => ({ eq: () => ({ limit: async () => ({ data: [] }) }) }) }
        throw new Error(`unexpected table ${table}`)
      },
    } as never)
    const result = await deleteMatchRule(undefined, formDataFrom({ id: 'r1', gameId: 'g1' }))
    expect(result?.success).toBe(true)
    expect(deleteFn).toHaveBeenCalled()
    expect(updateFn).not.toHaveBeenCalled()
  })

  it('deactivates instead of deleting when a tournament references this rule', async () => {
    const deleteFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const updateFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({
      from: (table: string) => {
        if (table === 'game_mode_match_rules') return { delete: deleteFn, update: updateFn }
        if (table === 'tournaments') return { select: () => ({ eq: () => ({ limit: async () => ({ data: [{ id: 't1' }] }) }) }) }
        throw new Error(`unexpected table ${table}`)
      },
    } as never)
    const result = await deleteMatchRule(undefined, formDataFrom({ id: 'r1', gameId: 'g1' }))
    expect(result?.success).toBe(true)
    expect(updateFn).toHaveBeenCalled()
    expect(deleteFn).not.toHaveBeenCalled()
  })

  it('deactivates rather than hard-deletes when the history check itself fails', async () => {
    const deleteFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const updateFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({
      from: (table: string) => {
        if (table === 'game_mode_match_rules') return { delete: deleteFn, update: updateFn }
        if (table === 'tournaments') return { select: () => ({ eq: () => ({ limit: async () => ({ data: null, error: { message: 'connection reset' } }) }) }) }
        throw new Error(`unexpected table ${table}`)
      },
    } as never)
    const result = await deleteMatchRule(undefined, formDataFrom({ id: 'r1', gameId: 'g1' }))
    expect(result?.success).toBe(true)
    expect(updateFn).toHaveBeenCalled()
    expect(deleteFn).not.toHaveBeenCalled()
  })
})

describe('reorderMatchRules', () => {
  it('updates seq for each id in order', async () => {
    const eqCalls: string[] = []
    const updateFn = vi.fn((patch: { seq: number }) => ({
      eq: async (_col: string, id: string) => {
        eqCalls.push(`${id}:${patch.seq}`)
        return { error: null }
      },
    }))
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({ from: () => ({ update: updateFn }) } as never)
    const result = await reorderMatchRules(undefined, formDataFrom({ gameId: 'g1', orderedIds: JSON.stringify(['a', 'b']) }))
    expect(result?.success).toBe(true)
    expect(eqCalls).toEqual(['a:1', 'b:2'])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/games/match-rule-actions.test.ts`
Expected: FAIL with "Cannot find module './match-rule-actions'".

- [ ] **Step 3: Write the implementation**

```ts
// lib/games/match-rule-actions.ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { matchRuleSchema } from './mode-catalogue-schema'
import { slugify } from '@/lib/tournaments/slug'

export type MatchRuleActionState = { error?: string; success?: boolean } | undefined

function parseForm(formData: FormData) {
  return matchRuleSchema.safeParse({ name: formData.get('name') ?? '' })
}

export async function createMatchRule(_prev: MatchRuleActionState, formData: FormData): Promise<MatchRuleActionState> {
  await requireStaff()
  const modeId = String(formData.get('modeId') ?? '')
  const gameId = String(formData.get('gameId') ?? '')
  if (!modeId || !gameId) return { error: 'Missing mode.' }

  const parsed = parseForm(formData)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const slug = slugify(parsed.data.name).replace(/-/g, '_')
  if (!slug) return { error: 'Enter a name that produces a valid key.' }

  const supabase = createClient()
  const { count } = await supabase.from('game_mode_match_rules').select('*', { count: 'exact', head: true }).eq('mode_id', modeId)
  const { error } = await supabase.from('game_mode_match_rules').insert({
    mode_id: modeId,
    slug,
    name: parsed.data.name,
    seq: (count ?? 0) + 1,
  })
  if (error) return { error: error.code === '23505' ? 'A match rule with this name already exists for this mode.' : 'Could not create the match rule.' }

  revalidatePath(`/admin/games/${gameId}`)
  revalidatePath('/admin/tournaments/new')
  return { success: true }
}

export async function updateMatchRule(_prev: MatchRuleActionState, formData: FormData): Promise<MatchRuleActionState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  const gameId = String(formData.get('gameId') ?? '')
  if (!id || !gameId) return { error: 'Missing match rule.' }

  const parsed = parseForm(formData)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = createClient()
  const { error } = await supabase.from('game_mode_match_rules').update({ name: parsed.data.name }).eq('id', id)
  if (error) return { error: 'Could not update the match rule.' }

  revalidatePath(`/admin/games/${gameId}`)
  revalidatePath('/admin/tournaments/new')
  return { success: true }
}

export async function deleteMatchRule(_prev: MatchRuleActionState, formData: FormData): Promise<MatchRuleActionState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  const gameId = String(formData.get('gameId') ?? '')
  if (!id || !gameId) return { error: 'Missing match rule.' }

  const supabase = createClient()
  const { data: refs, error: historyError } = await supabase.from('tournaments').select('id').eq('match_rule_id', id).limit(1)
  const hasHistory = Boolean(historyError) || (refs ?? []).length > 0

  const { error } = hasHistory
    ? await supabase.from('game_mode_match_rules').update({ active: false }).eq('id', id)
    : await supabase.from('game_mode_match_rules').delete().eq('id', id)
  if (error) return { error: 'Could not remove the match rule.' }

  revalidatePath(`/admin/games/${gameId}`)
  revalidatePath('/admin/tournaments/new')
  return { success: true }
}

export async function reorderMatchRules(_prev: MatchRuleActionState, formData: FormData): Promise<MatchRuleActionState> {
  await requireStaff()
  const gameId = String(formData.get('gameId') ?? '')
  const orderedIds = JSON.parse(String(formData.get('orderedIds') ?? '[]')) as string[]
  if (!gameId || orderedIds.length === 0) return { error: 'Nothing to reorder.' }

  const supabase = createClient()
  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase.from('game_mode_match_rules').update({ seq: i + 1 }).eq('id', orderedIds[i])
    if (error) return { error: 'Could not save the new order.' }
  }

  revalidatePath(`/admin/games/${gameId}`)
  return { success: true }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/games/match-rule-actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/games/match-rule-actions.ts lib/games/match-rule-actions.test.ts
git commit -m "feat(games): admin CRUD actions for game_mode_match_rules"
```

---

## Task 8: `lib/games/match-type-actions.ts` — Match Type CRUD (global, no game/mode scope)

**Files:**
- Create: `lib/games/match-type-actions.ts`
- Test: `lib/games/match-type-actions.test.ts`

**Interfaces:**
- Consumes: `matchTypeSchema` (Task 3).
- Produces: `type MatchTypeActionState`; `createMatchType`, `updateMatchType`, `deleteMatchType`, `reorderMatchTypes`.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/games/match-type-actions.test.ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/admin/auth', () => ({ requireStaff: vi.fn().mockResolvedValue({ isAdmin: true }) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createMatchType, deleteMatchType, reorderMatchTypes } from './match-type-actions'

function formDataFrom(obj: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(obj)) fd.set(k, v)
  return fd
}

describe('createMatchType', () => {
  it('rejects an empty name before touching the database', async () => {
    const result = await createMatchType(undefined, formDataFrom({ name: '', available: 'false' }))
    expect(result?.error).toBeTruthy()
  })

  it('maps a duplicate name to a friendly error', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({
      from: () => ({
        select: async () => ({ count: 0 }),
        insert: async () => ({ error: { code: '23505' } }),
      }),
    } as never)
    const result = await createMatchType(undefined, formDataFrom({ name: 'Best of 7', available: 'false' }))
    expect(result?.error).toMatch(/already exists/)
  })
})

describe('deleteMatchType', () => {
  it('hard-deletes when no tournament references this match type', async () => {
    const deleteFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const updateFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({
      from: (table: string) => {
        if (table === 'match_types') return { delete: deleteFn, update: updateFn }
        if (table === 'tournaments') return { select: () => ({ eq: () => ({ limit: async () => ({ data: [] }) }) }) }
        throw new Error(`unexpected table ${table}`)
      },
    } as never)
    const result = await deleteMatchType(undefined, formDataFrom({ id: 'mt1' }))
    expect(result?.success).toBe(true)
    expect(deleteFn).toHaveBeenCalled()
    expect(updateFn).not.toHaveBeenCalled()
  })

  it('deactivates instead of deleting when a tournament references this match type', async () => {
    const deleteFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const updateFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({
      from: (table: string) => {
        if (table === 'match_types') return { delete: deleteFn, update: updateFn }
        if (table === 'tournaments') return { select: () => ({ eq: () => ({ limit: async () => ({ data: [{ id: 't1' }] }) }) }) }
        throw new Error(`unexpected table ${table}`)
      },
    } as never)
    const result = await deleteMatchType(undefined, formDataFrom({ id: 'mt1' }))
    expect(result?.success).toBe(true)
    expect(updateFn).toHaveBeenCalled()
    expect(deleteFn).not.toHaveBeenCalled()
  })

  it('deactivates rather than hard-deletes when the history check itself fails', async () => {
    const deleteFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const updateFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({
      from: (table: string) => {
        if (table === 'match_types') return { delete: deleteFn, update: updateFn }
        if (table === 'tournaments') return { select: () => ({ eq: () => ({ limit: async () => ({ data: null, error: { message: 'connection reset' } }) }) }) }
        throw new Error(`unexpected table ${table}`)
      },
    } as never)
    const result = await deleteMatchType(undefined, formDataFrom({ id: 'mt1' }))
    expect(result?.success).toBe(true)
    expect(updateFn).toHaveBeenCalled()
    expect(deleteFn).not.toHaveBeenCalled()
  })
})

describe('reorderMatchTypes', () => {
  it('updates seq for each id in order', async () => {
    const eqCalls: string[] = []
    const updateFn = vi.fn((patch: { seq: number }) => ({
      eq: async (_col: string, id: string) => {
        eqCalls.push(`${id}:${patch.seq}`)
        return { error: null }
      },
    }))
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({ from: () => ({ update: updateFn }) } as never)
    const result = await reorderMatchTypes(undefined, formDataFrom({ orderedIds: JSON.stringify(['a', 'b']) }))
    expect(result?.success).toBe(true)
    expect(eqCalls).toEqual(['a:1', 'b:2'])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/games/match-type-actions.test.ts`
Expected: FAIL with "Cannot find module './match-type-actions'".

- [ ] **Step 3: Write the implementation**

```ts
// lib/games/match-type-actions.ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { matchTypeSchema } from './mode-catalogue-schema'
import { slugify } from '@/lib/tournaments/slug'

export type MatchTypeActionState = { error?: string; success?: boolean } | undefined

function parseForm(formData: FormData) {
  return matchTypeSchema.safeParse({
    name: formData.get('name') ?? '',
    available: formData.get('available') === 'true',
  })
}

// match_types has no game_id/mode_id — it's the one global section of the
// Game Designer (spec §5.1 item 7), so it lives on the games LIST page, not
// any single game's Designer page.
export async function createMatchType(_prev: MatchTypeActionState, formData: FormData): Promise<MatchTypeActionState> {
  await requireStaff()
  const parsed = parseForm(formData)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const slug = slugify(parsed.data.name).replace(/-/g, '_')
  if (!slug) return { error: 'Enter a name that produces a valid key.' }

  const supabase = createClient()
  const { count } = await supabase.from('match_types').select('*', { count: 'exact', head: true })
  const { error } = await supabase.from('match_types').insert({
    slug,
    name: parsed.data.name,
    available: parsed.data.available,
    seq: (count ?? 0) + 1,
  })
  if (error) return { error: error.code === '23505' ? 'A match type with this name already exists.' : 'Could not create the match type.' }

  revalidatePath('/admin/games')
  revalidatePath('/admin/tournaments/new')
  return { success: true }
}

export async function updateMatchType(_prev: MatchTypeActionState, formData: FormData): Promise<MatchTypeActionState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing match type.' }

  const parsed = parseForm(formData)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = createClient()
  const { error } = await supabase.from('match_types').update({ name: parsed.data.name, available: parsed.data.available }).eq('id', id)
  if (error) return { error: 'Could not update the match type.' }

  revalidatePath('/admin/games')
  revalidatePath('/admin/tournaments/new')
  return { success: true }
}

export async function deleteMatchType(_prev: MatchTypeActionState, formData: FormData): Promise<MatchTypeActionState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing match type.' }

  const supabase = createClient()
  const { data: refs, error: historyError } = await supabase.from('tournaments').select('id').eq('match_type_id', id).limit(1)
  const hasHistory = Boolean(historyError) || (refs ?? []).length > 0

  const { error } = hasHistory
    ? await supabase.from('match_types').update({ active: false }).eq('id', id)
    : await supabase.from('match_types').delete().eq('id', id)
  if (error) return { error: 'Could not remove the match type.' }

  revalidatePath('/admin/games')
  revalidatePath('/admin/tournaments/new')
  return { success: true }
}

export async function reorderMatchTypes(_prev: MatchTypeActionState, formData: FormData): Promise<MatchTypeActionState> {
  await requireStaff()
  const orderedIds = JSON.parse(String(formData.get('orderedIds') ?? '[]')) as string[]
  if (orderedIds.length === 0) return { error: 'Nothing to reorder.' }

  const supabase = createClient()
  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase.from('match_types').update({ seq: i + 1 }).eq('id', orderedIds[i])
    if (error) return { error: 'Could not save the new order.' }
  }

  revalidatePath('/admin/games')
  return { success: true }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/games/match-type-actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/games/match-type-actions.ts lib/games/match-type-actions.test.ts
git commit -m "feat(games): admin CRUD actions for match_types (global catalogue)"
```

---

## Task 9: `FormatForm`/`FormatsPanel` — nested Formats UI

**Files:**
- Create: `components/admin/FormatForm.tsx`
- Create: `components/admin/FormatsPanel.tsx`

**Interfaces:**
- Consumes: `createFormat`/`updateFormat`/`deleteFormat`/`reorderFormats`, `FormatActionState` (Task 5).
- Produces: `FormatRow` type `{ id: string; modeId: string; name: string; entryUnit: string; teamSize: number; available: boolean }`; `<FormatsPanel gameId modeId formats />`.

- [ ] **Step 1: `components/admin/FormatForm.tsx`**

```tsx
'use client'
import { useFormState } from 'react-dom'
import { SubmitButton } from '@/components/ui/submit-button'

export interface FormatRow {
  id: string
  modeId: string
  name: string
  entryUnit: string
  teamSize: number
  available: boolean
}

type ActionState = { error?: string; success?: boolean } | undefined
type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>

export function FormatForm({
  gameId,
  modeId,
  action,
  existing,
  onDone,
}: {
  gameId: string
  modeId: string
  action: Action
  existing?: FormatRow
  onDone?: () => void
}) {
  const [state, formAction] = useFormState<ActionState, FormData>(action, undefined)
  if (state?.success) onDone?.()

  return (
    <form action={formAction} className="space-y-3 rounded-xl border border-slate-800 bg-slate-950 p-4">
      <input type="hidden" name="gameId" value={gameId} />
      <input type="hidden" name="modeId" value={modeId} />
      {existing && <input type="hidden" name="id" value={existing.id} />}
      <input
        name="name"
        placeholder="Name (e.g. 4v4)"
        defaultValue={existing?.name}
        required
        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-600"
      />
      <select name="entryUnit" defaultValue={existing?.entryUnit ?? 'solo'} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white">
        <option value="solo">Solo</option>
        <option value="squad">Squad</option>
      </select>
      <input
        name="teamSize"
        type="number"
        min={1}
        max={6}
        placeholder="Team size"
        defaultValue={existing?.teamSize ?? 1}
        required
        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-600"
      />
      <label className="flex items-center gap-2 text-sm text-slate-300">
        <input type="checkbox" name="available" value="true" defaultChecked={existing?.available ?? false} />
        Available (uncheck to show as &quot;coming soon&quot;)
      </label>
      {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
      <SubmitButton pendingLabel="Saving…" className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-bold text-white hover:bg-violet-500">
        {existing ? 'Save format' : 'Add format'}
      </SubmitButton>
    </form>
  )
}
```

- [ ] **Step 2: `components/admin/FormatsPanel.tsx`**

```tsx
'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { FormatForm, type FormatRow } from './FormatForm'
import { createFormat, updateFormat, deleteFormat, reorderFormats } from '@/lib/games/format-actions'
import type { FormatActionState } from '@/lib/games/format-actions'
import { SubmitButton } from '@/components/ui/submit-button'

function reordered(ids: string[], index: number, direction: -1 | 1): string[] {
  const target = index + direction
  if (target < 0 || target >= ids.length) return ids
  const next = [...ids]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

export function FormatsPanel({ gameId, modeId, formats }: { gameId: string; modeId: string; formats: FormatRow[] }) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [deleteState, deleteAction] = useFormState<FormatActionState, FormData>(deleteFormat, undefined)
  const [reorderState, reorderAction] = useFormState<FormatActionState, FormData>(reorderFormats, undefined)
  const ids = formats.map((f) => f.id)

  return (
    <section className="space-y-2">
      <h4 className="text-xs font-bold uppercase tracking-wide text-slate-400">Formats</h4>

      {formats.map((f, i) =>
        editingId === f.id ? (
          <FormatForm key={f.id} gameId={gameId} modeId={modeId} action={updateFormat} existing={f} onDone={() => setEditingId(null)} />
        ) : (
          <div key={f.id} className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950 p-2.5">
            <div>
              <p className="text-sm font-semibold text-white">{f.name}</p>
              <p className="text-xs text-slate-500">
                {f.entryUnit === 'squad' ? `Squad · ${f.teamSize}` : 'Solo'} · {f.available ? 'Available' : 'Coming soon'}
              </p>
            </div>
            <div className="flex gap-1.5">
              {i > 0 && (
                <form action={reorderAction}>
                  <input type="hidden" name="gameId" value={gameId} />
                  <input type="hidden" name="orderedIds" value={JSON.stringify(reordered(ids, i, -1))} />
                  <SubmitButton pendingLabel="…" className="rounded-lg border border-slate-700 px-2 py-1 text-xs font-bold text-slate-200 hover:border-slate-500">↑</SubmitButton>
                </form>
              )}
              {i < formats.length - 1 && (
                <form action={reorderAction}>
                  <input type="hidden" name="gameId" value={gameId} />
                  <input type="hidden" name="orderedIds" value={JSON.stringify(reordered(ids, i, 1))} />
                  <SubmitButton pendingLabel="…" className="rounded-lg border border-slate-700 px-2 py-1 text-xs font-bold text-slate-200 hover:border-slate-500">↓</SubmitButton>
                </form>
              )}
              <button type="button" onClick={() => setEditingId(f.id)} className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs font-bold text-slate-200 hover:border-slate-500">Edit</button>
              <form action={deleteAction}>
                <input type="hidden" name="gameId" value={gameId} />
                <input type="hidden" name="id" value={f.id} />
                <SubmitButton pendingLabel="…" className="rounded-lg border border-red-900 px-2.5 py-1 text-xs font-bold text-red-400 hover:border-red-700">Remove</SubmitButton>
              </form>
            </div>
          </div>
        ),
      )}
      {deleteState?.error && <p className="text-xs text-red-400">{deleteState.error}</p>}
      {reorderState?.error && <p className="text-xs text-red-400">{reorderState.error}</p>}

      {adding ? (
        <FormatForm gameId={gameId} modeId={modeId} action={createFormat} onDone={() => setAdding(false)} />
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-200 hover:border-slate-500">+ Add a format</button>
      )}
    </section>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add components/admin/FormatForm.tsx components/admin/FormatsPanel.tsx
git commit -m "feat(admin): Formats panel for the Game Designer"
```

---

## Task 10: `MapForm`/`MapsPanel` and `MatchRuleForm`/`MatchRulesPanel` — nested Maps and Match Rules UI

**Files:**
- Create: `components/admin/MapForm.tsx`
- Create: `components/admin/MapsPanel.tsx`
- Create: `components/admin/MatchRuleForm.tsx`
- Create: `components/admin/MatchRulesPanel.tsx`

**Interfaces:**
- Consumes: `createMap`/`updateMap`/`deleteMap`/`reorderMaps` (Task 6); `createMatchRule`/`updateMatchRule`/`deleteMatchRule`/`reorderMatchRules` (Task 7).
- Produces: `MapRow { id: string; modeId: string; name: string }`; `<MapsPanel gameId modeId maps />`; `MatchRuleRow { id: string; modeId: string; name: string }`; `<MatchRulesPanel gameId modeId matchRules />`.

- [ ] **Step 1: `components/admin/MapForm.tsx`**

```tsx
'use client'
import { useFormState } from 'react-dom'
import { SubmitButton } from '@/components/ui/submit-button'

export interface MapRow {
  id: string
  modeId: string
  name: string
}

type ActionState = { error?: string; success?: boolean } | undefined
type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>

export function MapForm({
  gameId,
  modeId,
  action,
  existing,
  onDone,
}: {
  gameId: string
  modeId: string
  action: Action
  existing?: MapRow
  onDone?: () => void
}) {
  const [state, formAction] = useFormState<ActionState, FormData>(action, undefined)
  if (state?.success) onDone?.()

  return (
    <form action={formAction} className="space-y-3 rounded-xl border border-slate-800 bg-slate-950 p-4">
      <input type="hidden" name="gameId" value={gameId} />
      <input type="hidden" name="modeId" value={modeId} />
      {existing && <input type="hidden" name="id" value={existing.id} />}
      <input
        name="name"
        placeholder="Map name (e.g. Bermuda)"
        defaultValue={existing?.name}
        required
        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-600"
      />
      {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
      <SubmitButton pendingLabel="Saving…" className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-bold text-white hover:bg-violet-500">
        {existing ? 'Save map' : 'Add map'}
      </SubmitButton>
    </form>
  )
}
```

- [ ] **Step 2: `components/admin/MapsPanel.tsx`**

```tsx
'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { MapForm, type MapRow } from './MapForm'
import { createMap, updateMap, deleteMap, reorderMaps } from '@/lib/games/map-actions'
import type { MapActionState } from '@/lib/games/map-actions'
import { SubmitButton } from '@/components/ui/submit-button'

function reordered(ids: string[], index: number, direction: -1 | 1): string[] {
  const target = index + direction
  if (target < 0 || target >= ids.length) return ids
  const next = [...ids]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

export function MapsPanel({ gameId, modeId, maps }: { gameId: string; modeId: string; maps: MapRow[] }) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [deleteState, deleteAction] = useFormState<MapActionState, FormData>(deleteMap, undefined)
  const [reorderState, reorderAction] = useFormState<MapActionState, FormData>(reorderMaps, undefined)
  const ids = maps.map((m) => m.id)

  return (
    <section className="space-y-2">
      <h4 className="text-xs font-bold uppercase tracking-wide text-slate-400">Maps</h4>

      {maps.map((m, i) =>
        editingId === m.id ? (
          <MapForm key={m.id} gameId={gameId} modeId={modeId} action={updateMap} existing={m} onDone={() => setEditingId(null)} />
        ) : (
          <div key={m.id} className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950 p-2.5">
            <p className="text-sm font-semibold text-white">{m.name}</p>
            <div className="flex gap-1.5">
              {i > 0 && (
                <form action={reorderAction}>
                  <input type="hidden" name="gameId" value={gameId} />
                  <input type="hidden" name="orderedIds" value={JSON.stringify(reordered(ids, i, -1))} />
                  <SubmitButton pendingLabel="…" className="rounded-lg border border-slate-700 px-2 py-1 text-xs font-bold text-slate-200 hover:border-slate-500">↑</SubmitButton>
                </form>
              )}
              {i < maps.length - 1 && (
                <form action={reorderAction}>
                  <input type="hidden" name="gameId" value={gameId} />
                  <input type="hidden" name="orderedIds" value={JSON.stringify(reordered(ids, i, 1))} />
                  <SubmitButton pendingLabel="…" className="rounded-lg border border-slate-700 px-2 py-1 text-xs font-bold text-slate-200 hover:border-slate-500">↓</SubmitButton>
                </form>
              )}
              <button type="button" onClick={() => setEditingId(m.id)} className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs font-bold text-slate-200 hover:border-slate-500">Edit</button>
              <form action={deleteAction}>
                <input type="hidden" name="gameId" value={gameId} />
                <input type="hidden" name="id" value={m.id} />
                <SubmitButton pendingLabel="…" className="rounded-lg border border-red-900 px-2.5 py-1 text-xs font-bold text-red-400 hover:border-red-700">Remove</SubmitButton>
              </form>
            </div>
          </div>
        ),
      )}
      {deleteState?.error && <p className="text-xs text-red-400">{deleteState.error}</p>}
      {reorderState?.error && <p className="text-xs text-red-400">{reorderState.error}</p>}

      {adding ? (
        <MapForm gameId={gameId} modeId={modeId} action={createMap} onDone={() => setAdding(false)} />
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-200 hover:border-slate-500">+ Add a map</button>
      )}
    </section>
  )
}
```

- [ ] **Step 3: `components/admin/MatchRuleForm.tsx`**

```tsx
'use client'
import { useFormState } from 'react-dom'
import { SubmitButton } from '@/components/ui/submit-button'

export interface MatchRuleRow {
  id: string
  modeId: string
  name: string
}

type ActionState = { error?: string; success?: boolean } | undefined
type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>

export function MatchRuleForm({
  gameId,
  modeId,
  action,
  existing,
  onDone,
}: {
  gameId: string
  modeId: string
  action: Action
  existing?: MatchRuleRow
  onDone?: () => void
}) {
  const [state, formAction] = useFormState<ActionState, FormData>(action, undefined)
  if (state?.success) onDone?.()

  return (
    <form action={formAction} className="space-y-3 rounded-xl border border-slate-800 bg-slate-950 p-4">
      <input type="hidden" name="gameId" value={gameId} />
      <input type="hidden" name="modeId" value={modeId} />
      {existing && <input type="hidden" name="id" value={existing.id} />}
      <input
        name="name"
        placeholder="Rule name (e.g. Headshot only)"
        defaultValue={existing?.name}
        required
        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-600"
      />
      {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
      <SubmitButton pendingLabel="Saving…" className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-bold text-white hover:bg-violet-500">
        {existing ? 'Save match rule' : 'Add match rule'}
      </SubmitButton>
    </form>
  )
}
```

- [ ] **Step 4: `components/admin/MatchRulesPanel.tsx`**

```tsx
'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { MatchRuleForm, type MatchRuleRow } from './MatchRuleForm'
import { createMatchRule, updateMatchRule, deleteMatchRule, reorderMatchRules } from '@/lib/games/match-rule-actions'
import type { MatchRuleActionState } from '@/lib/games/match-rule-actions'
import { SubmitButton } from '@/components/ui/submit-button'

function reordered(ids: string[], index: number, direction: -1 | 1): string[] {
  const target = index + direction
  if (target < 0 || target >= ids.length) return ids
  const next = [...ids]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

export function MatchRulesPanel({ gameId, modeId, matchRules }: { gameId: string; modeId: string; matchRules: MatchRuleRow[] }) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [deleteState, deleteAction] = useFormState<MatchRuleActionState, FormData>(deleteMatchRule, undefined)
  const [reorderState, reorderAction] = useFormState<MatchRuleActionState, FormData>(reorderMatchRules, undefined)
  const ids = matchRules.map((r) => r.id)

  return (
    <section className="space-y-2">
      <h4 className="text-xs font-bold uppercase tracking-wide text-slate-400">Match Rules</h4>

      {matchRules.map((r, i) =>
        editingId === r.id ? (
          <MatchRuleForm key={r.id} gameId={gameId} modeId={modeId} action={updateMatchRule} existing={r} onDone={() => setEditingId(null)} />
        ) : (
          <div key={r.id} className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950 p-2.5">
            <p className="text-sm font-semibold text-white">{r.name}</p>
            <div className="flex gap-1.5">
              {i > 0 && (
                <form action={reorderAction}>
                  <input type="hidden" name="gameId" value={gameId} />
                  <input type="hidden" name="orderedIds" value={JSON.stringify(reordered(ids, i, -1))} />
                  <SubmitButton pendingLabel="…" className="rounded-lg border border-slate-700 px-2 py-1 text-xs font-bold text-slate-200 hover:border-slate-500">↑</SubmitButton>
                </form>
              )}
              {i < matchRules.length - 1 && (
                <form action={reorderAction}>
                  <input type="hidden" name="gameId" value={gameId} />
                  <input type="hidden" name="orderedIds" value={JSON.stringify(reordered(ids, i, 1))} />
                  <SubmitButton pendingLabel="…" className="rounded-lg border border-slate-700 px-2 py-1 text-xs font-bold text-slate-200 hover:border-slate-500">↓</SubmitButton>
                </form>
              )}
              <button type="button" onClick={() => setEditingId(r.id)} className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs font-bold text-slate-200 hover:border-slate-500">Edit</button>
              <form action={deleteAction}>
                <input type="hidden" name="gameId" value={gameId} />
                <input type="hidden" name="id" value={r.id} />
                <SubmitButton pendingLabel="…" className="rounded-lg border border-red-900 px-2.5 py-1 text-xs font-bold text-red-400 hover:border-red-700">Remove</SubmitButton>
              </form>
            </div>
          </div>
        ),
      )}
      {deleteState?.error && <p className="text-xs text-red-400">{deleteState.error}</p>}
      {reorderState?.error && <p className="text-xs text-red-400">{reorderState.error}</p>}

      {adding ? (
        <MatchRuleForm gameId={gameId} modeId={modeId} action={createMatchRule} onDone={() => setAdding(false)} />
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-200 hover:border-slate-500">+ Add a match rule</button>
      )}
    </section>
  )
}
```

- [ ] **Step 5: Commit**

```bash
git add components/admin/MapForm.tsx components/admin/MapsPanel.tsx components/admin/MatchRuleForm.tsx components/admin/MatchRulesPanel.tsx
git commit -m "feat(admin): Maps and Match Rules panels for the Game Designer"
```

---

## Task 11: `ModeForm`/`ModesPanel` — composes Formats/Maps/Match Rules, wired into `/admin/games/[id]`

**Files:**
- Create: `components/admin/ModeForm.tsx`
- Create: `components/admin/ModesPanel.tsx`
- Modify: `app/[locale]/admin/games/[id]/page.tsx`

**Interfaces:**
- Consumes: `createMode`/`updateMode`/`deleteMode`/`reorderModes` (Task 4); `FormatsPanel`/`FormatRow` (Task 9); `MapsPanel`/`MapRow`, `MatchRulesPanel`/`MatchRuleRow` (Task 10).
- Produces: `ModeRow { id: string; name: string; competitionFormat: string }`; `<ModesPanel gameId modes formats maps matchRules />`.

- [ ] **Step 1: `components/admin/ModeForm.tsx`**

```tsx
'use client'
import { useFormState } from 'react-dom'
import { SubmitButton } from '@/components/ui/submit-button'

export interface ModeRow {
  id: string
  name: string
  competitionFormat: string
}

type ActionState = { error?: string; success?: boolean } | undefined
type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>

export function ModeForm({
  gameId,
  action,
  existing,
  onDone,
}: {
  gameId: string
  action: Action
  existing?: ModeRow
  onDone?: () => void
}) {
  const [state, formAction] = useFormState<ActionState, FormData>(action, undefined)
  if (state?.success) onDone?.()

  return (
    <form action={formAction} className="space-y-3 rounded-xl border border-slate-800 bg-slate-950 p-4">
      <input type="hidden" name="gameId" value={gameId} />
      {existing && <input type="hidden" name="id" value={existing.id} />}
      <input
        name="name"
        placeholder="Name (e.g. Clash Squad)"
        defaultValue={existing?.name}
        required
        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-600"
      />
      <select name="competitionFormat" defaultValue={existing?.competitionFormat ?? 'head_to_head'} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white">
        <option value="head_to_head">Head-to-head</option>
        <option value="points_race">Points race</option>
      </select>
      {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
      <SubmitButton pendingLabel="Saving…" className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-bold text-white hover:bg-violet-500">
        {existing ? 'Save mode' : 'Add mode'}
      </SubmitButton>
    </form>
  )
}
```

- [ ] **Step 2: `components/admin/ModesPanel.tsx`**

```tsx
'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { ModeForm, type ModeRow } from './ModeForm'
import { FormatsPanel } from './FormatsPanel'
import type { FormatRow } from './FormatForm'
import { MapsPanel } from './MapsPanel'
import type { MapRow } from './MapForm'
import { MatchRulesPanel } from './MatchRulesPanel'
import type { MatchRuleRow } from './MatchRuleForm'
import { createMode, updateMode, deleteMode, reorderModes } from '@/lib/games/mode-actions'
import type { ModeActionState } from '@/lib/games/mode-actions'
import { SubmitButton } from '@/components/ui/submit-button'

function reordered(ids: string[], index: number, direction: -1 | 1): string[] {
  const target = index + direction
  if (target < 0 || target >= ids.length) return ids
  const next = [...ids]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

export function ModesPanel({
  gameId,
  modes,
  formats,
  maps,
  matchRules,
}: {
  gameId: string
  modes: ModeRow[]
  formats: FormatRow[]
  maps: MapRow[]
  matchRules: MatchRuleRow[]
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [deleteState, deleteAction] = useFormState<ModeActionState, FormData>(deleteMode, undefined)
  const [reorderState, reorderAction] = useFormState<ModeActionState, FormData>(reorderModes, undefined)
  const ids = modes.map((m) => m.id)

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-bold text-white">Modes</h3>
      <p className="text-xs text-slate-500">What is actually being played — Battle Royale, Clash Squad. Expand a mode to manage its Formats, Maps and Match Rules.</p>

      {modes.map((m, i) =>
        editingId === m.id ? (
          <ModeForm key={m.id} gameId={gameId} action={updateMode} existing={m} onDone={() => setEditingId(null)} />
        ) : (
          <div key={m.id} className="rounded-xl border border-slate-800 bg-slate-900 p-3">
            <div className="flex items-center justify-between gap-2">
              <button type="button" onClick={() => setExpandedId(expandedId === m.id ? null : m.id)} className="text-left">
                <p className="text-sm font-semibold text-white">
                  {expandedId === m.id ? '▾' : '▸'} {m.name} <span className="text-slate-500">({m.competitionFormat})</span>
                </p>
              </button>
              <div className="flex shrink-0 gap-1.5">
                {i > 0 && (
                  <form action={reorderAction}>
                    <input type="hidden" name="gameId" value={gameId} />
                    <input type="hidden" name="orderedIds" value={JSON.stringify(reordered(ids, i, -1))} />
                    <SubmitButton pendingLabel="…" className="rounded-lg border border-slate-700 px-2 py-1.5 text-xs font-bold text-slate-200 hover:border-slate-500">↑</SubmitButton>
                  </form>
                )}
                {i < modes.length - 1 && (
                  <form action={reorderAction}>
                    <input type="hidden" name="gameId" value={gameId} />
                    <input type="hidden" name="orderedIds" value={JSON.stringify(reordered(ids, i, 1))} />
                    <SubmitButton pendingLabel="…" className="rounded-lg border border-slate-700 px-2 py-1.5 text-xs font-bold text-slate-200 hover:border-slate-500">↓</SubmitButton>
                  </form>
                )}
                <button type="button" onClick={() => setEditingId(m.id)} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-200 hover:border-slate-500">Edit</button>
                <form action={deleteAction}>
                  <input type="hidden" name="gameId" value={gameId} />
                  <input type="hidden" name="id" value={m.id} />
                  <SubmitButton pendingLabel="Removing…" className="rounded-lg border border-red-900 px-3 py-1.5 text-xs font-bold text-red-400 hover:border-red-700">Remove</SubmitButton>
                </form>
              </div>
            </div>
            {expandedId === m.id && (
              <div className="mt-3 space-y-4 border-t border-slate-800 pt-3">
                <FormatsPanel gameId={gameId} modeId={m.id} formats={formats.filter((f) => f.modeId === m.id)} />
                <MapsPanel gameId={gameId} modeId={m.id} maps={maps.filter((mm) => mm.modeId === m.id)} />
                <MatchRulesPanel gameId={gameId} modeId={m.id} matchRules={matchRules.filter((r) => r.modeId === m.id)} />
              </div>
            )}
          </div>
        ),
      )}
      {deleteState?.error && <p className="text-xs text-red-400">{deleteState.error}</p>}
      {reorderState?.error && <p className="text-xs text-red-400">{reorderState.error}</p>}

      {adding ? (
        <ModeForm gameId={gameId} action={createMode} onDone={() => setAdding(false)} />
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-bold text-slate-200 hover:border-slate-500">+ Add a mode</button>
      )}
    </section>
  )
}
```

- [ ] **Step 3: Wire into `app/[locale]/admin/games/[id]/page.tsx`**

Replace the file's contents with:

```tsx
import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { RegistrationFieldsPanel } from '@/components/admin/RegistrationFieldsPanel'
import { ModesPanel } from '@/components/admin/ModesPanel'

export const metadata: Metadata = { title: 'Game Designer · Admin · SentinelX' }

export default async function GameDesignerPage({ params }: { params: { id: string } }) {
  await requireStaff()
  const supabase = createClient()
  const { data: game } = await supabase.from('games').select('id, name, category, active').eq('id', params.id).maybeSingle()
  if (!game) notFound()

  const { data: fieldRows } = await supabase
    .from('game_registration_fields')
    .select('id, field_key, label, placeholder, input_type, required, validation_pattern, validation_message, show_on_bracket, active')
    .eq('game_id', game.id)
    .eq('active', true)
    .order('seq')

  const fields = (fieldRows ?? []).map((f) => ({
    id: f.id,
    fieldKey: f.field_key,
    label: f.label,
    placeholder: f.placeholder,
    inputType: f.input_type as 'text' | 'number' | 'url',
    required: f.required,
    validationPattern: f.validation_pattern,
    validationMessage: f.validation_message,
    showOnBracket: f.show_on_bracket,
  }))

  const { data: modeRows } = await supabase
    .from('game_modes')
    .select('id, name, competition_format')
    .eq('game_id', game.id)
    .eq('active', true)
    .order('seq')
  const modes = (modeRows ?? []).map((m) => ({ id: m.id, name: m.name, competitionFormat: m.competition_format }))
  const modeIds = modes.map((m) => m.id)

  const [{ data: formatRows }, { data: mapRows }, { data: ruleRows }] = modeIds.length
    ? await Promise.all([
        supabase
          .from('game_mode_formats')
          .select('id, mode_id, name, entry_unit, team_size, available')
          .in('mode_id', modeIds)
          .eq('active', true)
          .order('seq'),
        supabase.from('game_mode_maps').select('id, mode_id, name').in('mode_id', modeIds).eq('active', true).order('seq'),
        supabase.from('game_mode_match_rules').select('id, mode_id, name').in('mode_id', modeIds).eq('active', true).order('seq'),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }]

  const formats = (formatRows ?? []).map((f) => ({
    id: f.id,
    modeId: f.mode_id,
    name: f.name,
    entryUnit: f.entry_unit,
    teamSize: f.team_size,
    available: f.available,
  }))
  const maps = (mapRows ?? []).map((m) => ({ id: m.id, modeId: m.mode_id, name: m.name }))
  const matchRules = (ruleRows ?? []).map((r) => ({ id: r.id, modeId: r.mode_id, name: r.name }))

  return (
    <section className="max-w-2xl space-y-8">
      <Link href="/admin/games" className="text-sm text-violet-400 hover:text-violet-300">
        ← Games
      </Link>
      <h2 className="text-base font-bold text-white">{game.name} <span className="font-normal text-slate-500">— {game.category} · {game.active ? 'Active' : 'Inactive'}</span></h2>

      <RegistrationFieldsPanel gameId={game.id} fields={fields} />
      <ModesPanel gameId={game.id} modes={modes} formats={formats} maps={maps} matchRules={matchRules} />
    </section>
  )
}
```

- [ ] **Step 4: Typecheck and lint**

Run: `npm run lint`
Expected: no new errors in the touched/created files.

- [ ] **Step 5: Commit**

```bash
git add components/admin/ModeForm.tsx components/admin/ModesPanel.tsx "app/[locale]/admin/games/[id]/page.tsx"
git commit -m "feat(admin): Modes panel composing Formats/Maps/Match Rules on the Game Designer page"
```

---

## Task 12: `MatchTypeForm`/`MatchTypesPanel` — global section on `/admin/games`

**Files:**
- Create: `components/admin/MatchTypeForm.tsx`
- Create: `components/admin/MatchTypesPanel.tsx`
- Modify: `app/[locale]/admin/games/page.tsx`

**Interfaces:**
- Consumes: `createMatchType`/`updateMatchType`/`deleteMatchType`/`reorderMatchTypes` (Task 8).
- Produces: `MatchTypeRow { id: string; name: string; available: boolean }`; `<MatchTypesPanel matchTypes />`.

- [ ] **Step 1: `components/admin/MatchTypeForm.tsx`**

```tsx
'use client'
import { useFormState } from 'react-dom'
import { SubmitButton } from '@/components/ui/submit-button'

export interface MatchTypeRow {
  id: string
  name: string
  available: boolean
}

type ActionState = { error?: string; success?: boolean } | undefined
type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>

export function MatchTypeForm({
  action,
  existing,
  onDone,
}: {
  action: Action
  existing?: MatchTypeRow
  onDone?: () => void
}) {
  const [state, formAction] = useFormState<ActionState, FormData>(action, undefined)
  if (state?.success) onDone?.()

  return (
    <form action={formAction} className="space-y-3 rounded-xl border border-slate-800 bg-slate-950 p-4">
      {existing && <input type="hidden" name="id" value={existing.id} />}
      <input
        name="name"
        placeholder="Name (e.g. Best of 7)"
        defaultValue={existing?.name}
        required
        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-600"
      />
      <label className="flex items-center gap-2 text-sm text-slate-300">
        <input type="checkbox" name="available" value="true" defaultChecked={existing?.available ?? false} />
        Available (uncheck to show as &quot;coming soon&quot;)
      </label>
      {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
      <SubmitButton pendingLabel="Saving…" className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-bold text-white hover:bg-violet-500">
        {existing ? 'Save match type' : 'Add match type'}
      </SubmitButton>
    </form>
  )
}
```

- [ ] **Step 2: `components/admin/MatchTypesPanel.tsx`**

```tsx
'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { MatchTypeForm, type MatchTypeRow } from './MatchTypeForm'
import { createMatchType, updateMatchType, deleteMatchType, reorderMatchTypes } from '@/lib/games/match-type-actions'
import type { MatchTypeActionState } from '@/lib/games/match-type-actions'
import { SubmitButton } from '@/components/ui/submit-button'

function reordered(ids: string[], index: number, direction: -1 | 1): string[] {
  const target = index + direction
  if (target < 0 || target >= ids.length) return ids
  const next = [...ids]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

export function MatchTypesPanel({ matchTypes }: { matchTypes: MatchTypeRow[] }) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [deleteState, deleteAction] = useFormState<MatchTypeActionState, FormData>(deleteMatchType, undefined)
  const [reorderState, reorderAction] = useFormState<MatchTypeActionState, FormData>(reorderMatchTypes, undefined)
  const ids = matchTypes.map((t) => t.id)

  return (
    <section className="mt-8 space-y-3">
      <h3 className="text-sm font-bold text-white">Match Types</h3>
      <p className="text-xs text-slate-500">Series length for head-to-head tournaments — global, not tied to any one game.</p>

      {matchTypes.map((t, i) =>
        editingId === t.id ? (
          <MatchTypeForm key={t.id} action={updateMatchType} existing={t} onDone={() => setEditingId(null)} />
        ) : (
          <div key={t.id} className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900 p-3">
            <div>
              <p className="text-sm font-semibold text-white">{t.name}</p>
              <p className="text-xs text-slate-500">{t.available ? 'Available' : 'Coming soon'}</p>
            </div>
            <div className="flex gap-2">
              {i > 0 && (
                <form action={reorderAction}>
                  <input type="hidden" name="orderedIds" value={JSON.stringify(reordered(ids, i, -1))} />
                  <SubmitButton pendingLabel="…" className="rounded-lg border border-slate-700 px-2 py-1.5 text-xs font-bold text-slate-200 hover:border-slate-500">↑</SubmitButton>
                </form>
              )}
              {i < matchTypes.length - 1 && (
                <form action={reorderAction}>
                  <input type="hidden" name="orderedIds" value={JSON.stringify(reordered(ids, i, 1))} />
                  <SubmitButton pendingLabel="…" className="rounded-lg border border-slate-700 px-2 py-1.5 text-xs font-bold text-slate-200 hover:border-slate-500">↓</SubmitButton>
                </form>
              )}
              <button type="button" onClick={() => setEditingId(t.id)} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-200 hover:border-slate-500">Edit</button>
              <form action={deleteAction}>
                <input type="hidden" name="id" value={t.id} />
                <SubmitButton pendingLabel="Removing…" className="rounded-lg border border-red-900 px-3 py-1.5 text-xs font-bold text-red-400 hover:border-red-700">Remove</SubmitButton>
              </form>
            </div>
          </div>
        ),
      )}
      {deleteState?.error && <p className="text-xs text-red-400">{deleteState.error}</p>}
      {reorderState?.error && <p className="text-xs text-red-400">{reorderState.error}</p>}

      {adding ? (
        <MatchTypeForm action={createMatchType} onDone={() => setAdding(false)} />
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-bold text-slate-200 hover:border-slate-500">+ Add a match type</button>
      )}
    </section>
  )
}
```

- [ ] **Step 3: Wire into `app/[locale]/admin/games/page.tsx`**

```tsx
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { GameForm } from '@/components/admin/GameForm'
import { GameRow } from '@/components/admin/GameRow'
import { MatchTypesPanel } from '@/components/admin/MatchTypesPanel'

export const metadata: Metadata = { title: 'Games · Admin · SentinelX' }

export default async function AdminGamesPage() {
  await requireStaff()
  const supabase = createClient()
  const { data: games } = await supabase.from('games').select('id, name, category, active').order('name')

  const rows = games ?? []
  const tournamentCounts = await Promise.all(
    rows.map(async (g) => {
      const { count } = await supabase
        .from('tournaments')
        .select('id', { count: 'exact', head: true })
        .eq('game_id', g.id)
        .not('status', 'in', '(completed,cancelled)')
      return count ?? 0
    }),
  )

  const { data: matchTypeRows } = await supabase.from('match_types').select('id, name, available').eq('active', true).order('seq')
  const matchTypes = (matchTypeRows ?? []).map((t) => ({ id: t.id, name: t.name, available: t.available }))

  return (
    <section>
      <h2 className="mb-4 text-base font-bold text-white">Games</h2>
      <div className="mb-6">
        <GameForm />
      </div>
      <div className="space-y-2">
        {rows.map((g, i) => (
          <GameRow key={g.id} game={g} activeTournamentCount={tournamentCounts[i]} />
        ))}
      </div>
      <MatchTypesPanel matchTypes={matchTypes} />
    </section>
  )
}
```

- [ ] **Step 4: Typecheck and lint**

Run: `npm run lint`
Expected: no new errors in the touched/created files.

- [ ] **Step 5: Run the full test suite**

Run: `npm run test`
Expected: PASS (every new test file from Tasks 3–8, plus `lib/tournaments/admin-form.test.ts` from Task 2, plus everything pre-existing). Check `git worktree list` first per `[[project_vitest_nested_worktree_double_count]]` if the count looks implausible.

- [ ] **Step 6: Commit**

```bash
git add components/admin/MatchTypeForm.tsx components/admin/MatchTypesPanel.tsx "app/[locale]/admin/games/page.tsx"
git commit -m "feat(admin): Match Types panel (global) on the games list page"
```

---
