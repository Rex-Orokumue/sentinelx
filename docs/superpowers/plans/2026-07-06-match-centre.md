# Match Centre Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the public Match Centre (`/matches/[id]`) with a YouTube stream/replay embed and a participant-only result-submission panel (score + screenshot-to-Storage + optional recording URL) feeding admin verification.

**Architecture:** A Server Component page fetches the match + players, classifies the viewer as participant or not, and renders header/video/result-status plus (for participants) a client submission form. The form uploads the screenshot to a private Storage bucket, then a Server Action upserts a `match_results` row (editable while `pending`, auto-locked at `under_review`). Screenshots are shown via signed URLs generated fresh server-side each load. Pure logic (YouTube parsing, input schema) is TDD-tested.

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase (anon server client, browser client for upload, service-role for signed URLs), zod, Tailwind, vitest.

## Global Constraints

- Mobile-first, 375px up. Server Components by default; only the submission form is `"use client"`.
- **Screenshot required** (on first submit), **recording URL optional**.
- Submission **editable only while `status='pending'`**; locks at `under_review`. Upsert on `(match_id, submitted_by)`.
- Each participant sees **only their own** submission — never the opponent's.
- Screenshots are private: rendered via **signed URLs generated fresh server-side each page load** (TTL 3600s), never cached client-side.
- Storage object path: `{uid}/{matchId}/{timestamp}-{filename}`.
- Viewer classification for this page is **participant vs non-participant only** (staff review is #9).
- Public header score comes from `matches.score_a/score_b`; "result confirmed" = `matches.status === 'completed'`.
- Migrations `003`/`004` are applied to the live Supabase project (ref `itxubrkbropttfdackmi`) via Supabase MCP, and `lib/supabase/types.ts` is regenerated, **before** the code tasks.
- Tests colocated `*.test.ts`, vitest node env, pure-function style. Run `npm test`.
- FK embeds: `matches_player_a_id_fkey`, `matches_player_b_id_fkey`.

---

## File Structure

- Create `supabase/migrations/003_match_result_status.sql` — status column, unique, owner-update RLS.
- Create `supabase/migrations/004_match_evidence_storage.sql` — private bucket + object RLS.
- Modify `lib/supabase/types.ts` — regenerated (adds `match_results.status`).
- Create `lib/matches/youtube.ts` — `parseYouTubeId`, `youtubeEmbedUrl`.
- Create `lib/matches/schema.ts` — `submitResultSchema` (zod).
- Create `lib/matches/actions.ts` — `submitMatchResult` Server Action.
- Create `components/match/VideoEmbed.tsx` — presentational iframe.
- Create `components/match/ResultSubmissionForm.tsx` — client upload + submit.
- Create `app/(public)/matches/[id]/page.tsx` — assemble.
- Tests: `lib/matches/youtube.test.ts`, `lib/matches/schema.test.ts`.

---

## Task 1: Migrations + regenerated types

**Files:**
- Create: `supabase/migrations/003_match_result_status.sql`
- Create: `supabase/migrations/004_match_evidence_storage.sql`
- Modify: `lib/supabase/types.ts` (regenerated)

**Interfaces:**
- Produces: `match_results.status` column, `UNIQUE (match_id, submitted_by)`, RLS `mr_own_update_pending`, private bucket `match-evidence` with object RLS.

- [ ] **Step 1: Write `003_match_result_status.sql`**

```sql
-- Match-result submission workflow: status + one-row-per-participant + owner edit.
ALTER TABLE public.match_results
  ADD COLUMN status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'under_review', 'verified', 'disputed'));

ALTER TABLE public.match_results
  ADD CONSTRAINT match_results_match_submitter_unique UNIQUE (match_id, submitted_by);

-- A participant may edit their own submission only while it is still pending.
CREATE POLICY "mr_own_update_pending" ON public.match_results
  FOR UPDATE
  USING (submitted_by = auth.uid() AND status = 'pending')
  WITH CHECK (submitted_by = auth.uid());
```

- [ ] **Step 2: Write `004_match_evidence_storage.sql`**

```sql
-- Private bucket for match evidence screenshots.
INSERT INTO storage.buckets (id, name, public)
VALUES ('match-evidence', 'match-evidence', false)
ON CONFLICT (id) DO NOTHING;

-- Authenticated users may upload only into their own {uid}/... folder.
CREATE POLICY "match_evidence_insert_own"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'match-evidence'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Owner or staff may read (reads normally go through server-side signed URLs).
CREATE POLICY "match_evidence_select_own_or_staff"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'match-evidence'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.is_staff()
    )
  );
```

- [ ] **Step 3: Apply both migrations to the live project (Supabase MCP)**

Apply `003_match_result_status` and `004_match_evidence_storage` via `apply_migration`
against project `itxubrkbropttfdackmi`. Expected: both succeed with no error.

- [ ] **Step 4: Regenerate types**

Run `generate_typescript_types` for the project and overwrite `lib/supabase/types.ts`.

- [ ] **Step 5: Verify**

Run: `grep -n "status" lib/supabase/types.ts | head` → `match_results` Row now includes `status: string`.
Run: `npx tsc --noEmit` → clean.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/003_match_result_status.sql supabase/migrations/004_match_evidence_storage.sql lib/supabase/types.ts
git commit -m "feat: match_results.status workflow + private match-evidence bucket (migrations 003/004)"
```

---

## Task 2: YouTube helper

**Files:**
- Create: `lib/matches/youtube.ts`
- Test: `lib/matches/youtube.test.ts`

**Interfaces:**
- Produces:
  - `parseYouTubeId(url: string | null | undefined): string | null`
  - `youtubeEmbedUrl(id: string, opts?: { autoplay?: boolean }): string`

- [ ] **Step 1: Write the failing test**

Create `lib/matches/youtube.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseYouTubeId, youtubeEmbedUrl } from './youtube'

describe('parseYouTubeId', () => {
  it('parses watch?v= URLs', () => {
    expect(parseYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })
  it('parses youtu.be short URLs', () => {
    expect(parseYouTubeId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })
  it('parses /live/ URLs', () => {
    expect(parseYouTubeId('https://www.youtube.com/live/dQw4w9WgXcQ?feature=share')).toBe('dQw4w9WgXcQ')
  })
  it('parses /embed/ URLs', () => {
    expect(parseYouTubeId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })
  it('parses watch URLs with extra params', () => {
    expect(parseYouTubeId('https://www.youtube.com/watch?list=abc&v=dQw4w9WgXcQ&t=10s')).toBe('dQw4w9WgXcQ')
  })
  it('returns null for non-YouTube or junk', () => {
    expect(parseYouTubeId('https://example.com/video')).toBeNull()
    expect(parseYouTubeId('not a url')).toBeNull()
    expect(parseYouTubeId(null)).toBeNull()
    expect(parseYouTubeId('')).toBeNull()
  })
})

describe('youtubeEmbedUrl', () => {
  it('builds an embed URL', () => {
    expect(youtubeEmbedUrl('dQw4w9WgXcQ')).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ')
  })
  it('adds autoplay when requested', () => {
    expect(youtubeEmbedUrl('dQw4w9WgXcQ', { autoplay: true })).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/matches/youtube.test.ts`
Expected: FAIL — cannot resolve `./youtube`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/matches/youtube.ts`:

```ts
// Extracts an 11-char YouTube video id from the common URL shapes, or null.
export function parseYouTubeId(url: string | null | undefined): string | null {
  if (!url) return null
  const patterns = [
    /[?&]v=([A-Za-z0-9_-]{11})/, // watch?v=
    /youtu\.be\/([A-Za-z0-9_-]{11})/, // youtu.be/
    /\/live\/([A-Za-z0-9_-]{11})/, // /live/
    /\/embed\/([A-Za-z0-9_-]{11})/, // /embed/
    /\/shorts\/([A-Za-z0-9_-]{11})/, // /shorts/
  ]
  for (const re of patterns) {
    const m = url.match(re)
    if (m) return m[1]
  }
  return null
}

export function youtubeEmbedUrl(id: string, opts: { autoplay?: boolean } = {}): string {
  return `https://www.youtube.com/embed/${id}${opts.autoplay ? '?autoplay=1' : ''}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lib/matches/youtube.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Typecheck & commit**

Run: `npx tsc --noEmit` → clean.

```bash
git add lib/matches/youtube.ts lib/matches/youtube.test.ts
git commit -m "feat: parseYouTubeId + youtubeEmbedUrl helpers"
```

---

## Task 3: Result submission schema

**Files:**
- Create: `lib/matches/schema.ts`
- Test: `lib/matches/schema.test.ts`

**Interfaces:**
- Produces: `submitResultSchema` (zod object: `scoreA`, `scoreB` coerced ints 0–99; `recordingUrl` optional http(s) URL or `''`), `SubmitResultInput`.

- [ ] **Step 1: Write the failing test**

Create `lib/matches/schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { submitResultSchema } from './schema'

describe('submitResultSchema', () => {
  it('accepts valid scores with an empty recording URL', () => {
    const r = submitResultSchema.safeParse({ scoreA: '3', scoreB: '1', recordingUrl: '' })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.scoreA).toBe(3)
      expect(r.data.scoreB).toBe(1)
    }
  })

  it('accepts a valid https recording URL', () => {
    const r = submitResultSchema.safeParse({ scoreA: '2', scoreB: '2', recordingUrl: 'https://youtu.be/abc' })
    expect(r.success).toBe(true)
  })

  it('rejects negative scores', () => {
    expect(submitResultSchema.safeParse({ scoreA: '-1', scoreB: '0', recordingUrl: '' }).success).toBe(false)
  })

  it('rejects non-numeric scores', () => {
    expect(submitResultSchema.safeParse({ scoreA: 'x', scoreB: '0', recordingUrl: '' }).success).toBe(false)
  })

  it('rejects a non-http(s) recording URL', () => {
    expect(submitResultSchema.safeParse({ scoreA: '1', scoreB: '0', recordingUrl: 'ftp://x/y' }).success).toBe(false)
  })

  it('allows recordingUrl to be omitted', () => {
    expect(submitResultSchema.safeParse({ scoreA: '1', scoreB: '0' }).success).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/matches/schema.test.ts`
Expected: FAIL — cannot resolve `./schema`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/matches/schema.ts`:

```ts
import { z } from 'zod'

const scoreSchema = z.coerce
  .number()
  .int('Scores must be whole numbers')
  .min(0, 'Score cannot be negative')
  .max(99, 'Score is too large')

const recordingUrlSchema = z
  .string()
  .trim()
  .url('Enter a valid URL')
  .refine((v) => /^https?:\/\//i.test(v), 'Link must start with http:// or https://')

export const submitResultSchema = z.object({
  scoreA: scoreSchema,
  scoreB: scoreSchema,
  recordingUrl: z.union([recordingUrlSchema, z.literal('')]).optional(),
})

export type SubmitResultInput = z.infer<typeof submitResultSchema>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lib/matches/schema.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck & commit**

Run: `npx tsc --noEmit` → clean.

```bash
git add lib/matches/schema.ts lib/matches/schema.test.ts
git commit -m "feat: submitResultSchema (scores + optional http(s) recording URL)"
```

---

## Task 4: submitMatchResult Server Action

**Files:**
- Create: `lib/matches/actions.ts`

**Interfaces:**
- Consumes: `submitResultSchema` from `./schema`; `createClient` from `@/lib/supabase/server`.
- Produces:
  - `type SubmitResultState = { error?: string; success?: boolean } | undefined`
  - `submitMatchResult(_prev: SubmitResultState, formData: FormData): Promise<SubmitResultState>` (formData carries `matchId`, `screenshotPath`, `scoreA`, `scoreB`, `recordingUrl`)

- [ ] **Step 1: Write the action**

Create `lib/matches/actions.ts`:

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { submitResultSchema } from './schema'

export type SubmitResultState = { error?: string; success?: boolean } | undefined

export async function submitMatchResult(
  _prev: SubmitResultState,
  formData: FormData,
): Promise<SubmitResultState> {
  const matchId = String(formData.get('matchId') ?? '')
  const screenshotPath = String(formData.get('screenshotPath') ?? '')
  if (!matchId) return { error: 'Missing match.' }

  const parsed = submitResultSchema.safeParse({
    scoreA: formData.get('scoreA'),
    scoreB: formData.get('scoreB'),
    recordingUrl: formData.get('recordingUrl') ?? '',
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in to submit a result.' }

  const { data: match } = await supabase
    .from('matches')
    .select('id, player_a_id, player_b_id, status')
    .eq('id', matchId)
    .maybeSingle()
  if (!match) return { error: 'Match not found.' }
  if (user.id !== match.player_a_id && user.id !== match.player_b_id) {
    return { error: 'Only the players in this match can submit a result.' }
  }
  if (match.status === 'cancelled') return { error: 'This match was cancelled.' }
  if (match.status === 'completed') return { error: 'This match result is already confirmed.' }

  const { data: existing } = await supabase
    .from('match_results')
    .select('id, status, screenshot_url')
    .eq('match_id', matchId)
    .eq('submitted_by', user.id)
    .maybeSingle()

  if (existing && existing.status !== 'pending') {
    return { error: 'Your submission is under review and can no longer be edited.' }
  }

  const finalScreenshot = screenshotPath || existing?.screenshot_url || null
  if (!finalScreenshot) return { error: 'A screenshot is required.' }

  const recordingUrl =
    parsed.data.recordingUrl && parsed.data.recordingUrl !== '' ? parsed.data.recordingUrl : null

  const { error } = await supabase.from('match_results').upsert(
    {
      match_id: matchId,
      submitted_by: user.id,
      score_a: parsed.data.scoreA,
      score_b: parsed.data.scoreB,
      screenshot_url: finalScreenshot,
      recording_url: recordingUrl,
      status: 'pending',
    },
    { onConflict: 'match_id,submitted_by' },
  )
  if (error) return { error: 'Could not submit your result. Please try again.' }

  revalidatePath(`/matches/${matchId}`)
  return { success: true }
}
```

- [ ] **Step 2: Verify typecheck & lint**

Run: `npx tsc --noEmit` → clean (requires Task 1 types with `status`).
Run: `npm run lint` → no warnings/errors.

- [ ] **Step 3: Commit**

```bash
git add lib/matches/actions.ts
git commit -m "feat: submitMatchResult action (participant upsert, pending-lock, screenshot required)"
```

---

## Task 5: Video + submission form components

**Files:**
- Create: `components/match/VideoEmbed.tsx`
- Create: `components/match/ResultSubmissionForm.tsx`

**Interfaces:**
- Consumes: `parseYouTubeId`, `youtubeEmbedUrl` from `@/lib/matches/youtube`; `submitMatchResult`, `SubmitResultState` from `@/lib/matches/actions`; `createClient` from `@/lib/supabase/client`.
- Produces:
  - `VideoEmbed({ streamUrl: string | null; replayUrl: string | null; isLive: boolean })`
  - `ResultSubmissionForm({ matchId: string; playerAName: string; playerBName: string; initial: { scoreA: number | null; scoreB: number | null; recordingUrl: string | null; hasScreenshot: boolean } | null })`

- [ ] **Step 1: Write `VideoEmbed`**

Create `components/match/VideoEmbed.tsx`:

```tsx
import { parseYouTubeId, youtubeEmbedUrl } from '@/lib/matches/youtube'

export function VideoEmbed({
  streamUrl,
  replayUrl,
  isLive,
}: {
  streamUrl: string | null
  replayUrl: string | null
  isLive: boolean
}) {
  const src = isLive ? streamUrl : replayUrl ?? streamUrl
  const id = parseYouTubeId(src)

  if (!id) {
    return (
      <div className="flex aspect-video w-full items-center justify-center rounded-2xl border border-slate-800 bg-slate-900 text-sm text-slate-500">
        No stream or replay yet
      </div>
    )
  }

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-slate-800">
      {isLive && (
        <span className="absolute left-3 top-3 z-10 inline-flex items-center gap-1 rounded-full bg-red-500/90 px-2 py-0.5 text-[11px] font-bold text-white">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
          LIVE
        </span>
      )}
      <iframe
        src={youtubeEmbedUrl(id)}
        title="Match video"
        className="absolute inset-0 h-full w-full"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    </div>
  )
}
```

- [ ] **Step 2: Write `ResultSubmissionForm`**

Create `components/match/ResultSubmissionForm.tsx`:

```tsx
'use client'
import { useState, useTransition } from 'react'
import type { FormEvent } from 'react'
import { useFormState } from 'react-dom'
import { createClient } from '@/lib/supabase/client'
import { submitMatchResult, type SubmitResultState } from '@/lib/matches/actions'

export function ResultSubmissionForm({
  matchId,
  playerAName,
  playerBName,
  initial,
}: {
  matchId: string
  playerAName: string
  playerBName: string
  initial: { scoreA: number | null; scoreB: number | null; recordingUrl: string | null; hasScreenshot: boolean } | null
}) {
  const [state, formAction] = useFormState<SubmitResultState, FormData>(submitMatchResult, undefined)
  const [uploading, setUploading] = useState(false)
  const [clientError, setClientError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setClientError(null)
    const fd = new FormData(e.currentTarget)
    const file = fd.get('screenshot') as File | null
    fd.delete('screenshot')

    const hasNewFile = file && file.size > 0
    if (!hasNewFile && !initial?.hasScreenshot) {
      setClientError('A screenshot is required.')
      return
    }

    if (hasNewFile) {
      setUploading(true)
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        setUploading(false)
        setClientError('Please log in.')
        return
      }
      const safeName = file!.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `${user.id}/${matchId}/${Date.now()}-${safeName}`
      const { error } = await supabase.storage.from('match-evidence').upload(path, file!, { upsert: false })
      setUploading(false)
      if (error) {
        setClientError('Screenshot upload failed. Please try again.')
        return
      }
      fd.set('screenshotPath', path)
    } else {
      fd.set('screenshotPath', '')
    }

    fd.set('matchId', matchId)
    startTransition(() => formAction(fd))
  }

  if (state?.success) {
    return (
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5 text-center text-sm font-semibold text-emerald-400">
        ✓ Result submitted — awaiting admin review. You can edit it here until an admin opens it.
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <h2 className="text-base font-bold text-white">Submit your result</h2>

      <div className="flex items-end gap-3">
        <ScoreField label={playerAName} name="scoreA" defaultValue={initial?.scoreA ?? undefined} />
        <span className="pb-2 text-slate-500">–</span>
        <ScoreField label={playerBName} name="scoreB" defaultValue={initial?.scoreB ?? undefined} />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="screenshot" className="text-sm font-medium text-slate-300">
          Screenshot {initial?.hasScreenshot ? '(uploaded — choose a new file to replace)' : '(required)'}
        </label>
        <input
          id="screenshot"
          name="screenshot"
          type="file"
          accept="image/*"
          className="block w-full text-sm text-slate-400 file:mr-3 file:rounded-lg file:border-0 file:bg-violet-600 file:px-4 file:py-2 file:text-sm file:font-bold file:text-white hover:file:bg-violet-500"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="recordingUrl" className="text-sm font-medium text-slate-300">
          Recording URL <span className="text-slate-500">(optional — YouTube/Drive link)</span>
        </label>
        <input
          id="recordingUrl"
          name="recordingUrl"
          type="url"
          defaultValue={initial?.recordingUrl ?? ''}
          placeholder="https://…"
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
        />
      </div>

      {(clientError || state?.error) && (
        <p className="text-sm text-red-400">{clientError ?? state?.error}</p>
      )}

      <button
        type="submit"
        disabled={uploading}
        className="w-full rounded-xl bg-violet-600 px-7 py-3 text-sm font-bold text-white transition-colors hover:bg-violet-500 disabled:opacity-60"
      >
        {uploading ? 'Uploading…' : initial ? 'Update result' : 'Submit result'}
      </button>
    </form>
  )
}

function ScoreField({ label, name, defaultValue }: { label: string; name: string; defaultValue?: number }) {
  return (
    <div className="flex-1 space-y-1.5">
      <label htmlFor={name} className="block truncate text-xs font-medium text-slate-400">{label}</label>
      <input
        id={name}
        name={name}
        type="number"
        min={0}
        max={99}
        required
        defaultValue={defaultValue}
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-center text-lg font-bold text-white focus:border-violet-500 focus:outline-none"
      />
    </div>
  )
}
```

- [ ] **Step 3: Verify typecheck & lint**

Run: `npx tsc --noEmit` → clean.
Run: `npm run lint` → no warnings/errors.

- [ ] **Step 4: Commit**

```bash
git add components/match/VideoEmbed.tsx components/match/ResultSubmissionForm.tsx
git commit -m "feat: VideoEmbed + ResultSubmissionForm (upload screenshot, submit result)"
```

---

## Task 6: Match Centre page

**Files:**
- Create: `app/(public)/matches/[id]/page.tsx`

**Interfaces:**
- Consumes: `createClient` from `@/lib/supabase/server`; `createAdminClient` from `@/lib/supabase/admin`; `VideoEmbed`, `ResultSubmissionForm`.

- [ ] **Step 1: Write the page**

Create `app/(public)/matches/[id]/page.tsx`:

```tsx
import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { VideoEmbed } from '@/components/match/VideoEmbed'
import { ResultSubmissionForm } from '@/components/match/ResultSubmissionForm'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sentinelx.gg'

type ProfileRef = { username: string | null; display_name: string | null } | null

function nameOf(p: ProfileRef): string {
  return p?.display_name ?? p?.username ?? 'TBD'
}

const STATUS: Record<string, { label: string; cls: string }> = {
  scheduled: { label: 'SCHEDULED', cls: 'bg-slate-600/30 text-slate-300 border-slate-600/40' },
  live:      { label: 'LIVE',      cls: 'bg-red-500/20 text-red-400 border-red-500/30' },
  completed: { label: 'FULL TIME', cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  disputed:  { label: 'DISPUTED',  cls: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
  cancelled: { label: 'CANCELLED', cls: 'bg-slate-700/40 text-slate-500 border-slate-700/50' },
}

const MATCH_SELECT =
  'id, round, status, score_a, score_b, youtube_stream_url, replay_url, player_a_id, player_b_id, ' +
  'tournaments(title, slug), ' +
  'player_a:profiles!matches_player_a_id_fkey(username, display_name), ' +
  'player_b:profiles!matches_player_b_id_fkey(username, display_name)'

async function getMatch(id: string) {
  const supabase = createClient()
  const { data } = await supabase.from('matches').select(MATCH_SELECT).eq('id', id).maybeSingle()
  return data as
    | {
        id: string
        round: string
        status: string
        score_a: number | null
        score_b: number | null
        youtube_stream_url: string | null
        replay_url: string | null
        player_a_id: string
        player_b_id: string
        tournaments: { title: string; slug: string } | null
        player_a: ProfileRef
        player_b: ProfileRef
      }
    | null
}

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const m = await getMatch(params.id)
  if (!m) return { title: 'Match — Sentinel X' }
  const title = `${nameOf(m.player_a)} vs ${nameOf(m.player_b)} — Sentinel X`
  const description = m.tournaments ? `${m.tournaments.title} on Sentinel X.` : 'Mobile esports match on Sentinel X.'
  return {
    title,
    description,
    openGraph: { title, description, url: `${SITE_URL}/matches/${m.id}`, siteName: 'Sentinel X', type: 'website' },
  }
}

export default async function MatchCentrePage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const m = await getMatch(params.id)
  if (!m) notFound()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  const isParticipant = !!user && (user.id === m.player_a_id || user.id === m.player_b_id)

  // Participant's own submission only (never the opponent's).
  let myResult:
    | { score_a: number | null; score_b: number | null; recording_url: string | null; screenshot_url: string | null; status: string }
    | null = null
  if (isParticipant) {
    const { data } = await supabase
      .from('match_results')
      .select('score_a, score_b, recording_url, screenshot_url, status')
      .eq('match_id', m.id)
      .eq('submitted_by', user!.id)
      .maybeSingle()
    myResult = data
  }

  // Signed URL for the participant's own screenshot — generated fresh each load.
  let screenshotUrl: string | null = null
  if (myResult?.screenshot_url) {
    const admin = createAdminClient()
    const { data } = await admin.storage.from('match-evidence').createSignedUrl(myResult.screenshot_url, 3600)
    screenshotUrl = data?.signedUrl ?? null
  }

  const status = STATUS[m.status] ?? STATUS.scheduled
  const resultConfirmed = m.status === 'completed'
  const showScore = m.score_a != null && m.score_b != null
  const canSubmit =
    isParticipant && m.status !== 'cancelled' && !resultConfirmed && (!myResult || myResult.status === 'pending')
  const shareText = `${nameOf(m.player_a)} vs ${nameOf(m.player_b)} on Sentinel X 🎮 ${SITE_URL}/matches/${m.id}`

  return (
    <div className="mx-auto max-w-3xl px-4 pb-20">
      {m.tournaments && (
        <Link
          href={`/tournaments/${m.tournaments.slug}`}
          className="mt-6 mb-4 inline-block text-sm text-violet-400 hover:text-violet-300"
        >
          ← {m.tournaments.title}
        </Link>
      )}

      {/* Header */}
      <div className="mb-6 rounded-2xl border border-slate-800 bg-slate-900 p-6">
        <div className="mb-3 flex justify-center">
          <span className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${status.cls}`}>{status.label}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <p className="flex-1 text-right text-lg font-bold text-white">{nameOf(m.player_a)}</p>
          <p className="shrink-0 text-2xl font-black tabular-nums text-white">
            {showScore ? `${m.score_a} – ${m.score_b}` : 'vs'}
          </p>
          <p className="flex-1 text-left text-lg font-bold text-white">{nameOf(m.player_b)}</p>
        </div>
      </div>

      {/* Video */}
      <div className="mb-6">
        <VideoEmbed streamUrl={m.youtube_stream_url} replayUrl={m.replay_url} isLive={m.status === 'live'} />
      </div>

      {/* Result confirmed banner */}
      {resultConfirmed && (
        <div className="mb-6 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-4 text-center text-sm font-semibold text-emerald-400">
          ✅ Result confirmed by an admin.
        </div>
      )}

      {/* Participant: submission form or locked status */}
      {isParticipant && canSubmit && (
        <div className="mb-6">
          <ResultSubmissionForm
            matchId={m.id}
            playerAName={nameOf(m.player_a)}
            playerBName={nameOf(m.player_b)}
            initial={
              myResult
                ? {
                    scoreA: myResult.score_a,
                    scoreB: myResult.score_b,
                    recordingUrl: myResult.recording_url,
                    hasScreenshot: !!myResult.screenshot_url,
                  }
                : null
            }
          />
        </div>
      )}

      {isParticipant && myResult && !canSubmit && !resultConfirmed && (
        <div className="mb-6 rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <p className="text-sm font-bold text-white">
            Your submission — {myResult.status === 'under_review' ? 'under admin review' : myResult.status}
          </p>
          <p className="mt-1 text-sm text-slate-400">
            You reported {myResult.score_a} – {myResult.score_b}.
          </p>
          {screenshotUrl && (
            <a href={screenshotUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm text-violet-400 hover:text-violet-300">
              View your screenshot →
            </a>
          )}
        </div>
      )}

      <a
        href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 rounded-xl border border-[#25D366]/30 px-6 py-3 text-sm font-bold text-[#25D366] transition-colors hover:bg-[#25D366]/10"
      >
        Share on WhatsApp
      </a>
    </div>
  )
}
```

- [ ] **Step 2: Verify typecheck, lint, build**

Run: `npx tsc --noEmit` → clean.
Run: `npm run lint` → no warnings/errors.
Run: `npm run build` → `/matches/[id]` compiles as a dynamic route.

- [ ] **Step 3: Commit**

```bash
git add "app/(public)/matches/[id]/page.tsx"
git commit -m "feat: Match Centre page (header, video, participant result submission)"
```

---

## Task 7: Roadmap + full verification + push

**Files:**
- Modify: `ROADMAP.md` (mark #5 ✅)

- [ ] **Step 1: Full local verification**

Run: `npx tsc --noEmit && npm run lint && npm test && npm run build` → all green (expect `Test Files 11 passed`, `/matches/[id]` present).

- [ ] **Step 2: Mark the task done**

In `ROADMAP.md`, change the row:
`| 5 | Match Centre — YouTube embed, result submission | \`/matches/[id]\` | ⬜ |`
to `… | ✅ |`.

- [ ] **Step 3: Commit & push**

```bash
git add ROADMAP.md
git commit -m "chore: mark v1.0 #5 (Match Centre) done"
git push origin main
```

- [ ] **Step 4: Post-deploy manual check (two accounts)**

On the deployed URL, with a match that has two real registered players:
- As a participant: submit a result (score + screenshot upload + optional recording URL) → success; reload → form is prefilled (editable while pending). Edit the score → saves.
- Confirm the opponent's submission is NOT visible to you.
- As a spectator (logged out or a third account): header + video only, no form.
- Paste a YouTube live URL into `matches.youtube_stream_url` (via #9 later or SQL) and set status `live` → the embed shows with a LIVE badge.
- Verify the screenshot link works (signed URL) and still works after >1h only if the page is reloaded (fresh URL).

---

## Self-Review

**Spec coverage:**
- Migrations 003/004 (status, unique, owner-update RLS, private bucket, object RLS) → Task 1. ✅
- Signed URLs fresh server-side each load, TTL 3600 → Task 6. ✅
- Page: header (score from `matches`), viewer classification (participant vs not), video, result status, submission → Task 6. ✅
- Video precedence + `parseYouTubeId` → Tasks 2, 5. ✅
- Submission: screenshot required / recording optional, upload to `{uid}/{matchId}/...`, upsert `status='pending'`, editable-while-pending lock → Tasks 3, 4, 5. ✅
- Privacy (own submission only) → Task 6 query filters `submitted_by = uid`. ✅
- Schema validation tested → Task 3. ✅
- SEO `generateMetadata` + WhatsApp share → Task 6. ✅

**Placeholder scan:** No TBD/TODO; all code complete. ✅

**Type consistency:** `SubmitResultState`, `submitResultSchema`, `parseYouTubeId`/`youtubeEmbedUrl`, `VideoEmbed`/`ResultSubmissionForm` prop shapes, and the `initial` object (`{ scoreA, scoreB, recordingUrl, hasScreenshot }`) are defined once and consumed identically across Tasks 3–6. Upsert `onConflict: 'match_id,submitted_by'` matches the `UNIQUE (match_id, submitted_by)` from Task 1. FK aliases match the DB. ✅
