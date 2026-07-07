# Admin Match Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give staff a per-tournament matches page to set each match's schedule time, YouTube stream/replay URLs, and toggle it live.

**Architecture:** A zod schema (reusing `parseYouTubeId`) validates edits; two `requireStaff` server actions update fields and toggle live status (each fetching the tournament slug server-side for revalidation); a client `MatchRow` renders inline inputs; a page lists matches grouped by round. No DB migration.

**Tech Stack:** Next.js 14.2 App Router, TypeScript, Tailwind, Supabase server client, zod, Vitest. Forms use `useFormState` from `react-dom`.

## Global Constraints

- Mobile-first; only `MatchRow` is `"use client"`.
- All actions `requireStaff`; both re-check status server-side and read the tournament slug server-side (never from the client) for revalidation.
- Field edits (schedule/URLs) allowed in any non-bye status; the **live toggle** only when the match status is `scheduled` or `live`, and refused when the tournament status is `completed` (`tournaments.status` has no `'cancelled'` value).
- Stream and replay URLs are **YouTube-only** (validated by `parseYouTubeId`) because the Match Centre embeds them via the same helper — paired sync comments in `edit-schema.ts` and the Match Centre video section.
- Bye rows (`status='bye'` / null opponent) render read-only.
- Empty field → stored `null`.
- Do NOT mark roadmap #9 done (sub-project 4 of 6).
- Test: `npx vitest run <path>`. Type: `npx tsc --noEmit`. Lint: `npx next lint --file <path>`. Build: `npm run build`.
- Each commit message ends with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

### Task 1: Match edit schema + Match Centre sync comment

**Files:**
- Create: `lib/matches/edit-schema.ts`
- Create: `lib/matches/edit-schema.test.ts`
- Modify: `app/(public)/matches/[id]/page.tsx` (add the sync comment only)

**Interfaces:**
- Consumes: `parseYouTubeId` from `./youtube`.
- Produces: `matchEditSchema`, `type MatchEditInput` for Task 2.

- [ ] **Step 1: Write the failing test**

Create `lib/matches/edit-schema.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { matchEditSchema } from './edit-schema'

const valid = {
  scheduledAt: '2026-08-01T18:00',
  streamUrl: 'https://youtu.be/abcdefghijk',
  replayUrl: '',
}

describe('matchEditSchema', () => {
  it('accepts a schedule + youtube stream and an empty replay', () => {
    expect(matchEditSchema.safeParse(valid).success).toBe(true)
  })
  it('accepts all-empty fields (everything is clearable)', () => {
    expect(
      matchEditSchema.safeParse({ scheduledAt: '', streamUrl: '', replayUrl: '' }).success,
    ).toBe(true)
  })
  it('accepts a watch?v= url', () => {
    expect(
      matchEditSchema.safeParse({
        ...valid,
        streamUrl: 'https://www.youtube.com/watch?v=abcdefghijk',
      }).success,
    ).toBe(true)
  })
  it('rejects a non-youtube stream url', () => {
    expect(
      matchEditSchema.safeParse({ ...valid, streamUrl: 'https://drive.google.com/file/d/x' })
        .success,
    ).toBe(false)
  })
  it('rejects a non-youtube replay url', () => {
    expect(matchEditSchema.safeParse({ ...valid, replayUrl: 'https://example.com/clip' }).success).toBe(
      false,
    )
  })
  it('rejects a malformed scheduledAt', () => {
    expect(matchEditSchema.safeParse({ ...valid, scheduledAt: 'soon' }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/matches/edit-schema.test.ts`
Expected: FAIL — cannot find module `./edit-schema`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/matches/edit-schema.ts`:

```typescript
import { z } from 'zod'
import { parseYouTubeId } from './youtube'

const localDateTime = z.union([
  z.literal(''),
  z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Enter a valid date and time'),
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
  scheduledAt: localDateTime,
  streamUrl: youtubeUrl,
  replayUrl: youtubeUrl,
})

export type MatchEditInput = z.infer<typeof matchEditSchema>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/matches/edit-schema.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Add the paired sync comment to the Match Centre**

In `app/(public)/matches/[id]/page.tsx`, add a comment directly above the `<VideoEmbed …>` line
(inside the `{/* Video */}` block):

```tsx
      {/* Video */}
      <div className="mb-6">
        {/* youtube_stream_url / replay_url are YouTube-only — validated by
            matchEditSchema (lib/matches/edit-schema.ts) via parseYouTubeId.
            If that validation changes, update this embed in the same change. */}
        <VideoEmbed streamUrl={m.youtube_stream_url} replayUrl={m.replay_url} isLive={m.status === 'live'} />
      </div>
```

- [ ] **Step 6: Verify and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add lib/matches/edit-schema.ts lib/matches/edit-schema.test.ts "app/(public)/matches/[id]/page.tsx"
git commit -m "$(cat <<'EOF'
feat: match edit schema (YouTube-only URLs)

matchEditSchema validates datetime-local + YouTube stream/replay via
parseYouTubeId. Paired sync comment on the Match Centre embed.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Match admin server actions

**Files:**
- Create: `lib/matches/admin-actions.ts`

**Interfaces:**
- Consumes: `requireStaff` (`@/lib/admin/auth`), `createClient` (`@/lib/supabase/server`), `matchEditSchema` (Task 1).
- Produces: `type MatchAdminState`, `updateMatch`, `toggleMatchLive` for Task 3.

Verified via `tsc`/`lint`; exercised by the Task 4 build. Uses the user's session client — RLS `matches_staff_update` permits staff updates.

- [ ] **Step 1: Write the implementation**

Create `lib/matches/admin-actions.ts`:

```typescript
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
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
    scheduledAt: formData.get('scheduledAt') ?? '',
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

  const orNull = (v: string) => (v === '' ? null : v)
  const { error } = await supabase
    .from('matches')
    .update({
      scheduled_at: orNull(parsed.data.scheduledAt),
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

- [ ] **Step 2: Verify types and lint**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npx next lint --file lib/matches/admin-actions.ts`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add lib/matches/admin-actions.ts
git commit -m "$(cat <<'EOF'
feat: match admin server actions

updateMatch (schedule + YouTube URLs) and toggleMatchLive (scheduled<->live,
guarded by match + tournament status). Slug fetched server-side.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: MatchRow component

**Files:**
- Create: `components/admin/MatchRow.tsx`

**Interfaces:**
- Consumes: `updateMatch`, `toggleMatchLive`, `MatchAdminState` (Task 2).
- Produces: `MatchRow({ match })` and `interface AdminMatchRow` for Task 4.

- [ ] **Step 1: Create the component**

```tsx
'use client'
import type { InputHTMLAttributes } from 'react'
import { useFormState } from 'react-dom'
import { updateMatch, toggleMatchLive, type MatchAdminState } from '@/lib/matches/admin-actions'

export interface AdminMatchRow {
  id: string
  playerAName: string
  playerBName: string | null // null => bye
  status: string
  scheduledAt: string // datetime-local value ('' if none)
  streamUrl: string
  replayUrl: string
}

export function MatchRow({ match }: { match: AdminMatchRow }) {
  const [saveState, saveAction] = useFormState<MatchAdminState, FormData>(updateMatch, undefined)
  const [liveState, liveAction] = useFormState<MatchAdminState, FormData>(
    toggleMatchLive,
    undefined,
  )

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
        <Field label="Schedule" name="scheduledAt" type="datetime-local" defaultValue={match.scheduledAt} />
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

- [ ] **Step 2: Verify types and lint**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npx next lint --file components/admin/MatchRow.tsx`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add components/admin/MatchRow.tsx
git commit -m "$(cat <<'EOF'
feat: MatchRow admin component

Inline schedule + YouTube URL editing with per-row Save, a status-gated
live toggle, and a read-only rendering for bye rows.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Matches page + navigation links

**Files:**
- Create: `app/admin/tournaments/[id]/matches/page.tsx`
- Modify: `components/admin/TournamentListRow.tsx` (add a Matches link)
- Modify: `app/admin/tournaments/[id]/bracket/page.tsx` (add a Manage matches link)

**Interfaces:**
- Consumes: `requireStaff`, `ROUND_ORDER`/`ROUND_LABELS` (`@/lib/tournaments/bracket`), `MatchRow`/`AdminMatchRow` (Task 3), `createClient`.

- [ ] **Step 1: Create the matches page**

Create `app/admin/tournaments/[id]/matches/page.tsx`:

```tsx
import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { ROUND_ORDER, ROUND_LABELS } from '@/lib/tournaments/bracket'
import { MatchRow, type AdminMatchRow } from '@/components/admin/MatchRow'

export const metadata: Metadata = { title: 'Matches · Admin · SentinelX' }

type ProfileRef = { username: string | null; display_name: string | null } | null
type GroupRef = { name: string } | { name: string }[] | null
function nameOf(p: ProfileRef): string | null {
  return p ? p.display_name ?? p.username ?? 'TBD' : null
}
function groupNameOf(g: GroupRef): string | null {
  return Array.isArray(g) ? g[0]?.name ?? null : g?.name ?? null
}
function toLocalInput(iso: string | null): string {
  return iso ? iso.slice(0, 16) : ''
}

export default async function AdminMatchesPage({ params }: { params: { id: string } }) {
  await requireStaff()
  const supabase = createClient()
  const { data: t } = await supabase
    .from('tournaments')
    .select('id, title')
    .eq('id', params.id)
    .maybeSingle()
  if (!t) notFound()

  const { data } = await supabase
    .from('matches')
    .select(
      'id, round, group_id, status, scheduled_at, youtube_stream_url, replay_url, ' +
        'player_a:profiles!matches_player_a_id_fkey(username, display_name), ' +
        'player_b:profiles!matches_player_b_id_fkey(username, display_name), ' +
        'groups(name)',
    )
    .eq('tournament_id', t.id)

  const all = ((data as unknown[] | null) ?? []).map((raw) => {
    const m = raw as {
      id: string
      round: string
      status: string
      scheduled_at: string | null
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
        scheduledAt: toLocalInput(m.scheduled_at),
        streamUrl: m.youtube_stream_url ?? '',
        replayUrl: m.replay_url ?? '',
      } as AdminMatchRow,
    }
  })

  const groupMatches = all.filter((x) => x.round === 'group')
  const groupNames = [...new Set(groupMatches.map((x) => x.groupName).filter(Boolean))].sort() as string[]
  const groupSections = groupNames.map((gn) => ({
    label: gn,
    rows: groupMatches.filter((x) => x.groupName === gn).map((x) => x.row),
  }))
  const knockoutSections = ROUND_ORDER.map((r) => ({
    label: ROUND_LABELS[r] ?? r,
    rows: all.filter((x) => x.round === r).map((x) => x.row),
  })).filter((s) => s.rows.length > 0)
  const sections = [...groupSections, ...knockoutSections]

  return (
    <section>
      <Link href="/admin/tournaments" className="text-sm text-violet-400 hover:text-violet-300">
        ← Tournaments
      </Link>
      <h2 className="mb-4 mt-2 text-base font-bold text-white">{t.title} · Matches</h2>

      {sections.length === 0 ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center text-sm text-slate-500">
          No matches yet.{' '}
          <Link href={`/admin/tournaments/${t.id}/bracket`} className="text-violet-400">
            Generate the bracket first.
          </Link>
        </p>
      ) : (
        <div className="space-y-8">
          {sections.map((s) => (
            <div key={s.label}>
              <h3 className="mb-3 text-[11px] font-bold uppercase tracking-widest text-slate-500">
                {s.label}
              </h3>
              <div className="space-y-3">
                {s.rows.map((row) => (
                  <MatchRow key={row.id} match={row} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 2: Add the Matches link to the tournament row**

In `components/admin/TournamentListRow.tsx`, immediately after the Bracket `Link` (added in
sub-project 3), add:

```tsx
          <Link
            href={`/admin/tournaments/${t.id}/matches`}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-300 hover:border-slate-500"
          >
            Matches
          </Link>
```

- [ ] **Step 3: Add a Manage matches link on the admin bracket page**

In `app/admin/tournaments/[id]/bracket/page.tsx`, replace the back-link line

```tsx
      <Link href="/admin/tournaments" className="text-sm text-violet-400 hover:text-violet-300">
        ← Tournaments
      </Link>
```

with a two-link row:

```tsx
      <div className="flex items-center justify-between">
        <Link href="/admin/tournaments" className="text-sm text-violet-400 hover:text-violet-300">
          ← Tournaments
        </Link>
        <Link
          href={`/admin/tournaments/${t.id}/matches`}
          className="text-sm text-violet-400 hover:text-violet-300"
        >
          Manage matches →
        </Link>
      </div>
```

- [ ] **Step 4: Verify types and lint**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npx next lint --file "app/admin/tournaments/[id]/matches/page.tsx" --file components/admin/TournamentListRow.tsx --file "app/admin/tournaments/[id]/bracket/page.tsx"`
Expected: clean.

- [ ] **Step 5: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — all suites including `lib/matches/edit-schema.test.ts`.

- [ ] **Step 6: Production build**

Run: `npm run build`
Expected: build succeeds; `/admin/tournaments/[id]/matches` appears in the route list.

- [ ] **Step 7: Commit**

```bash
git add "app/admin/tournaments/[id]/matches" components/admin/TournamentListRow.tsx "app/admin/tournaments/[id]/bracket/page.tsx"
git commit -m "$(cat <<'EOF'
feat: admin matches page (#9 sub-project 4)

Per-tournament matches grouped by round with inline schedule/URL/live
controls, plus Matches / Manage matches nav links.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- `matchEditSchema` (datetime-local + YouTube-only via `parseYouTubeId`) + paired sync comments → Task 1. ✅
- `updateMatch` (fields, empty→null, server-side slug) + `toggleMatchLive` (match-status gate + tournament-`completed` gate, server-side slug) → Task 2. ✅
- `MatchRow`: inline inputs + per-row Save, status-gated live toggle, read-only bye → Task 3. ✅
- Matches page grouped by round (groups then knockout via `ROUND_ORDER`), bye rows read-only, empty-state → Task 4. ✅
- Matches link on the tournament row + Manage matches on the bracket page → Task 4. ✅
- No migration; #9 not marked done → honored. ✅

**Placeholder scan:** No "TBD" (only as a runtime name fallback), no "handle edge cases", no "similar to" — full code in every step. ✅

**Type consistency:** `matchEditSchema` (T1) consumed in T2. `MatchAdminState` + `updateMatch`/`toggleMatchLive` (T2) consumed by `MatchRow` (T3). `AdminMatchRow` (T3) built by the page (T4). Column names (`scheduled_at`, `youtube_stream_url`, `replay_url`, `status`, `group_id`) verified against `lib/supabase/types.ts`; `ROUND_ORDER`/`ROUND_LABELS` exist in `lib/tournaments/bracket.ts`. ✅

Note: `updateMatch`/`toggleMatchLive` use the user's session client (not the service-role client) because RLS `matches_staff_update` already scopes updates to staff — no need to bypass RLS here, unlike bracket generation's bulk writes.
