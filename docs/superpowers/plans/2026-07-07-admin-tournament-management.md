# Admin Tournament Management (CRUD) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give staff a `/admin/tournaments` surface to create, edit, delete (draft-only), and publish tournaments, all enforced server-side.

**Architecture:** Two pure, unit-tested helpers (`slug`, `readiness`) and a zod schema underpin four Server Actions. A shared client `TournamentForm` drives create + edit; a client `TournamentListRow` drives publish + delete. Three Server-Component pages render the list and forms. Builds on sub-project 1's `requireStaff`/`requireAdmin` and `ADMIN_NAV`. No DB migration.

**Tech Stack:** Next.js 14.2 App Router (React 18), TypeScript, Tailwind, Supabase server client, zod, Vitest. Forms use `useFormState` from `react-dom` (matching every existing form — NOT `useActionState`).

## Global Constraints

- Mobile-first (375px up); Server Components by default; only `TournamentForm` and `TournamentListRow` are `"use client"`.
- Role model: create/edit/publish → `requireStaff()`; **delete → `requireAdmin()`**.
- **Delete allowed only while `status='draft'`, re-checked server-side** in the action (hidden button is UX only). The `ON DELETE CASCADE` is safe *because* deletion is unreachable outside draft — document this so no one misreads the cascade.
- Publish (`draft → registration_open`) requires `missingForPublish` to be empty; the action returns the missing-field list otherwise. No other status transitions here.
- Slug: `slugify` from title; editable only while `draft`; after publish the form shows it as a **visible read-only** input with a "Locked — changing would break public URLs" note. Create retries on Postgres `23505` with a random suffix.
- Money is naira `integer` (`registration_fee` default 500, `prize_pool` default 0). `format` fixed `group_knockout` (no field). `status` never in the form.
- `tournaments.game_id` is a required FK to `games`; the game selector lists `games` where `active=true`. If none exist, the create page shows a "seed a game first" message.
- Append the Tournaments nav entry only when its page ships (Task 6). Do NOT mark roadmap #9 done (sub-project 2 of 6).
- Test: `npx vitest run <path>`. Type: `npx tsc --noEmit`. Lint: `npx next lint --file <path>`. Build: `npm run build`.
- Each commit message ends with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

### Task 1: Slug helper

**Files:**
- Create: `lib/tournaments/slug.ts`
- Create: `lib/tournaments/slug.test.ts`

**Interfaces:**
- Produces: `slugify(title: string): string` for Task 4.

- [ ] **Step 1: Write the failing test**

Create `lib/tournaments/slug.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { slugify } from './slug'

describe('slugify', () => {
  it('lowercases and hyphenates words', () => {
    expect(slugify('DLS Season 5')).toBe('dls-season-5')
  })
  it('strips punctuation', () => {
    expect(slugify('DLS Season 5!')).toBe('dls-season-5')
  })
  it('collapses repeated separators and trims', () => {
    expect(slugify('  Multiple   Spaces  ')).toBe('multiple-spaces')
    expect(slugify('Under_scores')).toBe('under-scores')
  })
  it('strips diacritics', () => {
    expect(slugify('Café Cup')).toBe('cafe-cup')
  })
  it('returns empty string for all-symbol input', () => {
    expect(slugify('---')).toBe('')
    expect(slugify('!!!')).toBe('')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/tournaments/slug.test.ts`
Expected: FAIL — cannot find module `./slug`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/tournaments/slug.ts`:

```typescript
// URL-safe slug from a title. Used for every public tournament URL, so it must
// be lowercase and contain only [a-z0-9-].
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics — use the range ̀-ͯ
    .replace(/[^a-z0-9]+/g, '-') // non-alphanumeric runs → single hyphen
    .replace(/-+/g, '-') // collapse
    .replace(/^-|-$/g, '') // trim leading/trailing hyphens
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/tournaments/slug.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/tournaments/slug.ts lib/tournaments/slug.test.ts
git commit -m "$(cat <<'EOF'
feat: slugify helper for tournament URLs

Lowercase, diacritic-stripped, [a-z0-9-] only.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Publish-readiness helper

**Files:**
- Create: `lib/tournaments/readiness.ts`
- Create: `lib/tournaments/readiness.test.ts`

**Interfaces:**
- Produces: `interface PublishableTournament`, `missingForPublish(t: PublishableTournament): string[]` for Tasks 4 & 6.

- [ ] **Step 1: Write the failing test**

Create `lib/tournaments/readiness.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { missingForPublish, type PublishableTournament } from './readiness'

function t(over: Partial<PublishableTournament> = {}): PublishableTournament {
  return {
    gameId: 'g1',
    maxPlayers: 16,
    registrationFee: 500,
    prizePool: 10000,
    dates: ['2026-08-01T10:00', null, null, null],
    ...over,
  }
}

describe('missingForPublish', () => {
  it('returns [] for a fully-configured tournament', () => {
    expect(missingForPublish(t())).toEqual([])
  })
  it('flags a missing game', () => {
    expect(missingForPublish(t({ gameId: null }))).toContain('game')
  })
  it('flags missing max players', () => {
    expect(missingForPublish(t({ maxPlayers: null }))).toContain('max players')
  })
  it('flags missing fee and prize', () => {
    const m = missingForPublish(t({ registrationFee: null, prizePool: null }))
    expect(m).toContain('registration fee')
    expect(m).toContain('prize pool')
  })
  it('flags no scheduled date when all four are absent', () => {
    expect(missingForPublish(t({ dates: [null, '', null, ''] }))).toContain(
      'at least one scheduled date',
    )
  })
  it('accepts a single populated date', () => {
    expect(missingForPublish(t({ dates: [null, null, '2026-09-01T10:00', null] }))).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/tournaments/readiness.test.ts`
Expected: FAIL — cannot find module `./readiness`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/tournaments/readiness.ts`:

```typescript
export interface PublishableTournament {
  gameId: string | null
  maxPlayers: number | null
  registrationFee: number | null
  prizePool: number | null
  dates: (string | null)[]
}

// Human-readable labels for each required-to-publish field that is absent.
// Empty array means the tournament is ready to open for registration.
export function missingForPublish(t: PublishableTournament): string[] {
  const missing: string[] = []
  if (!t.gameId) missing.push('game')
  if (t.maxPlayers == null) missing.push('max players')
  if (t.registrationFee == null) missing.push('registration fee')
  if (t.prizePool == null) missing.push('prize pool')
  if (!t.dates.some((d) => d != null && d !== '')) missing.push('at least one scheduled date')
  return missing
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/tournaments/readiness.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/tournaments/readiness.ts lib/tournaments/readiness.test.ts
git commit -m "$(cat <<'EOF'
feat: tournament publish-readiness helper

missingForPublish lists absent required fields (game, max players,
fee, prize, >=1 date) that block opening registration.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Tournament admin zod schema

**Files:**
- Create: `lib/tournaments/admin-schema.ts`
- Create: `lib/tournaments/admin-schema.test.ts`

**Interfaces:**
- Produces: `tournamentSchema` (zod object), `type TournamentInput` for Task 4.

- [ ] **Step 1: Write the failing test**

Create `lib/tournaments/admin-schema.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { tournamentSchema } from './admin-schema'

const valid = {
  title: 'DLS Cup',
  gameId: '11111111-1111-1111-1111-111111111111',
  slug: '',
  description: '',
  bannerUrl: '',
  registrationFee: '500',
  prizePool: '0',
  maxPlayers: '16',
  registrationStart: '',
  registrationEnd: '',
  tournamentStart: '2026-08-01T18:00',
  tournamentEnd: '',
}

describe('tournamentSchema', () => {
  it('accepts a valid tournament and coerces numbers', () => {
    const r = tournamentSchema.safeParse(valid)
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.registrationFee).toBe(500)
      expect(r.data.maxPlayers).toBe(16)
    }
  })
  it('requires a title', () => {
    expect(tournamentSchema.safeParse({ ...valid, title: '  ' }).success).toBe(false)
  })
  it('requires a uuid game', () => {
    expect(tournamentSchema.safeParse({ ...valid, gameId: 'dls' }).success).toBe(false)
  })
  it('allows an empty maxPlayers but rejects out-of-range', () => {
    expect(tournamentSchema.safeParse({ ...valid, maxPlayers: '' }).success).toBe(true)
    expect(tournamentSchema.safeParse({ ...valid, maxPlayers: '1' }).success).toBe(false)
    expect(tournamentSchema.safeParse({ ...valid, maxPlayers: '65' }).success).toBe(false)
  })
  it('rejects a malformed date', () => {
    expect(tournamentSchema.safeParse({ ...valid, tournamentStart: 'next week' }).success).toBe(
      false,
    )
  })
  it('rejects a non-url banner', () => {
    expect(tournamentSchema.safeParse({ ...valid, bannerUrl: 'notaurl' }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/tournaments/admin-schema.test.ts`
Expected: FAIL — cannot find module `./admin-schema`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/tournaments/admin-schema.ts`:

```typescript
import { z } from 'zod'

const optionalText = (max: number) => z.union([z.literal(''), z.string().trim().max(max)])
const optionalUrl = z.union([z.literal(''), z.string().trim().url('Enter a valid URL')])
// <input type="datetime-local"> yields 'YYYY-MM-DDTHH:mm' (no seconds/offset).
const localDateTime = z.union([
  z.literal(''),
  z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Enter a valid date and time'),
])
const money = (max: number) =>
  z.coerce.number().int('Whole naira only').min(0, 'Cannot be negative').max(max, 'Amount is too large')

export const tournamentSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(120, 'Title is too long'),
  gameId: z.string().uuid('Choose a game'),
  slug: z.union([z.literal(''), z.string().trim().max(120)]),
  description: optionalText(2000),
  bannerUrl: optionalUrl,
  registrationFee: money(1_000_000),
  prizePool: money(1_000_000_000),
  maxPlayers: z.union([
    z.literal(''),
    z.coerce.number().int().min(2, 'At least 2 players').max(64, 'At most 64 players'),
  ]),
  registrationStart: localDateTime,
  registrationEnd: localDateTime,
  tournamentStart: localDateTime,
  tournamentEnd: localDateTime,
})

export type TournamentInput = z.infer<typeof tournamentSchema>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/tournaments/admin-schema.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/tournaments/admin-schema.ts lib/tournaments/admin-schema.test.ts
git commit -m "$(cat <<'EOF'
feat: tournament admin zod schema

Title/game/slug/money/maxPlayers/datetime-local validation for the
create + edit forms.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Tournament admin server actions

**Files:**
- Create: `lib/tournaments/admin-actions.ts`

**Interfaces:**
- Consumes: `requireStaff`/`requireAdmin` (`@/lib/admin/auth`), `tournamentSchema` (Task 3), `slugify` (Task 1), `missingForPublish` (Task 2), `createClient` (`@/lib/supabase/server`).
- Produces: `type TournamentFormState`, `type PublishState`, `createTournament`, `updateTournament`, `deleteTournament`, `openRegistration` for Tasks 5 & 6.

Verified via `tsc`/`lint`; exercised by the Task 6 build. Mirrors `lib/auth/actions.ts` (redirect at end, outside any try) and `lib/auth/errors.ts` (23505 check).

- [ ] **Step 1: Write the implementation**

Create `lib/tournaments/admin-actions.ts`:

```typescript
'use server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireStaff, requireAdmin } from '@/lib/admin/auth'
import { tournamentSchema, type TournamentInput } from './admin-schema'
import { slugify } from './slug'
import { missingForPublish } from './readiness'

export type TournamentFormState = { error?: string; success?: boolean } | undefined
export type PublishState = { error?: string; fieldErrors?: string[]; success?: boolean } | undefined

function parseForm(formData: FormData) {
  return tournamentSchema.safeParse({
    title: formData.get('title'),
    gameId: formData.get('gameId'),
    slug: formData.get('slug') ?? '',
    description: formData.get('description') ?? '',
    bannerUrl: formData.get('bannerUrl') ?? '',
    registrationFee: formData.get('registrationFee'),
    prizePool: formData.get('prizePool'),
    maxPlayers: formData.get('maxPlayers') ?? '',
    registrationStart: formData.get('registrationStart') ?? '',
    registrationEnd: formData.get('registrationEnd') ?? '',
    tournamentStart: formData.get('tournamentStart') ?? '',
    tournamentEnd: formData.get('tournamentEnd') ?? '',
  })
}

// Map validated form values onto the tournaments row columns (empty string -> null).
function toRow(d: TournamentInput) {
  const orNull = (v: string) => (v === '' ? null : v)
  return {
    title: d.title,
    game_id: d.gameId,
    description: orNull(d.description),
    banner_url: orNull(d.bannerUrl),
    registration_fee: d.registrationFee,
    prize_pool: d.prizePool,
    max_players: d.maxPlayers === '' ? null : d.maxPlayers,
    registration_start: orNull(d.registrationStart),
    registration_end: orNull(d.registrationEnd),
    tournament_start: orNull(d.tournamentStart),
    tournament_end: orNull(d.tournamentEnd),
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '23505'
}

export async function createTournament(
  _prev: TournamentFormState,
  formData: FormData,
): Promise<TournamentFormState> {
  await requireStaff()
  const parsed = parseForm(formData)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const base = slugify(parsed.data.slug || parsed.data.title)
  if (!base) return { error: 'Enter a title that produces a valid URL slug.' }

  const supabase = createClient()
  const row = { ...toRow(parsed.data), status: 'draft', format: 'group_knockout' }

  // Insert, retrying with a random suffix if the slug collides (23505).
  let slug = base
  let newId: string | null = null
  for (let i = 0; i < 5; i++) {
    const { data, error } = await supabase
      .from('tournaments')
      .insert({ ...row, slug })
      .select('id')
      .single()
    if (!error) {
      newId = data.id
      break
    }
    if (!isUniqueViolation(error)) return { error: 'Could not create the tournament. Please try again.' }
    slug = `${base}-${Math.random().toString(36).slice(2, 6)}`
  }
  if (!newId) return { error: 'Could not generate a unique URL slug. Try a different title.' }

  revalidatePath('/admin/tournaments')
  revalidatePath('/tournaments')
  redirect(`/admin/tournaments/${newId}/edit`)
}

export async function updateTournament(
  _prev: TournamentFormState,
  formData: FormData,
): Promise<TournamentFormState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing tournament.' }
  const parsed = parseForm(formData)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = createClient()
  const { data: current } = await supabase
    .from('tournaments')
    .select('status, slug')
    .eq('id', id)
    .maybeSingle()
  if (!current) return { error: 'Tournament not found.' }

  // Slug is editable only while draft; otherwise keep the stored slug.
  let slug = current.slug
  if (current.status === 'draft') {
    const base = slugify(parsed.data.slug || parsed.data.title)
    if (!base) return { error: 'Enter a title that produces a valid URL slug.' }
    slug = base
  }

  const { error } = await supabase
    .from('tournaments')
    .update({ ...toRow(parsed.data), slug })
    .eq('id', id)
  if (error) {
    if (isUniqueViolation(error)) return { error: 'That URL slug is already taken.' }
    return { error: 'Could not save changes. Please try again.' }
  }

  revalidatePath('/admin/tournaments')
  revalidatePath('/tournaments')
  revalidatePath(`/tournaments/${slug}`)
  return { success: true }
}

export async function deleteTournament(
  _prev: TournamentFormState,
  formData: FormData,
): Promise<TournamentFormState> {
  await requireAdmin()
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing tournament.' }

  const supabase = createClient()
  const { data: current } = await supabase
    .from('tournaments')
    .select('status')
    .eq('id', id)
    .maybeSingle()
  if (!current) return { error: 'Tournament not found.' }
  // Server-side guard: the ON DELETE CASCADE is safe ONLY because deletion is
  // unreachable outside draft (no paid registrations / matches / results / SEO).
  if (current.status !== 'draft') return { error: 'Only draft tournaments can be deleted.' }

  const { error } = await supabase.from('tournaments').delete().eq('id', id)
  if (error) return { error: 'Could not delete the tournament.' }

  revalidatePath('/admin/tournaments')
  revalidatePath('/tournaments')
  return { success: true }
}

export async function openRegistration(
  _prev: PublishState,
  formData: FormData,
): Promise<PublishState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing tournament.' }

  const supabase = createClient()
  const { data: t } = await supabase
    .from('tournaments')
    .select(
      'status, game_id, max_players, registration_fee, prize_pool, registration_start, registration_end, tournament_start, tournament_end',
    )
    .eq('id', id)
    .maybeSingle()
  if (!t) return { error: 'Tournament not found.' }
  if (t.status !== 'draft')
    return { error: 'Registration can only be opened for a draft tournament.' }

  const missing = missingForPublish({
    gameId: t.game_id,
    maxPlayers: t.max_players,
    registrationFee: t.registration_fee,
    prizePool: t.prize_pool,
    dates: [t.registration_start, t.registration_end, t.tournament_start, t.tournament_end],
  })
  if (missing.length > 0) return { fieldErrors: missing }

  const { error } = await supabase
    .from('tournaments')
    .update({ status: 'registration_open' })
    .eq('id', id)
  if (error) return { error: 'Could not open registration.' }

  revalidatePath('/admin/tournaments')
  revalidatePath('/tournaments')
  return { success: true }
}
```

- [ ] **Step 2: Verify types and lint**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npx next lint --file lib/tournaments/admin-actions.ts`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add lib/tournaments/admin-actions.ts
git commit -m "$(cat <<'EOF'
feat: tournament admin server actions

create/update/delete (draft-only, requireAdmin) + openRegistration
(readiness-gated). Slug 23505 retry on create.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: TournamentForm + TournamentListRow components

**Files:**
- Create: `components/admin/TournamentForm.tsx`
- Create: `components/admin/TournamentListRow.tsx`

**Interfaces:**
- Consumes: the four actions + `TournamentFormState`/`PublishState` (Task 4).
- Produces: `TournamentForm({ action, games, initial, slugLocked, submitLabel })` with exported `interface TournamentFormValues`; `TournamentListRow({ t, isAdmin })` with exported `interface AdminTournamentRow`, for Task 6.

- [ ] **Step 1: Create `TournamentForm.tsx`**

```tsx
'use client'
import { useFormState, useFormStatus } from 'react-dom'
import { type TournamentFormState } from '@/lib/tournaments/admin-actions'

export interface TournamentFormValues {
  id?: string
  title: string
  slug: string
  gameId: string
  description: string
  bannerUrl: string
  registrationFee: string
  prizePool: string
  maxPlayers: string
  registrationStart: string
  registrationEnd: string
  tournamentStart: string
  tournamentEnd: string
}

type Action = (prev: TournamentFormState, fd: FormData) => Promise<TournamentFormState>

export function TournamentForm({
  action,
  games,
  initial,
  slugLocked,
  submitLabel,
}: {
  action: Action
  games: { id: string; name: string }[]
  initial: TournamentFormValues
  slugLocked: boolean
  submitLabel: string
}) {
  const [state, formAction] = useFormState<TournamentFormState, FormData>(action, undefined)
  return (
    <form action={formAction} className="space-y-4">
      {initial.id && <input type="hidden" name="id" value={initial.id} />}

      <Field label="Title" name="title" defaultValue={initial.title} required />

      <div className="space-y-1.5">
        <label htmlFor="slug" className="text-sm font-medium text-slate-300">
          URL slug {slugLocked && <span className="text-slate-500">— locked</span>}
        </label>
        <input
          id="slug"
          name="slug"
          defaultValue={initial.slug}
          readOnly={slugLocked}
          placeholder="auto-generated from title if left blank"
          className={`w-full rounded-lg border border-slate-700 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none ${
            slugLocked ? 'bg-slate-800 text-slate-400' : 'bg-slate-950'
          }`}
        />
        {slugLocked && (
          <p className="text-xs text-slate-500">Locked — changing would break public URLs.</p>
        )}
      </div>

      <div className="space-y-1.5">
        <label htmlFor="gameId" className="text-sm font-medium text-slate-300">
          Game
        </label>
        <select
          id="gameId"
          name="gameId"
          defaultValue={initial.gameId}
          required
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
        >
          <option value="" disabled>
            Choose a game
          </option>
          {games.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="description" className="text-sm font-medium text-slate-300">
          Description
        </label>
        <textarea
          id="description"
          name="description"
          defaultValue={initial.description}
          rows={3}
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
        />
      </div>

      <Field label="Banner URL" name="bannerUrl" type="url" defaultValue={initial.bannerUrl} />

      <div className="grid grid-cols-2 gap-4">
        <Field
          label="Registration fee (₦)"
          name="registrationFee"
          type="number"
          defaultValue={initial.registrationFee}
        />
        <Field
          label="Prize pool (₦)"
          name="prizePool"
          type="number"
          defaultValue={initial.prizePool}
        />
      </div>

      <Field
        label="Max players (2–64)"
        name="maxPlayers"
        type="number"
        defaultValue={initial.maxPlayers}
      />

      <div className="grid grid-cols-2 gap-4">
        <Field
          label="Registration start"
          name="registrationStart"
          type="datetime-local"
          defaultValue={initial.registrationStart}
        />
        <Field
          label="Registration end"
          name="registrationEnd"
          type="datetime-local"
          defaultValue={initial.registrationEnd}
        />
        <Field
          label="Tournament start"
          name="tournamentStart"
          type="datetime-local"
          defaultValue={initial.tournamentStart}
        />
        <Field
          label="Tournament end"
          name="tournamentEnd"
          type="datetime-local"
          defaultValue={initial.tournamentEnd}
        />
      </div>

      {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
      {state?.success && <p className="text-sm text-emerald-400">Saved.</p>}
      <SubmitButton label={submitLabel} />
    </form>
  )
}

function Field({
  label,
  name,
  type = 'text',
  defaultValue,
  required,
}: {
  label: string
  name: string
  type?: string
  defaultValue?: string
  required?: boolean
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="text-sm font-medium text-slate-300">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        defaultValue={defaultValue}
        required={required}
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
      />
    </div>
  )
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-xl bg-violet-600 px-7 py-3 text-sm font-bold text-white transition-colors hover:bg-violet-500 disabled:opacity-60"
    >
      {pending ? 'Saving…' : label}
    </button>
  )
}
```

- [ ] **Step 2: Create `TournamentListRow.tsx`**

```tsx
'use client'
import Link from 'next/link'
import { useFormState } from 'react-dom'
import {
  deleteTournament,
  openRegistration,
  type TournamentFormState,
  type PublishState,
} from '@/lib/tournaments/admin-actions'

export interface AdminTournamentRow {
  id: string
  title: string
  slug: string
  status: string
  gameName: string | null
  publishBlockers: string[] // from missingForPublish; only meaningful when status === 'draft'
}

const STATUS: Record<string, string> = {
  draft: 'text-slate-400',
  registration_open: 'text-emerald-400',
  registration_closed: 'text-amber-400',
  active: 'text-violet-400',
  completed: 'text-blue-400',
}

export function TournamentListRow({ t, isAdmin }: { t: AdminTournamentRow; isAdmin: boolean }) {
  const [openState, openAction] = useFormState<PublishState, FormData>(openRegistration, undefined)
  const [delState, delAction] = useFormState<TournamentFormState, FormData>(
    deleteTournament,
    undefined,
  )
  const isDraft = t.status === 'draft'
  const canPublish = isDraft && t.publishBlockers.length === 0

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-bold text-white">{t.title}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {t.gameName ?? 'No game'} ·{' '}
            <span className={STATUS[t.status] ?? 'text-slate-400'}>
              {t.status.replace(/_/g, ' ')}
            </span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href={`/admin/tournaments/${t.id}/edit`}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-300 hover:border-slate-500"
          >
            Edit
          </Link>
          {isDraft && (
            <form action={openAction}>
              <input type="hidden" name="id" value={t.id} />
              <button
                type="submit"
                disabled={!canPublish}
                className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-500 disabled:opacity-40"
              >
                Open registration
              </button>
            </form>
          )}
          {isDraft && isAdmin && (
            <form action={delAction}>
              <input type="hidden" name="id" value={t.id} />
              <button
                type="submit"
                className="rounded-lg border border-red-500/40 px-3 py-1.5 text-xs font-bold text-red-400 hover:bg-red-500/10"
              >
                Delete
              </button>
            </form>
          )}
        </div>
      </div>

      {isDraft && t.publishBlockers.length > 0 && (
        <p className="mt-2 text-xs text-amber-400/80">
          To open registration, add: {t.publishBlockers.join(', ')}.
        </p>
      )}
      {openState?.fieldErrors && (
        <p className="mt-2 text-xs text-amber-400/80">
          Missing: {openState.fieldErrors.join(', ')}.
        </p>
      )}
      {openState?.error && <p className="mt-2 text-xs text-red-400">{openState.error}</p>}
      {delState?.error && <p className="mt-2 text-xs text-red-400">{delState.error}</p>}
    </div>
  )
}
```

- [ ] **Step 3: Verify types and lint**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npx next lint --file components/admin/TournamentForm.tsx --file components/admin/TournamentListRow.tsx`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add components/admin/TournamentForm.tsx components/admin/TournamentListRow.tsx
git commit -m "$(cat <<'EOF'
feat: TournamentForm + TournamentListRow components

Shared create/edit form (slug locks after publish) and a list row with
readiness-gated Open registration + admin-only Delete.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Admin tournament pages + nav entry

**Files:**
- Create: `app/admin/tournaments/page.tsx`
- Create: `app/admin/tournaments/new/page.tsx`
- Create: `app/admin/tournaments/[id]/edit/page.tsx`
- Modify: `lib/admin/nav.ts` (append the Tournaments entry)

**Interfaces:**
- Consumes: `requireStaff` (`@/lib/admin/auth`), `missingForPublish` (Task 2), `TournamentForm`/`TournamentFormValues` + `TournamentListRow`/`AdminTournamentRow` (Task 5), `createTournament`/`updateTournament` (Task 4), `createClient` (`@/lib/supabase/server`).

- [ ] **Step 1: Append the nav entry**

In `lib/admin/nav.ts`, change `ADMIN_NAV` to:

```typescript
export const ADMIN_NAV: AdminNavItem[] = [
  { label: 'Overview', href: '/admin', adminOnly: false },
  { label: 'Tournaments', href: '/admin/tournaments', adminOnly: false },
]
```

- [ ] **Step 2: Create the list page**

Create `app/admin/tournaments/page.tsx`:

```tsx
import Link from 'next/link'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { missingForPublish } from '@/lib/tournaments/readiness'
import { TournamentListRow, type AdminTournamentRow } from '@/components/admin/TournamentListRow'

export const metadata: Metadata = { title: 'Tournaments · Admin · SentinelX' }

type GameRef = { name: string } | { name: string }[] | null
function gameName(g: GameRef): string | null {
  if (Array.isArray(g)) return g[0]?.name ?? null
  return g?.name ?? null
}

export default async function AdminTournamentsPage() {
  const ctx = await requireStaff()
  const supabase = createClient()
  const { data } = await supabase
    .from('tournaments')
    .select(
      'id, title, slug, status, game_id, max_players, registration_fee, prize_pool, registration_start, registration_end, tournament_start, tournament_end, games(name)',
    )
    .order('created_at', { ascending: false })

  const rows: AdminTournamentRow[] = ((data as unknown[] | null) ?? []).map((raw) => {
    const t = raw as {
      id: string
      title: string
      slug: string
      status: string
      game_id: string | null
      max_players: number | null
      registration_fee: number | null
      prize_pool: number | null
      registration_start: string | null
      registration_end: string | null
      tournament_start: string | null
      tournament_end: string | null
      games: GameRef
    }
    return {
      id: t.id,
      title: t.title,
      slug: t.slug,
      status: t.status,
      gameName: gameName(t.games),
      publishBlockers: missingForPublish({
        gameId: t.game_id,
        maxPlayers: t.max_players,
        registrationFee: t.registration_fee,
        prizePool: t.prize_pool,
        dates: [
          t.registration_start,
          t.registration_end,
          t.tournament_start,
          t.tournament_end,
        ],
      }),
    }
  })

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-bold text-white">All tournaments</h2>
        <Link
          href="/admin/tournaments/new"
          className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-500"
        >
          + New tournament
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center text-sm text-slate-500">
          No tournaments yet. Create the first one.
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((t) => (
            <TournamentListRow key={t.id} t={t} isAdmin={ctx.isAdmin} />
          ))}
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 3: Create the "new" page**

Create `app/admin/tournaments/new/page.tsx`:

```tsx
import Link from 'next/link'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { createTournament } from '@/lib/tournaments/admin-actions'
import { TournamentForm, type TournamentFormValues } from '@/components/admin/TournamentForm'

export const metadata: Metadata = { title: 'New tournament · Admin · SentinelX' }

const EMPTY: TournamentFormValues = {
  title: '',
  slug: '',
  gameId: '',
  description: '',
  bannerUrl: '',
  registrationFee: '500',
  prizePool: '0',
  maxPlayers: '',
  registrationStart: '',
  registrationEnd: '',
  tournamentStart: '',
  tournamentEnd: '',
}

export default async function NewTournamentPage() {
  await requireStaff()
  const supabase = createClient()
  const { data: games } = await supabase
    .from('games')
    .select('id, name')
    .eq('active', true)
    .order('name')

  return (
    <section className="max-w-xl">
      <Link href="/admin/tournaments" className="text-sm text-violet-400 hover:text-violet-300">
        ← Tournaments
      </Link>
      <h2 className="mb-4 mt-2 text-base font-bold text-white">New tournament</h2>
      {(games ?? []).length === 0 ? (
        <p className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 text-sm text-amber-300">
          No active games exist yet. Seed at least one game before creating a tournament.
        </p>
      ) : (
        <TournamentForm
          action={createTournament}
          games={games ?? []}
          initial={EMPTY}
          slugLocked={false}
          submitLabel="Create tournament"
        />
      )}
    </section>
  )
}
```

- [ ] **Step 4: Create the edit page**

Create `app/admin/tournaments/[id]/edit/page.tsx`:

```tsx
import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { updateTournament } from '@/lib/tournaments/admin-actions'
import { TournamentForm, type TournamentFormValues } from '@/components/admin/TournamentForm'

export const metadata: Metadata = { title: 'Edit tournament · Admin · SentinelX' }

// timestamptz ISO -> value for <input type="datetime-local"> ('YYYY-MM-DDTHH:mm').
function toLocalInput(iso: string | null): string {
  return iso ? iso.slice(0, 16) : ''
}
function moneyStr(n: number | null): string {
  return n == null ? '' : String(n)
}

export default async function EditTournamentPage({ params }: { params: { id: string } }) {
  await requireStaff()
  const supabase = createClient()
  const [{ data: t }, { data: games }] = await Promise.all([
    supabase.from('tournaments').select('*').eq('id', params.id).maybeSingle(),
    supabase.from('games').select('id, name').eq('active', true).order('name'),
  ])
  if (!t) notFound()

  const initial: TournamentFormValues = {
    id: t.id,
    title: t.title,
    slug: t.slug,
    gameId: t.game_id,
    description: t.description ?? '',
    bannerUrl: t.banner_url ?? '',
    registrationFee: moneyStr(t.registration_fee),
    prizePool: moneyStr(t.prize_pool),
    maxPlayers: t.max_players == null ? '' : String(t.max_players),
    registrationStart: toLocalInput(t.registration_start),
    registrationEnd: toLocalInput(t.registration_end),
    tournamentStart: toLocalInput(t.tournament_start),
    tournamentEnd: toLocalInput(t.tournament_end),
  }

  return (
    <section className="max-w-xl">
      <Link href="/admin/tournaments" className="text-sm text-violet-400 hover:text-violet-300">
        ← Tournaments
      </Link>
      <h2 className="mb-4 mt-2 text-base font-bold text-white">
        Edit · <span className="text-slate-400">{t.status.replace(/_/g, ' ')}</span>
      </h2>
      <TournamentForm
        action={updateTournament}
        games={games ?? []}
        initial={initial}
        slugLocked={t.status !== 'draft'}
        submitLabel="Save changes"
      />
    </section>
  )
}
```

- [ ] **Step 5: Verify types and lint**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npx next lint --file app/admin/tournaments/page.tsx --file app/admin/tournaments/new/page.tsx --file "app/admin/tournaments/[id]/edit/page.tsx"`
Expected: clean.

- [ ] **Step 6: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — all suites including the three new tournament-admin test files.

- [ ] **Step 7: Production build**

Run: `npm run build`
Expected: build succeeds; `/admin/tournaments`, `/admin/tournaments/new`, and `/admin/tournaments/[id]/edit` appear in the route list.

- [ ] **Step 8: Commit**

```bash
git add "app/admin/tournaments" lib/admin/nav.ts
git commit -m "$(cat <<'EOF'
feat: admin tournament pages (#9 sub-project 2)

List (all statuses) + create + edit pages wired to the admin actions,
plus the Tournaments nav entry.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- Role model create/edit/publish=staff, delete=admin → Tasks 4, 5, 6. ✅
- Draft-only delete with server re-check + cascade rationale documented → Task 4. ✅
- Publish readiness (block + list missing) → Tasks 2, 4, 5. ✅
- Slug: slugify, draft-only editable, visible read-only when locked, 23505 retry → Tasks 1, 4, 5, 6. ✅
- Schema (title/game/money/maxPlayers/datetime-local) → Task 3. ✅
- Pages: list (all statuses), new (games-empty message), edit (slugLocked by status) → Task 6. ✅
- Nav entry appended when the page ships → Task 6. ✅
- Game selector from active games; FK not enum → Tasks 5, 6. ✅
- `useFormState` (not `useActionState`) → Tasks 5. ✅
- No migration; #9 not marked done → honored. ✅

**Placeholder scan:** No "TBD"/"handle edge cases"/"similar to" — full code in every step. ✅

**Type consistency:** `slugify` (T1) used in T4. `PublishableTournament`/`missingForPublish` (T2) used in T4 & T6. `tournamentSchema`/`TournamentInput` (T3) used in T4. `TournamentFormState`/`PublishState` + the four actions (T4) consumed by T5 & T6. `TournamentFormValues` (T5) built by T6's pages. `AdminTournamentRow` (T5) built by T6's list. Column names (`game_id`, `max_players`, `registration_fee`, `prize_pool`, `registration_start/end`, `tournament_start/end`, `banner_url`, `status`) verified against `lib/supabase/types.ts`. ✅

Note: `updateTournament` keeps the stored slug for non-draft tournaments, so the "locked slug" the form shows read-only is never overwritten even though it is still submitted — matches the spec's draft-only slug rule.
