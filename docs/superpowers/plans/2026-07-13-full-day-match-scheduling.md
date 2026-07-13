# Full-Day Match Scheduling (#24) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin can schedule a match to a date (no time) instead of a precise kickoff. A new hourly cron job auto-cancels full-day matches whose day has passed with no result; the existing admin walkover-override flow (unchanged) picks them up from there.

**Architecture:** Two new boolean columns on `matches` (`is_full_day`, `auto_expired`) plus a Postgres function the cron calls. `scheduled_at` stays the single "when" field for both scheduling modes — no new date column, no dual-field reads anywhere downstream. The review queue needs zero date-math: full-day matches are simply excluded from the existing time-based "no submission" check, and a second condition picks up whatever the cron has already flipped to `cancelled` + `auto_expired`. `confirmResult` needs no changes at all — it already writes a score to any match regardless of current status.

**Tech Stack:** Next.js 14 App Router (Server Actions), Supabase (Postgres + pg_cron), TypeScript, Vitest, Tailwind.

## Global Constraints

- `scheduled_at` remains the single timestamp field for both scheduling modes. Full-day matches store midnight WAT of the chosen date there; `is_full_day` is the only thing distinguishing that from a real 00:00 kickoff.
- All WAT↔UTC conversion happens **server-side** (in `updateMatch`), never client-side — mirrors the existing `fromDateTimeLocal` pattern in `lib/format.ts`.
- The review queue must not do any date/timezone arithmetic of its own — the "has the day ended" boundary is enforced entirely by *when the cron fires*, not by logic in `bucketReviewQueue`.
- `confirmResult` (`lib/matches/verify-actions.ts`) is not modified — it already works on any match regardless of status.
- Migration file: `supabase/migrations/021_full_day_matches.sql` (next after `020_game_category.sql`).
- Both new columns default to `false`, so every existing match's behavior is unchanged until an admin explicitly uses full-day mode on it.

---

### Task 1: Migration — `is_full_day`, `auto_expired`, `expire_full_day_matches()`

**Files:**
- Create: `supabase/migrations/021_full_day_matches.sql`

- [ ] **Step 1: Write the migration**

```sql
ALTER TABLE public.matches
  ADD COLUMN is_full_day  boolean NOT NULL DEFAULT false,
  ADD COLUMN auto_expired boolean NOT NULL DEFAULT false;

-- Runs periodically (activated separately, see the plan's final task) to
-- cancel full-day matches whose day has passed with no result. scheduled_at
-- stores midnight WAT for a full-day match; adding 1 day to a UTC instant
-- that represents midnight WAT lands exactly on the following midnight WAT
-- (Nigeria has no DST, so this interval arithmetic is safe without an
-- explicit AT TIME ZONE conversion) — i.e. this fires the moment that
-- calendar day, WAT, ends.
CREATE FUNCTION public.expire_full_day_matches() RETURNS void
LANGUAGE sql
AS $$
  UPDATE public.matches
  SET status = 'cancelled', auto_expired = true
  WHERE is_full_day = true
    AND status = 'scheduled'
    AND scheduled_at + interval '1 day' <= now();
$$;
```

- [ ] **Step 2: Apply the migration**

Try `supabase db push --dry-run` then `supabase db push --yes`. If the CLI can't reach the DB (seen repeatedly this session), fall back to `mcp__claude_ai_Supabase__apply_migration` — ask the user to confirm before applying, showing the exact SQL. If a prior migration was applied via the MCP path, check `supabase migration list` first and repair (`supabase migration repair --status applied <version>` / `--status reverted <stray-timestamp>`) before pushing.

- [ ] **Step 3: Regenerate Supabase types**

Overwrite `lib/supabase/types.ts` (CLI `supabase gen types typescript` or `mcp__claude_ai_Supabase__generate_typescript_types`), preserving its existing header format.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/021_full_day_matches.sql lib/supabase/types.ts
git commit -m "feat: #24 add is_full_day/auto_expired columns + expire_full_day_matches()"
```

---

### Task 2: `lib/format.ts` — `fromDateLocal` (server-side date→WAT-midnight-UTC)

**Files:**
- Modify: `lib/format.ts`
- Create: `lib/format.test.ts` (if it doesn't already exist — check first; if it exists, add to it)

- [ ] **Step 1: Check for an existing test file**

Run: `ls lib/format.test.ts 2>&1 || echo "does not exist"`

If it exists, read it first and add the new tests to its existing structure/imports rather than overwriting. If it doesn't exist, create it fresh per Step 2 below.

- [ ] **Step 2: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { fromDateLocal } from './format'

describe('fromDateLocal', () => {
  it('converts a WAT calendar date to its UTC midnight instant', () => {
    // Midnight WAT (UTC+1) on 2026-07-14 is 23:00 UTC on 2026-07-13.
    expect(fromDateLocal('2026-07-14')).toBe('2026-07-13T23:00:00.000Z')
  })

  it('returns null for empty input', () => {
    expect(fromDateLocal('')).toBeNull()
    expect(fromDateLocal(null)).toBeNull()
    expect(fromDateLocal(undefined)).toBeNull()
  })

  it('returns null for invalid input', () => {
    expect(fromDateLocal('not-a-date')).toBeNull()
  })
})
```

(If `lib/format.test.ts` already exists with other describe blocks, add this `describe` block to the end of the file and merge the `fromDateLocal` import into the existing import line instead of adding a second import statement.)

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run lib/format.test.ts`
Expected: FAIL — `fromDateLocal` is not exported

- [ ] **Step 4: Add the implementation**

In `lib/format.ts`, add this function right after the existing `fromDateTimeLocal`:

```typescript
/**
 * "YYYY-MM-DD" (from an `<input type="date">`) → UTC ISO instant for
 * midnight WAT that date, for storage. Returns null for empty/invalid input.
 */
export function fromDateLocal(value: string | null | undefined): string | null {
  if (!value) return null
  const d = new Date(`${value}T00:00:00${WAT_OFFSET}`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run lib/format.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/format.ts lib/format.test.ts
git commit -m "feat: #24 fromDateLocal — server-side WAT-midnight conversion for date-only input"
```

---

### Task 3: `lib/matches/edit-schema.ts` — `schedulingMode` + date-only field

**Files:**
- Modify: `lib/matches/edit-schema.ts`
- Modify: `lib/matches/edit-schema.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `lib/matches/edit-schema.test.ts`:

```typescript
describe('matchEditSchema — full-day mode', () => {
  it('accepts full_day mode with a valid date and no scheduledAt', () => {
    const r = matchEditSchema.safeParse({
      schedulingMode: 'full_day',
      scheduledAt: '',
      scheduledDate: '2026-08-01',
      streamUrl: '',
      replayUrl: '',
    })
    expect(r.success).toBe(true)
  })

  it('accepts timed mode with a valid scheduledAt and no scheduledDate', () => {
    const r = matchEditSchema.safeParse({
      schedulingMode: 'timed',
      scheduledAt: '2026-08-01T18:00',
      scheduledDate: '',
      streamUrl: '',
      replayUrl: '',
    })
    expect(r.success).toBe(true)
  })

  it('rejects an invalid schedulingMode', () => {
    const r = matchEditSchema.safeParse({
      schedulingMode: 'sometimes',
      scheduledAt: '',
      scheduledDate: '',
      streamUrl: '',
      replayUrl: '',
    })
    expect(r.success).toBe(false)
  })

  it('rejects a malformed scheduledDate', () => {
    const r = matchEditSchema.safeParse({
      schedulingMode: 'full_day',
      scheduledAt: '',
      scheduledDate: 'August 1st',
      streamUrl: '',
      replayUrl: '',
    })
    expect(r.success).toBe(false)
  })
})
```

Also update the existing `valid` fixture at the top of the file (every existing test spreads `valid`, so it needs the two new required fields or the existing tests will fail to parse):

```typescript
const valid = {
  schedulingMode: 'timed' as const,
  scheduledAt: '2026-08-01T18:00',
  scheduledDate: '',
  streamUrl: 'https://youtu.be/abcdefghijk',
  replayUrl: '',
}
```

The two existing tests that build their own literal objects (not spreading `valid`) also need the new fields added — update these two:

```typescript
  it('accepts all-empty fields (everything is clearable)', () => {
    expect(
      matchEditSchema.safeParse({
        schedulingMode: 'timed',
        scheduledAt: '',
        scheduledDate: '',
        streamUrl: '',
        replayUrl: '',
      }).success,
    ).toBe(true)
  })
```

(the other four existing tests all spread `...valid`, so updating the `valid` fixture alone covers them)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/matches/edit-schema.test.ts`
Expected: FAIL — `schedulingMode`/`scheduledDate` not in the schema yet

- [ ] **Step 3: Update the schema**

In `lib/matches/edit-schema.ts`:

```typescript
import { z } from 'zod'
import { parseYouTubeId } from './youtube'

const localDateTime = z.union([
  z.literal(''),
  z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Enter a valid date and time'),
])

const localDate = z.union([
  z.literal(''),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date'),
])

// YouTube-only: the Match Centre video section (app/(public)/matches/[id]/page.tsx)
// embeds these via parseYouTubeId. If this ever accepts non-YouTube (e.g. a Drive
// link), update the Match Centre embed in the SAME change — otherwise it silently
// shows "no stream/replay".
const youtubeUrl = z.union([
  z.literal(''),
  z.string().trim().refine((v) => parseYouTubeId(v) !== null, 'Enter a valid YouTube link'),
])

export const matchEditSchema = z.object({
  schedulingMode: z.enum(['timed', 'full_day']),
  scheduledAt: localDateTime,
  scheduledDate: localDate,
  streamUrl: youtubeUrl,
  replayUrl: youtubeUrl,
})

export type MatchEditInput = z.infer<typeof matchEditSchema>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/matches/edit-schema.test.ts`
Expected: PASS (all tests, existing + new)

- [ ] **Step 5: Commit**

```bash
git add lib/matches/edit-schema.ts lib/matches/edit-schema.test.ts
git commit -m "feat: #24 matchEditSchema gains schedulingMode + date-only field"
```

---

### Task 4: `lib/matches/admin-actions.ts` — `updateMatch` writes `is_full_day`

**Files:**
- Modify: `lib/matches/admin-actions.ts`

- [ ] **Step 1: Update the implementation**

```typescript
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { fromDateTimeLocal, fromDateLocal } from '@/lib/format'
import { matchEditSchema } from './edit-schema'

export type MatchAdminState = { error?: string; success?: boolean } | undefined

type SlugRef = { slug: string } | { slug: string }[] | null
type StatusSlugRef = { status: string; slug: string } | { status: string; slug: string }[] | null
function first<T>(x: T | T[] | null): T | null {
  return Array.isArray(x) ? x[0] ?? null : x
}

function revalidateMatch(matchId: string, tournamentId: string, slug: string | null): void {
  revalidatePath(`/admin/tournaments/${tournamentId}/matches`)
  revalidatePath(`/admin/tournaments/${tournamentId}/bracket`)
  revalidatePath(`/matches/${matchId}`)
  if (slug) {
    revalidatePath(`/tournaments/${slug}`)
    revalidatePath(`/tournaments/${slug}/bracket`)
  }
}

export async function updateMatch(
  _prev: MatchAdminState,
  formData: FormData,
): Promise<MatchAdminState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing match.' }

  const parsed = matchEditSchema.safeParse({
    schedulingMode: formData.get('schedulingMode') ?? 'timed',
    scheduledAt: formData.get('scheduledAt') ?? '',
    scheduledDate: formData.get('scheduledDate') ?? '',
    streamUrl: formData.get('streamUrl') ?? '',
    replayUrl: formData.get('replayUrl') ?? '',
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = createClient()
  const { data: m } = await supabase
    .from('matches')
    .select('id, tournament_id, tournament:tournaments(slug)')
    .eq('id', id)
    .maybeSingle()
  if (!m) return { error: 'Match not found.' }

  const isFullDay = parsed.data.schedulingMode === 'full_day'
  const scheduledAt = isFullDay
    ? fromDateLocal(parsed.data.scheduledDate)
    : fromDateTimeLocal(parsed.data.scheduledAt)

  const orNull = (v: string) => (v === '' ? null : v)
  const { error } = await supabase
    .from('matches')
    .update({
      scheduled_at: scheduledAt,
      is_full_day: isFullDay,
      youtube_stream_url: orNull(parsed.data.streamUrl),
      replay_url: orNull(parsed.data.replayUrl),
    })
    .eq('id', id)
  if (error) return { error: 'Could not save the match. Please try again.' }

  revalidateMatch(id, m.tournament_id, first(m.tournament as SlugRef)?.slug ?? null)
  return { success: true }
}

export async function toggleMatchLive(
  _prev: MatchAdminState,
  formData: FormData,
): Promise<MatchAdminState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing match.' }

  const supabase = createClient()
  const { data: m } = await supabase
    .from('matches')
    .select('id, status, tournament_id, tournament:tournaments(status, slug)')
    .eq('id', id)
    .maybeSingle()
  if (!m) return { error: 'Match not found.' }
  if (m.status !== 'scheduled' && m.status !== 'live')
    return { error: 'Only a scheduled or live match can be toggled.' }

  const t = first(m.tournament as StatusSlugRef)
  // tournaments.status has no 'cancelled' value; 'completed' is the operative guard.
  if (t?.status === 'completed') return { error: 'This tournament is completed.' }

  const next = m.status === 'live' ? 'scheduled' : 'live'
  const { error } = await supabase.from('matches').update({ status: next }).eq('id', id)
  if (error) return { error: 'Could not update the match status.' }

  revalidateMatch(id, m.tournament_id, t?.slug ?? null)
  return { success: true }
}
```

(Only `updateMatch` changed — the import line and the new `isFullDay`/`scheduledAt` derivation. `toggleMatchLive` is shown unchanged for context; no edit needed there.)

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors referencing this file

- [ ] **Step 3: Commit**

```bash
git add lib/matches/admin-actions.ts
git commit -m "feat: #24 updateMatch writes is_full_day from the new scheduling-mode toggle"
```

---

### Task 5: `components/admin/MatchRow.tsx` — scheduling-mode toggle UI

**Files:**
- Modify: `components/admin/MatchRow.tsx`

- [ ] **Step 1: Write the full updated component**

```tsx
'use client'
import { useState, type InputHTMLAttributes } from 'react'
import { useFormState } from 'react-dom'
import { updateMatch, toggleMatchLive, type MatchAdminState } from '@/lib/matches/admin-actions'

export interface AdminMatchRow {
  id: string
  playerAName: string
  playerBName: string | null // null => bye
  status: string
  scheduledAt: string // datetime-local value ('' if none)
  isFullDay: boolean
  streamUrl: string
  replayUrl: string
}

export function MatchRow({ match }: { match: AdminMatchRow }) {
  const [saveState, saveAction] = useFormState<MatchAdminState, FormData>(updateMatch, undefined)
  const [liveState, liveAction] = useFormState<MatchAdminState, FormData>(
    toggleMatchLive,
    undefined,
  )
  const [mode, setMode] = useState<'timed' | 'full_day'>(match.isFullDay ? 'full_day' : 'timed')

  if (match.status === 'bye' || match.playerBName === null) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <p className="font-bold text-white">{match.playerAName}</p>
        <p className="mt-0.5 text-xs text-slate-500">Bye — auto-advances</p>
      </div>
    )
  }

  const canToggle = match.status === 'scheduled' || match.status === 'live'
  const err = saveState?.error || liveState?.error

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="min-w-0 truncate font-bold text-white">
          {match.playerAName} <span className="text-slate-500">vs</span> {match.playerBName}
        </p>
        <span className="shrink-0 text-xs font-semibold text-slate-400">{match.status}</span>
      </div>

      <form action={saveAction} className="grid gap-3 sm:grid-cols-3">
        <input type="hidden" name="id" value={match.id} />
        <div className="flex items-center gap-3 text-xs sm:col-span-3">
          <label className="flex items-center gap-1.5 text-slate-400">
            <input
              type="radio"
              name="schedulingMode"
              value="timed"
              checked={mode === 'timed'}
              onChange={() => setMode('timed')}
            />
            Timed
          </label>
          <label className="flex items-center gap-1.5 text-slate-400">
            <input
              type="radio"
              name="schedulingMode"
              value="full_day"
              checked={mode === 'full_day'}
              onChange={() => setMode('full_day')}
            />
            Full day
          </label>
        </div>
        {mode === 'timed' ? (
          <Field label="Schedule" name="scheduledAt" type="datetime-local" defaultValue={match.scheduledAt} />
        ) : (
          <Field label="Date" name="scheduledDate" type="date" defaultValue={match.scheduledAt.slice(0, 10)} />
        )}
        <Field label="Stream URL" name="streamUrl" type="url" defaultValue={match.streamUrl} placeholder="YouTube link" />
        <Field label="Replay URL" name="replayUrl" type="url" defaultValue={match.replayUrl} placeholder="YouTube link" />
        <div className="flex items-center gap-2 sm:col-span-3">
          <button
            type="submit"
            className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-bold text-white hover:bg-violet-500"
          >
            Save
          </button>
          {saveState?.success && <span className="text-xs text-emerald-400">Saved.</span>}
        </div>
      </form>

      {canToggle && (
        <form action={liveAction} className="mt-2">
          <input type="hidden" name="id" value={match.id} />
          <button
            type="submit"
            className={`rounded-lg px-4 py-2 text-xs font-bold ${
              match.status === 'live'
                ? 'border border-slate-700 text-slate-200 hover:border-slate-500'
                : 'bg-red-600 text-white hover:bg-red-500'
            }`}
          >
            {match.status === 'live' ? 'End live' : 'Go live'}
          </button>
        </form>
      )}

      {err && <p className="mt-2 text-xs text-red-400">{err}</p>}
    </div>
  )
}

function Field({
  label,
  name,
  type = 'text',
  ...rest
}: { label: string; name: string; type?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="text-xs font-medium text-slate-400">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        {...rest}
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
      />
    </div>
  )
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add components/admin/MatchRow.tsx
git commit -m "feat: #24 timed/full-day scheduling toggle on the admin match row"
```

---

### Task 6: `app/admin/tournaments/[id]/matches/page.tsx` — pass `isFullDay` through

**Files:**
- Modify: `app/admin/tournaments/[id]/matches/page.tsx`

- [ ] **Step 1: Update the query and row mapping**

Add `is_full_day` to the select string:

```typescript
  const { data } = await supabase
    .from('matches')
    .select(
      'id, round, group_id, status, scheduled_at, is_full_day, youtube_stream_url, replay_url, ' +
        'player_a:profiles!matches_player_a_id_fkey(username, display_name), ' +
        'player_b:profiles!matches_player_b_id_fkey(username, display_name), ' +
        'groups(name)',
    )
    .eq('tournament_id', t.id)
```

Add `is_full_day: boolean` to the raw row cast type, and `isFullDay: m.is_full_day` to the mapped row:

```typescript
  const all = ((data as unknown[] | null) ?? []).map((raw) => {
    const m = raw as {
      id: string
      round: string
      status: string
      scheduled_at: string | null
      is_full_day: boolean
      youtube_stream_url: string | null
      replay_url: string | null
      player_a: ProfileRef
      player_b: ProfileRef
      groups: GroupRef
    }
    return {
      round: m.round,
      groupName: groupNameOf(m.groups),
      row: {
        id: m.id,
        playerAName: nameOf(m.player_a) ?? 'TBD',
        playerBName: nameOf(m.player_b),
        status: m.status,
        scheduledAt: toDateTimeLocal(m.scheduled_at),
        isFullDay: m.is_full_day,
        streamUrl: m.youtube_stream_url ?? '',
        replayUrl: m.replay_url ?? '',
      } as AdminMatchRow,
    }
  })
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add "app/admin/tournaments/[id]/matches/page.tsx"
git commit -m "feat: #24 matches admin page passes is_full_day through to MatchRow"
```

---

### Task 7: `lib/matches/review-queue.ts` — exclude full-day, include auto-expired

**Files:**
- Modify: `lib/matches/review-queue.ts`
- Modify: `lib/matches/review-queue.test.ts`

- [ ] **Step 1: Write the failing tests**

Update the `m()` fixture and add new tests in `lib/matches/review-queue.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { bucketReviewQueue, type ReviewMatchInput } from './review-queue'

const NOW = new Date('2026-07-08T12:00:00Z')

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
  it('excludes a full-day match still within its day, even though scheduledAt <= now', () => {
    const r = bucketReviewQueue(
      [m({ id: 'fd', submissionCount: 0, scheduledAt: '2026-07-08T00:00:00Z', isFullDay: true })],
      NOW,
    )
    expect(r.needsReview.concat(r.noSubmission, r.disputed)).toEqual([])
  })
  it('routes an auto-expired match to No submission', () => {
    const r = bucketReviewQueue(
      [m({ id: 'ax', status: 'cancelled', autoExpired: true, submissionCount: 0 })],
      NOW,
    )
    expect(r.noSubmission.map((x) => x.id)).toEqual(['ax'])
  })
  it('excludes a cancelled match that was not auto-expired', () => {
    const r = bucketReviewQueue(
      [m({ id: 'c', status: 'cancelled', autoExpired: false, submissionCount: 0 })],
      NOW,
    )
    expect(r.needsReview.concat(r.noSubmission, r.disputed)).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/matches/review-queue.test.ts`
Expected: FAIL — TS error (`isFullDay`/`autoExpired` not on `ReviewMatchInput`) and the two new behavioral tests failing

- [ ] **Step 3: Update the implementation**

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

// Split matches (already limited to status scheduled/live/disputed/cancelled) into three
// actionable buckets. `now` is injected for deterministic tests.
//
// Full-day matches are deliberately excluded from the time-based "no submission"
// check below — scheduledAt is midnight for them, so scheduledAt <= now would go
// true the instant the day STARTS, not ends. Instead, the "has the day ended"
// boundary is enforced entirely by expire_full_day_matches() (a Postgres cron
// job — see the #24 design spec): it only sets autoExpired once the day has
// actually passed, and THAT is what routes a full-day match into this queue.
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
      !mt.isFullDay &&
      mt.submissionCount === 0 &&
      mt.scheduledAt != null &&
      new Date(mt.scheduledAt).getTime() <= now.getTime()
    ) {
      noSubmission.push(mt)
    } else if (mt.status === 'cancelled' && mt.autoExpired && mt.submissionCount === 0) {
      noSubmission.push(mt)
    }
    // else: future scheduled / live-with-no-submission / full-day-still-in-progress
    // / cancelled-but-not-auto-expired -> excluded
  }
  return { needsReview, noSubmission, disputed }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/matches/review-queue.test.ts`
Expected: PASS (all 7 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/matches/review-queue.ts lib/matches/review-queue.test.ts
git commit -m "feat: #24 review queue excludes in-progress full-day matches, includes auto-expired ones"
```

---

### Task 8: `app/admin/results/page.tsx` — widen the query to include cancelled/auto-expired

**Files:**
- Modify: `app/admin/results/page.tsx`

- [ ] **Step 1: Widen the status filter and select new columns**

```typescript
  const { data } = await supabase
    .from('matches')
    .select(
      'id, round, status, scheduled_at, is_full_day, auto_expired, tournament_id, ' +
        'player_a:profiles!matches_player_a_id_fkey(id, username, display_name), ' +
        'player_b:profiles!matches_player_b_id_fkey(id, username, display_name), ' +
        'tournament:tournaments(title, slug), ' +
        'match_results(count)',
    )
    .in('status', ['scheduled', 'live', 'disputed', 'cancelled'])
```

Update the raw-row cast type and the `ReviewMatchInput` construction:

```typescript
  const rows: ReviewMatchInput[] = rawRows.map((raw) => {
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
      playerAName: nameOf(m.player_a),
      playerBName: nameOf(m.player_b),
      playerAClubName: m.player_a?.id ? clubByKey.get(`${m.tournament_id}:${m.player_a.id}`) ?? null : null,
      playerBClubName: m.player_b?.id ? clubByKey.get(`${m.tournament_id}:${m.player_b.id}`) ?? null : null,
      tournamentTitle: t?.title ?? 'Tournament',
      tournamentSlug: t?.slug ?? '',
    }
  })
```

(No filtering-out of non-auto-expired cancelled rows is needed here — `bucketReviewQueue` from Task 7 already drops any row that doesn't match one of its three bucket conditions, including a hypothetical `cancelled`-but-not-`auto_expired` row.)

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add "app/admin/results/page.tsx"
git commit -m "feat: #24 admin results page fetches cancelled/auto-expired matches too"
```

---

### Task 9: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test -- --run`
Expected: all tests pass

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: `✔ No ESLint warnings or errors`

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output (clean)

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: build succeeds

- [ ] **Step 5: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: #24 full-day scheduling verification fixes"
```

(Skip this step if Steps 1–4 passed clean with no changes needed.)

---

### Task 10: Cron activation — out-of-band, manual, after Task 1 lands

**Files:** none (operational step, not code)

- [ ] **Step 1: Verify `pg_cron` is enabled**

`pg_cron` was enabled in migration `011_notifications.sql` for the fixture-reminder job. Confirm it's still active — via `mcp__claude_ai_Supabase__execute_sql` (project_id `itxubrkbropttfdackmi`):

```sql
select extname from pg_extension where extname = 'pg_cron';
```

If it returns no rows, enable it first:

```sql
CREATE EXTENSION IF NOT EXISTS pg_cron;
```

- [ ] **Step 2: Schedule the job**

Run this once against the live project (**ask the user to confirm before running** — this is a standing scheduled job, not a one-off query):

```sql
select cron.schedule(
  'expire-full-day-matches',
  '0 * * * *',  -- hourly
  $$ select public.expire_full_day_matches(); $$
);
```

- [ ] **Step 3: Report to the user**

No commit for this task — confirm to the user that the job is scheduled and report the `cron.schedule` return value (the job ID).
