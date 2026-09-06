# Admin Push Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the missing FCM push on the staff no-show alert (the reported bug — in-app fired, push never did), and extend real-time push to all five admin-facing events that currently only surface when a staff member happens to open the admin dashboard (`lib/admin/notification-queue.ts`'s pull-based queue): a pending withdrawal, a pending exchange listing, a match result that needs review, a match a staff member disputed, and a full-day match that auto-cancelled with nobody submitting a result.

**Root cause of the reported bug:** `resolvePendingNoShowMatches()` (`lib/matches/noshow-actions.ts`) calls `notify()` (WhatsApp) and `notifyInApp()` (bell) for each staff member but never `pushToPlayer()` (FCM) — confirmed against the user's own `fcm_tokens` (two valid, recently-active tokens) and `notification_prefs.push` (every existing key `true`), so this is a pure missing-call bug, not a config/client issue. The equivalent player-facing flow in `lib/matches/verify-actions.ts` already calls all three tiers for the same `result_confirmed` type — this plan makes the staff alert match that pattern, then extends the pattern to the four queue-only action-triggered events, plus one queue-only sweep-triggered event (see below).

**Architecture:** This codebase already has a proven three-tier pipeline: `notify()` (WhatsApp, `lib/notifications/notify.ts`), `notifyInApp()` (bell, `lib/notifications/inbox.ts`), `pushToPlayer()` (FCM, `lib/notifications/push.ts`). Every existing player-facing trigger calls tiers 1+2 together, or all three for the ~6 WhatsApp-eligible types. This plan adds a **new staff fan-out helper** (`getStaffIds` + `notifyStaff`, in `lib/admin/staff.ts`) that calls tiers 1+2 (in-app + push, no WhatsApp) for every admin/moderator, and wires it into four queue-only events at the exact moment each occurs — reusing the copy-generating functions that already exist in `lib/admin/notification-copy.ts` (`withdrawalNotification`, `exchangeListingNotification`, `resultNotification`) so the push/bell text matches what the pull-based admin queue already shows, instead of writing new copy.

**The fifth event — `result_no_submission` / full-day auto-cancel — needs a sweep, not an action hook.** Looking at `bucketReviewQueue()` (`lib/matches/review-queue.ts`), that bucket has two triggers: (a) a scheduled/live match whose deadline has passed with 0 submissions — this is exactly the case the no-show sweep already flags via `noshow_flagged_at`, so fixing that alert's push (Task 4) already covers it; (b) a full-day match that `expire_full_day_matches()` (a **Postgres cron function**, migration 021) auto-cancels. That function has no app-code hook today — it's called directly by a `pg_cron` job (`expire-full-day-matches`, just activated live during this investigation), not routed through `pg_net` to a Next.js route the way `resolve-noshow-matches` is. This plan adds a **second, small `pg_cron` job** (`notify-expired-full-day-matches`, offset 5 minutes after the expiry job) that calls a new Next.js route to sweep for matches the expiry job just cancelled and alert staff exactly once each, using a new `matches.full_day_alert_sent_at` dedupe column — the same one-shot-via-timestamp-column pattern `noshow_flagged_at` already uses.

**Tech Stack:** Next.js 14 Server Actions, Supabase (Postgres), existing `notifyInApp`/`pushToPlayer`/`notify` pipeline, vitest.

**Spec:** No formal spec — this plan was scoped directly from a live bug report + a follow-up "admin should get notified for everything" ask, confirmed against `docs/superpowers/specs/2026-08-16-notification-center-design.md` (the original three-tier design) and `docs/superpowers/plans/2026-08-17-notification-center.md` (the plan that built the pipeline but never wired the no-show alert or the admin queue events to it).

## Global Constraints

- Every new notification call is **non-blocking and best-effort**: `void` the call or wrap in try/catch, never `await` in a way that can fail the caller's primary action. `notifyInApp` and `pushToPlayer` already swallow their own errors internally — the new `notifyStaff` helper must preserve that (never throw into its caller).
- No WhatsApp for any of the five new admin event types — `notify()` is not touched by this plan. Only the pre-existing `noshow_needs_decision` type keeps its WhatsApp call (unchanged).
- Reuse existing copy generators (`lib/admin/notification-copy.ts`) for message text instead of writing new strings — keeps the push/bell text and the admin dashboard queue text identical for the same event.
- `PushNotificationType` (`lib/notifications/push-types.ts`) and in-app `NotificationType` (`lib/notifications/inbox.ts`) are two separate unions; every new type must be added to **both**, plus the `player_notifications_type_check` CHECK constraint (migration).
- No new WhatsApp templates, no new `.env` vars, no Firebase/FCM infrastructure changes — this plan is purely wiring existing tiers into new/fixed call sites.
- Match this codebase's established test convention: `'use server'` action files with heavy Supabase query chains (`noshow-actions.ts`, `verify-actions.ts`, `wallet/actions.ts`, `exchange/actions.ts`) have **no direct unit tests** anywhere in the repo — don't introduce one as part of this plan. Pure/mockable helper logic (the new `notifyStaff` fan-out) **does** get a unit test, matching `push.test.ts`'s mocking style.

---

### Task 1: Migration — widen `player_notifications_type_check` for the 5 new admin types

**Files:**
- Create: `supabase/migrations/067_admin_push_notifications.sql`

**Interfaces:**
- Produces: `player_notifications_type_check` permitting `'withdrawal_pending', 'exchange_listing_pending', 'result_needs_review', 'result_disputed', 'result_no_submission'` — consumed by every task below that calls `notifyInApp`/`notifyStaff` with one of these types.

- [ ] **Step 1: Write the migration**

Confirmed via live DB introspection (`pg_get_constraintdef`) that the current constraint is exactly:

```sql
CHECK (type IN (
  'listing_approved', 'listing_removed', 'listing_deleted', 'listing_sold',
  'withdrawal_paid', 'withdrawal_rejected',
  'result_confirmed', 'referral_credited',
  'friend_request', 'wallet_credited',
  'player_disqualified', 'noshow_needs_decision',
  'buy_request_in_progress', 'buy_request_fulfilled', 'buy_request_closed',
  'masters_invitation', 'champions_cup_invitation',
  'invitation_accepted', 'invitation_expired_cascade',
  'tier_upgraded', 'achievement_unlocked',
  'fixture_assigned', 'prize_credited', 'match_reminder',
  'tournament_announced', 'new_announcement',
  'post_comment', 'post_reaction', 'wager_settled', 'bracket_released'
));
```

```sql
-- 067_admin_push_notifications.sql
-- Widens player_notifications_type_check for five admin-facing event types
-- that previously only existed in the pull-based admin dashboard queue
-- (lib/admin/notification-queue.ts) and are now pushed to staff in real
-- time via the new notifyStaff() fan-out (lib/admin/staff.ts). Paired with
-- the code fix in lib/matches/noshow-actions.ts that adds the FCM push tier
-- the existing noshow_needs_decision alert was missing (that type is
-- already permitted by this constraint since migration 038 — no schema
-- change needed for it).
ALTER TABLE public.player_notifications DROP CONSTRAINT player_notifications_type_check;
ALTER TABLE public.player_notifications ADD CONSTRAINT player_notifications_type_check
  CHECK (type IN (
    'listing_approved', 'listing_removed', 'listing_deleted', 'listing_sold',
    'withdrawal_paid', 'withdrawal_rejected',
    'result_confirmed', 'referral_credited',
    'friend_request', 'wallet_credited',
    'player_disqualified', 'noshow_needs_decision',
    'buy_request_in_progress', 'buy_request_fulfilled', 'buy_request_closed',
    'masters_invitation', 'champions_cup_invitation',
    'invitation_accepted', 'invitation_expired_cascade',
    'tier_upgraded', 'achievement_unlocked',
    'fixture_assigned', 'prize_credited', 'match_reminder',
    'tournament_announced', 'new_announcement',
    'post_comment', 'post_reaction', 'wager_settled', 'bracket_released',
    'withdrawal_pending', 'exchange_listing_pending',
    'result_needs_review', 'result_disputed', 'result_no_submission'
  ));
```

- [ ] **Step 2: Apply the migration**

Use the Supabase MCP tools (per memory: CLI can be flaky on Windows — MCP first). Then confirm:

```sql
select pg_get_constraintdef(oid) from pg_constraint where conname = 'player_notifications_type_check';
```

Expected: the new 5 types appear in the list.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/067_admin_push_notifications.sql
git commit -m "feat(notifications): widen player_notifications_type_check for 5 admin push types"
```

---

### Task 2: `PushNotificationType` + in-app `NotificationType` — add the 6 admin types

**Files:**
- Modify: `lib/notifications/push-types.ts`
- Modify: `lib/notifications/inbox.ts`

**Interfaces:**
- Produces: `PushNotificationType` and `NotificationType` both gain `'noshow_needs_decision' | 'withdrawal_pending' | 'exchange_listing_pending' | 'result_needs_review' | 'result_disputed' | 'result_no_submission'` — consumed by Task 3 (`notifyStaff`) and every task below.

- [ ] **Step 1: Add the 6 types to `PushNotificationType`**

`noshow_needs_decision` is being added here for the first time — it already exists as an in-app `NotificationType` (since migration 038) but was never part of the push-eligible union, which is the direct cause of the reported bug (nothing stopped `pushToPlayer('...', 'noshow_needs_decision', ...)` from being called except this type not existing).

```ts
// lib/notifications/push-types.ts
export type PushNotificationType =
  | 'match_reminder'
  | 'result_confirmed'
  | 'achievement_unlocked'
  | 'challenge_completed'
  | 'new_announcement'
  | 'tournament_announced'
  | 'wager_settled'
  | 'referral_converted'
  | 'post_comment'
  | 'post_reaction'
  | 'bracket_released'
  | 'match_assigned'
  | 'prize_credited'
  | 'noshow_needs_decision'
  | 'withdrawal_pending'
  | 'exchange_listing_pending'
  | 'result_needs_review'
  | 'result_disputed'
  | 'result_no_submission'
```

- [ ] **Step 2: Add the 5 new types to in-app `NotificationType`**

In `lib/notifications/inbox.ts`, add to the existing union (`noshow_needs_decision` is already present):

```ts
  | 'withdrawal_pending'
  | 'exchange_listing_pending'
  | 'result_needs_review'
  | 'result_disputed'
  | 'result_no_submission'
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS (these are additive union members; nothing currently references them yet, so nothing can break).

- [ ] **Step 4: Commit**

```bash
git add lib/notifications/push-types.ts lib/notifications/inbox.ts
git commit -m "feat(notifications): add noshow_needs_decision + 5 admin types to push/in-app unions"
```

---

### Task 3: `getStaffIds` + `notifyStaff` fan-out helper

**Files:**
- Modify: `lib/admin/staff.ts`
- Test: `lib/admin/staff.test.ts` (new)

**Interfaces:**
- Consumes: `notifyInApp` from `@/lib/notifications/inbox` (existing), `pushToPlayer` from `@/lib/notifications/push` (existing).
- Produces: `getStaffIds(admin): Promise<string[]>`, `notifyStaff(admin, type, payload, excludePlayerId?): Promise<void>` — consumed by Tasks 5-8 (withdrawal, listing, dispute, needs-review) and Task 10 (full-day auto-cancel sweep). Task 4 (no-show fix) does NOT use this — it keeps its existing `notify()` WhatsApp call and just adds `pushToPlayer` directly, since `notifyStaff` deliberately has no WhatsApp tier.

- [ ] **Step 1: Write the failing test**

```ts
// lib/admin/staff.test.ts
import { describe, it, expect, vi } from 'vitest'

const notifyInApp = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/notifications/inbox', () => ({ notifyInApp }))
const pushToPlayer = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/notifications/push', () => ({ pushToPlayer }))

describe('notifyStaff', () => {
  it('notifies every admin/moderator in-app and via push', async () => {
    const inRoles = vi.fn().mockResolvedValue({ data: [{ user_id: 'staff-1' }, { user_id: 'staff-2' }] })
    const selectRoles = vi.fn(() => ({ in: inRoles }))
    const from = vi.fn(() => ({ select: selectRoles }))
    const admin = { from } as unknown as Parameters<typeof import('./staff').notifyStaff>[0]

    const { notifyStaff } = await import('./staff')
    await notifyStaff(admin, 'withdrawal_pending', { title: 'T', body: 'B', link: '/admin/wallet' })

    expect(notifyInApp).toHaveBeenCalledWith({ playerId: 'staff-1', type: 'withdrawal_pending', title: 'T', body: 'B', link: '/admin/wallet' })
    expect(notifyInApp).toHaveBeenCalledWith({ playerId: 'staff-2', type: 'withdrawal_pending', title: 'T', body: 'B', link: '/admin/wallet' })
    expect(pushToPlayer).toHaveBeenCalledWith('staff-1', 'withdrawal_pending', { title: 'T', body: 'B' }, { url: '/admin/wallet' })
    expect(pushToPlayer).toHaveBeenCalledWith('staff-2', 'withdrawal_pending', { title: 'T', body: 'B' }, { url: '/admin/wallet' })
  })

  it('excludes the acting staff member when excludePlayerId is passed', async () => {
    notifyInApp.mockClear()
    pushToPlayer.mockClear()
    const inRoles = vi.fn().mockResolvedValue({ data: [{ user_id: 'staff-1' }, { user_id: 'staff-2' }] })
    const selectRoles = vi.fn(() => ({ in: inRoles }))
    const from = vi.fn(() => ({ select: selectRoles }))
    const admin = { from } as unknown as Parameters<typeof import('./staff').notifyStaff>[0]

    const { notifyStaff } = await import('./staff')
    await notifyStaff(admin, 'result_disputed', { title: 'T', body: 'B', link: '/admin/results' }, 'staff-1')

    expect(notifyInApp).not.toHaveBeenCalledWith(expect.objectContaining({ playerId: 'staff-1' }))
    expect(notifyInApp).toHaveBeenCalledWith(expect.objectContaining({ playerId: 'staff-2' }))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/admin/staff.test.ts`
Expected: FAIL — `notifyStaff` is not exported yet.

- [ ] **Step 3: Implement**

```ts
// lib/admin/staff.ts — full file after this change
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyInApp, type NotificationType } from '@/lib/notifications/inbox'
import { pushToPlayer } from '@/lib/notifications/push'

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

// Every admin/moderator profile id, regardless of WhatsApp number — the
// recipient list for push+in-app-only staff alerts (notifyStaff below).
// Unlike getNotifiableStaffIds, no WhatsApp gate: pushToPlayer and
// notifyInApp already no-op per-recipient (no FCM token, opted out, etc.),
// so there's no reason to pre-filter here.
export async function getStaffIds(admin: Admin): Promise<string[]> {
  const { data: roleRows } = await admin
    .from('user_roles')
    .select('user_id')
    .in('role', ['admin', 'moderator'])
  return Array.from(new Set((roleRows ?? []).map((r) => r.user_id)))
}

// Fan-out for admin-facing events that only need tiers 1+2 (in-app + FCM
// push) — no WhatsApp. `type` must already be a member of both the in-app
// NotificationType union (inbox.ts) and PushNotificationType (push-types.ts);
// TypeScript enforces that at the call site via the intersection below.
// `excludePlayerId` skips notifying the staff member who caused the event
// themselves (e.g. the admin who just disputed a result).
export async function notifyStaff(
  admin: Admin,
  type: Extract<NotificationType, 'withdrawal_pending' | 'exchange_listing_pending' | 'result_needs_review' | 'result_disputed' | 'result_no_submission'>,
  payload: { title: string; body: string; link: string },
  excludePlayerId?: string,
): Promise<void> {
  try {
    const staffIds = (await getStaffIds(admin)).filter((id) => id !== excludePlayerId)
    for (const staffId of staffIds) {
      void notifyInApp({ playerId: staffId, type, title: payload.title, body: payload.body, link: payload.link })
      void pushToPlayer(staffId, type, { title: payload.title, body: payload.body }, { url: payload.link })
    }
  } catch (err) {
    console.error('[staff] notifyStaff failed (non-blocking)', { type, err })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/admin/staff.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/admin/staff.ts lib/admin/staff.test.ts
git commit -m "feat(notifications): add getStaffIds + notifyStaff fan-out helper"
```

---

### Task 4: Fix the reported bug — push on the no-show staff alert

**Files:**
- Modify: `lib/matches/noshow-actions.ts`

**Interfaces:**
- Consumes: `pushToPlayer` from `@/lib/notifications/push`.

- [ ] **Step 1: Add the import**

```ts
import { pushToPlayer } from '@/lib/notifications/push'
```

- [ ] **Step 2: Add the missing push call**

In `resolvePendingNoShowMatches`, inside the `for (const staffId of staffIds)` loop (currently ends after the `notifyInApp` call around line 143), add the push call right after `notifyInApp`:

```ts
      await notifyInApp({
        playerId: staffId,
        type: 'noshow_needs_decision',
        title: 'No-show needs a decision',
        body: `${tournamentTitle} — ${playerA} vs ${playerB} passed its deadline with no confirmed result.`,
        link: `/admin/matches/${m.id}/review`,
      })
      void pushToPlayer(
        staffId,
        'noshow_needs_decision',
        { title: 'No-show needs a decision', body: `${tournamentTitle} — ${playerA} vs ${playerB} passed its deadline with no confirmed result.` },
        { url: `/admin/matches/${m.id}/review` },
      )
```

- [ ] **Step 3: Run the full suite**

Run: `npx vitest run`
Expected: PASS — `noshow-actions.ts` has no existing test file (matches the rest of this file's untested `'use server'` siblings), so this confirms nothing else broke.

- [ ] **Step 4: Commit**

```bash
git add lib/matches/noshow-actions.ts
git commit -m "fix(notifications): add missing FCM push to the no-show staff alert"
```

---

### Task 5: Wire `withdrawal_pending`

**Files:**
- Modify: `lib/wallet/actions.ts`

**Interfaces:**
- Consumes: `notifyStaff` from `@/lib/admin/staff` (Task 3), `withdrawalNotification` from `@/lib/admin/notification-copy` (existing — reused, not rewritten).

- [ ] **Step 1: Add imports**

```ts
import { notifyStaff } from '@/lib/admin/staff'
import { withdrawalNotification } from '@/lib/admin/notification-copy'
```

- [ ] **Step 2: Fetch the requester's display name and fire the alert**

`requestWalletWithdrawal` currently only has `user.id`, not a display name. Add a small profile lookup right after the successful debit, then call `notifyStaff`, reusing `withdrawalNotification`'s copy so the push/bell text matches what the admin queue already shows for this same event:

```ts
  const debit = await debitWallet(admin, user.id, parsed.data.amount, 'withdrawal_request', inserted.id)
  if (!debit.ok) {
    // Race: balance dropped between the pre-check above and now (e.g. two
    // tabs submitting at once). Undo the insert so the player never sees a
    // pending request that was never actually debited.
    await admin.from('withdrawal_requests').delete().eq('id', inserted.id)
    return { error: 'That amount is more than your available balance.' }
  }

  const { data: requester } = await admin.from('profiles').select('display_name, username').eq('id', user.id).maybeSingle()
  const notification = withdrawalNotification({
    type: 'withdrawal_pending',
    username: requester?.display_name ?? requester?.username ?? 'A player',
    amount: parsed.data.amount,
    createdAt: new Date().toISOString(),
  })
  void notifyStaff(admin, 'withdrawal_pending', { title: notification.title, body: notification.body, link: notification.link })

  revalidatePath('/dashboard')
  return { success: true }
```

- [ ] **Step 3: Run the full suite**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add lib/wallet/actions.ts
git commit -m "feat(notifications): push staff the moment a withdrawal request comes in"
```

---

### Task 6: Wire `exchange_listing_pending`

**Files:**
- Modify: `lib/exchange/actions.ts`

**Interfaces:**
- Consumes: `notifyStaff` from `@/lib/admin/staff` (Task 3), `exchangeListingNotification` from `@/lib/admin/notification-copy` (existing), `createAdminClient` from `@/lib/supabase/admin` (new import — this file currently only uses the user-scoped client).

- [ ] **Step 1: Add imports**

```ts
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyStaff } from '@/lib/admin/staff'
import { exchangeListingNotification } from '@/lib/admin/notification-copy'
```

- [ ] **Step 2: Fetch the seller's display name and fire the alert**

After the listing insert succeeds and the images are attached (right before the existing `revalidatePath('/exchange')` line):

```ts
  if (urls.length > 0) {
    const rows = urls.map((url, i) => ({ listing_id: listing.id, image_url: url, display_order: i }))
    await supabase.from('listing_images').insert(rows)
  }

  const { data: seller } = await supabase.from('profiles').select('display_name, username').eq('id', user.id).maybeSingle()
  const notification = exchangeListingNotification({
    title: d.title,
    sellerName: seller?.display_name ?? seller?.username ?? 'A player',
    createdAt: new Date().toISOString(),
  })
  void notifyStaff(createAdminClient(), 'exchange_listing_pending', { title: notification.title, body: notification.body, link: notification.link })

  revalidatePath('/exchange')
  revalidatePath('/dashboard')
```

- [ ] **Step 3: Run the full suite**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add lib/exchange/actions.ts
git commit -m "feat(notifications): push staff the moment a listing needs approval"
```

---

### Task 7: Wire `result_disputed`

**Files:**
- Modify: `lib/matches/verify-actions.ts`

**Interfaces:**
- Consumes: `notifyStaff` from `@/lib/admin/staff` (Task 3), `resultNotification` from `@/lib/admin/notification-copy` (existing). `disputeResult` already runs under `requireStaff()`, so the acting admin's id is needed to exclude them from their own alert.

- [ ] **Step 1: Add imports**

```ts
import { notifyStaff } from '@/lib/admin/staff'
import { resultNotification } from '@/lib/admin/notification-copy'
```

- [ ] **Step 2: Capture the acting staff member's id, extend the match query, fire the alert**

`requireStaff()` (`lib/admin/auth.ts`) returns a `StaffContext` whose profile id field is `userId` (not `id`) — confirmed by reading the file. Extend the existing match `select` to also fetch player names + tournament title (same shape already used in `confirmResult`, ~line 429-438), then notify after the dispute is saved:

```ts
export async function disputeResult(_prev: VerifyState, formData: FormData): Promise<VerifyState> {
  const staff = await requireStaff()
  const id = String(formData.get('id') ?? '')
  const note = String(formData.get('note') ?? '').trim()
  if (!id) return { error: 'Missing match.' }
  if (!note) return { error: 'Enter a reason for the dispute.' }

  const admin = createAdminClient()
  type NameRef = { display_name: string | null; username: string | null } | { display_name: string | null; username: string | null }[] | null
  const { data: m } = await admin
    .from('matches')
    .select(
      'id, tournament_id, tournament:tournaments(slug, title), ' +
        'player_a:profiles!matches_player_a_id_fkey(display_name, username), ' +
        'player_b:profiles!matches_player_b_id_fkey(display_name, username)',
    )
    .eq('id', id)
    .maybeSingle()
  if (!m) return { error: 'Match not found.' }

  const { error } = await admin
    .from('matches')
    .update({ status: 'disputed', admin_note: note })
    .eq('id', id)
  if (error) return { error: 'Could not save the dispute.' }
  await admin.from('match_results').update({ status: 'disputed' }).eq('match_id', id)
```

Then, later in the same function — after the existing wager-refund block and before its final `revalidateAll(...)`/`return { success: true }` — add:

```ts
  const nameOf = (x: NameRef) => {
    const r = Array.isArray(x) ? x[0] ?? null : x
    return r?.display_name ?? r?.username ?? 'Player'
  }
  const tRef = Array.isArray(m.tournament) ? m.tournament[0] : m.tournament
  const notification = resultNotification({
    type: 'result_disputed',
    tournamentTitle: tRef?.title ?? 'Tournament',
    playerAName: nameOf(m.player_a as NameRef),
    playerBName: nameOf(m.player_b as NameRef),
    createdAt: new Date().toISOString(),
  })
  void notifyStaff(admin, 'result_disputed', { title: notification.title, body: notification.body, link: notification.link }, staff.userId)
```

Note: `m.tournament` now selects `slug, title` (was `slug` only) — check every other read of `m.tournament`/`tRef` later in this function still works with the wider select (it will; adding a column to an existing `select()` never breaks code that only reads a subset of the returned fields).

- [ ] **Step 3: Run the full suite**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add lib/matches/verify-actions.ts
git commit -m "feat(notifications): push other staff the moment a colleague disputes a result"
```

---

### Task 8: Wire `result_needs_review` (first submission only)

**Files:**
- Modify: `lib/matches/actions.ts`

**Interfaces:**
- Consumes: `notifyStaff` from `@/lib/admin/staff` (Task 3), `resultNotification` from `@/lib/admin/notification-copy` (existing), `createAdminClient` from `@/lib/supabase/admin` (new import).

**Why "first submission only":** per `bucketReviewQueue()`, a match enters the `needsReview` bucket the moment `submissionCount >= 1` — i.e. on the *first* player's submission, not the second. Re-notifying staff when the second player also submits (or when either player edits their still-pending submission) would be a duplicate alert for a state that hasn't changed. `submitMatchResult` already queries `match_results` filtered to the current player's own row (`existing`) — that doesn't tell us whether the *other* player has already submitted, so a second, small existence check across both players is needed before the upsert.

- [ ] **Step 1: Add imports**

```ts
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyStaff } from '@/lib/admin/staff'
import { resultNotification } from '@/lib/admin/notification-copy'
```

- [ ] **Step 2: Check submission count before the upsert, notify after it succeeds only if this was the first**

Insert the count check right after the existing `existing` query (so both queries run against the same known-good `matchId`), and the notify call after the upsert succeeds:

```ts
  const { data: existing } = await supabase
    .from('match_results')
    .select('id, status, screenshot_url')
    .eq('match_id', matchId)
    .eq('submitted_by', user.id)
    .maybeSingle()

  if (existing && existing.status !== 'pending') {
    return { error: 'Your submission is under review and can no longer be edited.' }
  }

  const { count: priorSubmissionCount } = await supabase
    .from('match_results')
    .select('id', { count: 'exact', head: true })
    .eq('match_id', matchId)

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

  if (!priorSubmissionCount) {
    const admin = createAdminClient()
    type NameRef = { display_name: string | null; username: string | null } | { display_name: string | null; username: string | null }[] | null
    const { data: md } = await admin
      .from('matches')
      .select(
        'player_a:profiles!matches_player_a_id_fkey(display_name, username), ' +
          'player_b:profiles!matches_player_b_id_fkey(display_name, username), ' +
          'tournament:tournaments(title)',
      )
      .eq('id', matchId)
      .maybeSingle()
    if (md) {
      const nameOf = (x: NameRef) => {
        const r = Array.isArray(x) ? x[0] ?? null : x
        return r?.display_name ?? r?.username ?? 'Player'
      }
      const tRef = Array.isArray(md.tournament) ? md.tournament[0] : md.tournament
      const notification = resultNotification({
        type: 'result_needs_review',
        tournamentTitle: tRef?.title ?? 'Tournament',
        playerAName: nameOf(md.player_a as NameRef),
        playerBName: nameOf(md.player_b as NameRef),
        createdAt: new Date().toISOString(),
      })
      void notifyStaff(admin, 'result_needs_review', { title: notification.title, body: notification.body, link: notification.link })
    }
  }

  revalidatePath(`/matches/${matchId}`)
  return { success: true }
```

`priorSubmissionCount` is the count **before** this upsert — `!priorSubmissionCount` (0 or null) means this call is the first submission for the match, matching `bucketReviewQueue`'s `submissionCount >= 1` transition point exactly.

- [ ] **Step 3: Run the full suite**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add lib/matches/actions.ts
git commit -m "feat(notifications): push staff the moment a match first needs result review"
```

---

### Task 9: Migration — `matches.full_day_alert_sent_at` dedupe column

**Files:**
- Create: `supabase/migrations/068_full_day_alert_dedupe.sql`

**Interfaces:**
- Produces: `matches.full_day_alert_sent_at timestamptz` (nullable) — consumed by Task 10's sweep route as the one-shot dedupe marker, the same pattern `noshow_flagged_at` already uses for the no-show sweep.

- [ ] **Step 1: Write the migration**

```sql
-- 068_full_day_alert_dedupe.sql
-- Dedupe marker for the full-day-match auto-cancel admin alert (Task 10 of
-- docs/superpowers/plans/2026-08-18-admin-push-notifications.md). Null =
-- not yet alerted. Set once the sweep route successfully notifies staff for
-- this match, so an hourly re-run never double-alerts on a still-cancelled
-- match — the same one-shot-via-timestamp-column pattern noshow_flagged_at
-- (migration 037) already uses for the no-show sweep.
ALTER TABLE public.matches
  ADD COLUMN full_day_alert_sent_at timestamptz;
```

- [ ] **Step 2: Apply the migration**

Use the Supabase MCP tools. Then confirm:

```sql
select column_name from information_schema.columns where table_name = 'matches' and column_name = 'full_day_alert_sent_at';
```

Expected: one row returned.

- [ ] **Step 3: Regenerate Supabase types**

Run: `npx supabase gen types typescript --project-id itxubrkbropttfdackmi > lib/supabase/types.ts` (or `mcp__claude_ai_Supabase__generate_typescript_types` if the CLI can't reach the DB — check memory first), preserving the existing file's header format.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/068_full_day_alert_dedupe.sql lib/supabase/types.ts
git commit -m "feat(notifications): add matches.full_day_alert_sent_at dedupe column"
```

---

### Task 10: Sweep route — push staff on full-day auto-cancel

**Files:**
- Create: `app/api/cron/notify-expired-full-day-matches/route.ts`

**Interfaces:**
- Consumes: `notifyStaff` from `@/lib/admin/staff` (Task 3), `noSubmissionNotification` from `@/lib/admin/notification-copy` (existing), `createAdminClient` from `@/lib/supabase/admin`, `matches.full_day_alert_sent_at` (Task 9).
- Produces: `POST /api/cron/notify-expired-full-day-matches` — consumed by Task 11's `pg_cron` job.

This is a **separate** cron/route from `expire_full_day_matches()` itself (which stays exactly as-is, called directly by the already-scheduled `expire-full-day-matches` `pg_cron` job). This route only *notifies* about matches that job already cancelled — it never changes `status`/`auto_expired` itself. Splitting the two means zero risk to the just-activated expiry job.

- [ ] **Step 1: Write the route**

```ts
// app/api/cron/notify-expired-full-day-matches/route.ts
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyStaff } from '@/lib/admin/staff'
import { noSubmissionNotification } from '@/lib/admin/notification-copy'

type NameRef = { display_name: string | null; username: string | null } | { display_name: string | null; username: string | null }[] | null
type TournamentRef = { title: string } | { title: string }[] | null

function nameOf(x: NameRef): string {
  const r = Array.isArray(x) ? x[0] ?? null : x
  return r?.display_name ?? r?.username ?? 'Player'
}

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const admin = createAdminClient()
  const { data } = await admin
    .from('matches')
    .select(
      'id, ' +
        'player_a:profiles!matches_player_a_id_fkey(display_name, username), ' +
        'player_b:profiles!matches_player_b_id_fkey(display_name, username), ' +
        'tournament:tournaments(title)',
    )
    .eq('is_full_day', true)
    .eq('status', 'cancelled')
    .eq('auto_expired', true)
    .is('full_day_alert_sent_at', null)

  const rows = data ?? []
  for (const m of rows) {
    const tRef = m.tournament as TournamentRef
    const t = Array.isArray(tRef) ? tRef[0] : tRef
    const notification = noSubmissionNotification({
      tournamentTitle: t?.title ?? 'Tournament',
      playerAName: nameOf(m.player_a as NameRef),
      playerBName: nameOf(m.player_b as NameRef),
      createdAt: new Date().toISOString(),
    })
    void notifyStaff(admin, 'result_no_submission', { title: notification.title, body: notification.body, link: notification.link })
    await admin.from('matches').update({ full_day_alert_sent_at: new Date().toISOString() }).eq('id', m.id)
  }

  return Response.json({ notified: rows.length })
}
```

- [ ] **Step 2: Run the full suite**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS. No test file for this route — matches the codebase's convention of not unit-testing thin cron route handlers (`resolve-noshow-matches/route.ts`, `fixture-reminders/route.ts` have none either); the logic worth testing (`notifyStaff`, `noSubmissionNotification`) is already covered where it's defined.

- [ ] **Step 3: Commit**

```bash
git add app/api/cron/notify-expired-full-day-matches/route.ts
git commit -m "feat(notifications): push staff when a full-day match auto-cancels with no submission"
```

---

### Task 11: Schedule the `notify-expired-full-day-matches` cron job

**Files:** none (operational step, not code)

- [ ] **Step 1: Schedule the job**

Runs 5 minutes after the top of the hour — after `expire-full-day-matches` (scheduled `0 * * * *`) has had a chance to actually flip any overdue matches to `cancelled`/`auto_expired` in the same hour, so this sweep always sees them. Use the same `CRON_SECRET` value already embedded in the `resolve-noshow-matches` job (`mcp__claude_ai_Supabase__execute_sql`, project `itxubrkbropttfdackmi`):

```sql
select cron.schedule(
  'notify-expired-full-day-matches',
  '5 * * * *',
  $$
    select net.http_post(
      url := 'https://sentinelxesports.vercel.app/api/cron/notify-expired-full-day-matches',
      headers := jsonb_build_object('Authorization', 'Bearer ' || '17acefc84f5a65e6312d32c163d48760c6de079d3485f832e5bd0a8db23ed7c7')
    );
  $$
);
```

- [ ] **Step 2: Confirm it's scheduled**

```sql
select jobname, schedule, active from cron.job where jobname = 'notify-expired-full-day-matches';
```

Expected: one active row.

- [ ] **Step 3: Report to the user**

No commit for this task (pure database state, not repo code) — report the `cron.schedule` return value (job id) to the user.

---

### Task 12: Final verification + report

**Files:** none (verification only)

- [ ] **Step 1: Full suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS, no errors.

- [ ] **Step 2: Confirm the migrations applied cleanly**

```sql
select pg_get_constraintdef(oid) from pg_constraint where conname = 'player_notifications_type_check';
select column_name from information_schema.columns where table_name = 'matches' and column_name = 'full_day_alert_sent_at';
select jobname, schedule, active from cron.job where jobname in ('expire-full-day-matches', 'notify-expired-full-day-matches');
```

Expected: constraint includes all 5 new types; the column exists; both cron jobs are active.

- [ ] **Step 3: Report to the user**

State plainly:
- The original bug (no push on no-show alerts) is fixed.
- 5 new admin events now push in real time: `withdrawal_pending`, `exchange_listing_pending`, `result_disputed`, `result_needs_review`, `result_no_submission` (full-day auto-cancel).
- Two `pg_cron` jobs now involved in the full-day path: `expire-full-day-matches` (does the cancelling, unchanged from Task 11 of the original full-day-match-scheduling plan) and the new `notify-expired-full-day-matches` (does the alerting, 5 minutes offset).
