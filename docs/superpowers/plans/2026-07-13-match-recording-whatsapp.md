# Match Recording Submission via WhatsApp (#30) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Submit recording via WhatsApp" button to the match result submission form, alongside (not replacing) the existing screenshot upload and optional Recording URL field.

**Architecture:** One new pure URL-builder function reusing the existing `toWhatsAppNumber` helper, one new `NEXT_PUBLIC_ADMIN_WHATSAPP` env var, two new props threaded into the existing `ResultSubmissionForm`.

**Tech Stack:** Next.js 14 Client Component, Vitest.

## Global Constraints

- Additive only — the screenshot stays required exactly as today; the Recording URL field is untouched; this is a third, optional path (spec §1).
- `NEXT_PUBLIC_ADMIN_WHATSAPP` is read from the environment, never hardcoded (spec §2).
- An unset or unparseable admin WhatsApp number hides the button entirely — it must never render as a link to `#` (spec §2, matching `buildOpponentWhatsAppUrl`'s existing fail-open-to-nothing behavior).
- No delivery/click tracking of any kind (spec §4).

---

## File Structure

**New:**
- `lib/matches/recording-whatsapp.ts` — pure URL builder
- `lib/matches/recording-whatsapp.test.ts`

**Modified:**
- `components/match/ResultSubmissionForm.tsx`
- `app/(public)/matches/[id]/page.tsx`
- `.env.local.example`

---

### Task 1: Pure URL builder — `lib/matches/recording-whatsapp.ts`

**Files:**
- Create: `lib/matches/recording-whatsapp.ts`
- Create: `lib/matches/recording-whatsapp.test.ts`

**Interfaces:**
- Consumes: `toWhatsAppNumber` from `lib/dashboard/fixtures.ts`.
- Produces: `export function buildRecordingWhatsAppUrl(args: { adminWhatsapp: string | null; username: string; tournamentTitle: string; playerAName: string; playerBName: string }): string | null`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { buildRecordingWhatsAppUrl } from './recording-whatsapp'

describe('buildRecordingWhatsAppUrl', () => {
  it('builds the exact pre-filled wa.me message', () => {
    const url = buildRecordingWhatsAppUrl({
      adminWhatsapp: '08012345678',
      username: 'chidi',
      tournamentTitle: 'DLS Cup 4',
      playerAName: 'Chidi',
      playerBName: 'Tunde',
    })
    expect(url).toBe(
      'https://wa.me/2348012345678?text=' +
        encodeURIComponent("Hi, I'm chidi submitting my recording for DLS Cup 4 - Chidi vs Tunde."),
    )
  })

  it('returns null when adminWhatsapp is null (env var unset)', () => {
    const url = buildRecordingWhatsAppUrl({
      adminWhatsapp: null,
      username: 'chidi',
      tournamentTitle: 'DLS Cup 4',
      playerAName: 'Chidi',
      playerBName: 'Tunde',
    })
    expect(url).toBeNull()
  })

  it('returns null for an unparseable admin WhatsApp number', () => {
    const url = buildRecordingWhatsAppUrl({
      adminWhatsapp: 'not-a-number',
      username: 'chidi',
      tournamentTitle: 'DLS Cup 4',
      playerAName: 'Chidi',
      playerBName: 'Tunde',
    })
    expect(url).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/matches/recording-whatsapp.test.ts`
Expected: FAIL — `./recording-whatsapp` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```ts
import { toWhatsAppNumber } from '@/lib/dashboard/fixtures'

export function buildRecordingWhatsAppUrl(args: {
  adminWhatsapp: string | null
  username: string
  tournamentTitle: string
  playerAName: string
  playerBName: string
}): string | null {
  if (!args.adminWhatsapp) return null
  const number = toWhatsAppNumber(args.adminWhatsapp)
  if (!number) return null
  const text = `Hi, I'm ${args.username} submitting my recording for ${args.tournamentTitle} - ${args.playerAName} vs ${args.playerBName}.`
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/matches/recording-whatsapp.test.ts`
Expected: PASS, all 3 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/matches/recording-whatsapp.ts lib/matches/recording-whatsapp.test.ts
git commit -m "feat: #30 pure wa.me recording-submission URL builder, TDD"
```

---

### Task 2: Wire the button into `ResultSubmissionForm` and the match page

**Files:**
- Modify: `components/match/ResultSubmissionForm.tsx`
- Modify: `app/(public)/matches/[id]/page.tsx`
- Modify: `.env.local.example`

**Interfaces:**
- Consumes: `buildRecordingWhatsAppUrl` from Task 1.

- [ ] **Step 1: Add the env var placeholder**

Append to `.env.local.example` (after the existing `NEXT_PUBLIC_WHATSAPP_COMMUNITY_URL` line, grouped with the other WhatsApp-related config):

```
NEXT_PUBLIC_ADMIN_WHATSAPP=
```

- [ ] **Step 2: Add `username`/`tournamentTitle` props and the button to `ResultSubmissionForm.tsx`**

Change the component signature:
```tsx
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
```
to:
```tsx
export function ResultSubmissionForm({
  matchId,
  playerAName,
  playerBName,
  username,
  tournamentTitle,
  initial,
}: {
  matchId: string
  playerAName: string
  playerBName: string
  username: string
  tournamentTitle: string
  initial: { scoreA: number | null; scoreB: number | null; recordingUrl: string | null; hasScreenshot: boolean } | null
}) {
```

Add the import at the top of the file:
```tsx
import { buildRecordingWhatsAppUrl } from '@/lib/matches/recording-whatsapp'
```

Compute the URL right before the `return (` in the non-success render path — insert immediately above the `return (` that renders the form (not the `if (state?.success)` early-return block above it):
```tsx
  const recordingWhatsAppUrl = buildRecordingWhatsAppUrl({
    adminWhatsapp: process.env.NEXT_PUBLIC_ADMIN_WHATSAPP ?? null,
    username,
    tournamentTitle,
    playerAName,
    playerBName,
  })
```

Add the button directly below the existing "Recording URL" field block, before the error/submit-button section:
```tsx
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

      {recordingWhatsAppUrl && (
        <div className="space-y-1.5">
          <p className="text-xs text-slate-500">
            Prefer to send the full video? Message it to us on WhatsApp.
          </p>
          <a
            href={recordingWhatsAppUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-xl border border-[#25D366]/30 px-5 py-2.5 text-sm font-bold text-[#25D366] transition-colors hover:bg-[#25D366]/10"
          >
            Submit recording via WhatsApp
          </a>
        </div>
      )}
```

- [ ] **Step 3: Pass the two new props from `app/(public)/matches/[id]/page.tsx`**

The page already resolves the logged-in user's id via `supabase.auth.getUser()` for `isParticipant`, but doesn't fetch that user's `username`. Add it alongside the existing `myResult` fetch — change:
```tsx
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
```
to:
```tsx
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const isParticipant = !!user && (user.id === m.player_a_id || user.id === m.player_b_id)

  // Participant's own submission only (never the opponent's).
  let myResult:
    | { score_a: number | null; score_b: number | null; recording_url: string | null; screenshot_url: string | null; status: string }
    | null = null
  let myUsername = ''
  if (isParticipant) {
    const [{ data }, { data: myProfile }] = await Promise.all([
      supabase
        .from('match_results')
        .select('score_a, score_b, recording_url, screenshot_url, status')
        .eq('match_id', m.id)
        .eq('submitted_by', user!.id)
        .maybeSingle(),
      supabase.from('profiles').select('username, display_name').eq('id', user!.id).maybeSingle(),
    ])
    myResult = data
    myUsername = myProfile?.username ?? myProfile?.display_name ?? 'Player'
  }
```

Change the `ResultSubmissionForm` call:
```tsx
          <ResultSubmissionForm
            matchId={m.id}
            playerAName={nameOf(m.player_a)}
            playerBName={nameOf(m.player_b)}
            initial={
```
to:
```tsx
          <ResultSubmissionForm
            matchId={m.id}
            playerAName={nameOf(m.player_a)}
            playerBName={nameOf(m.player_b)}
            username={myUsername}
            tournamentTitle={m.tournaments?.title ?? 'Sentinel X'}
            initial={
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: succeeds. `NEXT_PUBLIC_ADMIN_WHATSAPP` will be unset in the build environment unless configured — confirm the build does not fail on a missing env var (it shouldn't; the code treats it as optional via `?? null`).

- [ ] **Step 6: Commit**

```bash
git add components/match/ResultSubmissionForm.tsx "app/(public)/matches/[id]/page.tsx" .env.local.example
git commit -m "feat: #30 Submit recording via WhatsApp button on the result submission form"
```

---

### Task 3: Manual verification

**Files:** none

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including the 3 new `recording-whatsapp.test.ts` cases.

- [ ] **Step 2: Manual walkthrough** (`npm run dev`, QA test account, with `NEXT_PUBLIC_ADMIN_WHATSAPP` set in `.env.local`)

1. As a match participant with a submittable match, load `/matches/[id]` — the "Submit recording via WhatsApp" button renders below the Recording URL field.
2. Click it — confirm it opens WhatsApp (web or app) addressed to the configured admin number, with "Hi, I'm `<your username>` submitting my recording for `<tournament title>` - `<Player A>` vs `<Player B>`." pre-filled.
3. Submit a screenshot and score as normal — confirm the WhatsApp button submitting a message does not interfere with or replace the normal screenshot submission flow (they're fully independent).
4. Temporarily unset `NEXT_PUBLIC_ADMIN_WHATSAPP` (remove it from `.env.local`, restart the dev server) — reload the page and confirm the button does not render at all (no dead `#` link).

- [ ] **Step 3: Deployment reminder**

Before this ships to production, add `NEXT_PUBLIC_ADMIN_WHATSAPP` to the Vercel project's environment variables (all environments the feature should be live in) — without it, the button silently never renders in production. This is an operational step outside the codebase; flag it to whoever deploys if it isn't already done.

- [ ] **Step 4: Report results**

If any step fails, treat it as a bug against the task that owns the broken code path.
