# Status Notifications + Admin Push Delivery Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make community statuses fire notifications (a friend posted, someone viewed yours, a moderator removed yours), and close the two gaps that leave staff — specifically the moderator account "Codexempire" — receiving nothing.

**Architecture:** Statuses were shipped 2026-09-09 with "push notifications for statuses" explicitly out of scope. This plan adds three notification types (`status_from_friend`, `status_viewed`, `status_removed`) through the platform's existing three-tier pipeline (`notifyInApp` + `pushToPlayer`; no WhatsApp). It follows the exact pattern `lib/community/reaction-actions.ts` and `lib/admin/staff.ts` already use: a pure recipients helper (unit-tested), a `deferNotification`-wrapped fan-out, and `void notifyInApp(...)` / `void pushToPlayer(...)` at the call site. Separately it mounts the existing push-enable banner in `/admin` (today it only renders in `/dashboard`) and normalizes WhatsApp numbers at send time so a number stored in local format still reaches Termii.

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase (Postgres + Auth + Realtime), `zod`, `vitest`, `firebase-admin` (FCM), `libphonenumber-js`.

**Spec:** No separate spec doc — the design was agreed in-session (see this plan's "Design decisions" below). Cross-cutting community rules: `docs/superpowers/specs/2026-09-07-community-system-overview.md`. Statuses piece: `docs/superpowers/specs/2026-09-07-statuses-design.md`.

## Design decisions (agreed in-session)

- **Three triggers, all in-app bell + FCM push, no WhatsApp:**
  1. `status_from_friend` — when a player posts their **first currently-live** status, every `accepted` friend is notified once. Posting a 2nd/3rd status while the first is still live does **not** re-notify (dedupe by "did they already have a live status").
  2. `status_viewed` — when `recordStatusView` genuinely **inserts** a new `status_views` row (the table is `UNIQUE(status_id, viewer_id)`), the status author is notified: "<name> viewed your status." One notification per distinct viewer per status; a repeat open by the same person never re-notifies. The author is never notified of their own view (already skipped upstream in `StatusViewer`, and re-guarded here).
  3. `status_removed` — when a moderator deletes a status via `adminDeleteStatus`, the author is notified.
- **Preferences:** `status_from_friend` and `status_viewed` get per-user toggles + 1-hour mute rows in Settings → Push Notifications, default **on**. `status_removed` has no toggle (moderation notices are always delivered, like `player_disqualified`).
- **Noise:** `status_viewed` is the noisiest notification on the platform (a popular status = dozens in an evening). Accepted as-is per the product owner; the existing 1-hour mute and the per-user toggle are the escape hatches.
- **Admin delivery gaps (same theme, same branch):**
  - Mount `DashboardPushBanner` in `app/[locale]/admin/layout.tsx` so a moderator who lives in the admin panel is prompted to enable push.
  - `lib/notifications/notify.ts` sends WhatsApp to the raw `profiles.whatsapp_number`; a number stored as `09077682083` never reaches Termii. Normalize at send time with `parsePlayerPhone(raw, { country }).e164`.
- **Out of scope:** batching/digest of `status_viewed`; notifying on status *replies* or *reactions* (no such feature exists); any follow-graph work (there is no follow system — friends is the only audience graph).

## Global Constraints

- **Mobile-first.** Design at 375px, scale up.
- **RLS on every table.** No new tables in this plan; `player_statuses` / `status_views` / `friends` policies are unchanged.
- **Migrations are timestamp-named:** `YYYYMMDDHHMMSS_name.sql` (UTC). Do **not** use the next sequential number.
- **Supabase project id:** `itxubrkbropttfdackmi`. The primary checkout `C:/Users/gorok/Videos/sentinelx` is the CLI-linked one; a worktree is not. Apply migrations + regen types via the Supabase MCP tools or from the primary checkout.
- **Notification helpers are best-effort** — `notifyInApp`, `pushToPlayer`, `notify` never throw into the caller. New call sites use `void notifyInApp(...)` / `void pushToPlayer(...)`; fan-outs that `await` a query before reaching those must wrap the whole thing in `deferNotification(...)` (see `lib/admin/staff.ts` for why).
- **`pushToPlayer` already enforces per-user prefs and mutes** — a call site never re-checks `notification_prefs`. `notifyInApp` never checks prefs (the bell records everything).
- **Every `player_notifications.type` value must be in the `player_notifications_type_check` CHECK constraint** or the insert silently no-ops (best-effort try/catch). Widen the constraint in the same migration that adds the types.
- **Concurrent sessions** may be active in the primary checkout. Work in a git worktree. Verify with `npx tsc --noEmit` + `npx next lint` locally and on the Vercel preview; avoid `npm run build` while another session's `next dev` may be running.
- **Attribution** on every commit:
  ```
  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Jz9Va6H3nWMDpG2hytpkSK
  ```

## File Structure

**New files:**

| Path | Responsibility |
|---|---|
| `supabase/migrations/<timestamp>_status_notification_types.sql` | Widen `player_notifications_type_check` with the 3 new types; add the 2 push-pref keys to the `profiles.notification_prefs` column default and backfill existing rows |
| `lib/community/status-recipients.ts` | Pure: `friendStatusRecipients({ friendRows, authorId })` → de-duped friend ids to notify; `statusViewNotified()` guard helper |
| `lib/community/status-recipients.test.ts` | Unit tests for the above (the only TDD task) |
| `lib/community/status-notify.ts` | `notifyFriendsOfNewStatus(admin, { authorId, authorName })` and `notifyStatusViewed(admin, { authorId, viewerName, statusId })` and `notifyStatusRemoved(admin, { authorId })` — `deferNotification`-wrapped fan-outs, modeled on `lib/admin/staff.ts` |

**Modified files:**

| Path | Change |
|---|---|
| `lib/notifications/push-types.ts` | Add `'status_from_friend' \| 'status_viewed' \| 'status_removed'` to `PushNotificationType` |
| `lib/notifications/inbox.ts` | Add `'status_from_friend' \| 'status_viewed' \| 'status_removed'` to `NotificationType` |
| `components/shared/NotificationDrawer.tsx` | Add icons for the 3 new types to the `ICONS` map |
| `lib/community/status-actions.ts` | `postStatus`: detect "first live status", fire `notifyFriendsOfNewStatus`. `recordStatusView`: detect genuine insert, fire `notifyStatusViewed` |
| `lib/community/admin-actions.ts` | `adminDeleteStatus`: read author id before delete, fire `notifyStatusRemoved` |
| `lib/settings/notification-prefs.ts` | Add `status_from_friend` + `status_viewed` to `pushPrefsSchema` |
| `components/settings/PushPrefsForm.tsx` | Add both keys to the `PushPrefs` interface and the `LABELS` list |
| `app/[locale]/dashboard/settings/page.tsx` | Map both new keys into the `<PushPrefsForm prefs={…}>` object |
| `app/[locale]/admin/layout.tsx` | Render `<DashboardPushBanner />` above `{children}` |
| `lib/notifications/notify.ts` | Normalize `whatsapp_number` → E.164 with `parsePlayerPhone` before send; also select `country` |
| `lib/supabase/types.ts` | Regenerated after the migration |

---

## Task 1: Migration — notification types + push-pref defaults

**Files:**
- Create: `supabase/migrations/<timestamp>_status_notification_types.sql`
- Modify: `lib/supabase/types.ts` (regenerated)

**Interfaces:**
- Produces: `player_notifications` accepts `type IN ('status_from_friend','status_viewed','status_removed')`; `profiles.notification_prefs` column default and every existing row carry `push.status_from_friend = true` and `push.status_viewed = true`.

- [ ] **Step 1: Get the current UTC timestamp for the filename**

Run: `node -e "console.log(new Date().toISOString().replace(/[-:T]/g,'').slice(0,14))"`
Use the output (e.g. `20260909213000`) as `<timestamp>`.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/<timestamp>_status_notification_types.sql`:

```sql
-- Statuses (shipped 2026-09-09) launched with notifications out of scope.
-- This adds three: a friend posted a status, someone viewed your status, a
-- moderator removed your status. All three flow through player_notifications
-- (in-app bell) + FCM push; no WhatsApp.
--
-- Two halves, mirroring 080_enable_reaction_push.sql:
--   1. widen the player_notifications type CHECK (an unknown type makes the
--      best-effort insert silently no-op)
--   2. seed the two user-facing push prefs to true, on the column default and
--      on every existing row (status_removed has no pref — moderation notices
--      are always delivered)

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
    'withdrawal_pending', 'exchange_listing_pending', 'result_needs_review',
    'result_disputed', 'result_no_submission',
    'status_from_friend', 'status_viewed', 'status_removed'
  ));

ALTER TABLE public.profiles
  ALTER COLUMN notification_prefs SET DEFAULT '{
    "whatsapp": {
      "match_reminder": true,
      "result_confirmed": true,
      "prize_credited": true,
      "challenge_completed": false,
      "achievement_unlocked": false,
      "registration_confirmed": true
    },
    "push": {
      "match_reminder": true,
      "result_confirmed": true,
      "achievement_unlocked": true,
      "challenge_completed": true,
      "new_announcement": true,
      "tournament_announced": true,
      "wager_settled": true,
      "referral_converted": true,
      "post_comment": true,
      "post_reaction": true,
      "bracket_released": true,
      "match_assigned": true,
      "prize_credited": true,
      "status_from_friend": true,
      "status_viewed": true
    },
    "achievement_sharing": {
      "tournament": true,
      "milestone": true,
      "streak": true,
      "social": false,
      "other": false
    }
  }'::jsonb;

-- Add each key only where it is absent, so a deliberate opt-out made after
-- this ships is never overridden and the statement is safe to re-run.
UPDATE public.profiles
SET notification_prefs = jsonb_set(notification_prefs, '{push,status_from_friend}', 'true'::jsonb)
WHERE notification_prefs -> 'push' -> 'status_from_friend' IS NULL;

UPDATE public.profiles
SET notification_prefs = jsonb_set(notification_prefs, '{push,status_viewed}', 'true'::jsonb)
WHERE notification_prefs -> 'push' -> 'status_viewed' IS NULL;
```

- [ ] **Step 3: Apply the migration**

Via Supabase MCP `apply_migration` (name: `<timestamp>_status_notification_types`), or from the primary checkout `npx supabase db push`.

- [ ] **Step 4: Verify in production**

Run via MCP `execute_sql`:

```sql
SELECT pg_get_constraintdef(oid) LIKE '%status_from_friend%'
   AND pg_get_constraintdef(oid) LIKE '%status_viewed%'
   AND pg_get_constraintdef(oid) LIKE '%status_removed%' AS constraint_ok
FROM pg_constraint WHERE conname = 'player_notifications_type_check';

SELECT count(*) FILTER (WHERE notification_prefs -> 'push' -> 'status_viewed' IS NULL) AS missing_viewed,
       count(*) FILTER (WHERE notification_prefs -> 'push' -> 'status_from_friend' IS NULL) AS missing_friend
FROM public.profiles;
```

Expected: `constraint_ok = true`; both `missing_*` counts `0`.

- [ ] **Step 5: Regenerate types**

From the primary checkout (or via MCP `generate_typescript_types`):

```bash
npx supabase gen types typescript --project-id itxubrkbropttfdackmi > lib/supabase/types.ts
```

Copy the regenerated file into the worktree.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: passes (no code consumes the new values yet).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/ lib/supabase/types.ts
git commit -m "feat(notifications): DB support for status notification types

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Jz9Va6H3nWMDpG2hytpkSK"
```

---

## Task 2: Type unions + drawer icons

**Files:**
- Modify: `lib/notifications/push-types.ts`
- Modify: `lib/notifications/inbox.ts:4-40` (the `NotificationType` union)
- Modify: `components/shared/NotificationDrawer.tsx:9-22` (the `ICONS` map)

**Interfaces:**
- Produces: `PushNotificationType` and `NotificationType` both include `'status_from_friend' | 'status_viewed' | 'status_removed'`. Consumed by Tasks 4–6 and by `lib/community/status-notify.ts` (Task 3).

- [ ] **Step 1: Extend `PushNotificationType`**

In `lib/notifications/push-types.ts`, add three members to the union (after `'post_reaction'`):

```ts
  | 'post_comment'
  | 'post_reaction'
  | 'status_from_friend'
  | 'status_viewed'
  | 'status_removed'
```

Update the file's top comment: it says "The 13 keys under profiles.notification_prefs.push" — `status_from_friend` and `status_viewed` are real pref keys (added in Task 1) so that becomes 15; `status_removed` is in this union only for `pushToPlayer`'s parameter type and has **no** pref key (a moderation notice is always delivered — `push?.['status_removed']` is `undefined`, never `=== false`). Reword the comment to say so.

- [ ] **Step 2: Extend `NotificationType`**

In `lib/notifications/inbox.ts`, add three members to the `NotificationType` union (after `'result_no_submission'`):

```ts
  | 'result_no_submission'
  | 'status_from_friend'
  | 'status_viewed'
  | 'status_removed'
```

- [ ] **Step 3: Add drawer icons**

In `components/shared/NotificationDrawer.tsx`, the import on line 5 already brings in `MessageCircle`. Add `Eye` and `Trash2` to that import, and add three rows to the `ICONS` map:

```ts
  post_comment: MessageCircle,
  post_reaction: MessageCircle,
  status_from_friend: MessageCircle,
  status_viewed: Eye,
  status_removed: Trash2,
```

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit && npx next lint --file lib/notifications/push-types.ts --file lib/notifications/inbox.ts --file components/shared/NotificationDrawer.tsx`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add lib/notifications/push-types.ts lib/notifications/inbox.ts components/shared/NotificationDrawer.tsx
git commit -m "feat(notifications): register status notification types

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Jz9Va6H3nWMDpG2hytpkSK"
```

---

## Task 3: Recipients helper (TDD) + fan-out module

**Files:**
- Create: `lib/community/status-recipients.ts`
- Test: `lib/community/status-recipients.test.ts`
- Create: `lib/community/status-notify.ts`

**Interfaces:**
- Consumes: `createAdminClient` from `@/lib/supabase/admin`; `notifyInApp` from `@/lib/notifications/inbox`; `pushToPlayer` from `@/lib/notifications/push`; `deferNotification` from `@/lib/notifications/defer`.
- Produces:
  - `friendStatusRecipients(input: { friendRows: FriendRow[]; authorId: string }): string[]` — where `type FriendRow = { requester_id: string; recipient_id: string; status: string }`. Returns the de-duplicated set of the **other** participant id for every row with `status === 'accepted'` that involves `authorId`; excludes `authorId` itself; ignores non-accepted rows.
  - `notifyFriendsOfNewStatus(admin: Admin, opts: { authorId: string; authorName: string }): Promise<void>` — `Admin = ReturnType<typeof createAdminClient>`. Queries `friends` for accepted rows involving `authorId`, resolves recipients via `friendStatusRecipients`, fans out in-app + push (`type: 'status_from_friend'`, link `/community`). Best-effort, `deferNotification`-wrapped.
  - `notifyStatusViewed(admin: Admin, opts: { authorId: string; viewerId: string; viewerName: string; statusId: string }): Promise<void>` — no-op if `authorId === viewerId`; else in-app + push to `authorId` (`type: 'status_viewed'`, link `/community`). Best-effort, `deferNotification`-wrapped.
  - `notifyStatusRemoved(admin: Admin, opts: { authorId: string }): Promise<void>` — in-app + push to `authorId` (`type: 'status_removed'`, link `/community`). Best-effort, `deferNotification`-wrapped.

- [ ] **Step 1: Write the failing tests**

Create `lib/community/status-recipients.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { friendStatusRecipients } from './status-recipients'

const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const C = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const D = 'dddddddd-dddd-dddd-dddd-dddddddddddd'

describe('friendStatusRecipients', () => {
  it('returns the other side of every accepted friendship, regardless of direction', () => {
    const rows = [
      { requester_id: A, recipient_id: B, status: 'accepted' }, // A sent to B
      { requester_id: C, recipient_id: A, status: 'accepted' }, // C sent to A
    ]
    expect(friendStatusRecipients({ friendRows: rows, authorId: A }).sort()).toEqual([B, C].sort())
  })

  it('ignores pending requests', () => {
    const rows = [
      { requester_id: A, recipient_id: B, status: 'accepted' },
      { requester_id: A, recipient_id: C, status: 'pending' },
    ]
    expect(friendStatusRecipients({ friendRows: rows, authorId: A })).toEqual([B])
  })

  it('de-duplicates when both directions somehow exist', () => {
    const rows = [
      { requester_id: A, recipient_id: B, status: 'accepted' },
      { requester_id: B, recipient_id: A, status: 'accepted' },
    ]
    expect(friendStatusRecipients({ friendRows: rows, authorId: A })).toEqual([B])
  })

  it('never includes the author', () => {
    const rows = [{ requester_id: A, recipient_id: A, status: 'accepted' }]
    expect(friendStatusRecipients({ friendRows: rows, authorId: A })).toEqual([])
  })

  it('drops rows that do not involve the author', () => {
    const rows = [{ requester_id: C, recipient_id: D, status: 'accepted' }]
    expect(friendStatusRecipients({ friendRows: rows, authorId: A })).toEqual([])
  })

  it('returns an empty array for no rows', () => {
    expect(friendStatusRecipients({ friendRows: [], authorId: A })).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests — verify they fail**

Run: `npx vitest run lib/community/status-recipients.test.ts`
Expected: FAIL — `Cannot find module './status-recipients'`.

- [ ] **Step 3: Implement `status-recipients.ts`**

```ts
export type FriendRow = { requester_id: string; recipient_id: string; status: string }

// The de-duplicated set of players to tell when `authorId` posts a status:
// the other participant of every ACCEPTED friendship that involves them.
// Direction-agnostic (either side may have sent the request) and self-safe.
export function friendStatusRecipients(input: { friendRows: FriendRow[]; authorId: string }): string[] {
  const out = new Set<string>()
  for (const row of input.friendRows) {
    if (row.status !== 'accepted') continue
    const involvesAuthor = row.requester_id === input.authorId || row.recipient_id === input.authorId
    if (!involvesAuthor) continue
    const other = row.requester_id === input.authorId ? row.recipient_id : row.requester_id
    if (other !== input.authorId) out.add(other)
  }
  return [...out]
}
```

- [ ] **Step 4: Run the tests — verify they pass**

Run: `npx vitest run lib/community/status-recipients.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Implement `status-notify.ts`**

```ts
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyInApp } from '@/lib/notifications/inbox'
import { pushToPlayer } from '@/lib/notifications/push'
import { deferNotification } from '@/lib/notifications/defer'
import { friendStatusRecipients, type FriendRow } from './status-recipients'

type Admin = ReturnType<typeof createAdminClient>

const COMMUNITY_LINK = '/community'

// A friend posted their first live status. Fans out in-app + push to every
// accepted friend. Wrapped in deferNotification like notifyStaff: it awaits a
// query before reaching notifyInApp/pushToPlayer, so a `void` caller would be
// frozen mid-query on Vercel with nothing handed to the platform yet.
export function notifyFriendsOfNewStatus(admin: Admin, opts: { authorId: string; authorName: string }): Promise<void> {
  return deferNotification(fanOutNewStatus(admin, opts))
}

async function fanOutNewStatus(admin: Admin, opts: { authorId: string; authorName: string }): Promise<void> {
  try {
    const { data: rows } = await admin
      .from('friends')
      .select('requester_id, recipient_id, status')
      .eq('status', 'accepted')
      .or(`requester_id.eq.${opts.authorId},recipient_id.eq.${opts.authorId}`)

    const recipients = friendStatusRecipients({
      friendRows: (rows ?? []) as FriendRow[],
      authorId: opts.authorId,
    })
    if (recipients.length === 0) return

    const title = 'New status'
    const body = `${opts.authorName} added to their status.`
    await Promise.all(
      recipients.flatMap((id) => [
        notifyInApp({ playerId: id, type: 'status_from_friend', title, body, link: COMMUNITY_LINK }),
        pushToPlayer(id, 'status_from_friend', { title, body }, { url: COMMUNITY_LINK }),
      ]),
    )
  } catch (err) {
    console.error('[status-notify] notifyFriendsOfNewStatus failed (non-blocking)', err)
  }
}

// Someone viewed the author's status. One per distinct viewer (the caller only
// invokes this on a genuine status_views insert). Never notifies self.
export function notifyStatusViewed(
  admin: Admin,
  opts: { authorId: string; viewerId: string; viewerName: string; statusId: string },
): Promise<void> {
  return deferNotification(fanOutStatusViewed(opts))
}

async function fanOutStatusViewed(opts: {
  authorId: string
  viewerId: string
  viewerName: string
  statusId: string
}): Promise<void> {
  if (opts.authorId === opts.viewerId) return
  try {
    const title = 'Status viewed'
    const body = `${opts.viewerName} viewed your status.`
    await Promise.all([
      notifyInApp({ playerId: opts.authorId, type: 'status_viewed', title, body, link: COMMUNITY_LINK }),
      pushToPlayer(opts.authorId, 'status_viewed', { title, body }, { url: COMMUNITY_LINK }),
    ])
  } catch (err) {
    console.error('[status-notify] notifyStatusViewed failed (non-blocking)', err)
  }
}

// A moderator removed the author's status. Always delivered (no pref toggle).
export function notifyStatusRemoved(admin: Admin, opts: { authorId: string }): Promise<void> {
  return deferNotification(fanOutStatusRemoved(opts))
}

async function fanOutStatusRemoved(opts: { authorId: string }): Promise<void> {
  try {
    const title = 'Status removed'
    const body = 'A moderator removed your status.'
    await Promise.all([
      notifyInApp({ playerId: opts.authorId, type: 'status_removed', title, body, link: COMMUNITY_LINK }),
      pushToPlayer(opts.authorId, 'status_removed', { title, body }, { url: COMMUNITY_LINK }),
    ])
  } catch (err) {
    console.error('[status-notify] notifyStatusRemoved failed (non-blocking)', err)
  }
}
```

> All three types are in `PushNotificationType` (Task 2 Step 1), so `pushToPlayer(id, 'status_removed', …)` typechecks. `status_removed` has no pref key, so it always sends — intended for a moderation notice.

- [ ] **Step 6: Typecheck + lint + full test run**

Run: `npx tsc --noEmit && npx next lint --file lib/community/status-recipients.ts --file lib/community/status-notify.ts && npx vitest run lib/community/`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add lib/community/status-recipients.ts lib/community/status-recipients.test.ts lib/community/status-notify.ts
git commit -m "feat(community): status notification recipients + fan-out

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Jz9Va6H3nWMDpG2hytpkSK"
```

---

## Task 4: Wire `status_from_friend` into `postStatus`

**Files:**
- Modify: `lib/community/status-actions.ts` (the `postStatus` function, currently lines 9–39)

**Interfaces:**
- Consumes: `notifyFriendsOfNewStatus` from `./status-notify`; `createAdminClient` from `@/lib/supabase/admin`.

- [ ] **Step 1: Add the imports**

At the top of `lib/community/status-actions.ts`:

```ts
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyFriendsOfNewStatus } from './status-notify'
```

- [ ] **Step 2: Detect "first live status" and fire the fan-out**

In `postStatus`, replace the block from the successful insert through `return { id: data.id }` with:

```ts
  if (error || !data) {
    console.error('[postStatus] insert failed', { userId: user.id, code: error?.code, message: error?.message })
    return { error: 'Could not post your status. Please try again.' }
  }

  // Notify friends only on the player's FIRST currently-live status — posting
  // a 2nd/3rd while the first is still up is not a new event to announce.
  // This runs after the insert, so "exactly 1 live" means this is the first.
  const admin = createAdminClient()
  const { count: liveCount } = await admin
    .from('player_statuses')
    .select('id', { count: 'exact', head: true })
    .eq('player_id', user.id)
    .gt('expires_at', new Date().toISOString())

  if ((liveCount ?? 0) === 1) {
    const { data: profile } = await admin
      .from('profiles')
      .select('display_name, username')
      .eq('id', user.id)
      .maybeSingle()
    const authorName = profile?.display_name ?? profile?.username ?? 'A player'
    void notifyFriendsOfNewStatus(admin, { authorId: user.id, authorName })
  }

  revalidatePath('/community')
  return { id: data.id }
```

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit && npx next lint --file lib/community/status-actions.ts`
Expected: passes.

- [ ] **Step 4: Manual verification (deferred to Task 9)** — note in the task checklist that this needs two friended accounts on the Vercel preview.

- [ ] **Step 5: Commit**

```bash
git add lib/community/status-actions.ts
git commit -m "feat(community): notify friends when a player posts their first live status

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Jz9Va6H3nWMDpG2hytpkSK"
```

---

## Task 5: Wire `status_viewed` into `recordStatusView`

**Files:**
- Modify: `lib/community/status-actions.ts` (the `recordStatusView` function, currently lines 69–86)

**Interfaces:**
- Consumes: `notifyStatusViewed` from `./status-notify`; `createAdminClient`.

**Why the shape changes:** the current upsert uses `ignoreDuplicates: true` and selects nothing, so it can't tell a new view from a repeat. Switch to `.upsert(..., { onConflict: 'status_id,viewer_id', ignoreDuplicates: true }).select('id')` — with `ignoreDuplicates`, a conflicting row returns **no row**, a genuine insert returns one. That is the "distinct viewer" signal.

- [ ] **Step 1: Add the import**

```ts
import { notifyStatusViewed } from './status-notify'
```

(`createAdminClient` is already imported after Task 4.)

- [ ] **Step 2: Rewrite `recordStatusView`**

```ts
// Best-effort. A failure to record a view must never break playback, so this
// swallows everything and returns void. The unique (status_id, viewer_id)
// constraint makes a repeat view a no-op conflict — ignoreDuplicates returns
// no row in that case, one row on a genuine first view, which is exactly the
// "notify the author once per distinct viewer" signal.
export async function recordStatusView(id: string): Promise<void> {
  if (!id) return
  try {
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return

    const { data: inserted } = await supabase
      .from('status_views')
      .upsert(
        { status_id: id, viewer_id: user.id },
        { onConflict: 'status_id,viewer_id', ignoreDuplicates: true },
      )
      .select('id')
      .maybeSingle()

    if (!inserted) return // repeat view — already recorded, already notified

    const admin = createAdminClient()
    const { data: rows } = await admin
      .from('player_statuses')
      .select('player_id, author:profiles!player_statuses_player_id_fkey(display_name, username)')
      .eq('id', id)
      .maybeSingle()
    const authorId = (rows as { player_id?: string } | null)?.player_id
    if (!authorId || authorId === user.id) return

    const { data: viewer } = await admin
      .from('profiles')
      .select('display_name, username')
      .eq('id', user.id)
      .maybeSingle()
    const viewerName = viewer?.display_name ?? viewer?.username ?? 'Someone'

    void notifyStatusViewed(admin, { authorId, viewerId: user.id, viewerName, statusId: id })
  } catch {
    // swallow — see comment above
  }
}
```

> The `author:profiles!...` embed in the select is not used for the name here (we only need `player_id`); drop it if the FK alias name is uncertain — `player_id` alone is enough. Keep the select minimal: `.select('player_id')`.

- [ ] **Step 3: Simplify per the note** — use `.select('player_id')` only:

```ts
    const { data: statusRow } = await admin
      .from('player_statuses')
      .select('player_id')
      .eq('id', id)
      .maybeSingle()
    const authorId = statusRow?.player_id
    if (!authorId || authorId === user.id) return
```

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit && npx next lint --file lib/community/status-actions.ts`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add lib/community/status-actions.ts
git commit -m "feat(community): notify status author on each distinct viewer

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Jz9Va6H3nWMDpG2hytpkSK"
```

---

## Task 6: Wire `status_removed` into `adminDeleteStatus`

**Files:**
- Modify: `lib/community/admin-actions.ts` (the `adminDeleteStatus` function, currently lines 76–88)

**Interfaces:**
- Consumes: `notifyStatusRemoved` from `./status-notify`.

- [ ] **Step 1: Add the import**

At the top of `lib/community/admin-actions.ts`:

```ts
import { notifyStatusRemoved } from './status-notify'
```

- [ ] **Step 2: Read the author before deleting, notify after**

Replace the body of `adminDeleteStatus` after the `id` guard with:

```ts
  const admin = createAdminClient()

  const { data: statusRow } = await admin
    .from('player_statuses')
    .select('player_id')
    .eq('id', id)
    .maybeSingle()

  const { error } = await admin.from('player_statuses').delete().eq('id', id)
  if (error) return { error: 'Could not delete this status.' }

  if (statusRow?.player_id) {
    void notifyStatusRemoved(admin, { authorId: statusRow.player_id })
  }

  revalidatePath('/community')
  revalidatePath('/admin/community')
  return undefined
```

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit && npx next lint --file lib/community/admin-actions.ts`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add lib/community/admin-actions.ts
git commit -m "feat(community): notify author when staff removes their status

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Jz9Va6H3nWMDpG2hytpkSK"
```

---

## Task 7: Settings — expose the two toggles

**Files:**
- Modify: `lib/settings/notification-prefs.ts:63-77` (`pushPrefsSchema`)
- Modify: `components/settings/PushPrefsForm.tsx:9-39` (`PushPrefs` interface + `LABELS`)
- Modify: `app/[locale]/dashboard/settings/page.tsx:107-125` (the `prefs` object passed to `<PushPrefsForm>`)

**Interfaces:**
- Consumes: nothing new. `updatePushPrefs` already iterates `Object.keys(pushPrefsSchema.shape)`, so adding keys to the schema is enough for the save path.

- [ ] **Step 1: Extend `pushPrefsSchema`**

In `lib/settings/notification-prefs.ts`, add to the `z.object({ … })`:

```ts
  prize_credited: z.boolean(),
  status_from_friend: z.boolean(),
  status_viewed: z.boolean(),
})
```

- [ ] **Step 2: Extend the `PushPrefs` interface + `LABELS`**

In `components/settings/PushPrefsForm.tsx`, add to the interface:

```ts
  prize_credited: boolean
  status_from_friend: boolean
  status_viewed: boolean
}
```

And to `LABELS` (place them after the two `post_*` rows, before `new_announcement`):

```ts
  ['post_comment', 'Comments on your posts'],
  ['post_reaction', 'Reactions on your posts'],
  ['status_from_friend', 'A friend posts a status'],
  ['status_viewed', 'Someone views your status'],
```

- [ ] **Step 3: Map the keys in the settings page**

In `app/[locale]/dashboard/settings/page.tsx`, inside the `<PushPrefsForm prefs={{ … }}>` object, add:

```ts
            prize_credited: prefs.push?.prize_credited ?? true,
            status_from_friend: prefs.push?.status_from_friend ?? true,
            status_viewed: prefs.push?.status_viewed ?? true,
```

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit && npx next lint --file lib/settings/notification-prefs.ts --file components/settings/PushPrefsForm.tsx --file "app/[locale]/dashboard/settings/page.tsx"`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add lib/settings/notification-prefs.ts components/settings/PushPrefsForm.tsx "app/[locale]/dashboard/settings/page.tsx"
git commit -m "feat(settings): push toggles + mute rows for status notifications

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Jz9Va6H3nWMDpG2hytpkSK"
```

---

## Task 8: Admin push banner + WhatsApp number normalization

**Files:**
- Modify: `app/[locale]/admin/layout.tsx`
- Modify: `lib/notifications/notify.ts:20-25`

**Interfaces:**
- Consumes: `DashboardPushBanner` from `@/components/notifications/DashboardPushBanner` (client component, self-gating — renders nothing unless `Notification.permission === 'default'` and Firebase is configured); `parsePlayerPhone` from `@/lib/phone/number`.

**Why:** `DashboardPushBanner` only mounts in `DashboardShell`, so a moderator who works entirely in `/admin` is never prompted to enable push — this is why the "Codexempire" account has zero FCM tokens. And `notify.ts` sends WhatsApp to the raw `whatsapp_number`; a number saved as `09077682083` never reaches Termii. `parsePlayerPhone` already exists and returns `null` for genuinely invalid numbers (so a bad number degrades to "no WhatsApp", matching the file's existing philosophy).

- [ ] **Step 1: Mount the banner in the admin layout**

In `app/[locale]/admin/layout.tsx`, add the import and render it above `{children}`:

```tsx
import { DashboardPushBanner } from '@/components/notifications/DashboardPushBanner'
```

```tsx
      <div className="min-w-0 flex-1 py-6">
        <DashboardPushBanner />
        {children}
      </div>
```

- [ ] **Step 2: Normalize the WhatsApp number in `notify.ts`**

In `lib/notifications/sendWhatsAppNotification` (`lib/notifications/notify.ts`), change the profile select + `toNumber` derivation:

```ts
import { parsePlayerPhone } from '@/lib/phone/number'
```

```ts
    const { data: profile } = await admin
      .from('profiles')
      .select('whatsapp_number, country')
      .eq('id', input.playerId)
      .maybeSingle()
    // Stored numbers are free-typed — "09077682083", "+234 903 …", "903…".
    // Termii needs E.164; an unparseable number degrades to "no recipient"
    // (row stays 'skipped'), same as a missing number.
    const toNumber = parsePlayerPhone(profile?.whatsapp_number, { country: profile?.country })?.e164 ?? null
```

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit && npx next lint --file "app/[locale]/admin/layout.tsx" --file lib/notifications/notify.ts`
Expected: passes.

- [ ] **Step 4: Run the notify tests**

Run: `npx vitest run lib/notifications/`
Expected: passes. If `notify` has a test that stubs the profile select shape, update the stub to include `country`.

- [ ] **Step 5: Commit**

```bash
git add "app/[locale]/admin/layout.tsx" lib/notifications/notify.ts
git commit -m "fix(notifications): prompt staff in /admin to enable push; normalize WhatsApp numbers

The Codexempire moderator account had zero FCM tokens because the
push-enable banner only renders in /dashboard. notify() also sent to the
raw whatsapp_number, so a number stored in local format never reached Termii.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Jz9Va6H3nWMDpG2hytpkSK"
```

---

## Task 9: Full verification + preview E2E + merge

**Files:** none (verification only)

- [ ] **Step 1: Full local suite**

Run: `npx tsc --noEmit && npx next lint && npx vitest run`
Expected: all green. Note the `git worktree list` count first — per memory `project_vitest_nested_worktree_double_count`, a stale nested worktree double-counts tests.

- [ ] **Step 2: Push the branch, wait for the Vercel preview to go READY**

- [ ] **Step 3: Preview E2E checklist (needs two accounts, A and B, friended):**
  - B posts their first status → A gets an in-app bell entry "B added to their status" (+ push if A enabled it on that device).
  - B posts a second status immediately → A gets **nothing new**.
  - A opens B's status → B gets "A viewed your status" (once). A re-opens it → B gets nothing new.
  - B views their own status (own ring) → no self-notification.
  - Admin removes B's status from `/admin/community` → B gets "A moderator removed your status."
  - Settings → Push Notifications shows "A friend posts a status" and "Someone views your status" rows, both on; toggling `status_viewed` off and saving stops the push (bell still records). The 1-hour mute row for each is present.
  - Open `/admin` as a signed-in staff member who has never enabled push and whose browser permission is `default` → the "Enable notifications" banner appears.

- [ ] **Step 4: Confirm Codexempire specifically**

After deploy, have the Codexempire account open the site on their phone, use the new `/admin` banner (or Settings) to enable push, grant the browser prompt. Then verify:

```sql
SELECT count(*) FROM fcm_tokens WHERE player_id = '3d5fef74-2a8d-47f3-89cb-ee899810f8df';
```

Expected: `>= 1`. Send them a test push from Settings → "Send a test notification".

- [ ] **Step 5: Merge to main + push** (per memory `feedback_always_push` — do this automatically once verified, no finishing-a-branch menu):

```bash
git checkout main && git merge --no-ff <branch> && git push origin main
```

- [ ] **Step 6: Clean up the worktree**

```bash
git worktree remove <worktree-path>
```

---

## Self-Review

- **Design coverage:** friend-posts (Task 4), status-viewed (Task 5), staff-removal (Task 6), settings toggles + mutes (Task 7), admin push gap (Task 8), WhatsApp format gap (Task 8) — all covered.
- **Type consistency:** `notifyFriendsOfNewStatus` / `notifyStatusViewed` / `notifyStatusRemoved` signatures are declared in Task 3's Interfaces block and consumed unchanged in Tasks 4/5/6. `PushNotificationType` gains `status_from_friend`, `status_viewed`, and (per Task 3 Step 5 note) `status_removed`; `NotificationType` gains all three. The migration's CHECK list and the `pushPrefsSchema` keys match those names.
- **Placeholder scan:** the two `>` notes in Tasks 3 and 5 are resolved by a following concrete step (Task 3 Step 5's decision line; Task 5 Step 3). No TODO/TBD left.
- **Known soft spot:** `friends.or(...)` string interpolation of `authorId` — `authorId` is a Supabase-auth UUID (`user.id`), never user input, so PostgREST injection is not a concern, but keep the `.eq('status','accepted')` as a separate filter (done) rather than folding it into the `.or()`.
