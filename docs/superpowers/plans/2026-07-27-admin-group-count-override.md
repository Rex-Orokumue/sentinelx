# Admin Group Count Override Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admin choose the number of groups when generating or re-rolling a tournament bracket, instead of always using the fixed `groupCountFor` tier.

**Architecture:** Add two pure helpers to `lib/tournaments/draw.ts` — `validGroupCounts(n)` (the group counts that keep 4–8 players per group) and `resolveGroupCount(requested, seededCount)` (the client-submitted override if valid, else the existing tiered default). Wire an optional `groups` form field through `closeRegistration`/`generateBracket` in `lib/tournaments/bracket-admin-actions.ts`, re-validated server-side against the just-loaded seeded count. Add a `<select>` to `BracketActions.tsx`, populated from the same `validGroupCounts`, shown only when there's an actual choice. The bracket admin page fetches the paid registration count to drive that select.

**Tech Stack:** TypeScript, Next.js Server Actions, Vitest, Supabase (service-role admin client).

## Global Constraints

- Server actions must never trust a client-submitted group count — `closeRegistration`/`generateBracket` recompute `validGroupCounts` from the seeded player list they just loaded, before accepting the submitted value (per spec, "Server actions" section).
- `groupCountFor`'s existing tiered output is unchanged and remains the fallback for a missing or invalid override (spec: "does not change the default tiers").
- The group-count `<select>` only renders when `validGroupCounts(paidCount).length > 1` — no UI change for tournament sizes with a single valid option (spec: "Bracket admin page" / `BracketActions` section).
- Mobile-first styling, matching the existing `BracketActions.tsx` classes (per CLAUDE.md).

---

### Task 1: `validGroupCounts` and `resolveGroupCount` pure helpers

**Files:**
- Modify: `lib/tournaments/draw.ts`
- Test: `lib/tournaments/draw.test.ts`

**Interfaces:**
- Produces: `validGroupCounts(n: number): number[]` — every group count keeping each group within 4–8 players. `n <= 8` → `[0]`; `n > 8` → integers `ceil(n/8)..floor(n/4)` inclusive.
- Produces: `resolveGroupCount(requested: number | null | undefined, seededCount: number): number` — `requested` if it's in `validGroupCounts(seededCount)`, else `groupCountFor(seededCount)`.

- [ ] **Step 1: Write the failing tests**

Append to `lib/tournaments/draw.test.ts` (after the existing `groupCountFor` describe block):

```ts
describe('validGroupCounts', () => {
  it('returns every group count that keeps groups within 4-8 players', () => {
    expect(validGroupCounts(8)).toEqual([0])
    expect(validGroupCounts(9)).toEqual([2])
    expect(validGroupCounts(16)).toEqual([2, 3, 4])
    expect(validGroupCounts(17)).toEqual([3, 4])
    expect(validGroupCounts(32)).toEqual([4, 5, 6, 7, 8])
    expect(validGroupCounts(33)).toEqual([5, 6, 7, 8])
    expect(validGroupCounts(64)).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16])
  })
})

describe('resolveGroupCount', () => {
  it('uses a valid submitted override', () => {
    expect(resolveGroupCount(8, 32)).toBe(8)
    expect(resolveGroupCount(5, 32)).toBe(5)
  })
  it('falls back to the default tier when the override is out of range', () => {
    expect(resolveGroupCount(3, 32)).toBe(4)
    expect(resolveGroupCount(100, 32)).toBe(4)
  })
  it('falls back to the default tier when no override is submitted', () => {
    expect(resolveGroupCount(undefined, 32)).toBe(4)
    expect(resolveGroupCount(null, 32)).toBe(4)
  })
})
```

Update the top import line of `lib/tournaments/draw.test.ts` to also pull in the two new names:

```ts
import {
  groupCountFor,
  validGroupCounts,
  resolveGroupCount,
  snakeDistribute,
  roundRobinPairs,
  knockoutRound1,
} from './draw'
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/tournaments/draw.test.ts`
Expected: FAIL — `validGroupCounts is not a function` / `resolveGroupCount is not a function`.

- [ ] **Step 3: Implement the helpers**

In `lib/tournaments/draw.ts`, add directly after `groupCountFor`:

```ts
// Every group count that keeps each group within the documented 4-8 players/group rule.
// n<=8 -> [0] (straight knockout only, no group-stage option).
export function validGroupCounts(n: number): number[] {
  if (n <= 8) return [0]
  const min = Math.ceil(n / 8)
  const max = Math.floor(n / 4)
  const out: number[] = []
  for (let g = min; g <= max; g++) out.push(g)
  return out
}

// An admin-submitted override wins if it's within the valid range for the seeded count;
// otherwise fall back to the documented default tier. Never trust `requested` unchecked.
export function resolveGroupCount(
  requested: number | null | undefined,
  seededCount: number,
): number {
  if (requested != null && validGroupCounts(seededCount).includes(requested)) return requested
  return groupCountFor(seededCount)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/tournaments/draw.test.ts`
Expected: PASS (all describe blocks, including the pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add lib/tournaments/draw.ts lib/tournaments/draw.test.ts
git commit -m "feat: add validGroupCounts and resolveGroupCount helpers"
```

---

### Task 2: Wire the override into the bracket-generating server actions

**Files:**
- Modify: `lib/tournaments/bracket-admin-actions.ts`

**Interfaces:**
- Consumes: `validGroupCounts`, `resolveGroupCount` from Task 1 (`lib/tournaments/draw.ts`).
- Produces: `generate(admin: Admin, tournamentId: string, seeded: string[], g: number): Promise<void>` — `g` is now a required parameter instead of computed internally. `closeRegistration` and `generateBracket` (both exported, same signatures as today: `(_prev: BracketState, formData: FormData) => Promise<BracketState>`) now read an optional `groups` field from `formData`.

- [ ] **Step 1: Update the import and `generate` signature**

In `lib/tournaments/bracket-admin-actions.ts`, change the import line:

```ts
import { resolveGroupCount, snakeDistribute, roundRobinPairs, knockoutRound1 } from './draw'
```

(`groupCountFor` is no longer called directly in this file — `resolveGroupCount` calls it internally.)

Change the `generate` function signature and remove its internal group-count computation:

```ts
async function generate(admin: Admin, tournamentId: string, seeded: string[], g: number): Promise<void> {
  await clearBracket(admin, tournamentId)

  if (g === 0) {
```

(Delete the old `const g = groupCountFor(seeded.length)` line — `g` now arrives as a parameter. Everything below that line, both the `g === 0` branch and the `snakeDistribute(seeded, g)` branch, is unchanged.)

- [ ] **Step 2: Parse the submitted `groups` field**

Add this helper above `closeRegistration` (after `clearBracket`/`generate`, before the exported actions):

```ts
function parseGroupsField(formData: FormData): number | undefined {
  const raw = formData.get('groups')
  if (typeof raw !== 'string' || raw === '') return undefined
  const n = Number(raw)
  return Number.isFinite(n) ? n : undefined
}
```

- [ ] **Step 3: Resolve and pass the group count in `closeRegistration`**

In `closeRegistration`, replace:

```ts
  await admin.from('tournaments').update({ status: 'registration_closed' }).eq('id', id)
  await generate(admin, id, seeded)
```

with:

```ts
  const g = resolveGroupCount(parseGroupsField(formData), seeded.length)
  await admin.from('tournaments').update({ status: 'registration_closed' }).eq('id', id)
  await generate(admin, id, seeded, g)
```

- [ ] **Step 4: Resolve and pass the group count in `generateBracket`**

In `generateBracket`, replace:

```ts
  await generate(admin, id, seeded)
```

with:

```ts
  const g = resolveGroupCount(parseGroupsField(formData), seeded.length)
  await generate(admin, id, seeded, g)
```

- [ ] **Step 5: Type-check and run the full test suite**

Run: `npx tsc --noEmit`
Expected: no errors (confirms `generate`'s new required `g` parameter is satisfied at both call sites).

Run: `npx vitest run`
Expected: PASS — no test directly exercises `bracket-admin-actions.ts` (it's Supabase-IO-bound, consistent with how `confirmRegistration` in `lib/tournaments/confirm.ts` is left untested while its pure `decideConfirmation` is), but the full suite must still pass with no regressions.

- [ ] **Step 6: Commit**

```bash
git add lib/tournaments/bracket-admin-actions.ts
git commit -m "feat: accept admin group-count override in bracket generation actions"
```

---

### Task 3: Fetch paid registration count on the bracket admin page

**Files:**
- Modify: `app/admin/tournaments/[id]/bracket/page.tsx`

**Interfaces:**
- Produces: a `paidCount: number` prop passed to `<BracketActions>` (consumed by Task 4).

- [ ] **Step 1: Add the paid-count query**

In `app/admin/tournaments/[id]/bracket/page.tsx`, after the existing `loadBracketView` call, add:

```ts
  const view = await loadBracketView(supabase, t.id)
  const { count: paidCount } = await supabase
    .from('tournament_registrations')
    .select('*', { count: 'exact', head: true })
    .eq('tournament_id', t.id)
    .eq('payment_status', 'paid')
```

- [ ] **Step 2: Pass it to `BracketActions`**

Change:

```tsx
      <BracketActions tournamentId={t.id} status={t.status} />
```

to:

```tsx
      <BracketActions tournamentId={t.id} status={t.status} paidCount={paidCount ?? 0} />
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: fails at this point — `BracketActions` doesn't accept a `paidCount` prop yet (Task 4 fixes this). Confirm the error is exactly about the missing prop, not something else, then proceed to Task 4 before committing.

---

### Task 4: Add the group-count `<select>` to `BracketActions`

**Files:**
- Modify: `components/admin/BracketActions.tsx`

**Interfaces:**
- Consumes: `validGroupCounts`, `groupCountFor` from `lib/tournaments/draw.ts`; the `paidCount` prop from Task 3.

- [ ] **Step 1: Accept `paidCount` and compute the options**

In `components/admin/BracketActions.tsx`, update the import and function signature:

```tsx
'use client'
import { useFormState } from 'react-dom'
import {
  closeRegistration,
  generateBracket,
  publishBracket,
  type BracketState,
} from '@/lib/tournaments/bracket-admin-actions'
import { groupCountFor, validGroupCounts } from '@/lib/tournaments/draw'

export function BracketActions({
  tournamentId,
  status,
  paidCount,
}: {
  tournamentId: string
  status: string
  paidCount: number
}) {
  const [closeState, closeAction] = useFormState<BracketState, FormData>(
    closeRegistration,
    undefined,
  )
  const [rollState, rollAction] = useFormState<BracketState, FormData>(generateBracket, undefined)
  const [pubState, pubAction] = useFormState<BracketState, FormData>(publishBracket, undefined)
  const err = closeState?.error || rollState?.error || pubState?.error

  const groupOptions = validGroupCounts(paidCount)
  const defaultGroups = groupCountFor(paidCount)
  const groupPicker = groupOptions.length > 1 && (
    <label className="flex items-center gap-2 text-sm text-slate-300">
      Groups
      <select
        name="groups"
        defaultValue={defaultGroups}
        className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-sm text-white"
      >
        {groupOptions.map((g) => (
          <option key={g} value={g}>
            {g}
          </option>
        ))}
      </select>
    </label>
  )
```

- [ ] **Step 2: Render the picker in both group-generating forms**

Update the `registration_open` form to include `{groupPicker}` before the submit button:

```tsx
      {status === 'registration_open' && (
        <form action={closeAction} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="id" value={tournamentId} />
          {groupPicker}
          <button
            type="submit"
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-bold text-white hover:bg-violet-500"
          >
            Close registration & generate bracket
          </button>
        </form>
      )}
```

Update the `registration_closed` re-roll form the same way:

```tsx
      {status === 'registration_closed' && (
        <div className="flex flex-wrap items-center gap-2">
          <form action={rollAction} className="flex flex-wrap items-center gap-3">
            <input type="hidden" name="id" value={tournamentId} />
            {groupPicker}
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
```

(The rest of the component — the `active`/`completed` note and the error line — is unchanged.)

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS — the `paidCount` prop mismatch from Task 3 is now resolved.

- [ ] **Step 4: Run the full test suite**

Run: `npx vitest run`
Expected: PASS, no regressions.

- [ ] **Step 5: Commit**

```bash
git add app/admin/tournaments/[id]/bracket/page.tsx components/admin/BracketActions.tsx
git commit -m "feat: add group-count picker to the bracket admin action bar"
```

---

### Task 5: Manual verification

**Files:** none (verification only).

- [ ] **Step 1: Run the build**

Run: `npm run build`
Expected: succeeds with no type or lint errors.

- [ ] **Step 2: Manually verify in the admin dashboard**

Start the dev server (`npm run dev`), sign in as admin, open a tournament with registration open and ≥17 paid registrations (or seed a test tournament to 32 paid registrations via the QA test data / Supabase directly). On `/admin/tournaments/[id]/bracket`:
- Confirm the "Groups" select appears next to "Close registration & generate bracket" and lists the expected range (e.g. `4,5,6,7,8` for 32 players), defaulting to `4`.
- Pick `8`, submit, and confirm the generated bracket has 8 groups (via the preview below or `AdminBracketView`).
- Use "Re-roll draw" with a different group count (e.g. `6`) and confirm the bracket regenerates with 6 groups.
- Confirm a tournament with ≤16 paid players (where `validGroupCounts` has ≤1 option) shows no select, and generation behaves exactly as before.

- [ ] **Step 3: Report results**

No commit for this task — it's verification only. If any manual check fails, return to the relevant task, fix, and re-run its test suite before re-verifying.
