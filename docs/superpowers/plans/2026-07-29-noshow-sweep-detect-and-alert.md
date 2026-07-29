# No-show Sweep Detect-and-Alert Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the hourly no-show sweep from silently writing a 0-0 draw or forfeit onto any stale match — it now only flags the match and alerts staff (WhatsApp + in-app); every resolution (walkover, mutual no-show, or leaving it alone) becomes an explicit admin action.

**Architecture:** One new nullable timestamp column (`matches.noshow_flagged_at`) turns the sweep from a writer of scores into a pure detector. The existing admin review surfaces (`/admin/results`'s bucketed queue, the admin notification bell, `/admin/matches/[id]/review`) are extended to surface flagged matches rather than building parallel UI — a flagged, zero-submission match now lands in the same "No submission" bucket a timed match with no result already lands in today. A new `markBothNoShow` admin action is the only remaining path to the old auto-write behavior, gated by a small pure eligibility function so it can't be used to discard a real submission.

**Tech Stack:** Next.js 14 App Router (Server Actions), Supabase (Postgres + RLS), Vitest, existing `pg_cron`/`pg_net` hourly job (`resolve-noshow-matches`, unchanged cadence).

## Global Constraints

- **The system must never auto-write a match score or status again.** The sweep's only DB write is setting `noshow_flagged_at`. Every score/status write in this plan happens inside an explicit admin action (`declareNoShowWinner`, already shipped, or the new `markBothNoShow`).
- `noshow_flagged_at` is set exactly once per match (query filters `IS NULL`) — this is both the re-alert dedupe guard and the query key for every "needs attention" surface added in this plan.
- Walkover score is always 3-0 (existing `declareNoShowWinner`, unchanged). `no_show` Sentinel Score event = −10, unchanged (`lib/scoring/events.ts`) — this plan does not touch scoring logic, only what triggers it.
- `markBothNoShow` must refuse to run whenever any `match_results` row exists for the match, regardless of status — a mutual no-show write would silently discard a real submission. `declareNoShowWinner` needs no equivalent guard (unchanged, already shipped) since it always credits a specific player and is safe regardless of what either player submitted.
- Moderators may resolve no-shows (matches `declareNoShowWinner`'s existing `requireStaff` tier) — `markBothNoShow` uses `requireStaff` too, not `requireAdmin`, for consistency with the action it sits beside.
- `notify()`/`notifyInApp()` are best-effort (existing behavior in `lib/notifications/notify.ts` / `lib/notifications/inbox.ts`) — never let a failed alert block the flagging write.
- Nigeria observes no DST — `Africa/Lagos` (WAT) is UTC+1 year-round. The deadline boundary (`noShowDeadlinePassed` in `lib/matches/noshow.ts`) is unchanged by this plan.
- The `pg_cron` schedule (`0 * * * *`, hourly) and the cron route's path/auth are unchanged — only what the route's underlying function does changes.

---

## Task 1: Migration — `matches.noshow_flagged_at`

**Files:**
- Create: `supabase/migrations/037_noshow_flagged_at.sql`

**Interfaces:**
- Produces: `matches.noshow_flagged_at` (nullable `timestamptz`) in `lib/supabase/types.ts` after regeneration.

- [ ] **Step 1: Write the migration**

```sql
-- 037_noshow_flagged_at.sql
-- Marks the first time the hourly no-show sweep saw this match cross its
-- deadline while still scheduled/live. Purely a detection marker — the
-- sweep itself no longer writes any score or status (see
-- docs/superpowers/specs/2026-07-29-noshow-sweep-detect-and-alert-design.md).
-- NULL means "not yet flagged, or already resolved by an admin action."
ALTER TABLE public.matches ADD COLUMN noshow_flagged_at timestamptz;
```

- [ ] **Step 2: Apply the migration and regenerate types**

Apply via the Supabase MCP `apply_migration` tool against the linked project (preferred — the local CLI's TLS check has been flaky per prior sessions), then regenerate types with the MCP `generate_typescript_types` tool (or `npx supabase gen types typescript --project-id <project-id> > lib/supabase/types.ts` if the CLI is reachable).
Expected: `lib/supabase/types.ts`'s `matches` `Row`/`Insert`/`Update` types gain `noshow_flagged_at: string | null` (optional on Insert/Update).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/037_noshow_flagged_at.sql lib/supabase/types.ts
git commit -m "feat: add matches.noshow_flagged_at for the no-show sweep rewrite"
```

---

## Task 2: Notification plumbing — `noshow_needs_decision`

**Files:**
- Modify: `lib/notifications/templates.ts`
- Modify: `lib/notifications/keys.ts`
- Modify: `lib/notifications/inbox.ts`
- Modify: `lib/notifications/templates.test.ts`
- Modify: `lib/notifications/keys.test.ts`

**Interfaces:**
- Produces: `TemplateInput` gains `{ type: 'noshow_needs_decision'; tournament: string; round: string; playerA: string; playerB: string }`; `noshowKey(matchId: string, staffId: string): string`; `NotificationType` gains `'noshow_needs_decision'`.
- Consumes: nothing new.

- [ ] **Step 1: Write the failing tests**

Add to `lib/notifications/keys.test.ts` (extend the existing single test — follow its established pattern):

```ts
import { regKey, reminderKey, resultKey, prizeKey, disqualifyKey, noshowKey } from './keys'
// ...
it('formats each key type', () => {
  expect(regKey('r1')).toBe('reg:r1')
  expect(reminderKey('m1', 'p1')).toBe('reminder:m1:p1')
  expect(resultKey('m1', 'p1')).toBe('result:m1:p1')
  expect(prizeKey('w1')).toBe('prize:w1')
  expect(disqualifyKey('reg1')).toBe('disqualify:reg1')
  expect(noshowKey('m1', 'staff1')).toBe('noshow:m1:staff1')
})
```

Add to `lib/notifications/templates.test.ts`:

```ts
it('renders noshow_needs_decision', () => {
  const r = renderTemplate({
    type: 'noshow_needs_decision',
    tournament: 'Lagos Cup',
    round: 'group',
    playerA: 'Ade',
    playerB: 'Bola',
  })
  expect(r.templateName).toBe('noshow_needs_decision')
  expect(r.body).toContain('Lagos Cup')
  expect(r.body).toContain('Ade')
  expect(r.body).toContain('Bola')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/notifications/keys.test.ts lib/notifications/templates.test.ts`
Expected: FAIL — `noshowKey` doesn't exist, `'noshow_needs_decision'` isn't a valid `TemplateInput`.

- [ ] **Step 3: Implement**

In `lib/notifications/keys.ts`, add:

```ts
export const noshowKey = (matchId: string, staffId: string) => `noshow:${matchId}:${staffId}`
```

In `lib/notifications/templates.ts`, add to the `TemplateInput` union:

```ts
  | { type: 'noshow_needs_decision'; tournament: string; round: string; playerA: string; playerB: string }
```

and a case in `renderTemplate`:

```ts
    case 'noshow_needs_decision':
      return {
        templateName: 'noshow_needs_decision',
        body: `⚠️ No-show needs a decision: ${input.playerA} vs ${input.playerB} (${input.tournament}, ${input.round.replace(/_/g, ' ')}) passed its deadline with no confirmed result. Review it on the Sentinel X admin dashboard.`,
      }
```

In `lib/notifications/inbox.ts`, add `'noshow_needs_decision'` to the `NotificationType` union.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/notifications/keys.test.ts lib/notifications/templates.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/notifications/templates.ts lib/notifications/keys.ts lib/notifications/inbox.ts lib/notifications/templates.test.ts lib/notifications/keys.test.ts
git commit -m "feat: noshow_needs_decision notification template, dedupe key, in-app type"
```

---

## Task 3: Pure eligibility check — `canMarkBothNoShow`

**Files:**
- Create: `lib/matches/noshow-eligibility.ts`
- Test: `lib/matches/noshow-eligibility.test.ts`

**Interfaces:**
- Produces: `canMarkBothNoShow(m: { status: string; noshowFlaggedAt: string | null; submissionCount: number }): boolean`.
- Consumes: nothing.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { canMarkBothNoShow } from './noshow-eligibility'

describe('canMarkBothNoShow', () => {
  it('is true for a flagged scheduled match with no submissions', () => {
    expect(
      canMarkBothNoShow({ status: 'scheduled', noshowFlaggedAt: '2026-07-29T00:00:00Z', submissionCount: 0 }),
    ).toBe(true)
  })
  it('is true for a flagged live match with no submissions', () => {
    expect(
      canMarkBothNoShow({ status: 'live', noshowFlaggedAt: '2026-07-29T00:00:00Z', submissionCount: 0 }),
    ).toBe(true)
  })
  it('is false when the match has not been flagged yet', () => {
    expect(canMarkBothNoShow({ status: 'scheduled', noshowFlaggedAt: null, submissionCount: 0 })).toBe(false)
  })
  it('is false when a result has been submitted, even if flagged', () => {
    expect(
      canMarkBothNoShow({ status: 'scheduled', noshowFlaggedAt: '2026-07-29T00:00:00Z', submissionCount: 1 }),
    ).toBe(false)
  })
  it('is false once the match is no longer scheduled/live', () => {
    expect(
      canMarkBothNoShow({ status: 'completed', noshowFlaggedAt: '2026-07-29T00:00:00Z', submissionCount: 0 }),
    ).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/matches/noshow-eligibility.test.ts`
Expected: FAIL with "Cannot find module './noshow-eligibility'"

- [ ] **Step 3: Implement**

```ts
export interface NoShowMatchState {
  status: string
  noshowFlaggedAt: string | null
  submissionCount: number
}

// "Mark both no-show" may only run on a match the sweep has already flagged
// as stale, still scheduled/live, and with zero result submissions from
// either player. If anyone submitted anything, writing a mutual no-show
// would silently discard real evidence — use "Declare no-show winner" or
// the normal confirm-result flow instead.
export function canMarkBothNoShow(m: NoShowMatchState): boolean {
  return (
    (m.status === 'scheduled' || m.status === 'live') &&
    m.noshowFlaggedAt !== null &&
    m.submissionCount === 0
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/matches/noshow-eligibility.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/matches/noshow-eligibility.ts lib/matches/noshow-eligibility.test.ts
git commit -m "feat: pure eligibility check for the mark-both-no-show admin action"
```

---

## Task 4: Review queue — surface flagged matches in the existing "No submission" bucket

**Files:**
- Modify: `lib/matches/review-queue.ts`
- Test: `lib/matches/review-queue.test.ts`

**Interfaces:**
- Produces: `ReviewMatchInput` gains `noshowFlaggedAt: string | null`. `bucketReviewQueue`'s `noSubmission` bucket now also catches any `scheduled`/`live`, zero-submission match with `noshowFlaggedAt` set — regardless of `isFullDay` — since that's exactly the case the old `isFullDay`-gated timed check was never able to catch (all matches in the live tournament are full-day).
- Consumes: nothing new.

- [ ] **Step 1: Write the failing tests**

In `lib/matches/review-queue.test.ts`, add `noshowFlaggedAt: null` to the `m()` helper's defaults, and add:

```ts
it('routes a flagged full-day match with no submission to No submission', () => {
  const r = bucketReviewQueue(
    [
      m({
        id: 'fl',
        status: 'scheduled',
        isFullDay: true,
        submissionCount: 0,
        noshowFlaggedAt: '2026-07-08T00:00:00Z',
      }),
    ],
    NOW,
  )
  expect(r.noSubmission.map((x) => x.id)).toEqual(['fl'])
})
it('routes a flagged live match with no submission to No submission', () => {
  const r = bucketReviewQueue(
    [m({ id: 'lv', status: 'live', submissionCount: 0, noshowFlaggedAt: '2026-07-08T00:00:00Z' })],
    NOW,
  )
  expect(r.noSubmission.map((x) => x.id)).toEqual(['lv'])
})
it('routes a flagged match that already has a submission to Needs review, not No submission', () => {
  const r = bucketReviewQueue(
    [m({ id: 'sf', status: 'scheduled', submissionCount: 1, noshowFlaggedAt: '2026-07-08T00:00:00Z' })],
    NOW,
  )
  expect(r.needsReview.map((x) => x.id)).toEqual(['sf'])
  expect(r.noSubmission).toEqual([])
})
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run lib/matches/review-queue.test.ts`
Expected: the three new tests FAIL (flagged matches currently excluded); all pre-existing tests still PASS.

- [ ] **Step 3: Implement**

In `lib/matches/review-queue.ts`, add `noshowFlaggedAt: string | null` to `ReviewMatchInput`, and change the `noSubmission` branch:

```ts
export interface ReviewMatchInput {
  id: string
  status: string
  scheduledAt: string | null
  isFullDay: boolean
  autoExpired: boolean
  submissionCount: number
  hasMismatch: boolean
  round: string
  playerAName: string
  playerBName: string
  playerAClubName?: string | null
  playerBClubName?: string | null
  tournamentTitle: string
  tournamentSlug: string
  noshowFlaggedAt: string | null
}
```

```ts
    } else if (mt.status === 'disputed') {
      disputed.push(mt)
    } else if (mt.submissionCount >= 1 && (mt.status === 'scheduled' || mt.status === 'live')) {
      needsReview.push(mt)
    } else if (
      mt.submissionCount === 0 &&
      ((mt.status === 'scheduled' &&
        !mt.isFullDay &&
        mt.scheduledAt != null &&
        new Date(mt.scheduledAt).getTime() <= now.getTime()) ||
        ((mt.status === 'scheduled' || mt.status === 'live') && mt.noshowFlaggedAt != null))
    ) {
      noSubmission.push(mt)
    } else if (mt.status === 'cancelled' && mt.autoExpired && mt.submissionCount === 0) {
      noSubmission.push(mt)
    }
```

(Keep the function's existing doc comment about full-day matches — it's still accurate for the *timed* branch; the new flagged branch is the mechanism that now actually covers full-day matches, replacing the retired `expire_full_day_matches()` path that comment references as the intended-but-inactive mechanism.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/matches/review-queue.test.ts`
Expected: PASS (all tests, including every pre-existing one — the new OR branch is additive)

- [ ] **Step 5: Commit**

```bash
git add lib/matches/review-queue.ts lib/matches/review-queue.test.ts
git commit -m "feat: route noshow-flagged matches into the No submission review bucket"
```

---

## Task 5: Staff lookup helper

**Files:**
- Create: `lib/admin/staff.ts`

**Interfaces:**
- Produces: `getNotifiableStaffIds(admin: Admin): Promise<string[]>` — profile ids for every `admin`/`moderator` with a `whatsapp_number` on file.
- Consumes: `createAdminClient` (`lib/supabase/admin`).

- [ ] **Step 1: Implement**

```ts
import { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

// Profile ids for every admin/moderator with a WhatsApp number on file — the
// recipient list for staff-facing alerts (e.g. a no-show that needs a
// decision). A staff member with no verified WhatsApp number is silently
// skipped, same as notify()'s existing "no recipient -> stays skipped"
// behavior — they'll still see the in-app admin notification bell.
export async function getNotifiableStaffIds(admin: Admin): Promise<string[]> {
  const { data: roleRows } = await admin
    .from('user_roles')
    .select('user_id')
    .in('role', ['admin', 'moderator'])
  const staffIds = Array.from(new Set((roleRows ?? []).map((r) => r.user_id)))
  if (staffIds.length === 0) return []

  const { data: profiles } = await admin
    .from('profiles')
    .select('id, whatsapp_number')
    .in('id', staffIds)
    .not('whatsapp_number', 'is', null)
  return (profiles ?? []).map((p) => p.id)
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: No new type errors.

- [ ] **Step 3: Commit**

```bash
git add lib/admin/staff.ts
git commit -m "feat: staff lookup helper for admin/moderator WhatsApp alerts"
```

---

## Task 6: Rewrite the sweep — detect and alert, never write a result

**Files:**
- Modify: `lib/matches/noshow-actions.ts`

**Interfaces:**
- Produces: `resolvePendingNoShowMatches(admin, tournamentId?): Promise<{ flagged: number }>` (return shape changes from `{ drawn, forfeited }`). `ResolveState` gains `flagged?: number`, drops `resolved?: number`. `triggerResolvePendingMatches` returns `{ success: true, flagged }`.
- Consumes: `getNotifiableStaffIds` (Task 5), `noshowKey` (Task 2), `noShowDeadlinePassed` (existing `lib/matches/noshow.ts`, unchanged).

- [ ] **Step 1: Replace `resolvePendingNoShowMatches` and `triggerResolvePendingMatches`**

In `lib/matches/noshow-actions.ts`, replace the `PendingMatch` interface, `resolvePendingNoShowMatches`, and `triggerResolvePendingMatches`/`ResolveState`:

```ts
import { getNotifiableStaffIds } from '@/lib/admin/staff'
import { noshowKey } from '@/lib/notifications/keys'
```

(add these two imports alongside the existing ones at the top of the file)

```ts
interface PendingMatch {
  id: string
  tournament_id: string
  round: string
  group_id: string | null
  scheduled_at: string | null
  player_a: { display_name: string | null; username: string | null } | { display_name: string | null; username: string | null }[] | null
  player_b: { display_name: string | null; username: string | null } | { display_name: string | null; username: string | null }[] | null
  tournament: { title: string } | { title: string }[] | null
}

function firstOf<T>(x: T | T[] | null): T | null {
  return Array.isArray(x) ? x[0] ?? null : x
}

function nameOf(p: PendingMatch['player_a']): string {
  const row = firstOf(p)
  return row?.display_name ?? row?.username ?? 'TBD'
}

// The deadline sweep: flags any scheduled/live match whose WAT day has fully
// elapsed and alerts staff. It NEVER writes a score or status — every
// resolution (walkover, mutual no-show, or leaving it alone) is now an
// explicit admin action (declareNoShowWinner / markBothNoShow). Called by
// both the hourly cron (unchanged cadence) and the admin "Check for
// no-shows now" button — the system must never depend on the cron alone.
export async function resolvePendingNoShowMatches(
  admin: Admin,
  tournamentId?: string,
): Promise<{ flagged: number }> {
  const now = new Date()
  let query = admin
    .from('matches')
    .select(
      'id, tournament_id, round, group_id, scheduled_at, ' +
        'player_a:profiles!matches_player_a_id_fkey(display_name, username), ' +
        'player_b:profiles!matches_player_b_id_fkey(display_name, username), ' +
        'tournament:tournaments(title)',
    )
    .in('status', ['scheduled', 'live'])
    .not('scheduled_at', 'is', null)
    .is('noshow_flagged_at', null)
  if (tournamentId) query = query.eq('tournament_id', tournamentId)
  const { data } = await query

  const due = ((data ?? []) as PendingMatch[]).filter((m) => noShowDeadlinePassed(m.scheduled_at, now))
  if (due.length === 0) return { flagged: 0 }

  const staffIds = await getNotifiableStaffIds(admin)

  for (const m of due) {
    await admin.from('matches').update({ noshow_flagged_at: now.toISOString() }).eq('id', m.id)

    const tournamentTitle = firstOf(m.tournament)?.title ?? 'Tournament'
    const playerA = nameOf(m.player_a)
    const playerB = nameOf(m.player_b)
    for (const staffId of staffIds) {
      await notify({
        type: 'noshow_needs_decision',
        playerId: staffId,
        dedupeKey: noshowKey(m.id, staffId),
        tournament: tournamentTitle,
        round: m.round,
        playerA,
        playerB,
      })
      await notifyInApp({
        playerId: staffId,
        type: 'noshow_needs_decision',
        title: 'No-show needs a decision',
        body: `${tournamentTitle} — ${playerA} vs ${playerB} passed its deadline with no confirmed result.`,
        link: `/admin/matches/${m.id}/review`,
      })
    }
  }
  return { flagged: due.length }
}

export type ResolveState = { error?: string; success?: boolean; flagged?: number } | undefined

// Manual fallback for the hourly cron — "the system shouldn't fail" per the
// design spec. Scoped to one tournament via the admin matches page. Only
// flags stale matches for review; never resolves anything itself.
export async function triggerResolvePendingMatches(_prev: ResolveState, formData: FormData): Promise<ResolveState> {
  await requireStaff()
  const tournamentId = String(formData.get('tournamentId') ?? '')
  if (!tournamentId) return { error: 'Missing tournament.' }

  const admin = createAdminClient()
  const { flagged } = await resolvePendingNoShowMatches(admin, tournamentId)

  revalidatePath(`/admin/tournaments/${tournamentId}/matches`)
  revalidatePath('/admin/results')
  return { success: true, flagged }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: No new type errors (this step will surface the two callers from Task 7/8 if done out of order — do this task before Task 7).

- [ ] **Step 3: Manual verification**

Against a dev Supabase project with a test tournament:
1. Create a group match, `status='scheduled'`, `scheduled_at` in the past (WAT). Call `resolvePendingNoShowMatches` (via a scratch script, or the cron route once Task 7 lands). Confirm: `noshow_flagged_at` is set, `status`/`score_a`/`score_b`/`resolution` are all **untouched**, and a `notifications` row + `player_notifications` row exist for each staff profile with a `whatsapp_number`.
2. Call it again immediately. Confirm no new notification rows are created (the `noshow_flagged_at IS NULL` filter already excludes the match from the query, so it's never re-processed).
3. Confirm a match still within its scheduled WAT day is never flagged.

- [ ] **Step 4: Commit**

```bash
git add lib/matches/noshow-actions.ts
git commit -m "feat: sweep only flags and alerts staff, never auto-writes a result"
```

---

## Task 7: Cron route — new return shape

**Files:**
- Modify: `app/api/cron/resolve-noshow-matches/route.ts`

**Interfaces:**
- Produces: `POST` response body becomes `{ flagged: number }`.
- Consumes: `resolvePendingNoShowMatches` (Task 6).

- [ ] **Step 1: Update the route**

```ts
import { createAdminClient } from '@/lib/supabase/admin'
import { resolvePendingNoShowMatches } from '@/lib/matches/noshow-actions'

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const admin = createAdminClient()
  const { flagged } = await resolvePendingNoShowMatches(admin)

  return Response.json({ flagged })
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Manual verification**

With `CRON_SECRET` set locally: `curl -X POST http://localhost:3000/api/cron/resolve-noshow-matches -H "Authorization: Bearer $CRON_SECRET"` against a dev DB with a past-deadline match staged; confirm `{"flagged":N}` and the match's `noshow_flagged_at` is set with `status`/score untouched. Confirm a wrong/missing header still gets 401 (unchanged).

- [ ] **Step 4: Commit**

```bash
git add "app/api/cron/resolve-noshow-matches/route.ts"
git commit -m "feat: cron route returns the new flagged-count shape"
```

---

## Task 8: Relabel the manual trigger button

**Files:**
- Modify: `components/admin/ResolvePendingMatchesButton.tsx`

**Interfaces:**
- Consumes: `triggerResolvePendingMatches`, `ResolveState` (Task 6, new `flagged` field).

- [ ] **Step 1: Update the component**

```tsx
'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { triggerResolvePendingMatches, type ResolveState } from '@/lib/matches/noshow-actions'

export function ResolvePendingMatchesButton({ tournamentId }: { tournamentId: string }) {
  const [state, action] = useFormState<ResolveState, FormData>(triggerResolvePendingMatches, undefined)
  const [confirming, setConfirming] = useState(false)

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-300 hover:border-slate-500"
      >
        Check for no-shows now
      </button>
    )
  }
  return (
    <form action={action} className="flex flex-col items-start gap-1.5">
      <input type="hidden" name="tournamentId" value={tournamentId} />
      <p className="text-xs text-amber-400">
        Flags any match past its deadline with no confirmed result for your review — nothing is scored
        automatically. Continue?
      </p>
      <div className="flex gap-1.5">
        <button
          type="submit"
          className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-500"
        >
          Confirm
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-300 hover:border-slate-500"
        >
          Cancel
        </button>
      </div>
      {state?.success && <span className="text-xs text-emerald-400">Flagged {state.flagged} match(es) for review.</span>}
      {state?.error && <span className="text-xs text-red-400">{state.error}</span>}
    </form>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add components/admin/ResolvePendingMatchesButton.tsx
git commit -m "feat: relabel the manual no-show trigger to reflect flag-only behavior"
```

---

## Task 9: `markBothNoShow` admin action

**Files:**
- Modify: `lib/matches/noshow-actions.ts`

**Interfaces:**
- Produces: `markBothNoShow(_prev: NoShowState, formData: FormData): Promise<NoShowState>` (formData: `id`, `reason`).
- Consumes: `canMarkBothNoShow` (Task 3), `recomputeGroupAndMaybeAdvance`/`advanceKnockout` (existing exports from `lib/matches/verify-actions.ts`), `syncMatchEvents` (existing), `revalidateAll` (existing `lib/matches/revalidate.ts`).

- [ ] **Step 1: Add the import and the action**

Add to the imports in `lib/matches/noshow-actions.ts`:

```ts
import { canMarkBothNoShow } from './noshow-eligibility'
```

Append to the file:

```ts
// The only remaining path to a mutual 0-0 draw / forfeit — deliberate,
// admin-triggered, and only usable when the sweep has already flagged the
// match AND nobody submitted anything (canMarkBothNoShow, Task 3). Reuses
// the exact write shape the old automatic sweep used to write, plus the
// same post-processing pipeline declareNoShowWinner uses.
export async function markBothNoShow(_prev: NoShowState, formData: FormData): Promise<NoShowState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  const reason = String(formData.get('reason') ?? '').trim()
  if (!id) return { error: 'Missing match.' }
  if (!reason) return { error: 'Enter a reason (e.g. neither player responded to contact attempts).' }

  const admin = createAdminClient()
  const { data: m } = await admin
    .from('matches')
    .select('id, round, group_id, tournament_id, status, noshow_flagged_at, tournament:tournaments(slug)')
    .eq('id', id)
    .maybeSingle()
  if (!m) return { error: 'Match not found.' }

  const { count } = await admin
    .from('match_results')
    .select('*', { count: 'exact', head: true })
    .eq('match_id', id)
  const submissionCount = count ?? 0

  if (!canMarkBothNoShow({ status: m.status, noshowFlaggedAt: m.noshow_flagged_at, submissionCount })) {
    return {
      error:
        submissionCount > 0
          ? 'This match has a submitted result — use "Declare no-show winner" or confirm the result instead.'
          : 'This match has not been flagged as stale yet, or is no longer scheduled/live.',
    }
  }

  const now = new Date().toISOString()
  if (m.round === 'group') {
    await admin
      .from('matches')
      .update({ status: 'completed', resolution: 'no_show_draw', score_a: 0, score_b: 0, completed_at: now, admin_note: reason })
      .eq('id', id)
    if (m.group_id) await recomputeGroupAndMaybeAdvance(admin, m.tournament_id, m.group_id)
  } else {
    await admin
      .from('matches')
      .update({ status: 'forfeited', completed_at: now, admin_note: reason })
      .eq('id', id)
    await advanceKnockout(admin, m.tournament_id, m.round)
  }
  await syncMatchEvents(admin, id)

  const t = firstOf(m.tournament as { slug: string } | { slug: string }[] | null)
  revalidateAll(m.tournament_id, t?.slug ?? '', id)
  return { success: true }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: No new type errors.

- [ ] **Step 3: Manual verification**

Against a dev Supabase project:
1. Flag a group match (Task 6's manual verification already does this), then call `markBothNoShow` with a reason. Confirm `status='completed'`, `resolution='no_show_draw'`, `score_a=0, score_b=0`, `group_memberships` recomputes, and two `no_show` Sentinel Score events land.
2. Flag a knockout match and call `markBothNoShow`. Confirm `status='forfeited'` and (if paired with another completed match in the round) the round's other winner gets an auto-bye into the next round.
3. Submit a `match_results` row for a flagged match, then call `markBothNoShow` on it. Confirm it returns the "submitted result" error and makes no changes.
4. Call `markBothNoShow` on a match that hasn't been flagged yet. Confirm it returns the "not flagged" error and makes no changes.

- [ ] **Step 4: Commit**

```bash
git add lib/matches/noshow-actions.ts
git commit -m "feat: mark-both-no-show admin action, gated on flagged + no submissions"
```

---

## Task 10: `MarkBothNoShowForm` — wire into the review page

**Files:**
- Create: `components/admin/MarkBothNoShowForm.tsx`
- Modify: `app/admin/matches/[id]/review/page.tsx`

**Interfaces:**
- Consumes: `markBothNoShow`, `NoShowState` (Task 9), `canMarkBothNoShow` (Task 3).

- [ ] **Step 1: Create the form component**

```tsx
'use client'
import { useFormState } from 'react-dom'
import { markBothNoShow, type NoShowState } from '@/lib/matches/noshow-actions'

export function MarkBothNoShowForm({ matchId }: { matchId: string }) {
  const [state, action] = useFormState<NoShowState, FormData>(markBothNoShow, undefined)

  if (state?.success) {
    return (
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-center text-sm font-semibold text-emerald-400">
        ✓ Marked as a mutual no-show.
      </div>
    )
  }

  return (
    <form action={action} className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <input type="hidden" name="id" value={matchId} />
      <h3 className="text-sm font-bold text-white">Mark both no-show</h3>
      <p className="text-xs text-slate-500">
        Use only when neither player showed up or responded — records a 0-0 draw (group) or a forfeit (knockout),
        and both players receive the no-show Sentinel Score penalty.
      </p>
      <textarea
        name="reason"
        rows={2}
        required
        placeholder="Reason (required) — e.g. neither player responded to WhatsApp contact attempts"
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
      />
      {state?.error && <p className="text-xs text-red-400">{state.error}</p>}
      <button
        type="submit"
        className="rounded-lg border border-red-500/40 px-4 py-2 text-xs font-bold text-red-400 hover:bg-red-500/10"
      >
        Mark both no-show
      </button>
    </form>
  )
}
```

- [ ] **Step 2: Wire it into the review page**

In `app/admin/matches/[id]/review/page.tsx`, add `noshow_flagged_at` to the `matches` select, add it to the local type, and conditionally render the new form using `canMarkBothNoShow`:

```ts
import { canMarkBothNoShow } from '@/lib/matches/noshow-eligibility'
import { MarkBothNoShowForm } from '@/components/admin/MarkBothNoShowForm'
```

Change the `matches` select string to:

```ts
    .select(
      'id, status, resolution, admin_note, noshow_flagged_at, ' +
        'player_a:profiles!matches_player_a_id_fkey(id, username, display_name), ' +
        'player_b:profiles!matches_player_b_id_fkey(id, username, display_name)',
    )
```

Add `noshow_flagged_at: string | null` to the local `m` type cast.

After the existing submissions fetch (`withUrls`), compute:

```ts
const eligibleForMutualNoShow = canMarkBothNoShow({
  status: m.status,
  noshowFlaggedAt: m.noshow_flagged_at,
  submissionCount: submissions.length,
})
```

And render it alongside the existing `DeclareNoShowWinnerForm` block:

```tsx
      {!(m.status === 'completed' && m.resolution === null) && (
        <div className="mt-4 space-y-4">
          <DeclareNoShowWinnerForm
            matchId={m.id}
            playerAId={m.player_a?.id ?? ''}
            playerAName={playerA}
            playerBId={m.player_b?.id ?? ''}
            playerBName={playerB}
          />
          {eligibleForMutualNoShow && <MarkBothNoShowForm matchId={m.id} />}
        </div>
      )}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: No new type errors.

- [ ] **Step 4: Manual verification**

Visit `/admin/matches/[id]/review` for a flagged, zero-submission match — confirm both forms render. Visit it for a match with one submission — confirm only `DeclareNoShowWinnerForm` renders (the new form must not appear).

- [ ] **Step 5: Commit**

```bash
git add components/admin/MarkBothNoShowForm.tsx "app/admin/matches/[id]/review/page.tsx"
git commit -m "feat: mark-both-no-show form on the match review page"
```

---

## Task 11: Results page — pass `noshowFlaggedAt` through

**Files:**
- Modify: `app/admin/results/page.tsx`

**Interfaces:**
- Consumes: `ReviewMatchInput`'s new `noshowFlaggedAt` field (Task 4).

- [ ] **Step 1: Update the query and row mapping**

Add `noshow_flagged_at` to the `matches` select string, add it to the local raw-row type, and add it to the `ReviewMatchInput` object built in the `rows.map(...)`:

```ts
    .select(
      'id, round, status, scheduled_at, is_full_day, auto_expired, noshow_flagged_at, tournament_id, ' +
        'player_a:profiles!matches_player_a_id_fkey(id, username, display_name), ' +
        'player_b:profiles!matches_player_b_id_fkey(id, username, display_name), ' +
        'tournament:tournaments(title, slug), ' +
        'match_results(score_a, score_b)',
    )
```

```ts
      is_full_day: boolean
      auto_expired: boolean
      noshow_flagged_at: string | null
```

```ts
      tournamentSlug: t?.slug ?? '',
      noshowFlaggedAt: m.noshow_flagged_at,
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: No new type errors.

- [ ] **Step 3: Manual verification**

With a flagged, zero-submission test match: visit `/admin/results`, confirm it appears under "No submission" and links to its review page.

- [ ] **Step 4: Commit**

```bash
git add app/admin/results/page.tsx
git commit -m "feat: surface noshow-flagged matches on the admin results queue"
```

---

## Task 12: Admin notification bell — include "No submission" items

**Files:**
- Modify: `lib/admin/notification-copy.ts`
- Modify: `lib/admin/notification-queue.ts`
- Modify: `lib/admin/notification-copy.test.ts`

**Interfaces:**
- Produces: `AdminNotificationType` gains `'result_no_submission'`; new `noSubmissionNotification(row): AdminNotificationItem`; `getAdminNotificationQueue` now includes `noSubmission` bucket items (which, after Task 4, includes flagged no-shows).
- Consumes: `bucketReviewQueue`'s `noSubmission` output (Task 4).

- [ ] **Step 1: Write the failing test**

Add to `lib/admin/notification-copy.test.ts`:

```ts
import {
  exchangeListingNotification,
  resultNotification,
  withdrawalNotification,
  noSubmissionNotification,
  sortByCreatedAtDesc,
  countByHref,
  type AdminNotificationItem,
} from './notification-copy'
// ...
describe('noSubmissionNotification', () => {
  it('labels a no-submission match and links to the results queue', () => {
    const item = noSubmissionNotification({
      tournamentTitle: 'Lagos Cup',
      playerAName: 'Ade',
      playerBName: 'Bola',
      createdAt: '2026-07-10T11:00:00Z',
    })
    expect(item.title).toBe('No result submitted')
    expect(item.body).toBe('Lagos Cup — Ade vs Bola')
    expect(item.link).toBe('/admin/results')
    expect(item.type).toBe('result_no_submission')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/admin/notification-copy.test.ts`
Expected: FAIL — `noSubmissionNotification` doesn't exist.

- [ ] **Step 3: Implement**

In `lib/admin/notification-copy.ts`:

```ts
export type AdminNotificationType =
  | 'exchange_listing_pending'
  | 'result_needs_review'
  | 'result_disputed'
  | 'result_no_submission'
  | 'withdrawal_pending'
```

```ts
const TYPE_LINK: Record<AdminNotificationType, string> = {
  exchange_listing_pending: '/admin/exchange',
  result_needs_review: '/admin/results',
  result_disputed: '/admin/results',
  result_no_submission: '/admin/results',
  withdrawal_pending: '/admin/wallet',
}
```

```ts
export function noSubmissionNotification(row: {
  tournamentTitle: string
  playerAName: string
  playerBName: string
  createdAt: string
}): AdminNotificationItem {
  return {
    type: 'result_no_submission',
    title: 'No result submitted',
    body: `${row.tournamentTitle} — ${row.playerAName} vs ${row.playerBName}`,
    link: TYPE_LINK.result_no_submission,
    createdAt: row.createdAt,
  }
}
```

In `lib/admin/notification-queue.ts`, update `fetchResultItems` to also build `noSubmission` items and include them in the returned array, and pass `noshow_flagged_at` through the query and into `ReviewMatchInput`:

Change the `matches` select in `fetchResultItems` to add `noshow_flagged_at`:

```ts
      'id, round, status, scheduled_at, is_full_day, auto_expired, noshow_flagged_at, created_at, ' +
        'player_a:profiles!matches_player_a_id_fkey(username, display_name), ' +
        'player_b:profiles!matches_player_b_id_fkey(username, display_name), ' +
        'tournament:tournaments(title), match_results(count)',
```

Add `noshow_flagged_at: string | null` to the local `Row` type, and `noshowFlaggedAt: m.noshow_flagged_at` to the `reviewInputs` mapping.

Change the destructure and import:

```ts
import {
  exchangeListingNotification,
  resultNotification,
  withdrawalNotification,
  noSubmissionNotification,
  sortByCreatedAtDesc,
  type AdminNotificationItem,
} from './notification-copy'
```

```ts
  const { needsReview, noSubmission, disputed } = bucketReviewQueue(reviewInputs, new Date())

  return [
    ...needsReview.map((m) =>
      resultNotification({
        type: 'result_needs_review',
        tournamentTitle: m.tournamentTitle,
        playerAName: m.playerAName,
        playerBName: m.playerBName,
        createdAt: createdAtById.get(m.id) ?? new Date().toISOString(),
      }),
    ),
    ...noSubmission.map((m) =>
      noSubmissionNotification({
        tournamentTitle: m.tournamentTitle,
        playerAName: m.playerAName,
        playerBName: m.playerBName,
        createdAt: createdAtById.get(m.id) ?? new Date().toISOString(),
      }),
    ),
    ...disputed.map((m) =>
      resultNotification({
        type: 'result_disputed',
        tournamentTitle: m.tournamentTitle,
        playerAName: m.playerAName,
        playerBName: m.playerBName,
        createdAt: createdAtById.get(m.id) ?? new Date().toISOString(),
      }),
    ),
  ]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/admin/notification-copy.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: No new type errors.

- [ ] **Step 6: Manual verification**

With a flagged, zero-submission test match: confirm the admin sidebar bell and "Results" nav badge count both include it.

- [ ] **Step 7: Commit**

```bash
git add lib/admin/notification-copy.ts lib/admin/notification-queue.ts lib/admin/notification-copy.test.ts
git commit -m "feat: admin notification bell surfaces no-submission matches, including no-shows"
```

---

## Task 13: Banner on the tournament-scoped matches page

**Files:**
- Create: `components/admin/NoShowBanner.tsx`
- Modify: `app/admin/tournaments/[id]/matches/page.tsx`

**Interfaces:**
- Consumes: nothing new from earlier tasks (queries `matches` directly).

- [ ] **Step 1: Create the banner component**

```tsx
import Link from 'next/link'

export interface FlaggedMatchRow {
  id: string
  playerAName: string
  playerBName: string
  round: string
}

export function NoShowBanner({ matches }: { matches: FlaggedMatchRow[] }) {
  if (matches.length === 0) return null
  return (
    <div className="mb-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
      <p className="mb-2 text-sm font-bold text-amber-300">
        {matches.length} match{matches.length === 1 ? '' : 'es'} past deadline need a decision
      </p>
      <div className="space-y-1.5">
        {matches.map((m) => (
          <Link
            key={m.id}
            href={`/admin/matches/${m.id}/review`}
            className="block text-xs text-amber-200 underline decoration-amber-500/40 underline-offset-2 hover:text-amber-100"
          >
            {m.playerAName} vs {m.playerBName} — {m.round.replace(/_/g, ' ')}
          </Link>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire it into the matches page**

In `app/admin/tournaments/[id]/matches/page.tsx`, add the import:

```ts
import { NoShowBanner, type FlaggedMatchRow } from '@/components/admin/NoShowBanner'
```

After the existing `matches` query (the one building `all`), add a second lightweight query scoped to flagged matches only:

```ts
  const { data: flaggedRaw } = await supabase
    .from('matches')
    .select(
      'id, round, ' +
        'player_a:profiles!matches_player_a_id_fkey(username, display_name), ' +
        'player_b:profiles!matches_player_b_id_fkey(username, display_name)',
    )
    .eq('tournament_id', t.id)
    .not('noshow_flagged_at', 'is', null)
    .in('status', ['scheduled', 'live'])

  const flagged: FlaggedMatchRow[] = ((flaggedRaw as unknown[] | null) ?? []).map((raw) => {
    const m = raw as { id: string; round: string; player_a: ProfileRef; player_b: ProfileRef }
    return {
      id: m.id,
      playerAName: nameOf(m.player_a) ?? 'TBD',
      playerBName: nameOf(m.player_b) ?? 'TBD',
      round: m.round,
    }
  })
```

Render it above the sections:

```tsx
      <NoShowBanner matches={flagged} />

      {sections.length === 0 ? (
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: No new type errors.

- [ ] **Step 4: Manual verification**

With a flagged match in a test tournament: visit `/admin/tournaments/[id]/matches`, confirm the banner appears above the round sections and links to the review page. Confirm it's absent when nothing is flagged.

- [ ] **Step 5: Commit**

```bash
git add components/admin/NoShowBanner.tsx "app/admin/tournaments/[id]/matches/page.tsx"
git commit -m "feat: no-show banner on the tournament-scoped admin matches page"
```

---

## Task 14: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: PASS, including every test file touched above.

- [ ] **Step 2: Typecheck the whole project**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: End-to-end manual check against the live tournament data**

Using the Supabase MCP `execute_sql` tool against the linked project: confirm the 6 already-auto-resolved matches (identified in the design spec's Section F) are unaffected by this change (they're already `completed`, so the sweep's `status IN ('scheduled','live')` filter excludes them going forward). Confirm the 33 currently-`scheduled` matches are untouched until their deadline passes, at which point they should gain `noshow_flagged_at` on the next hourly run — verify this in the review queue and admin bell rather than waiting for the actual cron tick, by calling `resolvePendingNoShowMatches` directly against one deliberately-backdated test match first.

- [ ] **Step 4: Update the design spec's status**

No code change — just confirm every item in the design spec's "In" scope list (Section A–G) has a corresponding task above with nothing missed. If anything was descoped or changed during implementation, note it inline in the spec file the same way Task 10 of the original 2026-07-28 plan documented its cron-cadence deviation.
