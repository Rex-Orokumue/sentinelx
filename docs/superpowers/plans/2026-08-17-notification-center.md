# Notification Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add FCM web push as a new notification tier alongside the existing in-app (`player_notifications`) and WhatsApp (`notifications`) tiers, wire it and the in-app tier into every trigger point the spec calls for, fix a live bug where two notification types silently never fire, and rebuild the bell dropdown into a paginated, realtime drawer.

**Architecture:** SentinelX already has a working two-tier pipeline (`notify()` for WhatsApp, `notifyInApp()` for the bell) wired into 6 call sites. This plan **extends that pipeline in place — it does not replace it.** `player_notifications` is treated as the spec's "tier 1" table and `notifications` (the existing WhatsApp send/dedupe log) as the spec's `notification_logs` — no new tables for either. The only new table is `fcm_tokens`. A new `pushToPlayer()` / `broadcastPush()` pair (tier 2, pref-gated on `notification_prefs.push`) is added *alongside* the existing `notify()`/`notifyInApp()` calls at the 6 already-wired sites, and used together with `notifyInApp()` at brand-new integration points (community, wagers, tournament announcements). This was a deliberate reconciliation decision made with the user before this plan was written — see the conversation that produced this plan for the full rationale; do not re-litigate it mid-execution.

**Technical correction to the source spec:** the spec's `lib/notifications/fcm.ts` design posts to the legacy `fcm.googleapis.com/fcm/send` endpoint with an `Authorization: key=<FCM_SERVER_KEY>` header. **That endpoint was fully decommissioned by Google in June 2024 and no longer works.** This plan uses the `firebase-admin` Node SDK (`getMessaging().sendEachForMulticast()`), authenticated with a Firebase service-account (`FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY`), which is the current supported path for server-side FCM sends including web push. Everything else about the design (dormant-until-configured, three-tier model, pref gating, service worker, drawer) is unchanged from spec intent.

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase (Postgres + Realtime), `firebase-admin` (new, server), `firebase` (new, client), vitest.

**Spec:** `docs/superpowers/specs/2026-08-16-notification-center-design.md`, `docs/superpowers/specs/2026-08-16-whatsapp-notifications-design.md` — read both; this plan deviates from them in the specific ways called out above and per-task below, and those deviations are intentional, not omissions.

**Post-merge correction (2026-08-17):** after this plan's branch merged, the user reported their actual Firebase project setup uses a single `FIREBASE_SERVICE_ACCOUNT_JSON` env var (the full downloaded service-account key file, pasted as one JSON string) rather than the three separate `FIREBASE_PROJECT_ID`/`FIREBASE_CLIENT_EMAIL`/`FIREBASE_PRIVATE_KEY` vars this plan specifies below. `lib/notifications/fcm.ts`, its test, `.env.local.example`, and `lib/firebase/client.ts` (added `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`) were updated post-merge to match — this document's task text below still shows the original three-var design and was intentionally left as the historical record rather than rewritten; the shipped code is the source of truth.

## Global Constraints

- Every new notification call is **non-blocking and best-effort**: wrap in try/catch (or reuse a helper that already does), log on failure, never throw into the caller's primary action — same contract as the existing `notify()` and `notifyInApp()`.
- Tier 1 (in-app) is never pref-gated — it always fires. Tier 2 (FCM) is gated on `profiles.notification_prefs.push[type]` (default `true` when the key is absent). Tier 3 (WhatsApp) is unchanged — do not add any new WhatsApp templates in this plan; only new in-app + FCM integration points are being added.
- `TERMII_API_KEY` stays unset — do not add it, do not touch anything that would make WhatsApp sending live.
- FCM must be genuinely dormant until `FIREBASE_PROJECT_ID`/`FIREBASE_CLIENT_EMAIL`/`FIREBASE_PRIVATE_KEY` are set: every FCM send path must check for their presence and `console.warn` + no-op otherwise, exactly like `sendWhatsApp()` does for `TERMII_API_KEY`.
- `admin_flag` is a known gap — no `flagPlayer`/admin moderation feature exists anywhere in the codebase. Do not build one as part of this plan; it is out of scope. Report it as a known gap at the end.
- No new UI dependency: this codebase hand-rolls its overlay/drawer components (see `components/shared/MobileNavSheet.tsx`) rather than using Radix/shadcn `Sheet`. The new notification drawer follows that same hand-rolled pattern — do not add `@radix-ui/*`.
- No component tests exist anywhere in this repo (confirmed: zero `*.test.tsx` files). Match that convention — write `.test.ts` unit tests only for new pure/testable logic; UI pieces are verified manually, not with new test infrastructure.
- Migration numbering: the latest migration on `main` is `065_racing_category.sql`. This plan's migration is `066_notification_center.sql`.
- `vercel.json` does not exist and this plan does not create it. Match reminders run on `pg_cron`/`pg_net` calling `app/api/cron/fixture-reminders/route.ts` directly from Postgres, not Vercel Cron — the source spec's `vercel.json` cron-config instructions do not apply to this codebase and must not be followed.

---

### Task 1: Migration — `fcm_tokens` table, CHECK-constraint widening, Realtime publication

**Files:**
- Create: `supabase/migrations/066_notification_center.sql`

**Interfaces:**
- Produces: `public.fcm_tokens(id, player_id, token, last_active, created_at)` table, consumed by Task 3 (`lib/notifications/fcm.ts`) and Task 9 (`app/api/notifications/fcm-token/route.ts`).
- Produces: widened `player_notifications_type_check` allowing `'fixture_assigned', 'prize_credited', 'tournament_announced', 'new_announcement', 'post_comment', 'post_reaction', 'wager_settled', 'bracket_released'` — consumed by every task below that calls `notifyInApp()`/`broadcastInApp()` with one of these types.
- Produces: widened `notifications_type_check` allowing `'fixture_assigned'` (WhatsApp log bugfix) — consumed by Task 6.
- Produces: `player_notifications` added to the `supabase_realtime` publication — consumed by Task 13.

- [ ] **Step 1: Write the migration**

```sql
-- 066_notification_center.sql
-- Notification Center (Phase 3): FCM web push as a new tier alongside the
-- existing WhatsApp (notifications table) and in-app (player_notifications)
-- tiers. See docs/superpowers/specs/2026-08-16-notification-center-design.md
-- and docs/superpowers/specs/2026-08-16-whatsapp-notifications-design.md.
-- Per docs/superpowers/plans/2026-08-17-notification-center.md, this repo
-- already has a working notifications/player_notifications pipeline — this
-- migration extends it rather than replacing it. No new "notifications" or
-- "notification_logs" table: those names are already taken by the existing
-- WhatsApp send log, which serves the same purpose the spec's
-- notification_logs table would.

-- New: FCM device tokens, one row per browser/device a player has granted
-- push permission on.
CREATE TABLE public.fcm_tokens (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id   uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token       text        NOT NULL UNIQUE,
  last_active timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.fcm_tokens (player_id);

ALTER TABLE public.fcm_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fcm_tokens_owner" ON public.fcm_tokens FOR ALL
  USING (player_id = auth.uid())
  WITH CHECK (player_id = auth.uid());

-- Bugfix: notifyNewFixtures (lib/notifications/fixture-created.ts) has
-- called notify()/notifyInApp() with type='fixture_assigned' since it
-- shipped, but neither CHECK constraint has ever allowed that value — every
-- "new fixture" WhatsApp message and bell notification has silently
-- no-op'd (both helpers are best-effort try/catch, so the failure was
-- invisible). Fixed here as part of the same migration that widens these
-- constraints for the new types below.
ALTER TABLE public.notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'registration_confirmed', 'fixture_reminder', 'result_confirmed',
    'prize_credited', 'escrow_sale', 'escrow_completed', 'escrow_refunded',
    'noshow_needs_decision', 'fixture_assigned'
  ));

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
    'post_comment', 'post_reaction', 'wager_settled', 'bracket_released'
  ));

-- Realtime: the notification drawer (Task 13) subscribes to INSERTs on this
-- table so the bell badge updates live without a page reload. Guarded so
-- re-running this migration (or a project where it's already enabled)
-- doesn't error on a duplicate ADD TABLE.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'player_notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.player_notifications;
  END IF;
END $$;
```

- [ ] **Step 2: Apply the migration to the linked Supabase project**

Run via whichever path is currently working for this repo (see memory: CLI can be flaky on Windows — check MCP Supabase tools first). Confirm no errors, then confirm the new table and constraints exist:

```sql
select column_name from information_schema.columns where table_name = 'fcm_tokens';
select conname, pg_get_constraintdef(oid) from pg_constraint where conname in ('notifications_type_check','player_notifications_type_check');
select * from pg_publication_tables where tablename = 'player_notifications';
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/066_notification_center.sql
git commit -m "feat(notifications): fcm_tokens table, widen type constraints, enable realtime on player_notifications"
```

---

### Task 2: `PushNotificationType` + widen `inbox.ts`'s `NotificationType`

**Files:**
- Create: `lib/notifications/push-types.ts`
- Modify: `lib/notifications/inbox.ts:3-26` (the `NotificationType` union)
- Test: `lib/notifications/push-types.test.ts`

**Interfaces:**
- Produces: `PushNotificationType` — the exact 13 keys under `notification_prefs.push` from migration 062, used by Task 4 (`push.ts`) and every task that calls `pushToPlayer`/`broadcastPush`.
- Produces: widened `NotificationType` (in-app) — used by every task that calls `notifyInApp`/`broadcastInApp`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/notifications/push-types.test.ts
import { describe, it, expect } from 'vitest'
import type { PushNotificationType } from './push-types'

// Compile-time-only check made runtime-visible: every key in migration
// 062's notification_prefs.push default must have a matching union member.
// If this list and the union ever drift, this test's literal array will
// fail to satisfy the type and the build breaks — that's the point.
describe('PushNotificationType', () => {
  it('covers all 13 push pref keys from migration 062', () => {
    const keys: PushNotificationType[] = [
      'match_reminder', 'result_confirmed', 'achievement_unlocked',
      'challenge_completed', 'new_announcement', 'tournament_announced',
      'wager_settled', 'referral_converted', 'post_comment',
      'post_reaction', 'bracket_released', 'match_assigned', 'prize_credited',
    ]
    expect(keys).toHaveLength(13)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/notifications/push-types.test.ts`
Expected: FAIL — `Cannot find module './push-types'`

- [ ] **Step 3: Create `push-types.ts` and widen `inbox.ts`**

```ts
// lib/notifications/push-types.ts
// The 13 keys under profiles.notification_prefs.push (migration 062's
// default JSONB). Kept as its own file (not inside push.ts) so both
// push.ts and any settings-UI code that needs the full key list can import
// the type without pulling in fcm.ts's firebase-admin dependency.
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
```

In `lib/notifications/inbox.ts`, replace the `NotificationType` union (lines 3-26) with:

```ts
export type NotificationType =
  | 'listing_approved'
  | 'listing_removed'
  | 'listing_deleted'
  | 'listing_sold'
  | 'withdrawal_paid'
  | 'withdrawal_rejected'
  | 'result_confirmed'
  | 'referral_credited'
  | 'friend_request'
  | 'wallet_credited'
  | 'fixture_assigned'
  | 'player_disqualified'
  | 'noshow_needs_decision'
  | 'buy_request_in_progress'
  | 'buy_request_fulfilled'
  | 'buy_request_closed'
  | 'masters_invitation'
  | 'champions_cup_invitation'
  | 'invitation_accepted'
  | 'invitation_expired_cascade'
  | 'tier_upgraded'
  | 'achievement_unlocked'
  | 'prize_credited'
  | 'tournament_announced'
  | 'new_announcement'
  | 'post_comment'
  | 'post_reaction'
  | 'wager_settled'
  | 'bracket_released'
  | 'match_reminder'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/notifications/push-types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/notifications/push-types.ts lib/notifications/push-types.test.ts lib/notifications/inbox.ts
git commit -m "feat(notifications): add PushNotificationType, widen in-app NotificationType union"
```

---

### Task 3: `lib/notifications/fcm.ts` — dormant FCM sender

**Files:**
- Create: `lib/notifications/fcm.ts`
- Test: `lib/notifications/fcm.test.ts`
- Modify: `package.json` (add `firebase-admin` dependency)

**Interfaces:**
- Consumes: `createAdminClient` from `@/lib/supabase/admin` (existing); `fcm_tokens` table (Task 1).
- Produces: `sendToTokens(tokens, notification, data)`, `sendFCMToPlayer(playerId, notification, data)`, `broadcastFCM(notification, data)` — consumed by Task 4 (`push.ts`).

- [ ] **Step 1: Add the dependency**

```bash
npm install firebase-admin
```

- [ ] **Step 2: Write the failing test**

```ts
// lib/notifications/fcm.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const sendEachForMulticast = vi.fn()
vi.mock('firebase-admin/app', () => ({
  getApps: () => [],
  initializeApp: vi.fn(() => ({})),
  cert: vi.fn((c) => c),
}))
vi.mock('firebase-admin/messaging', () => ({
  getMessaging: () => ({ sendEachForMulticast }),
}))

const deleteIn = vi.fn().mockResolvedValue({ error: null })
const del = vi.fn(() => ({ in: deleteIn }))
const eq = vi.fn().mockResolvedValue({ data: [] })
const select = vi.fn(() => ({ eq }))
const from = vi.fn(() => ({ select, delete: del }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from }) }))

describe('sendToTokens', () => {
  beforeEach(() => {
    vi.stubEnv('FIREBASE_PROJECT_ID', 'sx-test')
    vi.stubEnv('FIREBASE_CLIENT_EMAIL', 'sa@sx-test.iam.gserviceaccount.com')
    vi.stubEnv('FIREBASE_PRIVATE_KEY', '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n')
    sendEachForMulticast.mockReset()
    deleteIn.mockClear()
  })

  it('deletes tokens FCM reports as unregistered', async () => {
    sendEachForMulticast.mockResolvedValueOnce({
      responses: [
        { success: true },
        { success: false, error: { code: 'messaging/registration-token-not-registered' } },
      ],
    })
    const { sendToTokens } = await import('./fcm')
    await sendToTokens(
      [{ id: 'row-1', token: 'tok-1' }, { id: 'row-2', token: 'tok-2' }],
      { title: 'Hi', body: 'There' },
      { url: '/x' },
    )
    expect(deleteIn).toHaveBeenCalledWith('id', ['row-2'])
  })

  it('does not call FCM when credentials are unset', async () => {
    vi.unstubAllEnvs()
    vi.resetModules()
    const { sendToTokens } = await import('./fcm')
    await sendToTokens([{ id: 'row-1', token: 'tok-1' }], { title: 'Hi', body: 'There' }, { url: '/x' })
    expect(sendEachForMulticast).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run lib/notifications/fcm.test.ts`
Expected: FAIL — `Cannot find module './fcm'`

- [ ] **Step 4: Write the implementation**

```ts
// lib/notifications/fcm.ts
import { createAdminClient } from '@/lib/supabase/admin'
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app'
import { getMessaging, type Messaging } from 'firebase-admin/messaging'

export interface FCMNotification {
  title: string
  body: string
}

let cachedMessaging: Messaging | null | undefined // undefined = not attempted, null = unavailable

// Dormant until all three server credentials are set — same contract as
// sendWhatsApp() in termii.ts for TERMII_API_KEY. NOTE: this deliberately
// does NOT use the legacy fcm.googleapis.com/fcm/send + "server key"
// endpoint the original design doc specified — Google decommissioned that
// endpoint in June 2024. firebase-admin + a service account is the current
// supported path.
function getFirebaseMessaging(): Messaging | null {
  if (cachedMessaging !== undefined) return cachedMessaging
  const projectId = process.env.FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_PRIVATE_KEY
  if (!projectId || !clientEmail || !privateKey) {
    console.warn('[FCM] Firebase server credentials not set — push skipped')
    cachedMessaging = null
    return null
  }
  const app: App = getApps()[0] ?? initializeApp({
    credential: cert({ projectId, clientEmail, privateKey: privateKey.replace(/\\n/g, '\n') }),
  })
  cachedMessaging = getMessaging(app)
  return cachedMessaging
}

// Shared by sendFCMToPlayer, broadcastFCM and broadcastPush (push.ts) so
// stale-token cleanup (FCM reporting a token as unregistered/invalid) lives
// in exactly one place. Batches in groups of 500 — the FCM multicast limit.
export async function sendToTokens(
  tokens: { id: string; token: string }[],
  notification: FCMNotification,
  data: Record<string, string>,
): Promise<void> {
  const messaging = getFirebaseMessaging()
  if (!messaging || tokens.length === 0) return
  const admin = createAdminClient()

  for (let i = 0; i < tokens.length; i += 500) {
    const chunk = tokens.slice(i, i + 500)
    const res = await messaging.sendEachForMulticast({
      tokens: chunk.map((t) => t.token),
      notification,
      data,
      webpush: { fcmOptions: { link: data.url } },
    })
    const staleIds: string[] = []
    res.responses.forEach((r, idx) => {
      const code = r.error?.code
      if (!r.success && (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token')) {
        staleIds.push(chunk[idx].id)
      }
    })
    if (staleIds.length > 0) await admin.from('fcm_tokens').delete().in('id', staleIds)
  }
}

export async function sendFCMToPlayer(
  playerId: string,
  notification: FCMNotification,
  data: Record<string, string>,
): Promise<void> {
  const messaging = getFirebaseMessaging()
  if (!messaging) return
  const admin = createAdminClient()
  const { data: tokens } = await admin.from('fcm_tokens').select('id, token').eq('player_id', playerId)
  await sendToTokens(tokens ?? [], notification, data)
}

// All tokens, no pref filtering — callers that need per-player pref
// filtering at broadcast scale use broadcastPush (push.ts) instead, which
// does its own filtered query and calls sendToTokens directly.
export async function broadcastFCM(notification: FCMNotification, data: Record<string, string>): Promise<void> {
  const messaging = getFirebaseMessaging()
  if (!messaging) return
  const admin = createAdminClient()
  const { data: tokens } = await admin.from('fcm_tokens').select('id, token')
  await sendToTokens(tokens ?? [], notification, data)
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/notifications/fcm.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/notifications/fcm.ts lib/notifications/fcm.test.ts package.json package-lock.json
git commit -m "feat(notifications): add dormant FCM sender (firebase-admin, not the decommissioned legacy endpoint)"
```

---

### Task 4: `lib/notifications/push.ts` — pref-gated tier-2 entry point + `broadcastInApp`

**Files:**
- Create: `lib/notifications/push.ts`
- Modify: `lib/notifications/inbox.ts` (add `broadcastInApp`)
- Test: `lib/notifications/push.test.ts`

**Interfaces:**
- Consumes: `sendFCMToPlayer`, `sendToTokens` from `./fcm` (Task 3); `PushNotificationType` from `./push-types` (Task 2).
- Produces: `pushToPlayer(playerId, type, notification, data)`, `broadcastPush(type, notification, data)`, `broadcastInApp(input)` — consumed by every remaining task.

- [ ] **Step 1: Write the failing test**

```ts
// lib/notifications/push.test.ts
import { describe, it, expect, vi } from 'vitest'

const sendFCMToPlayer = vi.fn().mockResolvedValue(undefined)
vi.mock('./fcm', () => ({ sendFCMToPlayer, sendToTokens: vi.fn() }))

const maybeSingle = vi.fn()
const eq = vi.fn(() => ({ maybeSingle }))
const select = vi.fn(() => ({ eq }))
const from = vi.fn(() => ({ select }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from }) }))

describe('pushToPlayer', () => {
  it('sends when the pref key is absent (default true)', async () => {
    maybeSingle.mockResolvedValueOnce({ data: { notification_prefs: { push: {} } } })
    const { pushToPlayer } = await import('./push')
    await pushToPlayer('p1', 'wager_settled', { title: 'T', body: 'B' }, { url: '/x' })
    expect(sendFCMToPlayer).toHaveBeenCalledWith('p1', { title: 'T', body: 'B' }, { url: '/x', type: 'wager_settled' })
  })

  it('skips when the player turned the type off', async () => {
    sendFCMToPlayer.mockClear()
    maybeSingle.mockResolvedValueOnce({ data: { notification_prefs: { push: { wager_settled: false } } } })
    const { pushToPlayer } = await import('./push')
    await pushToPlayer('p1', 'wager_settled', { title: 'T', body: 'B' }, { url: '/x' })
    expect(sendFCMToPlayer).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/notifications/push.test.ts`
Expected: FAIL — `Cannot find module './push'`

- [ ] **Step 3: Write the implementation**

```ts
// lib/notifications/push.ts
import { createAdminClient } from '@/lib/supabase/admin'
import { sendFCMToPlayer, sendToTokens, type FCMNotification } from './fcm'
import type { PushNotificationType } from './push-types'

// Tier 2 (FCM) entry point — mirrors notify()/notifyInApp()'s best-effort
// contract: never throws into the caller. Checks
// notification_prefs.push[type] first; the key defaults to true when
// absent, matching the seeded defaults in migration 062.
export async function pushToPlayer(
  playerId: string,
  type: PushNotificationType,
  notification: FCMNotification,
  data: Record<string, string>,
): Promise<void> {
  try {
    const admin = createAdminClient()
    const { data: profile } = await admin.from('profiles').select('notification_prefs').eq('id', playerId).maybeSingle()
    const push = (profile?.notification_prefs as { push?: Record<string, boolean> } | null)?.push
    if (push?.[type] === false) return
    await sendFCMToPlayer(playerId, notification, { ...data, type })
  } catch (err) {
    console.error('[push] pushToPlayer failed (non-blocking)', { playerId, type, err })
  }
}

// Broadcast variant for tournament_announced / new_announcement — filters
// per-player prefs itself (unlike broadcastFCM in fcm.ts, which sends to
// every token unconditionally) since a broadcast still has to respect each
// recipient's individual opt-out.
export async function broadcastPush(
  type: Extract<PushNotificationType, 'tournament_announced' | 'new_announcement'>,
  notification: FCMNotification,
  data: Record<string, string>,
): Promise<void> {
  try {
    const admin = createAdminClient()
    const { data: rows } = await admin
      .from('fcm_tokens')
      .select('id, token, profiles!inner(notification_prefs)')
    const eligible = (rows ?? [])
      .filter((r) => {
        const profile = r.profiles as { notification_prefs?: { push?: Record<string, boolean> } } | null
        return profile?.notification_prefs?.push?.[type] !== false
      })
      .map((r) => ({ id: r.id as string, token: r.token as string }))
    await sendToTokens(eligible, notification, { ...data, type })
  } catch (err) {
    console.error('[push] broadcastPush failed (non-blocking)', { type, err })
  }
}
```

Then, in `lib/notifications/inbox.ts`, add below `notifyInApp`:

```ts
// Bulk in-app insert for broadcast-scale events (tournament_announced,
// new_announcement). Chunked at 500 rows/insert — same batch size as the
// FCM multicast limit in fcm.ts, no deep reason they need to match, just
// convenient symmetry.
export async function broadcastInApp(input: {
  type: NotificationType
  title: string
  body: string
  link?: string
}): Promise<void> {
  try {
    const admin = createAdminClient()
    const { data: players } = await admin.from('profiles').select('id')
    const ids = (players ?? []).map((p) => p.id as string)
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500)
      await admin.from('player_notifications').insert(
        chunk.map((playerId) => ({
          player_id: playerId,
          type: input.type,
          title: input.title,
          body: input.body,
          link: input.link ?? null,
        })),
      )
    }
  } catch (err) {
    console.error('[inbox] broadcastInApp failed (non-blocking)', { type: input.type, err })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/notifications/push.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/notifications/push.ts lib/notifications/push.test.ts lib/notifications/inbox.ts
git commit -m "feat(notifications): add pref-gated pushToPlayer/broadcastPush and broadcastInApp"
```

---

### Task 5: Fix the `prize_credited` / `withdrawal_paid` bug + add push

**Files:**
- Modify: `lib/wallet/admin-actions.ts:48-59`

**Interfaces:**
- Consumes: `pushToPlayer` from `@/lib/notifications/push` (Task 4).

**Context:** `/dashboard/settings` already has a working "Prize credited to wallet" WhatsApp toggle (`lib/settings/notification-prefs.ts`, `components/settings/NotificationPrefsForm.tsx`) keyed on `prize_credited` — but nothing has ever fired that type. `resolveWalletWithdrawal`'s "paid" branch fires `withdrawal_paid` instead, so the toggle has always been dead. Fix: fire `prize_credited` for the paid case (the rejection case keeps `withdrawal_rejected` — there's no `prize_credited`-style pref or push key for rejections).

- [ ] **Step 1: Edit the notifyInApp call and add pushToPlayer**

```ts
// lib/wallet/admin-actions.ts — replace lines 48-59
  await notifyInApp({
    playerId: wr.player_id,
    type: action === 'paid' ? 'prize_credited' : 'withdrawal_rejected',
    title: action === 'paid' ? 'Prize credited' : 'Withdrawal rejected',
    body:
      action === 'paid'
        ? `${formatNaira(wr.amount)} has been approved for withdrawal.`
        : note
          ? `Your withdrawal request was rejected: ${note}`
          : 'Your withdrawal request was rejected.',
    link: '/dashboard#wallet',
  })
  if (action === 'paid') {
    void pushToPlayer(
      wr.player_id,
      'prize_credited',
      { title: 'Prize credited', body: `${formatNaira(wr.amount)} has been approved for withdrawal.` },
      { url: '/dashboard#wallet' },
    )
  }
```

Add the import at the top of the file:

```ts
import { pushToPlayer } from '@/lib/notifications/push'
```

- [ ] **Step 2: Manually verify**

Run: `npx vitest run` (no existing test covers this file — confirm the full suite still passes, since `notifyInApp`'s type string changed).
Expected: PASS, no failures referencing `lib/wallet/admin-actions.ts` or `withdrawal_paid`.

- [ ] **Step 3: Commit**

```bash
git add lib/wallet/admin-actions.ts
git commit -m "fix(wallet): fire prize_credited instead of dead withdrawal_paid type, add FCM push"
```

---

### Task 6: Add `pushToPlayer` to the 5 remaining already-wired call sites

**Files:**
- Modify: `lib/notifications/fixture-created.ts:37-62` (match_assigned)
- Modify: `lib/matches/verify-actions.ts:448-467` (result_confirmed)
- Modify: `lib/referrals/actions.ts:95-101` (referral_converted)
- Modify: `lib/achievements/unlock.ts:69-75` (achievement_unlocked)
- Modify: `app/api/cron/fixture-reminders/route.ts:64-75` (match_reminder — also adds the in-app tier, which this route currently skips entirely)

**Interfaces:**
- Consumes: `pushToPlayer` from `@/lib/notifications/push` (Task 4).

- [ ] **Step 1: `fixture-created.ts`** — add the import, then inside the `for (const pid of [r.playerAId, r.playerBId])` loop, after the existing `notifyInApp(...)` call:

```ts
    void pushToPlayer(
      pid,
      'match_assigned',
      { title: 'New fixture', body: `${a} vs ${b} — ${tournament}` },
      { url: matchUrl },
    )
```

- [ ] **Step 2: `verify-actions.ts`** — add the import, then inside the `for (const pid of [nd.player_a_id, nd.player_b_id])` loop, after the existing `notifyInApp(...)` call:

```ts
      void pushToPlayer(
        pid,
        'result_confirmed',
        { title: 'Result confirmed', body: `${a} ${scoreA} – ${scoreB} ${b} — confirmed for ${title}.` },
        { url: `/matches/${id}` },
      )
```

- [ ] **Step 3: `referrals/actions.ts`** — add the import, then inside `settleReferral`, right after the existing `notifyInApp({...type: 'referral_credited'...})` call:

```ts
    void pushToPlayer(
      referrerId,
      'referral_converted',
      { title: 'Referral credited', body: `${referredName} just competed for the first time — +${REFERRAL_BASE_REWARD_COINS} SX Coins added.` },
      { url: '/dashboard/referrals' },
    )
```

- [ ] **Step 4: `achievements/unlock.ts`** — add the import, then inside `unlock()`, right after the existing `notifyInApp({...})` call:

```ts
  void pushToPlayer(
    playerId,
    'achievement_unlocked',
    { title: 'Achievement unlocked!', body: `${achievement.name} — +${achievement.xp_reward} XP, +${achievement.coin_reward} SX Coins.` },
    { url: '/dashboard' },
  )
```

- [ ] **Step 5: `app/api/cron/fixture-reminders/route.ts`** — this route currently only calls `notify()` (WhatsApp) — it has never called `notifyInApp()`, so match reminders don't reach the bell today either. Add both. Add the imports (`notifyInApp` from `@/lib/notifications/inbox`, `pushToPlayer` from `@/lib/notifications/push`), and replace the `for (const pid of [m.player_a_id, m.player_b_id])` loop body:

```ts
    for (const pid of [m.player_a_id, m.player_b_id]) {
      await notify({
        type: 'fixture_reminder',
        playerId: pid,
        dedupeKey: reminderKey(m.id, pid),
        playerA: a,
        playerB: b,
        tournament,
        matchUrl,
      })
      const opponent = pid === m.player_a_id ? b : a
      void notifyInApp({
        playerId: pid,
        type: 'match_reminder',
        title: 'Match in 1 hour',
        body: `${tournament} · vs ${opponent}`,
        link: matchUrl,
      })
      void pushToPlayer(
        pid,
        'match_reminder',
        { title: 'Match in 1 hour', body: `${tournament} · vs ${opponent}` },
        { url: matchUrl },
      )
      reminded += 1
    }
```

This depends on `'match_reminder'` already being a member of the in-app `NotificationType` union (Task 2) and the `player_notifications_type_check` CHECK constraint (Task 1) — both already include it as written above, so no further schema change is needed here.

- [ ] **Step 6: Run the full suite**

Run: `npx vitest run`
Expected: PASS — these are additive `void`-called side effects; no existing test asserts on the absence of a push/in-app call.

- [ ] **Step 7: Commit**

```bash
git add lib/notifications/fixture-created.ts lib/matches/verify-actions.ts lib/referrals/actions.ts lib/achievements/unlock.ts app/api/cron/fixture-reminders/route.ts
git commit -m "feat(notifications): add FCM push (and in-app for reminders) alongside the 5 existing call sites"
```

---

### Task 7: Community integration — `post_comment`, `post_reaction`, `challenge_completed`

**Files:**
- Modify: `lib/community/comment-actions.ts`
- Modify: `lib/community/reaction-actions.ts`
- Modify: `lib/community/challenges.ts`
- Test: `lib/community/comment-actions.test.ts` (new — the self-comment skip is real logic worth a unit test)

**Interfaces:**
- Consumes: `notifyInApp` from `@/lib/notifications/inbox`, `pushToPlayer` from `@/lib/notifications/push`.

- [ ] **Step 1: Write the failing test for the self-comment skip**

```ts
// lib/community/comment-actions.test.ts
import { describe, it, expect, vi } from 'vitest'

const notifyInApp = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/notifications/inbox', () => ({ notifyInApp }))
const pushToPlayer = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/notifications/push', () => ({ pushToPlayer }))

const insertSingle = vi.fn()
const single = vi.fn(() => insertSingle())
const select = vi.fn(() => ({ single }))
const insert = vi.fn(() => ({ select }))
const maybeSingle = vi.fn()
const eqAuthor = vi.fn(() => ({ maybeSingle }))
const selectAuthor = vi.fn(() => ({ eq: eqAuthor }))
const from = vi.fn((table: string) => (table === 'post_comments' ? { insert } : { select: selectAuthor }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'commenter-1' } } }) },
    from,
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

describe('createComment notifications', () => {
  it('does not notify when the author comments on their own post', async () => {
    insertSingle.mockResolvedValueOnce({ data: { id: 'c1' }, error: null })
    maybeSingle.mockResolvedValueOnce({ data: { author_id: 'commenter-1', content: 'x' } })
    const { createComment } = await import('./comment-actions')
    await createComment({ postId: 'post-1', content: 'nice post' })
    expect(notifyInApp).not.toHaveBeenCalled()
    expect(pushToPlayer).not.toHaveBeenCalled()
  })

  it('notifies the post author when someone else comments', async () => {
    insertSingle.mockResolvedValueOnce({ data: { id: 'c1' }, error: null })
    maybeSingle.mockResolvedValueOnce({ data: { author_id: 'author-1', content: 'x' } })
    const { createComment } = await import('./comment-actions')
    await createComment({ postId: 'post-1', content: 'nice post' })
    expect(notifyInApp).toHaveBeenCalledWith(expect.objectContaining({ playerId: 'author-1', type: 'post_comment' }))
    expect(pushToPlayer).toHaveBeenCalledWith('author-1', 'post_comment', expect.anything(), expect.anything())
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/community/comment-actions.test.ts`
Expected: FAIL — no notification calls exist yet in `createComment`.

- [ ] **Step 3: Implement `comment-actions.ts`**

```ts
// lib/community/comment-actions.ts — add imports
import { notifyInApp } from '@/lib/notifications/inbox'
import { pushToPlayer } from '@/lib/notifications/push'
```

Inside `createComment`, after the successful insert (replacing the `revalidatePath` line and return with):

```ts
  const { data: post } = await supabase.from('community_posts').select('author_id, content').eq('id', input.postId).maybeSingle()
  if (post?.author_id && post.author_id !== user.id) {
    const excerpt = parsed.data.length > 60 ? `${parsed.data.slice(0, 60)}…` : parsed.data
    void notifyInApp({
      playerId: post.author_id,
      type: 'post_comment',
      title: 'New comment',
      body: excerpt,
      link: `/community/${input.postId}`,
    })
    void pushToPlayer(
      post.author_id,
      'post_comment',
      { title: 'New comment', body: excerpt },
      { url: `/community/${input.postId}` },
    )
  }

  revalidatePath(`/community/${input.postId}`)
  return { id: comment.id }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/community/comment-actions.test.ts`
Expected: PASS

- [ ] **Step 5: Implement `reaction-actions.ts`** — `post_reaction` is in-app only (spec: `{inApp: true, fcm: false, whatsapp: false}`), and only on a brand-new reaction (the insert branch), not on toggle-off or reaction-swap:

```ts
// lib/community/reaction-actions.ts — add import
import { notifyInApp } from '@/lib/notifications/inbox'
```

Replace the final block (`const { error } = await supabase.from('post_reactions').insert(...)`) with:

```ts
  const { error } = await supabase.from('post_reactions').insert({ post_id: postId, player_id: user.id, reaction: parsed.data })
  if (error) return { error: 'Could not save your reaction.' }

  const admin = createAdminClient()
  await incrementChallenge(admin, user.id, 'reactions_given')

  const { data: post } = await admin.from('community_posts').select('author_id').eq('id', postId).maybeSingle()
  if (post?.author_id && post.author_id !== user.id) {
    void notifyInApp({
      playerId: post.author_id,
      type: 'post_reaction',
      title: 'New reaction',
      body: `Someone reacted ${parsed.data} to your post.`,
      link: `/community/${postId}`,
    })
  }
  return undefined
```

- [ ] **Step 6: Implement `challenges.ts`** — inside `incrementChallenge`, after the reward is recorded (right after the `if (challenge.xp_reward > 0) await awardXP(...)` line):

```ts
// lib/community/challenges.ts — add imports
import { notifyInApp } from '@/lib/notifications/inbox'
import { pushToPlayer } from '@/lib/notifications/push'
```

```ts
      if (challenge.xp_reward > 0) await awardXP(admin, playerId, challenge.xp_reward, 'weekly_challenge', challenge.id)
      void notifyInApp({
        playerId,
        type: 'wallet_credited',
        title: 'Challenge complete!',
        body: `${challenge.title} — +${challenge.coin_reward} SX Coins, +${challenge.xp_reward} XP.`,
        link: '/community',
      })
      void pushToPlayer(
        playerId,
        'challenge_completed',
        { title: 'Challenge complete!', body: `${challenge.title} — +${challenge.coin_reward} SX Coins, +${challenge.xp_reward} XP.` },
        { url: '/community' },
      )
```

Note: the in-app `type` here is `'wallet_credited'`, not `'challenge_completed'` — the in-app `NotificationType` union has no `challenge_completed` member and none is needed (`wallet_credited` already renders fine for a coins-earned message; only the FCM/push side uses the dedicated `PushNotificationType` key). Do not add `challenge_completed` to the in-app union or the migration's CHECK constraint — it would be unused.

- [ ] **Step 7: Run the full suite**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add lib/community/comment-actions.ts lib/community/comment-actions.test.ts lib/community/reaction-actions.ts lib/community/challenges.ts
git commit -m "feat(notifications): wire post_comment, post_reaction, challenge_completed"
```

---

### Task 8: Wager settlement — `wager_settled`

**Files:**
- Modify: `lib/wagers/settle.ts`
- Test: `lib/wagers/settle.test.ts` — check if this file already exists first; if it does, add to it instead of assuming it doesn't.

**Interfaces:**
- Consumes: `notifyInApp` from `@/lib/notifications/inbox`, `pushToPlayer` from `@/lib/notifications/push`.

- [ ] **Step 1: Check for an existing test file**

Run: `ls lib/wagers/settle.test.ts 2>&1 || echo "no existing test"`. If it exists, read it fully before adding — match its existing mocking style instead of introducing a second pattern.

- [ ] **Step 2: Write the failing test**

```ts
// lib/wagers/settle.test.ts (add to existing file, or create if none exists)
import { describe, it, expect, vi } from 'vitest'

const notifyInApp = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/notifications/inbox', () => ({ notifyInApp }))
const pushToPlayer = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/notifications/push', () => ({ pushToPlayer }))
vi.mock('@/lib/coins/service', () => ({ recordCoinTransaction: vi.fn().mockResolvedValue(undefined) }))

describe('settleMatchWagers notifications', () => {
  it('notifies both a winning and a losing bettor with different messages', async () => {
    const rows = [
      { id: 'w1', bettor_id: 'winner-1', pick_player_id: 'player-A', stake_coins: 100 },
      { id: 'w2', bettor_id: 'loser-1', pick_player_id: 'player-B', stake_coins: 50 },
    ]
    const admin = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ data: rows }) })) })),
        update: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) })),
        insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      })),
    } as unknown as Parameters<typeof import('./settle').settleMatchWagers>[0]
    const { settleMatchWagers } = await import('./settle')
    await settleMatchWagers(admin, 'match-1', 'player-A')
    expect(notifyInApp).toHaveBeenCalledWith(expect.objectContaining({ playerId: 'winner-1', type: 'wager_settled' }))
    expect(notifyInApp).toHaveBeenCalledWith(expect.objectContaining({ playerId: 'loser-1', type: 'wager_settled' }))
    expect(pushToPlayer).toHaveBeenCalledWith('winner-1', 'wager_settled', expect.anything(), expect.anything())
    expect(pushToPlayer).toHaveBeenCalledWith('loser-1', 'wager_settled', expect.anything(), expect.anything())
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run lib/wagers/settle.test.ts`
Expected: FAIL — no notification calls exist in `settleMatchWagers` yet.

- [ ] **Step 4: Implement**

Add imports to `lib/wagers/settle.ts`:

```ts
import { notifyInApp } from '@/lib/notifications/inbox'
import { pushToPlayer } from '@/lib/notifications/push'
```

Inside the `for (const w of wagers)` loop in `settleMatchWagers`, after the existing status-update branches:

```ts
    const won = payout > 0
    const body = won
      ? `You won ${payout} SX Coins on this match.`
      : `Your ${w.stakeCoins}-coin wager didn't hit this time.`
    void notifyInApp({ playerId: w.bettorId, type: 'wager_settled', title: won ? 'Wager won!' : 'Wager settled', body, link: `/matches/${matchId}` })
    void pushToPlayer(w.bettorId, 'wager_settled', { title: won ? 'Wager won!' : 'Wager settled', body }, { url: `/matches/${matchId}` })
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/wagers/settle.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/wagers/settle.ts lib/wagers/settle.test.ts
git commit -m "feat(notifications): notify bettors on wager settlement (in-app + push)"
```

---

### Task 9: Broadcasts — `tournament_announced`, `new_announcement`

**Files:**
- Modify: `lib/tournaments/admin-actions.ts:171-209` (`openRegistration`)
- Modify: `lib/community/admin-actions.ts:13-33` (`createAnnouncement`)

**Interfaces:**
- Consumes: `broadcastInApp` from `@/lib/notifications/inbox` (Task 4), `broadcastPush` from `@/lib/notifications/push` (Task 4).

- [ ] **Step 1: `openRegistration`** — add `title` to the existing `.select(...)` (line 182-184) and add the broadcast after the status update succeeds:

```ts
// lib/tournaments/admin-actions.ts — add import
import { broadcastInApp } from '@/lib/notifications/inbox'
import { broadcastPush } from '@/lib/notifications/push'
```

Change the select at line 182-184 to include `title`:

```ts
    .select(
      'status, title, game_id, max_players, registration_fee, prize_pool, registration_start, registration_end, tournament_start, tournament_end',
    )
```

After `if (error) return { error: 'Could not open registration.' }` and before `revalidatePath('/admin/tournaments')`:

```ts
  void broadcastInApp({
    type: 'tournament_announced',
    title: 'New tournament!',
    body: `${t.title} is open for registration.`,
    link: '/tournaments',
  })
  void broadcastPush(
    'tournament_announced',
    { title: 'New tournament!', body: `${t.title} is open for registration.` },
    { url: '/tournaments' },
  )
```

- [ ] **Step 2: `createAnnouncement`** — add the broadcast after the insert succeeds:

```ts
// lib/community/admin-actions.ts — add import
import { broadcastInApp } from '@/lib/notifications/inbox'
import { broadcastPush } from '@/lib/notifications/push'
```

After `if (error) return { error: 'Could not create the announcement.' }` and before `revalidatePath('/community')`:

```ts
  const excerpt = parsed.data.length > 80 ? `${parsed.data.slice(0, 80)}…` : parsed.data || 'Check the community feed.'
  void broadcastInApp({ type: 'new_announcement', title: 'New announcement', body: excerpt, link: '/community' })
  void broadcastPush('new_announcement', { title: 'New announcement', body: excerpt }, { url: '/community' })
```

- [ ] **Step 3: Run the full suite**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add lib/tournaments/admin-actions.ts lib/community/admin-actions.ts
git commit -m "feat(notifications): broadcast tournament_announced and new_announcement"
```

---

### Task 10: Firebase client setup (service worker, client SDK, env vars)

**Files:**
- Create: `public/firebase-messaging-sw.js`
- Create: `lib/firebase/client.ts`
- Modify: `.env.local.example`
- Modify: `package.json` (add `firebase` client dependency)

**Interfaces:**
- Produces: `getFirebaseApp()` from `lib/firebase/client.ts` — consumed by Task 11 (`useFCM.ts`).

- [ ] **Step 1: Add the client dependency**

```bash
npm install firebase
```

- [ ] **Step 2: `lib/firebase/client.ts`**

```ts
// lib/firebase/client.ts
'use client'
import { getApps, initializeApp, type FirebaseApp } from 'firebase/app'

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
}

// Returns null when the project hasn't configured Firebase yet — every
// caller (useFCM.ts) must treat null as "push isn't available here",
// matching the dormant-until-configured contract used everywhere else in
// the notification system.
export function getFirebaseApp(): FirebaseApp | null {
  if (!firebaseConfig.apiKey || !firebaseConfig.projectId) return null
  return getApps()[0] ?? initializeApp(firebaseConfig)
}
```

- [ ] **Step 3: `public/firebase-messaging-sw.js`**

```js
// public/firebase-messaging-sw.js
// Must live at the site root — this is a Firebase Cloud Messaging
// requirement, not a project convention. Config values can't reach a
// service worker via process.env (there's no bundler step for files under
// public/), so useFCM.ts passes them as URL query params when it registers
// this worker, and they're read from `self.location.search` here.
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js')

const params = new URLSearchParams(self.location.search)
firebase.initializeApp({
  apiKey: params.get('apiKey'),
  authDomain: params.get('authDomain'),
  projectId: params.get('projectId'),
  messagingSenderId: params.get('messagingSenderId'),
  appId: params.get('appId'),
})

const messaging = firebase.messaging()

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title ?? 'SentinelX'
  self.registration.showNotification(title, {
    body: payload.notification?.body,
    icon: '/logo-icon.png',
    data: payload.data,
  })
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url ?? '/'
  event.waitUntil(clients.openWindow(url))
})
```

- [ ] **Step 4: Update `.env.local.example`**

Append after the existing `META_WHATSAPP_OTP_TEMPLATE=otp_verification` block:

```
# Push notifications (Firebase Cloud Messaging) — leave blank to disable
# sending (no-op), same pattern as TERMII_API_KEY above. The NEXT_PUBLIC_*
# values come from Firebase Console → Project settings → General → Your
# apps → Web app config. FIREBASE_PRIVATE_KEY/CLIENT_EMAIL come from
# Project settings → Service accounts → Generate new private key.
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
NEXT_PUBLIC_FIREBASE_VAPID_KEY=
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
```

- [ ] **Step 5: Manually verify**

Run: `npm run build` — confirm the new files don't break the build (no test coverage possible for a raw service-worker file or an env-driven client singleton with no logic branches worth a unit test).
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add public/firebase-messaging-sw.js lib/firebase/client.ts .env.local.example package.json package-lock.json
git commit -m "feat(notifications): Firebase client SDK + service worker, dormant until configured"
```

---

### Task 11: FCM token API route + `useFCM` hook + permission prompt

**Files:**
- Create: `app/api/notifications/fcm-token/route.ts`
- Create: `components/notifications/useFCM.ts`
- Create: `components/notifications/PushPermissionPrompt.tsx`

**Interfaces:**
- Consumes: `getFirebaseApp` from `@/lib/firebase/client` (Task 10); `fcm_tokens` table (Task 1).
- Produces: `requestPushPermission()`, `disablePush()` from `useFCM.ts` — consumed by Task 12 (settings page) and the logout flow.

- [ ] **Step 1: `app/api/notifications/fcm-token/route.ts`**

```ts
// app/api/notifications/fcm-token/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: Request) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

  const { token } = (await req.json()) as { token?: string }
  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 })

  const { error } = await supabase
    .from('fcm_tokens')
    .upsert({ player_id: user.id, token, last_active: new Date().toISOString() }, { onConflict: 'token' })
  if (error) return NextResponse.json({ error: 'Could not save token' }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

  const { token } = (await req.json().catch(() => ({}))) as { token?: string }
  const query = supabase.from('fcm_tokens').delete().eq('player_id', user.id)
  if (token) query.eq('token', token)
  const { error } = await query
  if (error) return NextResponse.json({ error: 'Could not remove token' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
```

Note: `fcm_tokens.token` is `UNIQUE` (Task 1) — the `POST` upsert's `onConflict: 'token'` relies on that constraint, and RLS's `fcm_tokens_owner` policy (`player_id = auth.uid()`) means a player can only ever upsert/delete their own rows regardless.

- [ ] **Step 2: `components/notifications/useFCM.ts`**

```ts
// components/notifications/useFCM.ts
'use client'
import { getFirebaseApp } from '@/lib/firebase/client'

function swQueryString(): string {
  const p = new URLSearchParams({
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? '',
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? '',
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '',
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? '',
  })
  return p.toString()
}

// Called only from an explicit user action (Settings' "Enable Push
// Notifications" button, or PushPermissionPrompt after a meaningful event)
// — never on page load. Returns false if push isn't available (no Firebase
// project configured, permission denied, or unsupported browser) so the
// caller can show an appropriate message instead of assuming success.
export async function requestPushPermission(): Promise<boolean> {
  const app = getFirebaseApp()
  if (!app || typeof window === 'undefined' || !('Notification' in window)) return false

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return false

  const registration = await navigator.serviceWorker.register(`/firebase-messaging-sw.js?${swQueryString()}`)
  const { getMessaging, getToken } = await import('firebase/messaging')
  const messaging = getMessaging(app)
  const token = await getToken(messaging, {
    vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY,
    serviceWorkerRegistration: registration,
  })
  if (!token) return false

  const res = await fetch('/api/notifications/fcm-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  })
  return res.ok
}

// Called from the Settings "Disable" button and from signOut() — removes
// every token for the current player rather than tracking "this device's"
// token client-side, which keeps the call trivially simple at the cost of
// also deregistering push on the player's other devices. Acceptable: the
// player can re-enable per-device from Settings.
export async function disablePush(): Promise<void> {
  await fetch('/api/notifications/fcm-token', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: '{}' })
}
```

- [ ] **Step 3: `components/notifications/PushPermissionPrompt.tsx`**

```tsx
// components/notifications/PushPermissionPrompt.tsx
'use client'
import { useState } from 'react'
import { requestPushPermission } from './useFCM'

// A small dismissible banner, not a modal — shown by a parent after a
// meaningful event (first registration, first result confirmed). The
// parent owns whether/when to render this; this component only owns the
// button's pending/result state.
export function PushPermissionPrompt({ onDismiss }: { onDismiss: () => void }) {
  const [status, setStatus] = useState<'idle' | 'pending' | 'granted' | 'denied'>('idle')

  async function handleEnable() {
    setStatus('pending')
    const ok = await requestPushPermission()
    setStatus(ok ? 'granted' : 'denied')
    if (ok) setTimeout(onDismiss, 1500)
  }

  if (status === 'granted') {
    return <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm text-emerald-300">Push notifications enabled 🎮</div>
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-sx-border bg-sx-surface p-4">
      <p className="text-sm text-white">Get notified the moment your match result is confirmed — even off-site.</p>
      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          onClick={handleEnable}
          disabled={status === 'pending'}
          className="rounded-lg bg-sx-purple px-4 py-2 text-xs font-bold text-white hover:bg-sx-purple-light disabled:opacity-60"
        >
          {status === 'pending' ? 'Enabling…' : 'Enable'}
        </button>
        <button type="button" onClick={onDismiss} className="rounded-lg px-3 py-2 text-xs text-sx-gray hover:text-white">
          Not now
        </button>
      </div>
      {status === 'denied' && <p className="text-xs text-red-400">Could not enable push — check your browser's notification permission.</p>}
    </div>
  )
}
```

- [ ] **Step 4: Manually verify**

Run: `npm run build`
Expected: build succeeds. (No unit test for this task — it's browser-API-driven client code with no pure logic to isolate; matches the repo's existing convention of not testing client components.)

- [ ] **Step 5: Commit**

```bash
git add app/api/notifications/fcm-token/route.ts components/notifications/useFCM.ts components/notifications/PushPermissionPrompt.tsx
git commit -m "feat(notifications): FCM token API route, useFCM hook, permission prompt"
```

---

### Task 12: Settings UI — push notification prefs

**Files:**
- Modify: `lib/settings/notification-prefs.ts` (add `updatePushPrefs`)
- Create: `components/settings/PushPrefsForm.tsx`
- Modify: `app/dashboard/settings/page.tsx`
- Modify: `lib/auth/actions.ts` (call `disablePush()` on sign-out — check the file first, see step 4)

**Interfaces:**
- Consumes: `requestPushPermission`, `disablePush` from `@/components/notifications/useFCM` (Task 11); `jsonb_merge_notification_prefs` RPC (existing, migration 062).

- [ ] **Step 1: `lib/settings/notification-prefs.ts`** — add below `updateAchievementSharingPrefs`:

```ts
const pushPrefsSchema = z.object({
  match_reminder: z.boolean(),
  result_confirmed: z.boolean(),
  achievement_unlocked: z.boolean(),
  challenge_completed: z.boolean(),
  new_announcement: z.boolean(),
  tournament_announced: z.boolean(),
  wager_settled: z.boolean(),
  referral_converted: z.boolean(),
  post_comment: z.boolean(),
  post_reaction: z.boolean(),
  bracket_released: z.boolean(),
  match_assigned: z.boolean(),
  prize_credited: z.boolean(),
})

export async function updatePushPrefs(_prev: PrefsState, formData: FormData): Promise<PrefsState> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }

  const keys = Object.keys(pushPrefsSchema.shape) as (keyof typeof pushPrefsSchema.shape)[]
  const parsed = pushPrefsSchema.safeParse(Object.fromEntries(keys.map((k) => [k, boolFromForm(formData, k)])))
  if (!parsed.success) return { error: 'Invalid preferences.' }

  const { error } = await supabase.rpc('jsonb_merge_notification_prefs', {
    p_id: user.id,
    p_key: 'push',
    p_patch: parsed.data,
  })
  if (error) {
    console.error('updatePushPrefs failed', error)
    return { error: 'Could not save your preferences. Please try again.' }
  }
  revalidatePath('/dashboard/settings')
  return { success: true }
}
```

- [ ] **Step 2: `components/settings/PushPrefsForm.tsx`**

```tsx
// components/settings/PushPrefsForm.tsx
'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { updatePushPrefs, type PrefsState } from '@/lib/settings/notification-prefs'
import { requestPushPermission, disablePush } from '@/components/notifications/useFCM'

export interface PushPrefs {
  match_reminder: boolean
  result_confirmed: boolean
  achievement_unlocked: boolean
  challenge_completed: boolean
  new_announcement: boolean
  tournament_announced: boolean
  wager_settled: boolean
  referral_converted: boolean
  post_comment: boolean
  post_reaction: boolean
  bracket_released: boolean
  match_assigned: boolean
  prize_credited: boolean
}

const LABELS: [keyof PushPrefs, string][] = [
  ['match_reminder', 'Match reminders'],
  ['match_assigned', 'New fixture assigned'],
  ['bracket_released', 'Bracket released'],
  ['result_confirmed', 'Result confirmed'],
  ['prize_credited', 'Prize credited'],
  ['achievement_unlocked', 'Achievement unlocked'],
  ['challenge_completed', 'Weekly challenge completed'],
  ['wager_settled', 'Wager settled'],
  ['referral_converted', 'Referral converted'],
  ['post_comment', 'Comments on your posts'],
  ['post_reaction', 'Reactions on your posts'],
  ['new_announcement', 'Community announcements'],
  ['tournament_announced', 'New tournaments'],
]

export function PushPrefsForm({ prefs, enabled }: { prefs: PushPrefs; enabled: boolean }) {
  const [state, formAction] = useFormState<PrefsState, FormData>(updatePushPrefs, undefined)
  const [pushEnabled, setPushEnabled] = useState(enabled)
  const [busy, setBusy] = useState(false)
  const [customize, setCustomize] = useState(false)

  async function handleToggle() {
    setBusy(true)
    if (pushEnabled) {
      await disablePush()
      setPushEnabled(false)
    } else {
      const ok = await requestPushPermission()
      setPushEnabled(ok)
    }
    setBusy(false)
  }

  return (
    <section className="rounded-2xl border border-sx-border bg-sx-surface p-5">
      <h2 className="text-sm font-bold uppercase tracking-wide text-white">Push Notifications</h2>
      <p className="mt-1 text-xs text-sx-gray">Receive browser notifications even when you&apos;re not on the site.</p>
      <div className="mt-4 flex items-center justify-between border-t border-sx-border pt-4">
        <span className="text-sm text-white">Status: {pushEnabled ? '✅ Enabled' : 'Not enabled'}</span>
        <button
          type="button"
          onClick={handleToggle}
          disabled={busy}
          className="rounded-lg bg-sx-purple px-4 py-2 text-xs font-bold text-white hover:bg-sx-purple-light disabled:opacity-60"
        >
          {pushEnabled ? 'Disable' : 'Enable Push Notifications'}
        </button>
      </div>
      {pushEnabled && (
        <>
          <button type="button" onClick={() => setCustomize((c) => !c)} className="mt-3 text-xs text-sx-purple-text hover:underline">
            {customize ? 'Hide' : 'Customize →'}
          </button>
          {customize && (
            <form action={formAction} className="mt-3 space-y-3 border-t border-sx-border pt-4">
              {LABELS.map(([key, label]) => (
                <label key={key} className="flex items-center justify-between text-sm text-white">
                  {label}
                  <input type="checkbox" name={key} defaultChecked={prefs[key]} className="h-5 w-5 accent-sx-purple" />
                </label>
              ))}
              {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
              {state?.success && <p className="text-sm text-emerald-400">Saved.</p>}
              <button type="submit" className="rounded-lg bg-sx-purple px-5 py-2.5 text-sm font-bold text-white hover:bg-sx-purple-light">
                Save Changes
              </button>
            </form>
          )}
        </>
      )}
    </section>
  )
}
```

- [ ] **Step 3: Wire into `app/dashboard/settings/page.tsx`**

Change the `prefs` cast (line 30-33) to include `push`:

```ts
  const prefs = (row?.notification_prefs ?? {}) as {
    whatsapp?: Record<string, boolean>
    push?: Record<string, boolean>
    achievement_sharing?: Record<string, boolean>
  }
```

Add the import and, right after the `<NotificationPrefsForm ... />` block, render:

```tsx
        <PushPrefsForm
          prefs={{
            match_reminder: prefs.push?.match_reminder ?? true,
            result_confirmed: prefs.push?.result_confirmed ?? true,
            achievement_unlocked: prefs.push?.achievement_unlocked ?? true,
            challenge_completed: prefs.push?.challenge_completed ?? true,
            new_announcement: prefs.push?.new_announcement ?? true,
            tournament_announced: prefs.push?.tournament_announced ?? true,
            wager_settled: prefs.push?.wager_settled ?? true,
            referral_converted: prefs.push?.referral_converted ?? true,
            post_comment: prefs.push?.post_comment ?? true,
            post_reaction: prefs.push?.post_reaction ?? false,
            bracket_released: prefs.push?.bracket_released ?? true,
            match_assigned: prefs.push?.match_assigned ?? true,
            prize_credited: prefs.push?.prize_credited ?? true,
          }}
          enabled={false}
        />
```

Note `enabled={false}` is always the server-rendered default — actual enabled/disabled state lives in the browser's `Notification.permission` + whether a token was ever saved, which is client-only state `PushPrefsForm` can't know from a server component prop. This is an acceptable simplification for this plan: the button always starts as "Not enabled" on page load and reflects reality only within the current client session after the player interacts with it. Note this as a known limitation in the final report — do not attempt to solve it with an extra `fcm_tokens` existence check in this task; that's an enhancement, not a defect blocking ship.

- [ ] **Step 4: Wire `disablePush()` into sign-out**

Read `lib/auth/actions.ts` in full first. Find `signOut()`. Add, before the actual Supabase sign-out call:

```ts
  // Best-effort — a failed token cleanup must never block sign-out.
  try {
    await fetch(`${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/api/notifications/fcm-token`, { method: 'DELETE' })
  } catch {
    // ignore
  }
```

If `signOut()` is a Server Action (likely, given the rest of the auth system per CLAUDE.md), a server-side `fetch` back to the app's own API route works but is unusual — check whether `lib/auth/actions.ts` has access to a request-scoped Supabase client that could instead delete `fcm_tokens` directly via `createClient().from('fcm_tokens').delete().eq('player_id', user.id)` before calling `supabase.auth.signOut()`. **Prefer the direct Supabase delete over a self-fetch if `signOut()` already has the user's id in scope** — it avoids a same-origin fetch from server code entirely. Only fall back to the `fetch` approach if `signOut()` doesn't already have the user id available.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/settings/notification-prefs.ts components/settings/PushPrefsForm.tsx app/dashboard/settings/page.tsx lib/auth/actions.ts
git commit -m "feat(notifications): push prefs settings UI, enable/disable, cleanup on sign-out"
```

---

### Task 13: Notification drawer — replace the dropdown, add realtime + pagination

**Files:**
- Create: `components/shared/NotificationDrawer.tsx`
- Create: `lib/notifications/drawer-actions.ts`
- Modify: `components/shared/NotificationBell.tsx`

**Interfaces:**
- Consumes: `NotificationItem`, `NavSession` from `@/lib/nav/session` (existing, unchanged).
- Produces: `markNotificationRead(id)`, `markAllNotificationsRead()`, `loadMoreNotifications(offset)` — used only by `NotificationDrawer.tsx`.

**Context:** The existing dropdown's own code comment (`components/shared/NotificationBell.tsx`) explicitly flags itself as a placeholder for this exact rebuild — this task is expected, not a scope add.

- [ ] **Step 1: `lib/notifications/drawer-actions.ts`**

```ts
// lib/notifications/drawer-actions.ts
'use server'
import { createClient } from '@/lib/supabase/server'
import type { NotificationItem } from '@/lib/nav/session'

export async function markNotificationRead(id: string): Promise<void> {
  const supabase = createClient()
  await supabase.from('player_notifications').update({ read: true }).eq('id', id)
}

export async function markAllNotificationsRead(): Promise<void> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return
  await supabase.from('player_notifications').update({ read: true }).eq('player_id', user.id).eq('read', false)
}

export async function loadMoreNotifications(offset: number): Promise<NotificationItem[]> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []
  const { data } = await supabase
    .from('player_notifications')
    .select('id, type, title, body, link, read, created_at')
    .eq('player_id', user.id)
    .order('created_at', { ascending: false })
    .range(offset, offset + 19)
  return (data ?? []).map((n) => ({
    id: n.id, type: n.type, title: n.title, body: n.body, link: n.link, read: n.read, createdAt: n.created_at,
  }))
}
```

- [ ] **Step 2: `components/shared/NotificationDrawer.tsx`**

```tsx
// components/shared/NotificationDrawer.tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { X, Bell, Trophy, MessageCircle, Coins, Award, Megaphone, AlertTriangle } from 'lucide-react'
import type { NotificationItem } from '@/lib/nav/session'
import { markNotificationRead, markAllNotificationsRead, loadMoreNotifications } from '@/lib/notifications/drawer-actions'

const ICONS: Record<string, typeof Bell> = {
  result_confirmed: Trophy,
  prize_credited: Coins,
  wallet_credited: Coins,
  wager_settled: Coins,
  achievement_unlocked: Award,
  referral_credited: Award,
  post_comment: MessageCircle,
  post_reaction: MessageCircle,
  tournament_announced: Megaphone,
  new_announcement: Megaphone,
  player_disqualified: AlertTriangle,
  noshow_needs_decision: AlertTriangle,
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export function NotificationDrawer({
  notifications,
  onClose,
  onNotificationsChange,
}: {
  notifications: NotificationItem[]
  onClose: () => void
  onNotificationsChange: (next: NotificationItem[]) => void
}) {
  const router = useRouter()
  const [loadingMore, setLoadingMore] = useState(false)
  const [exhausted, setExhausted] = useState(false)

  async function handleSelect(n: NotificationItem) {
    onClose()
    if (!n.read) {
      onNotificationsChange(notifications.map((x) => (x.id === n.id ? { ...x, read: true } : x)))
      void markNotificationRead(n.id)
    }
    if (n.link) router.push(n.link)
  }

  async function handleMarkAllRead() {
    onNotificationsChange(notifications.map((x) => ({ ...x, read: true })))
    void markAllNotificationsRead()
  }

  async function handleLoadMore() {
    setLoadingMore(true)
    const more = await loadMoreNotifications(notifications.length)
    if (more.length === 0) setExhausted(true)
    onNotificationsChange([...notifications, ...more])
    setLoadingMore(false)
  }

  return (
    <div className="fixed inset-0 z-[60]">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="absolute right-0 top-0 flex h-full w-full max-w-sm flex-col border-l border-sx-border bg-sx-bg shadow-2xl">
        <div className="flex items-center justify-between border-b border-sx-border px-4 py-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-white">Notifications</h2>
          <div className="flex items-center gap-3">
            {notifications.some((n) => !n.read) && (
              <button type="button" onClick={handleMarkAllRead} className="text-xs text-sx-purple-text hover:underline">
                Mark all read
              </button>
            )}
            <button type="button" onClick={onClose} aria-label="Close" className="text-white/70 hover:text-white">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {notifications.length === 0 ? (
            <p className="px-4 py-16 text-center text-sm text-sx-gray">You&apos;re all caught up 🎮</p>
          ) : (
            notifications.map((n) => {
              const Icon = ICONS[n.type] ?? Bell
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => handleSelect(n)}
                  className={`flex w-full items-start gap-3 border-b border-sx-border px-4 py-3 text-left transition-colors hover:bg-white/5 ${
                    n.read ? '' : 'bg-sx-purple/5'
                  }`}
                >
                  {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-sx-purple" />}
                  <Icon className={`h-4 w-4 shrink-0 ${n.read ? 'text-sx-gray' : 'text-sx-purple-text'}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-white">{n.title}</p>
                    <p className="mt-0.5 truncate text-xs text-sx-gray">{n.body}</p>
                    <p className="mt-1 text-[10px] text-sx-gray/70">{relativeTime(n.createdAt)}</p>
                  </div>
                </button>
              )
            })
          )}
          {notifications.length > 0 && !exhausted && (
            <button
              type="button"
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="w-full py-3 text-center text-xs text-sx-purple-text hover:underline disabled:opacity-60"
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Rewrite `NotificationBell.tsx`** to render the drawer and add the Realtime subscription

```tsx
// components/shared/NotificationBell.tsx
'use client'
import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { Bell } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { NotificationDrawer } from './NotificationDrawer'
import type { NotificationItem } from '@/lib/nav/session'

export function NotificationBell({
  initialNotifications,
  initialUnreadCount,
}: {
  initialNotifications: NotificationItem[]
  initialUnreadCount: number
}) {
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState(initialNotifications)
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount)
  const pathname = usePathname()

  // Same "fetch fresh on every soft nav" contract as before this rewrite —
  // the bell is mounted once in the root layout and its initial props
  // never re-run server-side on a client-side navigation.
  useEffect(() => {
    let cancelled = false
    async function refresh() {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return
      const [{ count }, { data: rows }] = await Promise.all([
        supabase.from('player_notifications').select('id', { count: 'exact', head: true }).eq('player_id', user.id).eq('read', false),
        supabase
          .from('player_notifications')
          .select('id, type, title, body, link, read, created_at')
          .eq('player_id', user.id)
          .order('created_at', { ascending: false })
          .limit(20),
      ])
      if (cancelled) return
      setUnreadCount(count ?? 0)
      setNotifications((rows ?? []).map((n) => ({ id: n.id, type: n.type, title: n.title, body: n.body, link: n.link, read: n.read, createdAt: n.created_at })))
    }
    refresh()
    return () => {
      cancelled = true
    }
  }, [pathname])

  // Realtime: fires on every INSERT into this player's own rows (RLS still
  // applies to realtime — the filter here is belt-and-suspenders, not the
  // only guard). Subscribed once per mount, not per pathname change.
  useEffect(() => {
    let channel: ReturnType<ReturnType<typeof createClient>['channel']> | null = null
    let cancelled = false
    async function subscribe() {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user || cancelled) return
      channel = supabase
        .channel(`player_notifications:${user.id}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'player_notifications', filter: `player_id=eq.${user.id}` },
          (payload) => {
            const row = payload.new as { id: string; type: string; title: string; body: string; link: string | null; read: boolean; created_at: string }
            setNotifications((prev) => [
              { id: row.id, type: row.type, title: row.title, body: row.body, link: row.link, read: row.read, createdAt: row.created_at },
              ...prev,
            ])
            setUnreadCount((c) => c + 1)
          },
        )
        .subscribe()
    }
    subscribe()
    return () => {
      cancelled = true
      if (channel) createClient().removeChannel(channel)
    }
  }, [])

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Notifications"
        aria-expanded={open}
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-white/80 transition hover:bg-white/5"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <NotificationDrawer
          notifications={notifications}
          onClose={() => setOpen(false)}
          onNotificationsChange={(next) => {
            setNotifications(next)
            setUnreadCount(next.filter((n) => !n.read).length)
          }}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 4: Manually verify**

Run: `npm run build`
Expected: build succeeds.

Then manually: log in, trigger a notification (e.g. have staff confirm a match result for a test account), confirm the bell badge updates live without a page reload, open the drawer, confirm mark-read/mark-all-read/load-more all work, confirm the empty state renders for a fresh account.

- [ ] **Step 5: Commit**

```bash
git add components/shared/NotificationDrawer.tsx components/shared/NotificationBell.tsx lib/notifications/drawer-actions.ts
git commit -m "feat(notifications): replace bell dropdown with realtime paginated drawer"
```

---

### Task 14: Final verification pass + report

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: all tests PASS, including every new `*.test.ts` file from Tasks 2–8.

- [ ] **Step 2: Run the build**

Run: `npm run build`
Expected: succeeds with no type errors.

- [ ] **Step 3: Confirm every spec integration point resolves to one of: wired, or a documented known gap**

Cross-check against `docs/superpowers/specs/2026-08-16-notification-center-design.md` §7 and `docs/superpowers/specs/2026-08-16-whatsapp-notifications-design.md` §6. Expected outcome:
- Wired this plan: `registration_confirmed` (pre-existing, unchanged), `bracket_released`/`match_assigned` (Task 6, via `notifyNewFixtures`), `match_reminder` (Task 6, cron route — previously WhatsApp-only, now also in-app + push), `result_confirmed` (Task 6), `prize_credited` (Task 5), `new_announcement` (Task 9), `tournament_announced` (Task 9), `post_comment` (Task 7), `post_reaction` (Task 7), `achievement_unlocked` (Task 6), `challenge_completed` (Task 7), `wager_settled` (Task 8), `referral_converted` (Task 6).
- Known gap, report but do not build: `admin_flag` — no `flagPlayer`/moderation feature exists anywhere in the codebase (confirmed during planning research).

- [ ] **Step 4: Report to the user**

Summarize: migration number assigned (066), that no Firebase project has been created yet (dormant, same as WhatsApp — user activates via Vercel env vars whenever ready), the full list of files touched, the `prize_credited`/`withdrawal_paid` bug fix, the `fixture_assigned` CHECK-constraint bug fix, the `admin_flag` known gap, and that Realtime replication for `player_notifications` was enabled by the migration itself (no separate Supabase dashboard step needed) — correcting the original spec's assumption that this required manual dashboard config.

No commit for this task — it's a verification and reporting step.
