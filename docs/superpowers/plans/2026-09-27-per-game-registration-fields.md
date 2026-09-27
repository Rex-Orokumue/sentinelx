# Per-Game Registration Fields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded `clubName`/`ignTag` registration fields (asked on every tournament for every game) with a per-game catalogue, so a Free Fire player is asked for their in-game UID instead of a club name, and a future game's identity fields are a data seed, not a code change.

**Architecture:** A new `game_registration_fields` catalogue table (public read, staff write — same shape as the existing `game_modes` catalogue) drives a shared zod-schema builder consumed by every registration/waitlist code path (web Server Actions, mobile API). Registration values move from two fixed columns to one `registration_details jsonb` column. An admin CRUD UI (the "Game Designer," `/admin/games/[id]`) lets staff manage a game's fields without touching code; a raw SQL migration remains an equally valid way to seed the same table.

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase (Postgres + RLS), zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-27-game-designer-registration-fields-design.md` (§4 and §5.1–5.2 only — the Mode/Format/Map/Match Rules half of the Game Designer, §5.1 sections 3–7, is a separate plan, `docs/superpowers/plans/2026-09-27-game-designer-mode-catalogue-ui.md`, since it's an independent subsystem that happens to share a page).

## Global Constraints

- No hardcoded `clubName`/`ignTag` may remain in application code after this plan — every reader/writer goes through the catalogue.
- `registration_details` is the only place registration identity values are stored; `reg_club_name`/`reg_ign_tag` are dropped in the same migration that adds it (backfilled first — no data loss).
- `game_registration_fields` RLS: public `SELECT`, `is_staff()`-gated `ALL` — actions use the regular session client (`createClient()`), never `createAdminClient()`, per CLAUDE.md rule 9 (this table isn't on the sensitive-tables list).
- `displayName` and `whatsapp` stay fixed, universal fields — never part of the per-game catalogue.
- The migration that drops the old columns must seed the three currently-active games' fields in the same file, so registration never renders zero fields in production.
- Mobile API changes follow `docs/superpowers/specs/2026-09-18-mobile-api-v1-conventions.md`: new/changed endpoints go through `defineEndpoint()`, and `npm run openapi` must be re-run and `openapi/mobile-v1.json` committed.

## Review Focus

- A game with an empty/unseeded field list must not crash the registration form or the server action — it should render zero optional fields, not throw when parsing a body with no dynamic keys.
- A `validation_pattern` that fails to compile as a regex (bad data entered via the admin UI) must not 500 the registration endpoint for every player of that game — reject at write-time (the admin action), not read-time.
- Deleting/deactivating a field that existing `registration_details` rows already used must not break rendering the admin registrations table or the bracket for past registrations — old keys just don't have a matching active field to label anymore.
- The waitlist path and the register path must both pick up a game's fields — it's easy to fix one call site and miss the other, since they're separate Server Actions and separate mobile endpoints.
- A tournament's game lookup must handle the tournament row not resolving (bad id) without throwing before the existing `tournament_not_found` handling runs.

---

## Task 1: Schema — `game_registration_fields` table + `registration_details` jsonb cutover

**Files:**
- Create: `supabase/migrations/20260927120000_game_registration_fields.sql`

**Interfaces:**
- Produces: table `public.game_registration_fields` (columns: `id, game_id, field_key, label, placeholder, input_type, required, validation_pattern, validation_message, show_on_bracket, seq, active, created_at`); `public.tournament_registrations.registration_details jsonb`; seed rows for `dls`, `ea-fc-mobile`, `free-fire`.

- [ ] **Step 1: Write the migration**

```sql
-- Per-game registration identity fields, replacing the hardcoded
-- clubName/ignTag every tournament asked regardless of game. Same shape as
-- game_modes: public read (the registration form needs it pre-login),
-- staff write via RLS (see 20260912090000_game_modes.sql for precedent).
CREATE TABLE public.game_registration_fields (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id             uuid NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  field_key           text NOT NULL,
  label               text NOT NULL,
  placeholder         text,
  input_type          text NOT NULL DEFAULT 'text',
  required            boolean NOT NULL DEFAULT true,
  validation_pattern  text,
  validation_message  text,
  -- Surfaced next to a player's name on the PUBLIC bracket (bracket-view.ts).
  -- Not every field belongs there — a numeric platform ID usually shouldn't.
  show_on_bracket     boolean NOT NULL DEFAULT false,
  seq                 int NOT NULL DEFAULT 1,
  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT grf_input_type_valid CHECK (input_type IN ('text', 'number', 'url')),
  CONSTRAINT grf_key_uniq UNIQUE (game_id, field_key)
);

CREATE INDEX game_registration_fields_game_idx ON public.game_registration_fields (game_id, seq);

ALTER TABLE public.game_registration_fields ENABLE ROW LEVEL SECURITY;
CREATE POLICY "grf_public_read"  ON public.game_registration_fields FOR SELECT USING (true);
CREATE POLICY "grf_staff_write" ON public.game_registration_fields FOR ALL USING (is_staff()) WITH CHECK (is_staff());

-- ── Storage cutover: reg_club_name/reg_ign_tag -> registration_details ─────
ALTER TABLE public.tournament_registrations ADD COLUMN registration_details jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.tournament_registrations SET registration_details =
  jsonb_strip_nulls(jsonb_build_object('club_name', reg_club_name, 'ign_tag', reg_ign_tag));

ALTER TABLE public.tournament_registrations DROP COLUMN reg_club_name;
ALTER TABLE public.tournament_registrations DROP COLUMN reg_ign_tag;

-- ── Seed: the three currently-active games ──────────────────────────────────
-- Seeded here, not left for someone to fill in via the admin UI later — a
-- game already live must not go through a window with zero registration
-- fields the moment this migration lands. This is also the reference example
-- for how the Game Designer UI seeds every game after these three.
INSERT INTO public.game_registration_fields (game_id, field_key, label, placeholder, required, show_on_bracket, seq)
SELECT g.id, v.field_key, v.label, v.placeholder, v.required, v.show_on_bracket, v.seq
  FROM public.games g
  JOIN (VALUES
    ('dls',          'club_name', 'Club name',                  'Your in-game club/team', true,  true,  1),
    ('dls',          'ign_tag',   'In-game player ID / tag',    'Your IGN or player tag', false, false, 2),
    ('ea-fc-mobile', 'club_name', 'Club name',                  'Your in-game club/team', true,  true,  1),
    ('ea-fc-mobile', 'ign_tag',   'In-game player ID / tag',    'Your IGN or player tag', false, false, 2)
  ) AS v(slug, field_key, label, placeholder, required, show_on_bracket, seq) ON v.slug = g.slug;

INSERT INTO public.game_registration_fields (game_id, field_key, label, placeholder, required, show_on_bracket, seq)
SELECT g.id, 'in_game_uid', 'In-game UID', 'Your Free Fire UID', true, true, 1
  FROM public.games g WHERE g.slug = 'free-fire';
```

- [ ] **Step 2: Apply and verify**

Run: `npx supabase db push` (or the project's existing migration-apply flow — see `[[project_supabase_connectivity_gotcha]]` if the CLI can't reach the remote; use the Supabase MCP `apply_migration` tool as the fallback).

Verify:
```sql
select g.slug, f.field_key, f.required, f.show_on_bracket from game_registration_fields f join games g on g.id = f.game_id order by g.slug, f.seq;
```
Expected: 5 rows — dls×2, ea-fc-mobile×2, free-fire×1 — and `select reg_club_name from tournament_registrations limit 1` now errors with "column does not exist."

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260927120000_game_registration_fields.sql
git commit -m "feat(db): add game_registration_fields catalogue, drop reg_club_name/reg_ign_tag"
```

---

## Task 2: `lib/tournaments/registration-fields.ts` — types, schema builder, fetch, display helper

**Files:**
- Create: `lib/tournaments/registration-fields.ts`
- Test: `lib/tournaments/registration-fields.test.ts`

**Interfaces:**
- Produces:
  - `interface RegistrationField { fieldKey: string; label: string; placeholder: string | null; inputType: 'text' | 'number' | 'url'; required: boolean; validationPattern: string | null; validationMessage: string | null; showOnBracket: boolean }`
  - `function buildRegistrationSchema(fields: RegistrationField[]): z.ZodObject<Record<string, z.ZodTypeAny>>`
  - `async function fetchRegistrationFields(supabase: SupabaseClient<Database>, gameId: string): Promise<RegistrationField[]>` (active only, ordered by `seq`)
  - `function pickDisplayValue(details: Record<string, unknown> | null, fields: RegistrationField[]): string | null` (first field, in `fields` order, with a non-empty string value in `details`)

- [ ] **Step 1: Write the failing tests**

```typescript
// lib/tournaments/registration-fields.test.ts
import { describe, it, expect } from 'vitest'
import { buildRegistrationSchema, pickDisplayValue, type RegistrationField } from './registration-fields'

const clubName: RegistrationField = {
  fieldKey: 'club_name', label: 'Club name', placeholder: null, inputType: 'text',
  required: true, validationPattern: null, validationMessage: null, showOnBracket: true,
}
const ignTag: RegistrationField = {
  fieldKey: 'ign_tag', label: 'IGN', placeholder: null, inputType: 'text',
  required: false, validationPattern: null, validationMessage: null, showOnBracket: false,
}
const uid: RegistrationField = {
  fieldKey: 'in_game_uid', label: 'In-game UID', placeholder: null, inputType: 'text',
  required: true, validationPattern: '^[0-9]+$', validationMessage: 'UID must be numeric', showOnBracket: true,
}

describe('buildRegistrationSchema', () => {
  it('requires a required field', () => {
    const schema = buildRegistrationSchema([clubName])
    expect(schema.safeParse({ club_name: '' }).success).toBe(false)
    expect(schema.safeParse({ club_name: 'Lagos Ronin' }).success).toBe(true)
  })

  it('allows an empty optional field', () => {
    const schema = buildRegistrationSchema([ignTag])
    expect(schema.safeParse({ ign_tag: '' }).success).toBe(true)
  })

  it('enforces a validation pattern with its message', () => {
    const schema = buildRegistrationSchema([uid])
    const bad = schema.safeParse({ in_game_uid: 'not-numeric' })
    expect(bad.success).toBe(false)
    if (!bad.success) expect(bad.error.issues[0].message).toBe('UID must be numeric')
    expect(schema.safeParse({ in_game_uid: '123456789' }).success).toBe(true)
  })

  it('produces an empty object schema for no fields', () => {
    const schema = buildRegistrationSchema([])
    expect(schema.safeParse({}).success).toBe(true)
  })
})

describe('pickDisplayValue', () => {
  it('returns the first field in order with a non-empty value', () => {
    expect(pickDisplayValue({ ign_tag: '', club_name: 'Lagos Ronin' }, [clubName, ignTag])).toBe('Lagos Ronin')
  })

  it('returns null when no field has a value', () => {
    expect(pickDisplayValue({}, [clubName])).toBeNull()
    expect(pickDisplayValue(null, [clubName])).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/tournaments/registration-fields.test.ts`
Expected: FAIL — `./registration-fields` doesn't exist yet.

- [ ] **Step 3: Implement**

```typescript
// lib/tournaments/registration-fields.ts
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'

export interface RegistrationField {
  fieldKey: string
  label: string
  placeholder: string | null
  inputType: 'text' | 'number' | 'url'
  required: boolean
  validationPattern: string | null
  validationMessage: string | null
  showOnBracket: boolean
}

// One dynamic zod object, built from whatever fields a game declares. Every
// registration/waitlist code path (web Server Actions, mobile endpoints)
// calls this instead of hand-writing clubName/ignTag.
export function buildRegistrationSchema(fields: RegistrationField[]) {
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const f of fields) {
    let str = z.string().trim().max(120, `${f.label} is too long`)
    if (f.validationPattern) {
      str = str.regex(new RegExp(f.validationPattern), f.validationMessage ?? `${f.label} is invalid`)
    }
    shape[f.fieldKey] = f.required
      ? str.min(1, `${f.label} is required`)
      : z.union([z.literal(''), str])
  }
  return z.object(shape)
}

export async function fetchRegistrationFields(
  supabase: SupabaseClient<Database>,
  gameId: string,
): Promise<RegistrationField[]> {
  const { data } = await supabase
    .from('game_registration_fields')
    .select('field_key, label, placeholder, input_type, required, validation_pattern, validation_message, show_on_bracket')
    .eq('game_id', gameId)
    .eq('active', true)
    .order('seq')
  return (data ?? []).map((f) => ({
    fieldKey: f.field_key,
    label: f.label,
    placeholder: f.placeholder,
    inputType: f.input_type as RegistrationField['inputType'],
    required: f.required,
    validationPattern: f.validation_pattern,
    validationMessage: f.validation_message,
    showOnBracket: f.show_on_bracket,
  }))
}

// First field (in the given order) whose value is present and non-empty —
// used wherever a single identifying value is shown next to a player's name
// (the public bracket, the admin results queue), not the full detail set.
export function pickDisplayValue(details: Record<string, unknown> | null, fields: RegistrationField[]): string | null {
  if (!details) return null
  for (const f of fields) {
    const v = details[f.fieldKey]
    if (typeof v === 'string' && v.trim() !== '') return v
  }
  return null
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/tournaments/registration-fields.test.ts`
Expected: PASS, all 6 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/tournaments/registration-fields.ts lib/tournaments/registration-fields.test.ts
git commit -m "feat(tournaments): registration-fields schema builder, fetch, and display helper"
```

---

## Task 3: `registration-schema.ts` — drop the hardcoded fields, keep only the universal ones

**Files:**
- Modify: `lib/tournaments/registration-schema.ts`
- Modify: `lib/tournaments/registration-schema.test.ts`

**Interfaces:**
- Consumes: nothing new (pure zod).
- Produces: `fixedRegistrationSchema` (renamed from `registrationDetailsSchema`, `displayName` + `whatsapp` only) — `coinsUsedSchema` unchanged.

- [ ] **Step 1: Update the test file first**

```typescript
// lib/tournaments/registration-schema.test.ts
import { describe, it, expect } from 'vitest'
import { fixedRegistrationSchema } from './registration-schema'

const valid = { displayName: 'Samuel O.', whatsapp: '+2348012345678' }

describe('fixedRegistrationSchema', () => {
  it('accepts valid input', () => {
    expect(fixedRegistrationSchema.safeParse(valid).success).toBe(true)
  })

  it('requires displayName', () => {
    expect(fixedRegistrationSchema.safeParse({ ...valid, displayName: '  ' }).success).toBe(false)
  })

  it('requires a plausible WhatsApp number', () => {
    expect(fixedRegistrationSchema.safeParse({ ...valid, whatsapp: 'not a number' }).success).toBe(false)
  })

  it('accepts a WhatsApp number without a leading +', () => {
    expect(fixedRegistrationSchema.safeParse({ ...valid, whatsapp: '08012345678' }).success).toBe(true)
  })

  it('trims surrounding whitespace', () => {
    const r = fixedRegistrationSchema.safeParse({ ...valid, displayName: '  Samuel O.  ' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.displayName).toBe('Samuel O.')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/tournaments/registration-schema.test.ts`
Expected: FAIL — `fixedRegistrationSchema` is not exported yet.

- [ ] **Step 3: Implement**

```typescript
// lib/tournaments/registration-schema.ts
import { z } from 'zod'
import { COINS_HALF_ENTRY, COINS_PER_ENTRY } from '@/lib/coins/value'

// displayName + whatsapp are the only fields every registration needs
// regardless of game — everything else comes from the per-game catalogue
// (see lib/tournaments/registration-fields.ts's buildRegistrationSchema).
export const fixedRegistrationSchema = z.object({
  displayName: z.string().trim().min(1, 'Display name is required').max(60, 'Display name is too long'),
  whatsapp: z
    .string()
    .trim()
    .min(1, 'WhatsApp number is required')
    .regex(/^\+?[0-9]{10,15}$/, 'Enter a valid WhatsApp number'),
})

export type FixedRegistrationInput = z.infer<typeof fixedRegistrationSchema>

// The three radio positions on the entry-fee discount widget (spec §4). '0'
// means no discount applied — the default, pre-existing behavior.
export const coinsUsedSchema = z
  .union([z.literal('0'), z.literal(String(COINS_HALF_ENTRY)), z.literal(String(COINS_PER_ENTRY))])
  .default('0')
  .transform(Number)
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/tournaments/registration-schema.test.ts`
Expected: PASS, all 5 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/tournaments/registration-schema.ts lib/tournaments/registration-schema.test.ts
git commit -m "refactor(tournaments): registration-schema keeps only the universal fields"
```

---

## Task 4: `register-service.ts` — `registrationDetails` replaces `clubName`/`ignTag`

**Files:**
- Modify: `lib/tournaments/register-service.ts`
- Modify: `lib/tournaments/register-service.test.ts`

**Interfaces:**
- Consumes: nothing new (writes whatever object it's given to the jsonb column).
- Produces: `RegisterInput` with `registrationDetails: Record<string, string>` replacing `clubName`/`ignTag`.

- [ ] **Step 1: Update the test fixture and one assertion**

In `lib/tournaments/register-service.test.ts`, replace:
```typescript
const baseInput = { displayName: 'Ada', whatsapp: '+2348012345678', clubName: 'FC Test', ignTag: null, agreedToRules: true, coinsUsed: 0, squadId: null }
```
with:
```typescript
const baseInput = { displayName: 'Ada', whatsapp: '+2348012345678', registrationDetails: { club_name: 'FC Test' }, agreedToRules: true, coinsUsed: 0, squadId: null }
```
No other test in this file asserts on `regFields`' shape directly (confirmed by reading the file), so no further test changes are needed here.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/tournaments/register-service.test.ts`
Expected: FAIL — TypeScript error, `RegisterInput` still requires `clubName`/`ignTag`.

- [ ] **Step 3: Implement**

In `lib/tournaments/register-service.ts`:

```typescript
export type RegisterInput = {
  displayName: string
  whatsapp: string
  registrationDetails: Record<string, string>
  agreedToRules: boolean
  coinsUsed: number
  squadId: string | null
}
```

Replace:
```typescript
  const regFields = {
    reg_display_name: input.displayName, reg_whatsapp: input.whatsapp,
    reg_club_name: input.clubName, reg_ign_tag: input.ignTag || null,
  }
```
with:
```typescript
  const regFields = {
    reg_display_name: input.displayName, reg_whatsapp: input.whatsapp,
    registration_details: input.registrationDetails,
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/tournaments/register-service.test.ts`
Expected: PASS, all existing tests unchanged in count.

- [ ] **Step 5: Commit**

```bash
git add lib/tournaments/register-service.ts lib/tournaments/register-service.test.ts
git commit -m "refactor(tournaments): register-service stores registrationDetails jsonb"
```

---

## Task 5: `waitlist-service.ts` — same swap

**Files:**
- Modify: `lib/tournaments/waitlist-service.ts`
- Modify: `lib/tournaments/waitlist-service.test.ts`

**Interfaces:**
- Produces: `WaitlistInput` with `registrationDetails: Record<string, string>` replacing `clubName`/`ignTag`.

- [ ] **Step 1: Update the test fixture**

Read `lib/tournaments/waitlist-service.test.ts` first (it wasn't fully read during planning — confirm its input fixture shape before editing) and replace any `clubName`/`ignTag` fixture fields with `registrationDetails: { club_name: '...' }`, matching Task 4's fixture-update pattern exactly.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/tournaments/waitlist-service.test.ts`
Expected: FAIL — type mismatch on `WaitlistInput`.

- [ ] **Step 3: Implement**

In `lib/tournaments/waitlist-service.ts`:

```typescript
export type WaitlistInput = { displayName: string; whatsapp: string; registrationDetails: Record<string, string>; agreedToRules: boolean }
```

Replace:
```typescript
  const { error: insErr } = await admin.from('tournament_registrations').insert({
    tournament_id: tournamentId, player_id: userId, payment_status: 'pending', status: 'waitlisted',
    reg_display_name: input.displayName, reg_whatsapp: input.whatsapp, reg_club_name: input.clubName, reg_ign_tag: input.ignTag || null,
  })
```
with:
```typescript
  const { error: insErr } = await admin.from('tournament_registrations').insert({
    tournament_id: tournamentId, player_id: userId, payment_status: 'pending', status: 'waitlisted',
    reg_display_name: input.displayName, reg_whatsapp: input.whatsapp, registration_details: input.registrationDetails,
  })
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/tournaments/waitlist-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/tournaments/waitlist-service.ts lib/tournaments/waitlist-service.test.ts
git commit -m "refactor(tournaments): waitlist-service stores registrationDetails jsonb"
```

---

## Task 6: Server Actions — dynamic parsing in `registerForTournament` and `joinWaitlist`

**Files:**
- Modify: `lib/tournaments/actions.ts`
- Modify: `lib/tournaments/waitlist-actions.ts`
- Test: `lib/tournaments/actions.test.ts` (create if it doesn't exist — check first)
- Test: `lib/tournaments/waitlist-actions.test.ts`

**Interfaces:**
- Consumes: `fetchRegistrationFields`, `buildRegistrationSchema` (Task 2), `fixedRegistrationSchema` (Task 3), `performRegisterForTournament`/`performJoinWaitlist` (Tasks 4/5).
- Produces: no exported signature change — `registerForTournament`/`joinWaitlist` keep their `(prev, formData) => Promise<State>` shape; only their internals change.

Both actions need the tournament's `game_id` before they can look up its fields — one extra lightweight query, placed before the existing tournament-dependent work.

Both `lib/tournaments/actions.test.ts` and `lib/tournaments/waitlist-actions.test.ts` already exist, each with one test whose inline `createClient` mock only handles the `profiles` table (and throws on anything else). The new action code queries `tournaments` (for `game_id`) and `game_registration_fields` *before* it ever reaches the `profiles` lookup inside `performRegisterForTournament`/`performJoinWaitlist` — both existing tests will throw `unexpected table tournaments` the moment Task 6 ships unless their mocks are extended in the same change.

- [ ] **Step 1: Update `lib/tournaments/waitlist-actions.test.ts`**

Replace the whole file:

```typescript
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

function fd(obj: Record<string, string>) {
  const f = new FormData()
  for (const [k, v] of Object.entries(obj)) f.set(k, v)
  return f
}

function mockClient(opts: { username?: string | null; tournamentExists?: boolean; fields?: { field_key: string; label: string; placeholder: string | null; input_type: string; required: boolean; validation_pattern: string | null; validation_message: string | null; show_on_bracket: boolean }[] } = {}) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => {
      if (table === 'tournaments') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.tournamentExists === false ? null : { game_id: 'g1' } }) }) }) }
      if (table === 'game_registration_fields') return { select: () => ({ eq: () => ({ eq: () => ({ order: async () => ({ data: opts.fields ?? [] }) }) }) }) }
      if (table === 'profiles') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { username: opts.username ?? null } }) }) }) }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

describe('joinWaitlist — username gate', () => {
  it('refuses and returns needsUsername when the caller has no claimed username', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue(mockClient({ username: null }) as never)
    const { createAdminClient } = await import('@/lib/supabase/admin')
    vi.mocked(createAdminClient).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { deletion_requested_at: null, deleted_at: null } }),
          }),
        }),
      }),
    } as never)
    const { joinWaitlist } = await import('./waitlist-actions')
    const r = await joinWaitlist(undefined, fd({ tournamentId: 't1', displayName: 'X', whatsapp: '+2340000000000' }))
    expect(r?.needsUsername).toBe(true)
  })
})

describe('joinWaitlist — dynamic fields', () => {
  it('parses the game\'s dynamic fields into registrationDetails, not clubName/ignTag', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue(mockClient({
      username: 'ada',
      fields: [{ field_key: 'in_game_uid', label: 'In-game UID', placeholder: null, input_type: 'text', required: true, validation_pattern: null, validation_message: null, show_on_bracket: true }],
    }) as never)
    const { createAdminClient } = await import('@/lib/supabase/admin')
    vi.mocked(createAdminClient).mockReturnValue({
      from: (table: string) => {
        if (table === 'profiles') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { deletion_requested_at: null, deleted_at: null } }) }) }) }
        throw new Error(`unexpected admin table ${table}`)
      },
    } as never)
    const { joinWaitlist } = await import('./waitlist-actions')
    const r = await joinWaitlist(undefined, fd({ tournamentId: 't1', displayName: 'X', whatsapp: '+2340000000000', in_game_uid: '' }))
    // Empty required field -> the dynamic schema rejects before performJoinWaitlist is ever reached.
    expect(r?.error).toBe('In-game UID is required')
  })

  it('returns "Tournament not found" when the game_id lookup finds nothing, without throwing', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue(mockClient({ tournamentExists: false }) as never)
    const { joinWaitlist } = await import('./waitlist-actions')
    const r = await joinWaitlist(undefined, fd({ tournamentId: 'missing', displayName: 'X', whatsapp: '+2340000000000' }))
    expect(r?.error).toBe('Tournament not found.')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/tournaments/waitlist-actions.test.ts`
Expected: FAIL — `joinWaitlist` doesn't query `tournaments`/`game_registration_fields` yet, so `mockClient`'s `profiles`-only real shape isn't exercised the new way (the first test still passes by coincidence today; the second fails because `registrationDetails`/dynamic parsing doesn't exist).

- [ ] **Step 3: Implement `joinWaitlist`**

```typescript
// lib/tournaments/waitlist-actions.ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fixedRegistrationSchema } from './registration-schema'
import { buildRegistrationSchema, fetchRegistrationFields } from './registration-fields'
import { performJoinWaitlist, type WaitlistErrorCode } from './waitlist-service'

export type JoinWaitlistState = { error?: string; success?: boolean; needsUsername?: boolean } | undefined

const ERROR_MESSAGES: Record<WaitlistErrorCode, string> = {
  needs_username: 'Claim a username before joining the waitlist.',
  tournament_not_found: 'Tournament not found.',
  waitlist_not_open: 'The waitlist is only open once registration has closed.',
  rules_agreement_required: 'Please confirm you have read and agree to the rules.',
  already_on_waitlist: "You're already on the waitlist.",
  already_registered: "You're already registered for this tournament.",
  waitlist_failed: 'Could not join the waitlist. Please try again.',
}

export async function joinWaitlist(_prev: JoinWaitlistState, formData: FormData): Promise<JoinWaitlistState> {
  const tournamentId = String(formData.get('tournamentId') ?? '')
  if (!tournamentId) return { error: 'Missing tournament.' }

  const supabase = createClient()

  const { data: tournament } = await supabase.from('tournaments').select('game_id').eq('id', tournamentId).maybeSingle()
  if (!tournament) return { error: 'Tournament not found.' }

  const fixedParsed = fixedRegistrationSchema.safeParse({
    displayName: formData.get('displayName') ?? '',
    whatsapp: formData.get('whatsapp') ?? '',
  })
  if (!fixedParsed.success) return { error: fixedParsed.error.issues[0].message }

  const fields = await fetchRegistrationFields(supabase, tournament.game_id)
  const dynamicParsed = buildRegistrationSchema(fields).safeParse(
    Object.fromEntries(fields.map((f) => [f.fieldKey, formData.get(f.fieldKey) ?? ''])),
  )
  if (!dynamicParsed.success) return { error: dynamicParsed.error.issues[0].message }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in to join the waitlist.' }

  const result = await performJoinWaitlist(supabase, createAdminClient(), user.id, tournamentId, {
    displayName: fixedParsed.data.displayName,
    whatsapp: fixedParsed.data.whatsapp,
    registrationDetails: dynamicParsed.data,
    agreedToRules: formData.get('agreedToRules') === 'true',
  })

  if (!result.ok) {
    return result.errorCode === 'needs_username'
      ? { error: ERROR_MESSAGES.needs_username, needsUsername: true }
      : { error: ERROR_MESSAGES[result.errorCode] }
  }

  revalidatePath(`/tournaments/${result.tournamentSlug}`)
  revalidatePath(`/admin/tournaments/${tournamentId}/registrations`)
  return { success: true }
}
```

- [ ] **Step 4: Implement `registerForTournament`** — same pattern in `lib/tournaments/actions.ts`:

```typescript
'use server'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fixedRegistrationSchema, coinsUsedSchema } from './registration-schema'
import { buildRegistrationSchema, fetchRegistrationFields } from './registration-fields'
import { performRegisterForTournament, type RegisterErrorCode } from './register-service'

export type RegisterState = { error?: string; needsUsername?: boolean } | undefined

const ERROR_MESSAGES: Record<RegisterErrorCode, string> = {
  needs_username: 'Claim a username before registering.',
  tournament_not_found: 'Tournament not found.',
  rules_agreement_required: 'Please confirm you have read and agree to the rules.',
  already_registered: "You're already registered for this tournament.",
  tournament_full: 'This tournament is full.',
  invitation_only: 'This tournament is invitation-only. Check your dashboard for an invite.',
  registration_closed: 'Registration is closed for this tournament.',
  squads_not_available: 'This tournament does not use squads.',
  squad_not_found: 'That squad no longer exists for this tournament.',
  squad_not_accepting_members: 'That squad is no longer accepting members.',
  squad_full: 'That squad is already full.',
  insufficient_coins: 'Not enough SX Coins for this discount.',
  registration_failed: 'Could not complete registration. Please try again.',
  payment_init_failed: 'Payment could not be started. Please try again.',
}

export async function registerForTournament(
  _prev: RegisterState,
  formData: FormData,
): Promise<RegisterState> {
  const tournamentId = String(formData.get('tournamentId') ?? '')
  if (!tournamentId) return { error: 'Missing tournament.' }

  const supabase = createClient()

  const { data: tournament } = await supabase.from('tournaments').select('game_id').eq('id', tournamentId).maybeSingle()
  if (!tournament) return { error: 'Tournament not found.' }

  const fixedParsed = fixedRegistrationSchema.safeParse({
    displayName: formData.get('displayName') ?? '',
    whatsapp: formData.get('whatsapp') ?? '',
  })
  if (!fixedParsed.success) return { error: fixedParsed.error.issues[0].message }

  const fields = await fetchRegistrationFields(supabase, tournament.game_id)
  const dynamicParsed = buildRegistrationSchema(fields).safeParse(
    Object.fromEntries(fields.map((f) => [f.fieldKey, formData.get(f.fieldKey) ?? ''])),
  )
  if (!dynamicParsed.success) return { error: dynamicParsed.error.issues[0].message }

  const coinsUsedParsed = coinsUsedSchema.safeParse(formData.get('coinsUsed') ?? '0')
  const coinsUsed = coinsUsedParsed.success ? coinsUsedParsed.data : 0

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in to register.' }

  const squadIdRaw = String(formData.get('squadId') ?? '')

  const result = await performRegisterForTournament(supabase, createAdminClient(), user.id, tournamentId, {
    displayName: fixedParsed.data.displayName,
    whatsapp: fixedParsed.data.whatsapp,
    registrationDetails: dynamicParsed.data,
    agreedToRules: formData.get('agreedToRules') === 'true',
    coinsUsed,
    squadId: squadIdRaw || null,
  })

  if (!result.ok) {
    return result.errorCode === 'needs_username'
      ? { error: ERROR_MESSAGES.needs_username, needsUsername: true }
      : { error: ERROR_MESSAGES[result.errorCode] }
  }

  if (result.status === 'confirmed') redirect(`/tournaments/${result.tournamentSlug}?paid=1`)
  redirect(result.authorizationUrl)
}
```

- [ ] **Step 5: Update `lib/tournaments/actions.test.ts`** — same pattern as Step 1's `waitlist-actions.test.ts` update:

```typescript
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

function mockClient(opts: { username?: string | null; tournamentExists?: boolean; fields?: { field_key: string; label: string; placeholder: string | null; input_type: string; required: boolean; validation_pattern: string | null; validation_message: string | null; show_on_bracket: boolean }[] } = {}) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => {
      if (table === 'tournaments') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.tournamentExists === false ? null : { game_id: 'g1' } }) }) }) }
      if (table === 'game_registration_fields') return { select: () => ({ eq: () => ({ eq: () => ({ order: async () => ({ data: opts.fields ?? [] }) }) }) }) }
      if (table === 'profiles') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { username: opts.username ?? null } }) }) }) }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

describe('registerForTournament — username gate', () => {
  it('refuses and returns needsUsername when the caller has no claimed username', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue(mockClient({ username: null }) as never)
    const { createAdminClient } = await import('@/lib/supabase/admin')
    vi.mocked(createAdminClient).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { deletion_requested_at: null, deleted_at: null } }),
          }),
        }),
      }),
    } as never)
    const { registerForTournament } = await import('./actions')
    const r = await registerForTournament(undefined, fd({ tournamentId: 't1', displayName: 'X', whatsapp: '+2340000000000' }))
    expect(r?.needsUsername).toBe(true)
  })
})

describe('registerForTournament — dynamic fields', () => {
  it('rejects when a required dynamic field is missing, before ever calling performRegisterForTournament', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue(mockClient({
      username: 'ada',
      fields: [{ field_key: 'in_game_uid', label: 'In-game UID', placeholder: null, input_type: 'text', required: true, validation_pattern: null, validation_message: null, show_on_bracket: true }],
    }) as never)
    const { registerForTournament } = await import('./actions')
    const r = await registerForTournament(undefined, fd({ tournamentId: 't1', displayName: 'X', whatsapp: '+2340000000000', in_game_uid: '' }))
    expect(r?.error).toBe('In-game UID is required')
  })

  it('returns "Tournament not found" when the game_id lookup finds nothing, without throwing', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue(mockClient({ tournamentExists: false }) as never)
    const { registerForTournament } = await import('./actions')
    const r = await registerForTournament(undefined, fd({ tournamentId: 'missing', displayName: 'X', whatsapp: '+2340000000000' }))
    expect(r?.error).toBe('Tournament not found.')
  })
})
```

- [ ] **Step 6: Run to verify pass**

Run: `npx vitest run lib/tournaments/actions.test.ts lib/tournaments/waitlist-actions.test.ts`
Expected: PASS, all tests in both files.

- [ ] **Step 7: Commit**

```bash
git add lib/tournaments/actions.ts lib/tournaments/waitlist-actions.ts lib/tournaments/actions.test.ts lib/tournaments/waitlist-actions.test.ts
git commit -m "feat(tournaments): register/waitlist actions parse per-game dynamic fields"
```

---

## Task 7: Web form — `RegistrationPanel.tsx` renders whatever fields the game declares

**Files:**
- Modify: `components/tournament/RegistrationPanel.tsx`
- Modify: `app/[locale]/(public)/tournaments/[slug]/page.tsx`

**Interfaces:**
- Consumes: `fetchRegistrationFields`, `RegistrationField` (Task 2).
- Produces: `RegistrationPanel` takes a new prop `registrationFields: RegistrationField[]`.

- [ ] **Step 1: Fetch and thread the fields in the tournament page**

In `app/[locale]/(public)/tournaments/[slug]/page.tsx`, add `game_id` to `getTournament`'s select list:

```typescript
    .select(
      'id, title, slug, description, banner_url, card_image_url, prize_pool, registration_fee, status, format, max_players, registration_end, tournament_start, tournament_end, rules, invitation_only, entry_unit, squad_size, game_id, games(name, icon_url, slug, category), game_modes(name), game_mode_formats(name), game_mode_maps(name), game_mode_match_rules(name)',
    )
```

Import `fetchRegistrationFields` from `@/lib/tournaments/registration-fields`, and where the page currently builds its other data (near where `supabase`/`t` are already in scope, before the `<RegistrationPanel>` JSX), add:

```typescript
  const registrationFields = await fetchRegistrationFields(supabase, t.game_id)
```

Pass it through:

```tsx
        <RegistrationPanel
          view={view}
          tournamentId={t.id}
          slug={t.slug}
          fee={t.registration_fee}
          entryUnit={t.entry_unit as 'solo' | 'squad'}
          squadSize={t.squad_size}
          mySquad={mySquad}
          loginHref={`/login?next=/tournaments/${t.slug}`}
          prefill={prefill}
          rules={splitRules(t.rules)}
          gameName={game?.name ?? 'Mobile Esports'}
          tournamentTitle={t.title}
          loggedIn={!!user}
          coinBalance={coinBalance}
          hasUsername={hasUsername}
          registrationFields={registrationFields}
        />
```

- [ ] **Step 2: Thread the prop through `RegistrationPanel` and render dynamically**

In `components/tournament/RegistrationPanel.tsx`, add the import and prop:

```typescript
import type { RegistrationField } from '@/lib/tournaments/registration-fields'
```

Add `registrationFields: RegistrationField[]` to `RegistrationPanel`'s props type and destructure it, then thread it into both branches that render `RegisterForm`/`WaitlistForm`/`SquadPickerThenRegister` (three call sites: the squad branch, the direct `RegisterForm` branch, and the `WaitlistForm` branch — add `registrationFields={registrationFields}` to each).

In `SquadPickerThenRegister`'s props type, add `registrationFields: RegistrationField[]` and forward it to both its `RegisterForm` calls.

In `WaitlistForm`, replace:
```tsx
      <Field name="clubName" label="Club name" placeholder="Your in-game club/team" />
      <Field
        name="ignTag"
        label="In-game player ID / tag (optional)"
        placeholder="Your IGN or player tag"
        required={false}
      />
```
with:
```tsx
      {registrationFields.map((f) => (
        <Field
          key={f.fieldKey}
          name={f.fieldKey}
          label={f.required ? f.label : `${f.label} (optional)`}
          placeholder={f.placeholder ?? undefined}
          required={f.required}
        />
      ))}
```
and add `registrationFields: RegistrationField[]` to `WaitlistForm`'s props type + destructuring.

In `RegisterForm`, make the identical replacement (same two hardcoded `<Field>`s exist there too) and add `registrationFields: RegistrationField[]` to its props type + destructuring.

- [ ] **Step 3: Manual verification (no automated test for JSX wiring in this codebase's existing pattern — confirmed by the absence of a `RegistrationPanel.test.tsx`)**

Run: `npx tsc --noEmit -p .` — confirms every prop is threaded with matching types across all three components.
Then: start the dev server (`npm run dev`), open a Free Fire tournament's registration form, and confirm it shows "In-game UID" instead of "Club name" / "In-game player ID / tag".

- [ ] **Step 4: Commit**

```bash
git add components/tournament/RegistrationPanel.tsx "app/[locale]/(public)/tournaments/[slug]/page.tsx"
git commit -m "feat(tournament): registration form renders per-game dynamic fields"
```

---

## Task 8: `lib/admin/search.ts` — generalize the club-name search field

**Files:**
- Modify: `lib/admin/search.ts`
- Modify: `lib/admin/search.test.ts`

**Interfaces:**
- Produces: `SearchablePlayer` gains `registrationDetails?: Record<string, string> | null` replacing `clubName?: string | null`; `matchesPlayerQuery` matches against all its values.

- [ ] **Step 1: Replace every `clubName` fixture with `registrationDetails`**

`lib/admin/search.test.ts` currently passes `clubName: string | null` directly on six existing cases — since `SearchablePlayer` drops that field, every one needs updating in this same step, not just the new case. Replace the whole file:

```typescript
import { describe, it, expect } from 'vitest'
import { matchesPlayerQuery } from './search'

describe('matchesPlayerQuery', () => {
  it('matches a blank query against anything', () => {
    expect(matchesPlayerQuery({ username: 'zee', displayName: null, registrationDetails: null }, '')).toBe(true)
    expect(matchesPlayerQuery({ username: null, displayName: null, registrationDetails: null }, '')).toBe(true)
  })

  it('matches a case-insensitive username substring', () => {
    expect(matchesPlayerQuery({ username: 'DarkStrikerNG', displayName: null, registrationDetails: null }, 'strike')).toBe(true)
  })

  it('matches a case-insensitive display name substring', () => {
    expect(matchesPlayerQuery({ username: null, displayName: 'Samuel Okoro', registrationDetails: null }, 'okoro')).toBe(true)
  })

  it('matches a case-insensitive value inside registrationDetails', () => {
    expect(
      matchesPlayerQuery({ username: 'x', displayName: null, registrationDetails: { club_name: 'Lagos Ronin' } }, 'ronin'),
    ).toBe(true)
  })

  it('matches any value inside registrationDetails, not just a fixed clubName field', () => {
    expect(
      matchesPlayerQuery({ username: 'ada', displayName: null, registrationDetails: { in_game_uid: '778899' } }, '7788'),
    ).toBe(true)
  })

  it('returns false when nothing matches', () => {
    expect(
      matchesPlayerQuery({ username: 'zee', displayName: 'Zee Player', registrationDetails: { club_name: 'Ronin' } }, 'nomatch'),
    ).toBe(false)
  })

  it('does not crash when all fields are null and query is non-empty', () => {
    expect(matchesPlayerQuery({ username: null, displayName: null, registrationDetails: null }, 'x')).toBe(false)
  })

  it('trims and ignores leading/trailing whitespace in the query', () => {
    expect(matchesPlayerQuery({ username: 'zee', displayName: null, registrationDetails: null }, '  zee  ')).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/admin/search.test.ts`
Expected: FAIL — `registrationDetails` isn't a recognized field yet (or passes vacuously if the old `clubName` test still exists unmodified; update/remove that old test's `clubName` usage in this same step so the suite reflects the new shape).

- [ ] **Step 3: Implement**

```typescript
// lib/admin/search.ts
export interface SearchablePlayer {
  username: string | null
  displayName: string | null
  registrationDetails?: Record<string, string> | null
}

// Case-insensitive substring match against username, display name, and every
// value in registrationDetails (club name, in-game UID, whatever the
// player's game asks for). A blank/whitespace-only query matches everything.
export function matchesPlayerQuery(item: SearchablePlayer, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const values = [item.username, item.displayName, ...Object.values(item.registrationDetails ?? {})]
  return values.some((field) => field != null && field.toLowerCase().includes(q))
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/admin/search.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/admin/search.ts lib/admin/search.test.ts
git commit -m "refactor(admin): player search matches any registration-detail value"
```

---

## Task 9: Admin registrations table — dynamic columns

**Files:**
- Modify: `app/[locale]/admin/tournaments/[id]/registrations/page.tsx`
- Modify: `components/admin/RegistrationsTable.tsx`

**Interfaces:**
- Consumes: `fetchRegistrationFields`, `RegistrationField`, `pickDisplayValue` (Task 2 — `pickDisplayValue` not needed here since the table shows every field, not just one).
- Produces: `AdminRegistrationRow.registrationDetails: Record<string, string>` replaces `regClubName`/`regIgnTag`; `RegistrationsTable` takes a new `fields: RegistrationField[]` prop and renders one column per field.

- [ ] **Step 1: Update the page loader**

In `app/[locale]/admin/tournaments/[id]/registrations/page.tsx`, add `game_id` to the tournament select:

```typescript
  const { data: t } = await supabase
    .from('tournaments')
    .select('id, title, status, registration_fee, max_players, game_id')
    .eq('id', params.id)
    .maybeSingle()
  if (!t) notFound()

  const registrationFields = await fetchRegistrationFields(supabase, t.game_id)
```
(add the import `import { fetchRegistrationFields } from '@/lib/tournaments/registration-fields'`)

Replace the registrations select and mapping:
```typescript
    supabase
      .from('tournament_registrations')
      .select(
        'id, player_id, payment_status, registered_at, reg_display_name, reg_whatsapp, registration_details, status, replaces_registration_id, profiles(username)',
      )
      .eq('tournament_id', t.id)
      .order('registered_at', { ascending: false }),
```
```typescript
  const rows: AdminRegistrationRow[] = ((data as unknown[] | null) ?? []).map((raw) => {
    const r = raw as {
      id: string
      player_id: string
      payment_status: string
      registered_at: string
      reg_display_name: string | null
      reg_whatsapp: string | null
      registration_details: Record<string, string> | null
      status: string
      replaces_registration_id: string | null
      profiles: ProfileRef
    }
    return {
      id: r.id,
      playerId: r.player_id,
      username: firstUsername(r.profiles),
      regDisplayName: r.reg_display_name,
      regWhatsapp: r.reg_whatsapp,
      registrationDetails: r.registration_details ?? {},
      paymentStatus: r.payment_status,
      registeredAt: r.registered_at,
      status: r.status,
      replacesRegistrationId: r.replaces_registration_id,
    }
  })
```

Pass `fields={registrationFields}` to `<RegistrationsTable>`.

- [ ] **Step 2: Update `RegistrationsTable`**

```typescript
export interface AdminRegistrationRow {
  id: string
  playerId: string
  username: string | null
  regDisplayName: string | null
  regWhatsapp: string | null
  registrationDetails: Record<string, string>
  paymentStatus: string
  registeredAt: string
  status: string
  replacesRegistrationId: string | null
}
```

Add `fields: RegistrationField[]` to the component's props (import `RegistrationField` from `@/lib/tournaments/registration-fields`), update the search call:
```typescript
  const filtered = rows.filter((r) =>
    matchesPlayerQuery(
      { username: r.username, displayName: r.regDisplayName, registrationDetails: r.registrationDetails },
      query,
    ),
  )
```

Replace the two fixed header cells:
```tsx
                <th className="px-2 py-2.5 text-left">Club</th>
                <th className="px-2 py-2.5 text-left">IGN / Tag</th>
```
with:
```tsx
                {fields.map((f) => (
                  <th key={f.fieldKey} className="px-2 py-2.5 text-left">{f.label}</th>
                ))}
```

Replace the two fixed body cells:
```tsx
                  <td className="px-2 py-2.5 text-slate-300">{r.regClubName ?? '—'}</td>
                  <td className="px-2 py-2.5 text-slate-300">{r.regIgnTag ?? '—'}</td>
```
with:
```tsx
                  {fields.map((f) => (
                    <td key={f.fieldKey} className="px-2 py-2.5 text-slate-300">{r.registrationDetails[f.fieldKey] ?? '—'}</td>
                  ))}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit -p .`
Expected: clean — confirms `AdminRegistrationRow`'s new shape matches everywhere it's constructed/consumed.

- [ ] **Step 4: Commit**

```bash
git add "app/[locale]/admin/tournaments/[id]/registrations/page.tsx" components/admin/RegistrationsTable.tsx
git commit -m "feat(admin): registrations table renders one column per game field"
```

---

## Task 10: Admin results queue — generalize the club-name lookup

**Files:**
- Modify: `app/[locale]/admin/results/page.tsx`
- Modify: `lib/matches/review-queue.ts`

**Interfaces:**
- Consumes: `fetchRegistrationFields`, `pickDisplayValue` (Task 2).
- Produces: `ReviewMatchInput.playerAClubName`/`playerBClubName` keep their existing names (avoids touching `AdminResultsQueue` and `bucketReviewQueue`'s consumers) but are now sourced from `registration_details` via `pickDisplayValue`, generic to whichever fields the match's tournament's game declares.

- [ ] **Step 1: Update the page**

Replace the registrations lookup in `app/[locale]/admin/results/page.tsx`:
```typescript
  const { data: regs } =
    tournamentIds.length > 0
      ? await supabase
          .from('tournament_registrations')
          .select('tournament_id, player_id, reg_club_name')
          .in('tournament_id', tournamentIds)
      : { data: [] as { tournament_id: string; player_id: string; reg_club_name: string | null }[] }
  const clubByKey = new Map((regs ?? []).map((r) => [`${r.tournament_id}:${r.player_id}`, r.reg_club_name]))
```
with:
```typescript
  const { data: tournamentGames } =
    tournamentIds.length > 0
      ? await supabase.from('tournaments').select('id, game_id').in('id', tournamentIds)
      : { data: [] as { id: string; game_id: string }[] }
  const gameIdByTournament = new Map((tournamentGames ?? []).map((t) => [t.id, t.game_id]))
  const fieldsByGame = new Map(
    await Promise.all(
      Array.from(new Set((tournamentGames ?? []).map((t) => t.game_id))).map(
        async (gameId) => [gameId, await fetchRegistrationFields(supabase, gameId)] as const,
      ),
    ),
  )

  const { data: regs } =
    tournamentIds.length > 0
      ? await supabase
          .from('tournament_registrations')
          .select('tournament_id, player_id, registration_details')
          .in('tournament_id', tournamentIds)
      : { data: [] as { tournament_id: string; player_id: string; registration_details: Record<string, string> | null }[] }
  const clubByKey = new Map(
    (regs ?? []).map((r) => [
      `${r.tournament_id}:${r.player_id}`,
      pickDisplayValue(r.registration_details, fieldsByGame.get(gameIdByTournament.get(r.tournament_id) ?? '') ?? []),
    ]),
  )
```
(add the import `import { fetchRegistrationFields, pickDisplayValue } from '@/lib/tournaments/registration-fields'`)

The rest of the file (`playerAClubName`/`playerBClubName` assignment, `ReviewMatchInput` shape) is unchanged — `clubByKey` still maps `"tournamentId:playerId" -> string | null`.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit -p .`
Expected: clean.

Run: `npx vitest run lib/matches/review-queue.test.ts` (if it exists — `bucketReviewQueue` itself takes no per-game input, so this task shouldn't need changes there; confirm by reading the test file first).

- [ ] **Step 3: Commit**

```bash
git add "app/[locale]/admin/results/page.tsx"
git commit -m "refactor(admin): results queue sources player identity from registration_details"
```

---

## Task 11: `bracket-view.ts` — public bracket shows whichever field is flagged `show_on_bracket`

**Files:**
- Modify: `lib/tournaments/bracket-view.ts`
- Modify: `lib/tournaments/bracket-view.test.ts`

**Interfaces:**
- Consumes: `fetchRegistrationFields`, `pickDisplayValue` (Task 2).
- Produces: no signature change to `loadBracketView(supabase, tournamentId, format)` or `BracketView` — `MembershipInput.clubName` keeps its name and type (`string | null`), only its source changes.

- [ ] **Step 1: Add `tournaments` and `game_registration_fields` branches to every mock in the file**

`lib/tournaments/bracket-view.test.ts` has a shared `fakeSupabase()` helper (used by the first two tests) and one inline `client` object (used by the third, squad-standings test). `loadBracketView` will unconditionally query `tournaments` (for `game_id`) before its existing `Promise.all`, and — when that resolves — `game_registration_fields` inside `fetchRegistrationFields`. Both need a branch in every mock in this file or the existing tests throw `unexpected table tournaments`. Replace the whole file:

```typescript
import { describe, it, expect } from 'vitest'
import { loadBracketView } from './bracket-view'

// Minimal Supabase-shaped mock covering exactly the five table queries
// loadBracketView makes — one group, zero knockout matches, mirroring what
// a round-robin tournament's data actually looks like. No registration
// fields configured by default, so clubNameByPlayer resolves to null for
// everyone unless a test overrides `fields`.
function fakeSupabase(opts: { fields?: { field_key: string; label: string; placeholder: string | null; input_type: string; required: boolean; validation_pattern: string | null; validation_message: string | null; show_on_bracket: boolean }[] } = {}) {
  return {
    from(table: string) {
      if (table === 'groups') {
        return {
          select: () => ({
            eq: () => ({
              order: async () => ({ data: [{ id: 'g1', name: 'League Table' }] }),
            }),
          }),
        }
      }
      if (table === 'group_memberships') {
        return { select: () => ({ in: async () => ({ data: [] }) }) }
      }
      if (table === 'matches') {
        return { select: () => ({ eq: async () => ({ data: [] }) }) }
      }
      if (table === 'tournament_registrations') {
        return { select: () => ({ eq: async () => ({ data: [] }) }) }
      }
      if (table === 'tournaments') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { game_id: 'g1' } }) }) }) }
      }
      if (table === 'game_registration_fields') {
        return { select: () => ({ eq: () => ({ eq: () => ({ order: async () => ({ data: opts.fields ?? [] }) }) }) }) }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

describe('loadBracketView', () => {
  it('never projects knockout rounds for a round_robin tournament', async () => {
    const view = await loadBracketView(fakeSupabase() as never, 'tournament-id', 'round_robin')
    expect(view.projected).toEqual([])
    expect(view.hasKnockout).toBe(false)
    expect(view.hasGroups).toBe(true)
  })

  it('still projects knockout rounds for a group_knockout tournament with groups', async () => {
    const view = await loadBracketView(fakeSupabase() as never, 'tournament-id', 'group_knockout')
    expect(view.projected.length).toBeGreaterThan(0)
  })

  it('resolves a squad name for a team match and a team group standing', async () => {
    const client = {
      from(table: string) {
        if (table === 'groups') {
          return { select: () => ({ eq: () => ({ order: async () => ({ data: [{ id: 'g1', name: 'Group A' }] }) }) }) }
        }
        if (table === 'group_memberships') {
          return {
            select: () => ({
              in: async () => ({
                data: [
                  {
                    group_id: 'g1', player_id: null, team_id: 'sq1',
                    wins: 2, draws: 0, losses: 0, goals_for: 6, goals_against: 1, points: 6,
                    profiles: null, squads: { name: 'Lagos Vipers' },
                  },
                ],
              }),
            }),
          }
        }
        if (table === 'matches') {
          return {
            select: () => ({
              eq: async () => ({
                data: [
                  {
                    id: 'm1', round: 'group', group_id: 'g1', status: 'completed', score_a: 2, score_b: 1,
                    scheduled_at: null, is_full_day: false,
                    player_a: null, player_b: null,
                    team_a: { id: 'sq1', name: 'Lagos Vipers' },
                    team_b: { id: 'sq2', name: 'Thunder Squad' },
                  },
                ],
              }),
            }),
          }
        }
        if (table === 'tournament_registrations') {
          return { select: () => ({ eq: async () => ({ data: [] }) }) }
        }
        if (table === 'tournaments') {
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { game_id: 'g1' } }) }) }) }
        }
        if (table === 'game_registration_fields') {
          return { select: () => ({ eq: () => ({ eq: () => ({ order: async () => ({ data: [] }) }) }) }) }
        }
        throw new Error(`unexpected table ${table}`)
      },
    }
    const view = await loadBracketView(client as never, 'tournament-id', 'round_robin')
    expect(view.fixtures.completed[0].playerA).toEqual({ id: 'sq1', name: 'Lagos Vipers' })
    expect(view.fixtures.completed[0].playerB).toEqual({ id: 'sq2', name: 'Thunder Squad' })
    expect(view.standings[0].rows[0].name).toBe('Lagos Vipers')
    expect(view.standings[0].rows[0].playerId).toBe('sq1')
  })

  it('shows the value of whichever field is flagged show_on_bracket, and null when none is', async () => {
    const withField = {
      ...fakeSupabase({ fields: [{ field_key: 'in_game_uid', label: 'In-game UID', placeholder: null, input_type: 'text', required: true, validation_pattern: null, validation_message: null, show_on_bracket: true }] }),
      from(table: string) {
        if (table === 'group_memberships') {
          return {
            select: () => ({
              in: async () => ({
                data: [{ group_id: 'g1', player_id: 'p1', team_id: null, wins: 1, draws: 0, losses: 0, goals_for: 3, goals_against: 1, points: 3, profiles: { username: 'ada', display_name: null }, squads: null }],
              }),
            }),
          }
        }
        if (table === 'tournament_registrations') {
          return { select: () => ({ eq: async () => ({ data: [{ player_id: 'p1', registration_details: { in_game_uid: '778899' } }] }) }) }
        }
        return fakeSupabase({ fields: [{ field_key: 'in_game_uid', label: 'In-game UID', placeholder: null, input_type: 'text', required: true, validation_pattern: null, validation_message: null, show_on_bracket: true }] }).from(table)
      },
    }
    const view = await loadBracketView(withField as never, 'tournament-id', 'round_robin')
    expect(view.standings[0].rows[0].clubName).toBe('778899')

    const withoutField = {
      ...fakeSupabase(),
      from(table: string) {
        if (table === 'group_memberships') {
          return {
            select: () => ({
              in: async () => ({
                data: [{ group_id: 'g1', player_id: 'p1', team_id: null, wins: 1, draws: 0, losses: 0, goals_for: 3, goals_against: 1, points: 3, profiles: { username: 'ada', display_name: null }, squads: null }],
              }),
            }),
          }
        }
        if (table === 'tournament_registrations') {
          return { select: () => ({ eq: async () => ({ data: [{ player_id: 'p1', registration_details: { in_game_uid: '778899' } }] }) }) }
        }
        return fakeSupabase().from(table)
      },
    }
    const view2 = await loadBracketView(withoutField as never, 'tournament-id', 'round_robin')
    expect(view2.standings[0].rows[0].clubName).toBeNull()
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run lib/tournaments/bracket-view.test.ts`
Expected: FAIL — still reading `reg_club_name`, which no longer exists.

- [ ] **Step 4: Implement**

Add the import: `import { fetchRegistrationFields, pickDisplayValue } from './registration-fields'`

Before the existing `Promise.all` that fetches memberships/matches/regs, add a sequential lookup (it needs the game id before it can fetch fields, so it can't join the same `Promise.all`):

```typescript
  const { data: tournamentRow } = await supabase.from('tournaments').select('game_id').eq('id', tournamentId).maybeSingle()
  const bracketFields = tournamentRow
    ? (await fetchRegistrationFields(supabase, tournamentRow.game_id)).filter((f) => f.showOnBracket)
    : []
```

Replace the `tournament_registrations` query in the existing `Promise.all` — change:
```typescript
    supabase.from('tournament_registrations').select('player_id, reg_club_name').eq('tournament_id', tournamentId),
```
to:
```typescript
    supabase.from('tournament_registrations').select('player_id, registration_details').eq('tournament_id', tournamentId),
```

Replace:
```typescript
  const clubNameByPlayer = new Map(
    ((regsRes.data as { player_id: string; reg_club_name: string | null }[] | null) ?? []).map((r) => [
      r.player_id,
      r.reg_club_name,
    ]),
  )
```
with:
```typescript
  const clubNameByPlayer = new Map(
    ((regsRes.data as { player_id: string; registration_details: Record<string, string> | null }[] | null) ?? []).map((r) => [
      r.player_id,
      pickDisplayValue(r.registration_details, bracketFields),
    ]),
  )
```

Line 146's consumer (`clubName: gm.team_id ? null : clubNameByPlayer.get(gm.player_id ?? '') ?? null`) needs no change — it already reads from this same map by the same key.

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run lib/tournaments/bracket-view.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/tournaments/bracket-view.ts lib/tournaments/bracket-view.test.ts
git commit -m "refactor(tournaments): public bracket shows whichever field is flagged show_on_bracket"
```

---

## Task 12: `lib/games/registration-fields-actions.ts` — admin CRUD

**Files:**
- Create: `lib/games/registration-fields-actions.ts`
- Create: `lib/games/registration-fields-actions.test.ts`
- Create: `lib/games/registration-fields-schema.ts` (validation for the admin form, separate from the runtime `buildRegistrationSchema` in Task 2 — this one validates the *definition*, not a submitted registration)

**Interfaces:**
- Consumes: `requireStaff` (`@/lib/admin/auth`), `createClient` (`@/lib/supabase/server`) — same pattern as `lib/games/admin-actions.ts`.
- Produces:
  - `createRegistrationField(prev, formData): Promise<RegistrationFieldActionState>`
  - `updateRegistrationField(prev, formData): Promise<RegistrationFieldActionState>`
  - `deleteRegistrationField(prev, formData): Promise<RegistrationFieldActionState>` (deactivates if any `tournament_registrations.registration_details` row already uses the key for that game, hard-deletes otherwise)
  - `reorderRegistrationFields(prev, formData): Promise<RegistrationFieldActionState>` (formData carries `gameId` + a JSON-encoded ordered array of field ids)

- [ ] **Step 1: Write the schema**

```typescript
// lib/games/registration-fields-schema.ts
import { z } from 'zod'

export const registrationFieldSchema = z.object({
  label: z.string().trim().min(1, 'Label is required').max(60, 'Label is too long'),
  placeholder: z.union([z.literal(''), z.string().trim().max(80, 'Placeholder is too long')]),
  inputType: z.enum(['text', 'number', 'url']),
  required: z.boolean(),
  validationPattern: z.union([z.literal(''), z.string().trim().max(200)]).refine(
    (v) => {
      if (!v) return true
      try {
        new RegExp(v)
        return true
      } catch {
        return false
      }
    },
    { message: 'Validation pattern must be a valid regular expression' },
  ),
  validationMessage: z.union([z.literal(''), z.string().trim().max(120)]),
  showOnBracket: z.boolean(),
})

export type RegistrationFieldInput = z.infer<typeof registrationFieldSchema>
```

- [ ] **Step 2: Write the failing tests**

```typescript
// lib/games/registration-fields-actions.test.ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/admin/auth', () => ({ requireStaff: vi.fn().mockResolvedValue({ isAdmin: true }) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createRegistrationField, deleteRegistrationField } from './registration-fields-actions'

function formDataFrom(obj: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(obj)) fd.set(k, v)
  return fd
}

describe('createRegistrationField', () => {
  it('rejects an invalid validation pattern before touching the database', async () => {
    const result = await createRegistrationField(undefined, formDataFrom({
      gameId: 'g1', fieldKey: 'uid', label: 'UID', placeholder: '', inputType: 'text',
      required: 'true', validationPattern: '(unclosed', validationMessage: '', showOnBracket: 'false',
    }))
    expect(result?.error).toMatch(/valid regular expression/)
  })
})

describe('deleteRegistrationField', () => {
  it('requires an id', async () => {
    const result = await deleteRegistrationField(undefined, formDataFrom({ gameId: 'g1' }))
    expect(result?.error).toBeTruthy()
  })

  it('hard-deletes when no registration has used this field', async () => {
    const deleteFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const updateFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({
      from: (table: string) => {
        if (table === 'game_registration_fields') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { field_key: 'in_game_uid' } }) }) }), delete: deleteFn, update: updateFn }
        if (table === 'tournament_registrations') return { select: () => ({ eq: () => ({ limit: async () => ({ data: [] }) }) }) }
        throw new Error(`unexpected table ${table}`)
      },
    } as never)
    const result = await deleteRegistrationField(undefined, formDataFrom({ id: 'f1', gameId: 'g1' }))
    expect(result?.success).toBe(true)
    expect(deleteFn).toHaveBeenCalled()
    expect(updateFn).not.toHaveBeenCalled()
  })

  it('deactivates instead of deleting when a past registration used this field', async () => {
    const deleteFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const updateFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({
      from: (table: string) => {
        if (table === 'game_registration_fields') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { field_key: 'in_game_uid' } }) }) }), delete: deleteFn, update: updateFn }
        if (table === 'tournament_registrations') return { select: () => ({ eq: () => ({ limit: async () => ({ data: [{ registration_details: { in_game_uid: '778899' } }] }) }) }) }
        throw new Error(`unexpected table ${table}`)
      },
    } as never)
    const result = await deleteRegistrationField(undefined, formDataFrom({ id: 'f1', gameId: 'g1' }))
    expect(result?.success).toBe(true)
    expect(updateFn).toHaveBeenCalled()
    expect(deleteFn).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run lib/games/registration-fields-actions.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 4: Implement**

```typescript
// lib/games/registration-fields-actions.ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { registrationFieldSchema } from './registration-fields-schema'
import { slugify } from '@/lib/tournaments/slug'

export type RegistrationFieldActionState = { error?: string; success?: boolean } | undefined

function parseForm(formData: FormData) {
  return registrationFieldSchema.safeParse({
    label: formData.get('label') ?? '',
    placeholder: formData.get('placeholder') ?? '',
    inputType: formData.get('inputType') ?? 'text',
    required: formData.get('required') === 'true',
    validationPattern: formData.get('validationPattern') ?? '',
    validationMessage: formData.get('validationMessage') ?? '',
    showOnBracket: formData.get('showOnBracket') === 'true',
  })
}

export async function createRegistrationField(
  _prev: RegistrationFieldActionState,
  formData: FormData,
): Promise<RegistrationFieldActionState> {
  await requireStaff()
  const gameId = String(formData.get('gameId') ?? '')
  if (!gameId) return { error: 'Missing game.' }

  const parsed = parseForm(formData)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const fieldKey = slugify(parsed.data.label).replace(/-/g, '_')
  if (!fieldKey) return { error: 'Enter a label that produces a valid key.' }

  const supabase = createClient()
  const { count } = await supabase.from('game_registration_fields').select('*', { count: 'exact', head: true }).eq('game_id', gameId)
  const { error } = await supabase.from('game_registration_fields').insert({
    game_id: gameId,
    field_key: fieldKey,
    label: parsed.data.label,
    placeholder: parsed.data.placeholder || null,
    input_type: parsed.data.inputType,
    required: parsed.data.required,
    validation_pattern: parsed.data.validationPattern || null,
    validation_message: parsed.data.validationMessage || null,
    show_on_bracket: parsed.data.showOnBracket,
    seq: (count ?? 0) + 1,
  })
  if (error) return { error: error.code === '23505' ? 'A field with this key already exists for this game.' : 'Could not create the field.' }

  revalidatePath(`/admin/games/${gameId}`)
  return { success: true }
}

export async function updateRegistrationField(
  _prev: RegistrationFieldActionState,
  formData: FormData,
): Promise<RegistrationFieldActionState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  const gameId = String(formData.get('gameId') ?? '')
  if (!id || !gameId) return { error: 'Missing field.' }

  const parsed = parseForm(formData)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = createClient()
  const { error } = await supabase
    .from('game_registration_fields')
    .update({
      label: parsed.data.label,
      placeholder: parsed.data.placeholder || null,
      input_type: parsed.data.inputType,
      required: parsed.data.required,
      validation_pattern: parsed.data.validationPattern || null,
      validation_message: parsed.data.validationMessage || null,
      show_on_bracket: parsed.data.showOnBracket,
    })
    .eq('id', id)
  if (error) return { error: 'Could not update the field.' }

  revalidatePath(`/admin/games/${gameId}`)
  return { success: true }
}

// Hard-deletes only if nothing has used this field yet; otherwise deactivates
// so past registrations that carry this key in their registration_details
// jsonb still resolve to a label everywhere it's displayed.
export async function deleteRegistrationField(
  _prev: RegistrationFieldActionState,
  formData: FormData,
): Promise<RegistrationFieldActionState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  const gameId = String(formData.get('gameId') ?? '')
  if (!id || !gameId) return { error: 'Missing field.' }

  const supabase = createClient()
  const { data: field } = await supabase.from('game_registration_fields').select('field_key').eq('id', id).maybeSingle()
  if (!field) return { error: 'Field not found.' }

  // Postgrest's jsonb-contains filter needs a full value to match against, not
  // a bare key check, so this reads a page of the game's registration_details
  // and checks for the key in application code instead — simpler and correct
  // at this table's scale.
  const { data: regs } = await supabase
    .from('tournament_registrations')
    .select('registration_details, tournaments!inner(game_id)')
    .eq('tournaments.game_id', gameId)
    .limit(1000)
  const hasHistory = (regs ?? []).some((r) => field.field_key in ((r.registration_details as Record<string, unknown>) ?? {}))

  const { error } = hasHistory
    ? await supabase.from('game_registration_fields').update({ active: false }).eq('id', id)
    : await supabase.from('game_registration_fields').delete().eq('id', id)
  if (error) return { error: 'Could not remove the field.' }

  revalidatePath(`/admin/games/${gameId}`)
  return { success: true }
}

export async function reorderRegistrationFields(
  _prev: RegistrationFieldActionState,
  formData: FormData,
): Promise<RegistrationFieldActionState> {
  await requireStaff()
  const gameId = String(formData.get('gameId') ?? '')
  const orderedIds = JSON.parse(String(formData.get('orderedIds') ?? '[]')) as string[]
  if (!gameId || orderedIds.length === 0) return { error: 'Nothing to reorder.' }

  const supabase = createClient()
  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase.from('game_registration_fields').update({ seq: i + 1 }).eq('id', orderedIds[i])
    if (error) return { error: 'Could not save the new order.' }
  }

  revalidatePath(`/admin/games/${gameId}`)
  return { success: true }
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run lib/games/registration-fields-actions.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/games/registration-fields-schema.ts lib/games/registration-fields-actions.ts lib/games/registration-fields-actions.test.ts
git commit -m "feat(games): admin CRUD actions for the registration-fields catalogue"
```

---

## Task 13: Admin UI — Game Designer page (Basics + Registration Fields)

**Files:**
- Create: `app/[locale]/admin/games/[id]/page.tsx`
- Create: `components/admin/RegistrationFieldsPanel.tsx`
- Create: `components/admin/RegistrationFieldForm.tsx`
- Modify: `components/admin/GameForm.tsx` (redirect to the new page after create)
- Modify: `components/admin/GameRow.tsx` (link to the new page)
- Modify: `app/[locale]/admin/games/page.tsx` (link each row to `/admin/games/[id]`)

**Interfaces:**
- Consumes: `fetchRegistrationFields`, `RegistrationField` (Task 2); `createRegistrationField`/`updateRegistrationField`/`deleteRegistrationField`/`reorderRegistrationFields` (Task 12).

- [ ] **Step 1: Link into the Designer from the games list**

In `components/admin/GameRow.tsx`, wrap the game name in a link:
```tsx
          <Link href={`/admin/games/${game.id}`} className="font-bold text-white hover:text-violet-300">
            {game.name}
          </Link>
```
(add `import Link from 'next/link'`)

In `components/admin/GameForm.tsx`, since `createGame` is a Server Action returning state (not a redirect), change its success branch:
```tsx
  if (state?.success) return <p className="text-sm text-emerald-400">Game added. Find it in the list below to configure its fields.</p>
```
(Kept as a state message, not a `redirect()`, since `createGame` doesn't currently return the new game's id — that's an acceptable, smaller change than threading an id back through the action's state type for this plan's scope.)

- [ ] **Step 2: Build the Registration Fields panel**

```tsx
// components/admin/RegistrationFieldForm.tsx
'use client'
import { useFormState } from 'react-dom'
import { SubmitButton } from '@/components/ui/submit-button'
import type { RegistrationFieldActionState } from '@/lib/games/registration-fields-actions'
import type { RegistrationField } from '@/lib/tournaments/registration-fields'

type Action = (prev: RegistrationFieldActionState, fd: FormData) => Promise<RegistrationFieldActionState>

export function RegistrationFieldForm({
  gameId,
  action,
  existing,
  onDone,
}: {
  gameId: string
  action: Action
  existing?: RegistrationField & { id: string }
  onDone?: () => void
}) {
  const [state, formAction] = useFormState<RegistrationFieldActionState, FormData>(action, undefined)
  if (state?.success) onDone?.()

  return (
    <form action={formAction} className="space-y-3 rounded-xl border border-slate-800 bg-slate-950 p-4">
      <input type="hidden" name="gameId" value={gameId} />
      {existing && <input type="hidden" name="id" value={existing.id} />}
      <input
        name="label"
        placeholder="Label (e.g. Roblox Username)"
        defaultValue={existing?.label}
        required
        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-600"
      />
      <input
        name="placeholder"
        placeholder="Placeholder (optional)"
        defaultValue={existing?.placeholder ?? ''}
        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-600"
      />
      <select name="inputType" defaultValue={existing?.inputType ?? 'text'} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white">
        <option value="text">Text</option>
        <option value="number">Number</option>
        <option value="url">URL</option>
      </select>
      <label className="flex items-center gap-2 text-sm text-slate-300">
        <input type="checkbox" name="required" value="true" defaultChecked={existing?.required ?? true} />
        Required
      </label>
      <label className="flex items-center gap-2 text-sm text-slate-300">
        <input type="checkbox" name="showOnBracket" value="true" defaultChecked={existing?.showOnBracket ?? false} />
        Show on the public bracket
      </label>
      <details className="text-sm text-slate-400">
        <summary className="cursor-pointer">Advanced: format validation</summary>
        <div className="mt-2 space-y-2">
          <input
            name="validationPattern"
            placeholder="Regex pattern (optional)"
            defaultValue={existing?.validationPattern ?? ''}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-600"
          />
          <input
            name="validationMessage"
            placeholder="Message shown when the pattern fails"
            defaultValue={existing?.validationMessage ?? ''}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-600"
          />
        </div>
      </details>
      {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
      <SubmitButton pendingLabel="Saving…" className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-bold text-white hover:bg-violet-500">
        {existing ? 'Save field' : 'Add field'}
      </SubmitButton>
    </form>
  )
}
```

```tsx
// components/admin/RegistrationFieldsPanel.tsx
'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { RegistrationFieldForm } from './RegistrationFieldForm'
import { createRegistrationField, updateRegistrationField, deleteRegistrationField } from '@/lib/games/registration-fields-actions'
import type { RegistrationFieldActionState } from '@/lib/games/registration-fields-actions'
import type { RegistrationField } from '@/lib/tournaments/registration-fields'
import { SubmitButton } from '@/components/ui/submit-button'

type FieldRow = RegistrationField & { id: string }

export function RegistrationFieldsPanel({ gameId, fields }: { gameId: string; fields: FieldRow[] }) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [deleteState, deleteAction] = useFormState<RegistrationFieldActionState, FormData>(deleteRegistrationField, undefined)

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-bold text-white">Registration Fields</h3>
      <p className="text-xs text-slate-500">
        What the registration form asks a player for. Preview: {fields.length === 0 ? 'displayName and WhatsApp only.' : fields.map((f) => f.label).join(', ')}.
      </p>

      {fields.map((f) =>
        editingId === f.id ? (
          <RegistrationFieldForm key={f.id} gameId={gameId} action={updateRegistrationField} existing={f} onDone={() => setEditingId(null)} />
        ) : (
          <div key={f.id} className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900 p-3">
            <div>
              <p className="text-sm font-semibold text-white">{f.label} <span className="text-slate-500">({f.fieldKey})</span></p>
              <p className="text-xs text-slate-500">{f.required ? 'Required' : 'Optional'}{f.showOnBracket ? ' · shown on bracket' : ''}</p>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setEditingId(f.id)} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-200 hover:border-slate-500">
                Edit
              </button>
              <form action={deleteAction}>
                <input type="hidden" name="gameId" value={gameId} />
                <input type="hidden" name="id" value={f.id} />
                <SubmitButton pendingLabel="Removing…" className="rounded-lg border border-red-900 px-3 py-1.5 text-xs font-bold text-red-400 hover:border-red-700">
                  Remove
                </SubmitButton>
              </form>
            </div>
          </div>
        ),
      )}
      {deleteState?.error && <p className="text-xs text-red-400">{deleteState.error}</p>}

      {adding ? (
        <RegistrationFieldForm gameId={gameId} action={createRegistrationField} onDone={() => setAdding(false)} />
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-bold text-slate-200 hover:border-slate-500">
          + Add a field
        </button>
      )}
    </section>
  )
}
```

- [ ] **Step 2: Build the Designer page**

```tsx
// app/[locale]/admin/games/[id]/page.tsx
import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { fetchRegistrationFields } from '@/lib/tournaments/registration-fields'
import { RegistrationFieldsPanel } from '@/components/admin/RegistrationFieldsPanel'

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

  return (
    <section className="max-w-2xl space-y-8">
      <Link href="/admin/games" className="text-sm text-violet-400 hover:text-violet-300">
        ← Games
      </Link>
      <h2 className="text-base font-bold text-white">{game.name} <span className="font-normal text-slate-500">— {game.category} · {game.active ? 'Active' : 'Inactive'}</span></h2>

      <RegistrationFieldsPanel gameId={game.id} fields={fields} />
    </section>
  )
}
```

(The `fetchRegistrationFields` import is unused in this version of the page since the page queries directly for the `id` field the UI needs to edit/delete — `fetchRegistrationFields` doesn't select `id`. Remove that import; it stays reserved for the read-only consumers in Tasks 7/9/10/11, which never need to mutate a specific row.)

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit -p .`
Expected: clean.

Then manually: visit `/admin/games`, click into Free Fire, add a field, confirm it appears in the list, edit its label, confirm the update sticks, remove it, confirm it disappears (or deactivates without disappearing from history if a registration already used it — that branch needs a real registration row to observe, otherwise trust Task 12's unit test).

- [ ] **Step 4: Commit**

```bash
git add "app/[locale]/admin/games/[id]/page.tsx" components/admin/RegistrationFieldsPanel.tsx components/admin/RegistrationFieldForm.tsx components/admin/GameForm.tsx components/admin/GameRow.tsx
git commit -m "feat(admin): Game Designer page with a Registration Fields section"
```

---

## Task 14: Mobile API — dynamic fields endpoint + `registrationDetails` body

**Files:**
- Create: `lib/mobile-api/endpoints/registration-fields.ts`
- Modify: `lib/mobile-api/endpoints/tournaments.ts`
- Modify: `lib/mobile-api/endpoints/index.ts`
- Modify: `lib/mobile-api/endpoints/tournaments.test.ts`
- Create: `lib/mobile-api/endpoints/registration-fields.test.ts`

**Interfaces:**
- Consumes: `fetchRegistrationFields`, `buildRegistrationSchema` (Task 2); `performRegisterForTournament`/`performJoinWaitlist` (Tasks 4/5); `defineEndpoint`, `createAnonClient`, `Errors` (existing mobile-api primitives).
- Produces: `GET /tournaments/{id}/registration-fields` (new); `registerEndpoint`/`waitlistEndpoint` bodies change from `clubName`/`ignTag` to `registrationDetails: Record<string, string>`.

- [ ] **Step 1: Write the failing test for the new endpoint**

```typescript
// lib/mobile-api/endpoints/registration-fields.test.ts
import { describe, it, expect, vi } from 'vitest'
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('../anon-client', () => ({ createAnonClient: vi.fn() }))
import { registrationFieldsEndpoint } from './registration-fields'

describe('registrationFieldsEndpoint', () => {
  it('404s when the tournament does not exist', async () => {
    const { createAnonClient } = await import('../anon-client')
    vi.mocked(createAnonClient).mockReturnValue({
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
    } as never)
    await expect(
      registrationFieldsEndpoint.handler({ ctx: null, body: undefined, req: new Request('http://x'), params: { id: 't1' } }),
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/mobile-api/endpoints/registration-fields.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the endpoint**

```typescript
// lib/mobile-api/endpoints/registration-fields.ts
import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import { Errors } from '../errors'
import { createAnonClient } from '../anon-client'
import { fetchRegistrationFields } from '@/lib/tournaments/registration-fields'

const fieldSchema = z.object({
  fieldKey: z.string(),
  label: z.string(),
  placeholder: z.string().nullable(),
  inputType: z.enum(['text', 'number', 'url']),
  required: z.boolean(),
  validationPattern: z.string().nullable(),
  validationMessage: z.string().nullable(),
})
const response = z.object({ fields: z.array(fieldSchema) })

export const registrationFieldsEndpoint = defineEndpoint({
  operationId: 'getTournamentRegistrationFields',
  method: 'GET',
  path: '/tournaments/{id}/registration-fields',
  summary: "The tournament's game-specific registration identity fields, for rendering a dynamic form.",
  auth: 'public',
  response,
  handler: async ({ ctx, params }) => {
    const supabase = ctx?.userClient ?? createAnonClient()
    const { data: tournament } = await supabase.from('tournaments').select('game_id').eq('id', params.id).maybeSingle()
    if (!tournament) throw Errors.notFound()
    const fields = await fetchRegistrationFields(supabase, tournament.game_id)
    return { fields: fields.map(({ showOnBracket: _showOnBracket, ...f }) => f) }
  },
})
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/mobile-api/endpoints/registration-fields.test.ts`
Expected: PASS.

- [ ] **Step 5: Update `registerEndpoint`/`waitlistEndpoint` bodies**

In `lib/mobile-api/endpoints/tournaments.ts`, add the import:
```typescript
import { buildRegistrationSchema, fetchRegistrationFields } from '@/lib/tournaments/registration-fields'
```

Replace `registerBody`:
```typescript
const registerBody = z.object({
  displayName: z.string().trim().min(1).max(60),
  whatsapp: z.string().trim().regex(/^\+?[0-9]{10,15}$/),
  registrationDetails: z.record(z.string()).default({}),
  agreedToRules: z.boolean(),
  coinsUsed: z.number().int().nonnegative().default(0),
  squadId: z.string().optional(),
})
```

Replace the handler body:
```typescript
  handler: async ({ ctx, body, params }) => {
    if (body.squadId) throw new ApiError(400, 'squads_not_available', REGISTER_ERROR_MESSAGE.squads_not_available)
    const { data: tournament } = await ctx.userClient.from('tournaments').select('game_id').eq('id', params.id).maybeSingle()
    if (!tournament) throw Errors.notFound()
    const fields = await fetchRegistrationFields(ctx.userClient, tournament.game_id)
    const parsedDetails = buildRegistrationSchema(fields).safeParse(body.registrationDetails)
    if (!parsedDetails.success) throw new ApiError(400, 'validation_failed', parsedDetails.error.issues[0].message)
    const result = await performRegisterForTournament(ctx.userClient, ctx.admin, ctx.userId, params.id, {
      displayName: body.displayName, whatsapp: body.whatsapp, registrationDetails: parsedDetails.data,
      agreedToRules: body.agreedToRules, coinsUsed: body.coinsUsed, squadId: null,
    })
    if (!result.ok) throw new ApiError(REGISTER_ERROR_STATUS[result.errorCode], result.errorCode, REGISTER_ERROR_MESSAGE[result.errorCode])
    if (result.status === 'confirmed') return { status: 'confirmed' as const }
    return { status: 'pending' as const, authorizationUrl: result.authorizationUrl, reference: result.reference }
  },
```
`tournaments.ts` already imports `{ ApiError, Errors }` from `'../errors'` — no new import needed there.

Make the identical two changes (`waitlistBody`, handler) to `waitlistEndpoint`, using `performJoinWaitlist` and its own error tables.

- [ ] **Step 6: Update `tournaments.test.ts`**

`registerEndpoint`'s existing test passes `authenticate.mockResolvedValue({ userId: 'u1', admin: {}, userClient: {} })` — an empty object for `userClient`. The new handler calls `ctx.userClient.from('tournaments')...` before it ever reaches `performRegisterForTournament`, so `userClient: {}` now throws `TypeError: ctx.userClient.from is not a function`. Same problem for `waitlistEndpoint`'s test. Replace the whole file:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { authenticate, optionalAuth } = vi.hoisted(() => ({ authenticate: vi.fn(), optionalAuth: vi.fn() }))
vi.mock('../auth', () => ({ authenticate, optionalAuth }))
const { buildRegistrationState } = vi.hoisted(() => ({ buildRegistrationState: vi.fn() }))
vi.mock('@/lib/tournaments/registration-state-service', () => ({ buildRegistrationState }))
const { performRegisterForTournament } = vi.hoisted(() => ({ performRegisterForTournament: vi.fn() }))
vi.mock('@/lib/tournaments/register-service', () => ({ performRegisterForTournament }))
const { runIdempotent } = vi.hoisted(() => ({ runIdempotent: vi.fn() }))
vi.mock('../idempotency', () => ({ runIdempotent }))
const { performJoinWaitlist } = vi.hoisted(() => ({ performJoinWaitlist: vi.fn() }))
vi.mock('@/lib/tournaments/waitlist-service', () => ({ performJoinWaitlist }))

import { registrationStateEndpoint, registerEndpoint, waitlistEndpoint } from './tournaments'

function fakeUserClient(fields: { field_key: string; label: string; placeholder: string | null; input_type: string; required: boolean; validation_pattern: string | null; validation_message: string | null; show_on_bracket: boolean }[] = []) {
  return {
    from: (table: string) => {
      if (table === 'tournaments') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { game_id: 'g1' } }) }) }) }
      if (table === 'game_registration_fields') return { select: () => ({ eq: () => ({ eq: () => ({ order: async () => ({ data: fields }) }) }) }) }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

describe('registrationStateEndpoint', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.test.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key-stub')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key-stub')
  })

  it('returns the built state for a known tournament', async () => {
    optionalAuth.mockResolvedValue(null)
    buildRegistrationState.mockResolvedValue({ view: 'guest', feeNaira: 500, hasWaiver: false, coinDiscountEligible: false, agreementRequired: true })
    const res = await registrationStateEndpoint.handler(
      new Request('https://x.test/api/mobile/v1/tournaments/t1/registration-state'),
      { params: { id: 't1' } },
    )
    expect(res.status).toBe(200)
    expect((await res.json()).data.view).toBe('guest')
  })

  it('returns 404 when buildRegistrationState reports no tournament', async () => {
    optionalAuth.mockResolvedValue(null)
    buildRegistrationState.mockResolvedValue(null)
    const res = await registrationStateEndpoint.handler(
      new Request('https://x.test/api/mobile/v1/tournaments/missing/registration-state'),
      { params: { id: 'missing' } },
    )
    expect(res.status).toBe(404)
  })
})

describe('registerEndpoint', () => {
  it('rejects a non-null squadId at the route level before calling the service', async () => {
    authenticate.mockResolvedValue({ userId: 'u1', admin: {}, userClient: fakeUserClient() })
    runIdempotent.mockImplementation(async (_admin, _args, run) => run())
    const req = new Request('https://x.test/api/mobile/v1/tournaments/t1/register', {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'k1' },
      body: JSON.stringify({ displayName: 'Ada', whatsapp: '+2348012345678', registrationDetails: { club_name: 'FC' }, agreedToRules: true, coinsUsed: 0, squadId: 'sq1' }),
    })
    const res = await registerEndpoint.handler(req, { params: { id: 't1' } })
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('squads_not_available')
    expect(performRegisterForTournament).not.toHaveBeenCalled()
  })

  it('rejects a missing required dynamic field before calling the service', async () => {
    authenticate.mockResolvedValue({
      userId: 'u1', admin: {}, userClient: fakeUserClient([
        { field_key: 'in_game_uid', label: 'In-game UID', placeholder: null, input_type: 'text', required: true, validation_pattern: null, validation_message: null, show_on_bracket: true },
      ]),
    })
    runIdempotent.mockImplementation(async (_admin, _args, run) => run())
    const req = new Request('https://x.test/api/mobile/v1/tournaments/t1/register', {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'k1' },
      body: JSON.stringify({ displayName: 'Ada', whatsapp: '+2348012345678', registrationDetails: {}, agreedToRules: true, coinsUsed: 0 }),
    })
    const res = await registerEndpoint.handler(req, { params: { id: 't1' } })
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('validation_failed')
    expect(performRegisterForTournament).not.toHaveBeenCalled()
  })
})

describe('waitlistEndpoint', () => {
  it('maps waitlist_not_open to 409', async () => {
    authenticate.mockResolvedValue({ userId: 'u1', admin: {}, userClient: fakeUserClient() })
    performJoinWaitlist.mockResolvedValue({ ok: false, errorCode: 'waitlist_not_open' })
    const req = new Request('https://x.test/api/mobile/v1/tournaments/t1/waitlist', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'Ada', whatsapp: '+2348012345678', registrationDetails: { club_name: 'FC' }, agreedToRules: true }),
    })
    const res = await waitlistEndpoint.handler(req, { params: { id: 't1' } })
    expect(res.status).toBe(409)
  })
})
```

- [ ] **Step 7: Register the new endpoint**

In `lib/mobile-api/endpoints/index.ts`:
```typescript
import { registrationFieldsEndpoint } from './registration-fields'
```
and add `registrationFieldsEndpoint,` to `ALL_ENDPOINTS` (next to `registrationStateEndpoint`).

- [ ] **Step 8: Run the full mobile-api suite**

Run: `npx vitest run lib/mobile-api/`
Expected: PASS.

- [ ] **Step 9: Regenerate OpenAPI**

Run: `npm run openapi`
Verify: `git diff openapi/mobile-v1.json` shows the new `/tournaments/{id}/registration-fields` path and the changed register/waitlist request bodies.

- [ ] **Step 10: Commit**

```bash
git add lib/mobile-api/endpoints/registration-fields.ts lib/mobile-api/endpoints/registration-fields.test.ts lib/mobile-api/endpoints/tournaments.ts lib/mobile-api/endpoints/tournaments.test.ts lib/mobile-api/endpoints/index.ts openapi/mobile-v1.json
git commit -m "feat(mobile-api): dynamic registration-fields endpoint, registrationDetails body

BREAKING: register/waitlist request bodies replace clubName/ignTag with
registrationDetails. sentinelx_mobile needs a coordinated update before this
ships to production — see docs/superpowers/specs/2026-09-27-game-designer-registration-fields-design.md §4.5."
```

---

## Task 15: Whole-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Full type-check**

Run: `npx tsc --noEmit -p .`
Expected: clean.

- [ ] **Step 2: Full lint**

Run: `npm run lint`
Expected: clean (per `[[project_mobile_phase0b_api_foundation]]` — `tsc --noEmit` clean does not imply `next build`/lint clean; both must be checked).

- [ ] **Step 3: Full test suite**

Run: `npx vitest run`
Expected: all green. Check the reported test count against `git worktree list` first — this repo has hit double-counted runs before when a linked worktree sits underneath the repo root (`[[project_vitest_nested_worktree_double_count]]`).

- [ ] **Step 4: Manual smoke test**

Start `npm run dev`, then:
1. Register for a Free Fire tournament as a test player — confirm the form asks for "In-game UID," not "Club name."
2. Open that tournament's public bracket — confirm the UID shows next to the player's name (Free Fire's field is seeded `show_on_bracket = true`).
3. Open `/admin/tournaments/{id}/registrations` — confirm the table shows an "In-game UID" column instead of "Club"/"IGN / Tag."
4. Open `/admin/games`, click into Free Fire, add a throwaway field via the new UI, confirm it appears, then remove it.

- [ ] **Step 5: Commit (if any fixes were needed)**

```bash
git add -A
git commit -m "fix: address issues found in whole-suite verification"
```
(Skip this step entirely if Steps 1–4 were clean — don't create an empty commit.)
