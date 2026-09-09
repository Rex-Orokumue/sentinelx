# Community Direct Messages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Private 1:1 text messaging between players — thread list, conversation view, realtime delivery, unread counts, and the non-negotiable safety trio: block, report, and a new-conversation rate limit.

**Architecture:** Four new tables (`dm_threads`, `dm_messages`, `dm_blocks`, `dm_reports`) with a normalised thread pair and RLS that scopes reads to the two participants and refuses an insert when either side has blocked the other. Pure logic (pair ordering, unread counting, block predicate, rate-limit predicate, body validation) is unit-tested; the query/action/UI layers follow this codebase's manual-verification norm. New messages write a `player_notifications` row (type `direct_message`) so the **existing header bell** carries the unread badge with zero header changes; the `/messages` list computes its own per-thread unread pips from `dm_messages.read_at`. Realtime reuses the `ALTER PUBLICATION supabase_realtime` + client-`channel` pattern already used by the notification bell and `CommunityRealtime`.

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase (Postgres + Auth + Realtime), Tailwind, `zod`, `vitest`, `lucide-react`, `next-intl`.

**Spec:**
- `docs/superpowers/specs/2026-09-07-direct-messages-design.md` (this piece)
- `docs/superpowers/specs/2026-09-07-community-system-overview.md` (cross-cutting rules)

## Global Constraints

- **Mobile-first.** Design at 375px. `/messages` and `/messages/[threadId]` are a phone experience first.
- **RLS on every table.** All four DM tables get RLS. The block check lives **in the `dm_messages` INSERT policy**, not only in the UI (spec: "Enforced in the RLS policy... so it holds regardless of client").
- **Messages are immutable.** No UPDATE policy except `read_at`. No edit/delete-message UI for players. (Staff can delete a message via the admin client when resolving a report.)
- **Thread pair is normalised.** `dm_threads.player_a` is always the lexicographically smaller uuid (`player_a < player_b` as text), unique index on `(player_a, player_b)`. A→B and B→A must resolve to one thread.
- **Body cap 2000 chars**, trimmed, non-empty (DB CHECK + friendly zod message).
- **Rate limit — not cuttable.** A cap on *new conversations started per rolling 24h*, enforced in the `sendMessage` action (app-level state guard, matching the `friendly_matches` convention of app guards over fine-grained RLS). Cap = `NEW_THREAD_DAILY_CAP = 15`.
- **Block & report — not cuttable.** Block from a thread and from a profile; blocked = no new messages either way + thread hidden from both trays. Report a message or a player with a reason → lands in `/admin/messages`. Staff can read a reported thread — **disclosed in the privacy policy as part of this piece, not a follow-up.**
- **Image attachments — CUT for v1.** `dm_messages.image_url` column ships (nullable) and the CHECK is "body or image" for forward-compat, but there is **no upload UI and no `dm-images` bucket** in v1. Text-only.
- **No push.** New messages notify in-app only (the bell). FCM push for social events is explicitly a later follow-up (overview spec).
- **Account deletion** must delete a leaving player's DM rows — added to the `anonymise_account()` function (profiles are anonymised in place, never row-deleted, so `ON DELETE CASCADE` never fires for deletion; the explicit DELETEs are the mechanism, mirroring how `friends` is handled there).
- **Migrations are timestamp-named:** `YYYYMMDDHHMMSS_name.sql` (UTC).
- **Supabase project id for type generation / MCP:** `itxubrkbropttfdackmi`.
- **This is a git worktree** at `.claude/worktrees/community-dms` on branch `worktree-community-dms`, based on `origin/main`. Concurrent sessions are active in other worktrees. Do **not** run `npm run build` (their `next dev` may be running) — verify with `npx tsc --noEmit` + `npx next lint`, and on the Vercel preview after push.
- **Out of scope (spec):** group chats, voice notes, typing indicators, read receipts beyond one `read_at`, message search, message reactions.

---

## File Structure

**New files:**

| Path | Responsibility |
|---|---|
| `supabase/migrations/<ts>_direct_messages.sql` | 4 tables + RLS + block-aware insert policy + notification type + realtime publication + `anonymise_account` extension |
| `lib/messages/thread-key.ts` | `orderedPair(a,b)` — the one place pair normalisation lives |
| `lib/messages/thread-key.test.ts` | unit tests |
| `lib/messages/predicates.ts` | `unreadCount`, `isBlockedBetween`, `newThreadAllowed` — pure |
| `lib/messages/predicates.test.ts` | unit tests |
| `lib/messages/schema.ts` | `messageBodySchema`, `reportReasonSchema` (zod) |
| `lib/messages/schema.test.ts` | unit tests |
| `lib/messages/query.ts` | server-only reads: `fetchThreadList`, `fetchThread`, `resolveThreadId` |
| `lib/messages/actions.ts` | `'use server'`: `sendMessage`, `markThreadRead`, `blockUser`, `unblockUser`, `reportConversation` |
| `app/[locale]/messages/page.tsx` | thread list (server component) |
| `app/[locale]/messages/[threadId]/page.tsx` | one conversation (server component) |
| `components/messages/ThreadListItem.tsx` | one row in the list |
| `components/messages/MessagesRealtime.tsx` | `'use client'` — refreshes the list on any `dm_messages` change |
| `components/messages/Conversation.tsx` | `'use client'` — message list + realtime append + composer + overflow menu |
| `components/messages/MessageComposer.tsx` | `'use client'` — textarea + send |
| `components/messages/ThreadMenu.tsx` | `'use client'` — block / report overflow menu + report dialog |
| `components/player/MessageButton.tsx` | `'use client'` — "Message" button for the profile header |
| `lib/messages/admin-query.ts` | `fetchDmReports` |
| `lib/messages/admin-actions.ts` | `'use server'`: `resolveDmReport` (+ optional message delete) |
| `app/[locale]/admin/messages/page.tsx` | staff report queue |
| `components/admin/DmReportRow.tsx` | `'use client'` — one report, expandable to the thread transcript |

**Modified files:**

| Path | Change |
|---|---|
| `lib/supabase/types.ts` | regenerated after the migration |
| `lib/supabase/middleware.ts` | add `/messages` to `PROTECTED` |
| `lib/notifications/inbox.ts` | add `'direct_message'` to `NotificationType` |
| `components/player/ProfileHeader.tsx` | render `<MessageButton>` beside the friend/challenge actions |
| `lib/admin/nav.ts` | add `{ label: 'Messages', href: '/admin/messages', adminOnly: false }` |
| `messages/en.json`, `messages/fr.json`, `messages/pcm.json` | privacy-policy DM disclosure keys |
| `app/[locale]/(public)/privacy/page.tsx` | wire the new privacy keys into §2 and §4 |

**Testing note:** `vitest` covers Tasks 2–4 (pure). Query/action/component/page code is verified by `tsc` + `next lint` + the Task 12 end-to-end run, matching how `feed-query.ts`, `post-actions.ts`, `NotificationBell.tsx` etc. carry no unit tests while the pure helpers they call do.

---

## Task 1: Schema — tables, RLS, notification type, realtime, deletion

**Files:**
- Create: `supabase/migrations/<ts>_direct_messages.sql`
- Modify: `lib/supabase/types.ts` (regenerated)
- Modify: `lib/supabase/middleware.ts`
- Modify: `lib/notifications/inbox.ts`

**Interfaces:**
- Produces: tables `dm_threads`, `dm_messages`, `dm_blocks`, `dm_reports` in production; `Database['public']['Tables']` entries for all four in `lib/supabase/types.ts`; `player_notifications.type` accepts `'direct_message'`; `dm_messages` on the realtime publication; `anonymise_account()` deletes DM rows; `/messages` redirects unauthenticated users to `/login`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/<ts>_direct_messages.sql` (real current UTC timestamp, e.g. `20260909210000`):

```sql
-- Private 1:1 player messaging. `070_chat_system` is the support chatbot — this
-- is unrelated and new.
--
-- Thread identity is the *pair*, stored normalised (player_a < player_b as text)
-- with a unique index, so A->B and B->A are one thread. Blocking is enforced in
-- the dm_messages INSERT policy, not just the UI. Messages are immutable except
-- read_at. Most players here are minors — block/report are part of this schema,
-- not a later addition.

-- ---------------------------------------------------------------
-- Threads
-- ---------------------------------------------------------------
CREATE TABLE public.dm_threads (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_a        uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  player_b        uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_by      uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dm_threads_pair_ordered CHECK (player_a < player_b),
  CONSTRAINT dm_threads_pair_unique  UNIQUE (player_a, player_b)
);
CREATE INDEX dm_threads_player_a_idx ON public.dm_threads (player_a, last_message_at DESC);
CREATE INDEX dm_threads_player_b_idx ON public.dm_threads (player_b, last_message_at DESC);
-- Rate limit reads this: new threads started by one player in the last 24h.
CREATE INDEX dm_threads_created_by_idx ON public.dm_threads (created_by, created_at DESC);

ALTER TABLE public.dm_threads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dm_threads_participant_read" ON public.dm_threads
  FOR SELECT USING (auth.uid() IN (player_a, player_b) OR public.is_staff());

-- Threads are created only via the sendMessage server action (service-role),
-- so no client INSERT/UPDATE/DELETE policy. Blocking hides a thread in the
-- query layer, not by deleting it.

-- ---------------------------------------------------------------
-- Messages
-- ---------------------------------------------------------------
CREATE TABLE public.dm_messages (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id  uuid        NOT NULL REFERENCES public.dm_threads(id) ON DELETE CASCADE,
  sender_id  uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body       text,
  image_url  text,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at    timestamptz,
  CONSTRAINT dm_messages_has_content
    CHECK ((body IS NOT NULL AND btrim(body) <> '') OR image_url IS NOT NULL),
  CONSTRAINT dm_messages_body_len
    CHECK (body IS NULL OR char_length(body) <= 2000)
);
CREATE INDEX dm_messages_thread_idx ON public.dm_messages (thread_id, created_at);
-- Unread lookups: "messages in my threads not sent by me and not yet read".
CREATE INDEX dm_messages_unread_idx ON public.dm_messages (thread_id, read_at) WHERE read_at IS NULL;

ALTER TABLE public.dm_messages ENABLE ROW LEVEL SECURITY;

-- A helper keeps the two message policies readable. STABLE + SECURITY DEFINER so
-- it can see dm_threads/dm_blocks regardless of the caller's own RLS.
CREATE OR REPLACE FUNCTION public.dm_can_message(p_thread uuid, p_sender uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.dm_threads t
    WHERE t.id = p_thread
      AND p_sender IN (t.player_a, t.player_b)
      AND NOT EXISTS (
        SELECT 1 FROM public.dm_blocks b
        WHERE (b.blocker_id = t.player_a AND b.blocked_id = t.player_b)
           OR (b.blocker_id = t.player_b AND b.blocked_id = t.player_a)
      )
  );
$$;

CREATE POLICY "dm_messages_participant_read" ON public.dm_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.dm_threads t
      WHERE t.id = thread_id AND (auth.uid() IN (t.player_a, t.player_b) OR public.is_staff())
    )
  );

-- Insert: you are the sender, you're a participant, and nobody has blocked
-- anybody in this pair. The server action also checks this (for a friendly
-- error) but the policy is the real guard.
CREATE POLICY "dm_messages_sender_insert" ON public.dm_messages
  FOR INSERT WITH CHECK (
    sender_id = auth.uid() AND public.dm_can_message(thread_id, auth.uid())
  );

-- The only permitted update is the recipient marking a message read.
CREATE POLICY "dm_messages_recipient_mark_read" ON public.dm_messages
  FOR UPDATE USING (
    sender_id <> auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.dm_threads t
      WHERE t.id = thread_id AND auth.uid() IN (t.player_a, t.player_b)
    )
  )
  WITH CHECK (sender_id <> auth.uid());

-- ---------------------------------------------------------------
-- Blocks
-- ---------------------------------------------------------------
CREATE TABLE public.dm_blocks (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  blocked_id uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dm_blocks_not_self  CHECK (blocker_id <> blocked_id),
  CONSTRAINT dm_blocks_pair_unique UNIQUE (blocker_id, blocked_id)
);
CREATE INDEX dm_blocks_blocker_idx ON public.dm_blocks (blocker_id);
CREATE INDEX dm_blocks_blocked_idx ON public.dm_blocks (blocked_id);

ALTER TABLE public.dm_blocks ENABLE ROW LEVEL SECURITY;

-- You see a block row if you are either party (so the UI can show "you blocked
-- them" vs "you can't message them"). You may only create/remove your own.
CREATE POLICY "dm_blocks_involved_read" ON public.dm_blocks
  FOR SELECT USING (auth.uid() IN (blocker_id, blocked_id) OR public.is_staff());
CREATE POLICY "dm_blocks_own_insert" ON public.dm_blocks
  FOR INSERT WITH CHECK (blocker_id = auth.uid());
CREATE POLICY "dm_blocks_own_delete" ON public.dm_blocks
  FOR DELETE USING (blocker_id = auth.uid());

-- ---------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------
CREATE TABLE public.dm_reports (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reported_id uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  thread_id   uuid        NOT NULL REFERENCES public.dm_threads(id) ON DELETE CASCADE,
  message_id  uuid        REFERENCES public.dm_messages(id) ON DELETE SET NULL,
  reason      text        NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 1000),
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid        REFERENCES public.profiles(id) ON DELETE SET NULL
);
CREATE INDEX dm_reports_open_idx ON public.dm_reports (created_at DESC) WHERE resolved_at IS NULL;

ALTER TABLE public.dm_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dm_reports_reporter_or_staff_read" ON public.dm_reports
  FOR SELECT USING (reporter_id = auth.uid() OR public.is_staff());
CREATE POLICY "dm_reports_own_insert" ON public.dm_reports
  FOR INSERT WITH CHECK (reporter_id = auth.uid());
CREATE POLICY "dm_reports_staff_update" ON public.dm_reports
  FOR UPDATE USING (public.is_staff()) WITH CHECK (public.is_staff());

-- ---------------------------------------------------------------
-- Notification type + realtime
-- ---------------------------------------------------------------
ALTER TABLE public.player_notifications DROP CONSTRAINT player_notifications_type_check;
ALTER TABLE public.player_notifications ADD CONSTRAINT player_notifications_type_check
  CHECK (type = ANY (ARRAY[
    'listing_approved','listing_removed','listing_deleted','listing_sold','withdrawal_paid',
    'withdrawal_rejected','result_confirmed','referral_credited','friend_request','wallet_credited',
    'player_disqualified','noshow_needs_decision','buy_request_in_progress','buy_request_fulfilled',
    'buy_request_closed','masters_invitation','champions_cup_invitation','invitation_accepted',
    'invitation_expired_cascade','tier_upgraded','achievement_unlocked','fixture_assigned',
    'prize_credited','match_reminder','tournament_announced','new_announcement','post_comment',
    'post_reaction','wager_settled','bracket_released','withdrawal_pending','exchange_listing_pending',
    'result_needs_review','result_disputed','result_no_submission','direct_message'
  ]::text[]));

-- RLS enforced on top of the publication — a subscriber only receives rows for
-- threads they participate in (dm_messages_participant_read).
ALTER PUBLICATION supabase_realtime ADD TABLE public.dm_messages;

-- ---------------------------------------------------------------
-- Account deletion — a private conversation ends when one side leaves,
-- same reasoning the function already applies to `friends`.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.anonymise_account(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_username text;
BEGIN
  SELECT username INTO v_username FROM public.profiles WHERE id = p_id;

  IF v_username IS NOT NULL THEN
    INSERT INTO public.retired_usernames (username)
    VALUES (lower(v_username))
    ON CONFLICT DO NOTHING;
  END IF;

  UPDATE public.profiles SET
    username           = 'deleted_' || substr(p_id::text, 1, 8),
    display_name       = 'Deleted player',
    avatar_url         = NULL,
    country            = NULL,
    phone              = NULL,
    whatsapp_number    = NULL,
    bio                = NULL,
    notification_prefs = '{}'::jsonb,
    last_login_date    = NULL,
    login_streak       = 0,
    deleted_at         = now(),
    updated_at         = now()
  WHERE id = p_id;

  DELETE FROM public.fcm_tokens                WHERE player_id = p_id;
  DELETE FROM public.phone_verifications       WHERE user_id   = p_id;
  DELETE FROM public.player_kyc                WHERE player_id = p_id;
  DELETE FROM public.game_interest             WHERE user_id   = p_id;
  DELETE FROM public.player_challenge_progress WHERE player_id = p_id;
  DELETE FROM public.player_store_items        WHERE player_id = p_id;
  DELETE FROM public.notifications             WHERE player_id = p_id;
  DELETE FROM public.player_notifications      WHERE player_id = p_id;
  DELETE FROM public.tournament_invitations    WHERE player_id = p_id;
  DELETE FROM public.user_roles                WHERE user_id   = p_id;
  DELETE FROM public.xp_events                 WHERE player_id = p_id;
  DELETE FROM public.friends
    WHERE requester_id = p_id OR recipient_id = p_id;

  -- Private messaging: drop the leaver's threads (cascades dm_messages),
  -- their blocks, and reports they filed or that name them.
  DELETE FROM public.dm_threads
    WHERE player_a = p_id OR player_b = p_id;
  DELETE FROM public.dm_blocks
    WHERE blocker_id = p_id OR blocked_id = p_id;
  DELETE FROM public.dm_reports
    WHERE reporter_id = p_id OR reported_id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.anonymise_account(uuid) FROM public, anon, authenticated;
```

> **If the DB's `anonymise_account` body has drifted from `079_anonymise_account.sql`** (another migration may have extended it since — check with `SELECT prosrc FROM pg_proc WHERE proname = 'anonymise_account';` in Step 3), keep every line it currently has and only add the three `dm_*` DELETEs before the final `END;`.

- [ ] **Step 2: Apply to production**

Supabase MCP `apply_migration` tool (name `direct_messages`), or `npx supabase db push` from the primary checkout if the CLI is reachable (memory `project_supabase_connectivity_gotcha` — prefer MCP). If neither is available, stop and ask the user.

- [ ] **Step 3: Verify in production**

Run via MCP `execute_sql`:

```sql
SELECT to_regclass('public.dm_threads'), to_regclass('public.dm_messages'),
       to_regclass('public.dm_blocks'), to_regclass('public.dm_reports');
SELECT tablename FROM pg_publication_tables
  WHERE pubname='supabase_realtime' AND tablename='dm_messages';
SELECT prosrc LIKE '%dm_threads%' AS deletion_patched
  FROM pg_proc WHERE proname='anonymise_account';
SELECT 'direct_message' = ANY (
  regexp_split_to_array(
    (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='player_notifications_type_check'),
    '\W+')) AS notif_type_ok;
```

Expected: 4 non-null regclasses, one `dm_messages` publication row, `deletion_patched = t`, `notif_type_ok = t`.

- [ ] **Step 4: Regenerate types**

MCP `generate_typescript_types` (project `itxubrkbropttfdackmi`) → write the `.types` payload to `lib/supabase/types.ts`. Confirm:

```bash
grep -c "dm_threads:\|dm_messages:\|dm_blocks:\|dm_reports:" lib/supabase/types.ts   # expect >= 4
```

- [ ] **Step 5: Guard `/messages` in middleware**

In `lib/supabase/middleware.ts`, change:

```ts
const PROTECTED = ['/dashboard', '/admin']
```

to:

```ts
const PROTECTED = ['/dashboard', '/admin', '/messages']
```

- [ ] **Step 6: Add the notification type**

In `lib/notifications/inbox.ts`, add `| 'direct_message'` to the `NotificationType` union (alphabetical-ish, next to `'post_reaction'` is fine).

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: passes (nothing consumes the new tables yet).

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/ lib/supabase/types.ts lib/supabase/middleware.ts lib/notifications/inbox.ts
git commit -m "feat(messages): schema for private 1:1 messaging

Four tables (threads/messages/blocks/reports), block enforced in the
dm_messages INSERT policy, dm_messages on realtime, anonymise_account extended
to drop a leaver's conversations, /messages guarded in middleware.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018zQe17sFEE1YWyDS9X2WfV"
```

---

## Task 2: Pure — thread pair normalisation (TDD)

**Files:**
- Create: `lib/messages/thread-key.ts`
- Test: `lib/messages/thread-key.test.ts`

**Interfaces:**
- Produces: `orderedPair(x: string, y: string): { playerA: string; playerB: string }` — sorts the two uuids as strings so `(A,B)` and `(B,A)` give the same result. Throws `Error('a player cannot message themselves')` if `x === y`.
- Consumed by: `lib/messages/query.ts` (`resolveThreadId`), `lib/messages/actions.ts` (`sendMessage`).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { orderedPair } from './thread-key'

describe('orderedPair', () => {
  it('puts the lexicographically smaller uuid first', () => {
    expect(orderedPair('bbb', 'aaa')).toEqual({ playerA: 'aaa', playerB: 'bbb' })
  })

  it('is order-independent', () => {
    expect(orderedPair('aaa', 'bbb')).toEqual(orderedPair('bbb', 'aaa'))
  })

  it('rejects a self-pair', () => {
    expect(() => orderedPair('aaa', 'aaa')).toThrow(/cannot message themselves/i)
  })
})
```

- [ ] **Step 2: Run — verify fail**

Run: `npx vitest run lib/messages/thread-key.test.ts`
Expected: FAIL — `Cannot find module './thread-key'`.

- [ ] **Step 3: Implement**

```ts
// The one place the normalised thread pair is computed. dm_threads has a
// CHECK (player_a < player_b) and a UNIQUE (player_a, player_b), so A->B and
// B->A must map to the same row — that only holds if every caller orders the
// pair the same way.
export function orderedPair(x: string, y: string): { playerA: string; playerB: string } {
  if (x === y) throw new Error('a player cannot message themselves')
  return x < y ? { playerA: x, playerB: y } : { playerA: y, playerB: x }
}
```

- [ ] **Step 4: Run — verify pass**

Run: `npx vitest run lib/messages/thread-key.test.ts`
Expected: PASS (3).

- [ ] **Step 5: Commit**

```bash
git add lib/messages/thread-key.ts lib/messages/thread-key.test.ts
git commit -m "feat(messages): thread pair normalisation

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018zQe17sFEE1YWyDS9X2WfV"
```

---

## Task 3: Pure — unread / block / rate-limit predicates (TDD)

**Files:**
- Create: `lib/messages/predicates.ts`
- Test: `lib/messages/predicates.test.ts`

**Interfaces:**
- Produces:
  - `type UnreadInput = { senderId: string; readAt: string | null }`
  - `unreadCount(messages: UnreadInput[], viewerId: string): number` — messages not sent by the viewer and with `readAt === null`.
  - `type BlockRow = { blockerId: string; blockedId: string }`
  - `isBlockedBetween(blocks: BlockRow[], x: string, y: string): boolean` — true if any row blocks x→y or y→x.
  - `NEW_THREAD_DAILY_CAP = 15`
  - `newThreadAllowed(startedInLast24h: number): boolean` — `startedInLast24h < NEW_THREAD_DAILY_CAP`.
- Consumed by: `lib/messages/query.ts`, `lib/messages/actions.ts`, `components/messages/*`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { unreadCount, isBlockedBetween, newThreadAllowed, NEW_THREAD_DAILY_CAP } from './predicates'

describe('unreadCount', () => {
  const rows = [
    { senderId: 'them', readAt: null },
    { senderId: 'them', readAt: '2026-09-09T00:00:00Z' },
    { senderId: 'me', readAt: null },
    { senderId: 'them', readAt: null },
  ]
  it('counts only unread messages from the other person', () => {
    expect(unreadCount(rows, 'me')).toBe(2)
  })
  it('is zero for an empty thread', () => {
    expect(unreadCount([], 'me')).toBe(0)
  })
})

describe('isBlockedBetween', () => {
  it('is true when x blocked y', () => {
    expect(isBlockedBetween([{ blockerId: 'x', blockedId: 'y' }], 'x', 'y')).toBe(true)
  })
  it('is true when y blocked x (symmetric in effect)', () => {
    expect(isBlockedBetween([{ blockerId: 'y', blockedId: 'x' }], 'x', 'y')).toBe(true)
  })
  it('is false when an unrelated block exists', () => {
    expect(isBlockedBetween([{ blockerId: 'x', blockedId: 'z' }], 'x', 'y')).toBe(false)
  })
})

describe('newThreadAllowed', () => {
  it('allows below the cap', () => {
    expect(newThreadAllowed(NEW_THREAD_DAILY_CAP - 1)).toBe(true)
  })
  it('blocks at the cap', () => {
    expect(newThreadAllowed(NEW_THREAD_DAILY_CAP)).toBe(false)
  })
})
```

- [ ] **Step 2: Run — verify fail**

Run: `npx vitest run lib/messages/predicates.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
export type UnreadInput = { senderId: string; readAt: string | null }

// "read_at IS NULL AND sender_id <> me" — the spec's exact definition.
export function unreadCount(messages: UnreadInput[], viewerId: string): number {
  return messages.filter((m) => m.senderId !== viewerId && m.readAt === null).length
}

export type BlockRow = { blockerId: string; blockedId: string }

// Blocking is symmetric in effect: if EITHER party blocked the other, neither
// can send. The DB's dm_can_message() enforces the same; this is the client twin.
export function isBlockedBetween(blocks: BlockRow[], x: string, y: string): boolean {
  return blocks.some(
    (b) =>
      (b.blockerId === x && b.blockedId === y) ||
      (b.blockerId === y && b.blockedId === x),
  )
}

// Cheapest effective anti-spam (spec): a cap on how many *new* conversations a
// player can start per rolling 24h. Existing threads are never limited.
export const NEW_THREAD_DAILY_CAP = 15

export function newThreadAllowed(startedInLast24h: number): boolean {
  return startedInLast24h < NEW_THREAD_DAILY_CAP
}
```

- [ ] **Step 4: Run — verify pass**

Run: `npx vitest run lib/messages/predicates.test.ts`
Expected: PASS (7).

- [ ] **Step 5: Commit**

```bash
git add lib/messages/predicates.ts lib/messages/predicates.test.ts
git commit -m "feat(messages): unread / block / rate-limit predicates

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018zQe17sFEE1YWyDS9X2WfV"
```

---

## Task 4: Zod schemas (TDD)

**Files:**
- Create: `lib/messages/schema.ts`
- Test: `lib/messages/schema.test.ts`

**Interfaces:**
- Produces:
  - `messageBodySchema: z.ZodType<string>` — trims, min 1 (`'Type a message first'`), max 2000 (`'Keep it under 2000 characters'`).
  - `reportReasonSchema: z.ZodType<string>` — trims, min 1 (`'Add a reason so staff can act on it'`), max 1000 (`'Keep it under 1000 characters'`).
- Consumed by: `lib/messages/actions.ts`, `components/messages/MessageComposer.tsx`, `components/messages/ThreadMenu.tsx`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { messageBodySchema, reportReasonSchema } from './schema'

describe('messageBodySchema', () => {
  it('trims', () => {
    expect(messageBodySchema.parse('  hi  ')).toBe('hi')
  })
  it('rejects empty / whitespace', () => {
    expect(messageBodySchema.safeParse('   ').success).toBe(false)
  })
  it('rejects over 2000 chars', () => {
    const res = messageBodySchema.safeParse('x'.repeat(2001))
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error.issues[0].message).toMatch(/under 2000/i)
  })
  it('accepts exactly 2000', () => {
    expect(messageBodySchema.parse('x'.repeat(2000))).toHaveLength(2000)
  })
})

describe('reportReasonSchema', () => {
  it('rejects empty', () => {
    expect(reportReasonSchema.safeParse('').success).toBe(false)
  })
  it('accepts a short reason', () => {
    expect(reportReasonSchema.parse('  harassment ')).toBe('harassment')
  })
})
```

- [ ] **Step 2: Run — verify fail**

Run: `npx vitest run lib/messages/schema.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
import { z } from 'zod'

// Mirrors dm_messages CHECKs: btrim(body) <> '' and char_length(body) <= 2000.
export const messageBodySchema = z
  .string()
  .trim()
  .min(1, 'Type a message first')
  .max(2000, 'Keep it under 2000 characters')

// Mirrors dm_reports.reason CHECK (1..1000).
export const reportReasonSchema = z
  .string()
  .trim()
  .min(1, 'Add a reason so staff can act on it')
  .max(1000, 'Keep it under 1000 characters')
```

- [ ] **Step 4: Run — verify pass**

Run: `npx vitest run lib/messages/schema.test.ts` → PASS (6).

- [ ] **Step 5: Commit**

```bash
git add lib/messages/schema.ts lib/messages/schema.test.ts
git commit -m "feat(messages): body + report reason validation

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018zQe17sFEE1YWyDS9X2WfV"
```

---

## Task 5: Query layer

**Files:**
- Create: `lib/messages/query.ts`

**Interfaces:**
- Consumes: `orderedPair` (Task 2), `unreadCount`, `isBlockedBetween` (Task 3), `createClient` from `@/lib/supabase/server`.
- Produces:
  - `type ThreadSummary = { threadId: string; otherId: string; otherName: string; otherUsername: string | null; otherAvatarUrl: string | null; lastMessage: string | null; lastMessageAt: string; unread: number }`
  - `fetchThreadList(viewerId: string): Promise<ThreadSummary[]>` — the viewer's threads, most-recent first, **excluding threads where the pair is blocked in either direction**, newest message preview + per-thread unread.
  - `type ThreadDetail = { threadId: string; other: { id: string; name: string; username: string | null; avatarUrl: string | null }; messages: { id: string; senderId: string; body: string | null; createdAt: string; readAt: string | null }[]; blockedByMe: boolean; blockedByThem: boolean }`
  - `fetchThread(threadId: string, viewerId: string): Promise<ThreadDetail | null>` — `null` if the viewer is not a participant (RLS returns nothing) or the thread does not exist.
  - `resolveThreadId(viewerId: string, otherId: string): Promise<string | null>` — the existing thread id for this pair, or `null` if none exists yet (does **not** create — creation happens in `sendMessage`).
- Consumed by: the two pages (Task 7, 8) and `MessageButton` (Task 9).

- [ ] **Step 1: Write `query.ts`**

```ts
import { createClient } from '@/lib/supabase/server'
import { orderedPair } from './thread-key'
import { unreadCount, isBlockedBetween, type BlockRow } from './predicates'

const PROFILE = 'id, username, display_name, avatar_url'

type ProfileRow = { id: string; username: string | null; display_name: string | null; avatar_url: string | null }

export type ThreadSummary = {
  threadId: string
  otherId: string
  otherName: string
  otherUsername: string | null
  otherAvatarUrl: string | null
  lastMessage: string | null
  lastMessageAt: string
  unread: number
}

export async function fetchThreadList(viewerId: string): Promise<ThreadSummary[]> {
  const supabase = createClient()

  const { data: threads } = await supabase
    .from('dm_threads')
    .select('id, player_a, player_b, last_message_at')
    .or(`player_a.eq.${viewerId},player_b.eq.${viewerId}`)
    .order('last_message_at', { ascending: false })
  if (!threads || threads.length === 0) return []

  const threadIds = threads.map((t) => t.id)
  const otherIds = threads.map((t) => (t.player_a === viewerId ? t.player_b : t.player_a))

  const [{ data: profiles }, { data: msgs }, { data: blocks }] = await Promise.all([
    supabase.from('profiles').select(PROFILE).in('id', otherIds),
    supabase
      .from('dm_messages')
      .select('thread_id, sender_id, body, created_at, read_at')
      .in('thread_id', threadIds)
      .order('created_at', { ascending: true }),
    supabase
      .from('dm_blocks')
      .select('blocker_id, blocked_id')
      .or(`blocker_id.eq.${viewerId},blocked_id.eq.${viewerId}`),
  ])

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p as ProfileRow]))
  const blockRows: BlockRow[] = (blocks ?? []).map((b) => ({ blockerId: b.blocker_id, blockedId: b.blocked_id }))
  const msgsByThread = new Map<string, { sender_id: string; body: string | null; created_at: string; read_at: string | null }[]>()
  for (const m of msgs ?? []) {
    const list = msgsByThread.get(m.thread_id) ?? []
    list.push(m)
    msgsByThread.set(m.thread_id, list)
  }

  const out: ThreadSummary[] = []
  for (const t of threads) {
    const otherId = t.player_a === viewerId ? t.player_b : t.player_a
    if (isBlockedBetween(blockRows, viewerId, otherId)) continue // hidden from both trays
    const list = msgsByThread.get(t.id) ?? []
    const last = list[list.length - 1]
    const other = profileById.get(otherId)
    out.push({
      threadId: t.id,
      otherId,
      otherName: other?.display_name ?? other?.username ?? 'Player',
      otherUsername: other?.username ?? null,
      otherAvatarUrl: other?.avatar_url ?? null,
      lastMessage: last?.body ?? null,
      lastMessageAt: t.last_message_at,
      unread: unreadCount(
        list.map((m) => ({ senderId: m.sender_id, readAt: m.read_at })),
        viewerId,
      ),
    })
  }
  return out
}

export type ThreadDetail = {
  threadId: string
  other: { id: string; name: string; username: string | null; avatarUrl: string | null }
  messages: { id: string; senderId: string; body: string | null; createdAt: string; readAt: string | null }[]
  blockedByMe: boolean
  blockedByThem: boolean
}

export async function fetchThread(threadId: string, viewerId: string): Promise<ThreadDetail | null> {
  const supabase = createClient()

  // RLS returns the row only to a participant; a non-participant gets null.
  const { data: thread } = await supabase
    .from('dm_threads')
    .select('id, player_a, player_b')
    .eq('id', threadId)
    .maybeSingle()
  if (!thread) return null
  if (viewerId !== thread.player_a && viewerId !== thread.player_b) return null

  const otherId = thread.player_a === viewerId ? thread.player_b : thread.player_a

  const [{ data: other }, { data: messages }, { data: blocks }] = await Promise.all([
    supabase.from('profiles').select(PROFILE).eq('id', otherId).maybeSingle(),
    supabase
      .from('dm_messages')
      .select('id, sender_id, body, created_at, read_at')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true }),
    supabase
      .from('dm_blocks')
      .select('blocker_id, blocked_id')
      .or(`blocker_id.eq.${viewerId},blocked_id.eq.${viewerId}`),
  ])

  const blockRows = (blocks ?? []) as { blocker_id: string; blocked_id: string }[]

  return {
    threadId,
    other: {
      id: otherId,
      name: other?.display_name ?? other?.username ?? 'Player',
      username: other?.username ?? null,
      avatarUrl: other?.avatar_url ?? null,
    },
    messages: (messages ?? []).map((m) => ({
      id: m.id,
      senderId: m.sender_id,
      body: m.body,
      createdAt: m.created_at,
      readAt: m.read_at,
    })),
    blockedByMe: blockRows.some((b) => b.blocker_id === viewerId && b.blocked_id === otherId),
    blockedByThem: blockRows.some((b) => b.blocker_id === otherId && b.blocked_id === viewerId),
  }
}

export async function resolveThreadId(viewerId: string, otherId: string): Promise<string | null> {
  const supabase = createClient()
  const { playerA, playerB } = orderedPair(viewerId, otherId)
  const { data } = await supabase
    .from('dm_threads')
    .select('id')
    .eq('player_a', playerA)
    .eq('player_b', playerB)
    .maybeSingle()
  return data?.id ?? null
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npx next lint --file lib/messages/query.ts`
Expected: passes. (If `dm_*` are `never`-typed, Task 1 Step 4 was not completed.)

- [ ] **Step 3: Commit**

```bash
git add lib/messages/query.ts
git commit -m "feat(messages): thread list + conversation + pair-resolve queries

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018zQe17sFEE1YWyDS9X2WfV"
```

---

## Task 6: Server actions

**Files:**
- Create: `lib/messages/actions.ts`

**Interfaces:**
- Consumes: `orderedPair` (Task 2), `newThreadAllowed`, `NEW_THREAD_DAILY_CAP` (Task 3), `messageBodySchema`, `reportReasonSchema` (Task 4), `createClient` from `@/lib/supabase/server`, `createAdminClient` from `@/lib/supabase/admin`, `notifyInApp` from `@/lib/notifications/inbox`.
- Produces (`'use server'`):
  - `sendMessage(input: { threadId?: string; recipientId?: string; body: string }): Promise<{ threadId?: string; error?: string }>` — resolves-or-creates the thread (creating counts against the daily cap), validates the body, inserts the message, bumps `last_message_at`, notifies the recipient. Rejects when the pair is blocked either way.
  - `markThreadRead(threadId: string): Promise<void>` — best-effort; sets `read_at = now()` on the viewer's unread inbound messages and marks matching `direct_message` notifications read.
  - `blockUser(otherId: string): Promise<{ error?: string }>`
  - `unblockUser(otherId: string): Promise<{ error?: string }>`
  - `reportConversation(input: { threadId: string; messageId?: string; reason: string }): Promise<{ error?: string }>`
- Consumed by: `MessageComposer`, `Conversation`, `ThreadMenu`, `MessageButton`, both pages.

- [ ] **Step 1: Write `actions.ts`**

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { orderedPair } from './thread-key'
import { newThreadAllowed } from './predicates'
import { messageBodySchema, reportReasonSchema } from './schema'
import { notifyInApp } from '@/lib/notifications/inbox'

async function authed() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return { supabase, userId: user?.id ?? null }
}

// Returns an existing thread id, or creates one (which counts against the
// daily new-conversation cap). Uses the service-role client for the insert —
// dm_threads has no client INSERT policy.
async function resolveOrCreateThread(
  viewerId: string,
  otherId: string,
): Promise<{ threadId: string } | { error: string }> {
  const admin = createAdminClient()
  const { playerA, playerB } = orderedPair(viewerId, otherId)

  const { data: existing } = await admin
    .from('dm_threads')
    .select('id')
    .eq('player_a', playerA)
    .eq('player_b', playerB)
    .maybeSingle()
  if (existing) return { threadId: existing.id }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count } = await admin
    .from('dm_threads')
    .select('id', { count: 'exact', head: true })
    .eq('created_by', viewerId)
    .gt('created_at', since)
  if (!newThreadAllowed(count ?? 0)) {
    return { error: "You've started a lot of new conversations today. Try again tomorrow." }
  }

  // Two clients racing the same new pair: the UNIQUE (player_a, player_b) makes
  // the loser's insert 23505 — re-read instead of failing.
  const { data: created, error } = await admin
    .from('dm_threads')
    .insert({ player_a: playerA, player_b: playerB, created_by: viewerId })
    .select('id')
    .single()
  if (error?.code === '23505') {
    const { data: raced } = await admin
      .from('dm_threads')
      .select('id')
      .eq('player_a', playerA)
      .eq('player_b', playerB)
      .maybeSingle()
    if (raced) return { threadId: raced.id }
  }
  if (error || !created) return { error: 'Could not start this conversation. Please try again.' }
  return { threadId: created.id }
}

export async function sendMessage(input: {
  threadId?: string
  recipientId?: string
  body: string
}): Promise<{ threadId?: string; error?: string }> {
  const { supabase, userId } = await authed()
  if (!userId) return { error: 'Please log in.' }

  const parsed = messageBodySchema.safeParse(input.body)
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const body = parsed.data

  // Establish the thread + the other participant.
  let threadId = input.threadId
  let otherId: string
  const admin = createAdminClient()

  if (threadId) {
    const { data: t } = await admin
      .from('dm_threads')
      .select('player_a, player_b')
      .eq('id', threadId)
      .maybeSingle()
    if (!t || (t.player_a !== userId && t.player_b !== userId)) {
      return { error: 'Conversation not found.' }
    }
    otherId = t.player_a === userId ? t.player_b : t.player_a
  } else {
    if (!input.recipientId || input.recipientId === userId) return { error: 'Pick someone to message.' }
    otherId = input.recipientId
    const resolved = await resolveOrCreateThread(userId, otherId)
    if ('error' in resolved) return resolved
    threadId = resolved.threadId
  }

  // Block check (the RLS insert would also reject, but this is the friendly path).
  const { data: blockRows } = await admin
    .from('dm_blocks')
    .select('blocker_id, blocked_id')
    .or(
      `and(blocker_id.eq.${userId},blocked_id.eq.${otherId}),and(blocker_id.eq.${otherId},blocked_id.eq.${userId})`,
    )
  if (blockRows && blockRows.length > 0) {
    const iBlocked = blockRows.some((b) => b.blocker_id === userId)
    return { error: iBlocked ? 'Unblock this player to message them.' : 'You can no longer message this player.' }
  }

  // Insert via the *session* client so the RLS sender-insert policy applies
  // (defence in depth) — dm_can_message() re-checks the block server-side.
  const { error: insErr } = await supabase.from('dm_messages').insert({ thread_id: threadId, sender_id: userId, body })
  if (insErr) {
    console.error('[sendMessage] insert failed', { userId, threadId, code: insErr.code, message: insErr.message })
    return { error: 'Could not send your message. Please try again.' }
  }

  await admin.from('dm_threads').update({ last_message_at: new Date().toISOString() }).eq('id', threadId)

  const { data: me } = await admin.from('profiles').select('display_name, username').eq('id', userId).maybeSingle()
  const fromName = me?.display_name ?? me?.username ?? 'Someone'
  const preview = body.length > 80 ? `${body.slice(0, 80)}…` : body
  void notifyInApp({
    playerId: otherId,
    type: 'direct_message',
    title: `New message from ${fromName}`,
    body: preview,
    link: `/messages/${threadId}`,
  })

  revalidatePath('/messages')
  revalidatePath(`/messages/${threadId}`)
  return { threadId }
}

export async function markThreadRead(threadId: string): Promise<void> {
  try {
    const { supabase, userId } = await authed()
    if (!userId) return
    await supabase
      .from('dm_messages')
      .update({ read_at: new Date().toISOString() })
      .eq('thread_id', threadId)
      .neq('sender_id', userId)
      .is('read_at', null)
    // Clear the bell entries for this thread.
    const admin = createAdminClient()
    await admin
      .from('player_notifications')
      .update({ read: true })
      .eq('player_id', userId)
      .eq('type', 'direct_message')
      .eq('link', `/messages/${threadId}`)
      .eq('read', false)
  } catch {
    // best-effort
  }
}

export async function blockUser(otherId: string): Promise<{ error?: string }> {
  const { supabase, userId } = await authed()
  if (!userId) return { error: 'Please log in.' }
  if (otherId === userId) return { error: 'You cannot block yourself.' }
  const { error } = await supabase
    .from('dm_blocks')
    .upsert({ blocker_id: userId, blocked_id: otherId }, { onConflict: 'blocker_id,blocked_id', ignoreDuplicates: true })
  if (error) return { error: 'Could not block this player.' }
  revalidatePath('/messages')
  return {}
}

export async function unblockUser(otherId: string): Promise<{ error?: string }> {
  const { supabase, userId } = await authed()
  if (!userId) return { error: 'Please log in.' }
  const { error } = await supabase.from('dm_blocks').delete().eq('blocker_id', userId).eq('blocked_id', otherId)
  if (error) return { error: 'Could not unblock this player.' }
  revalidatePath('/messages')
  return {}
}

export async function reportConversation(input: {
  threadId: string
  messageId?: string
  reason: string
}): Promise<{ error?: string }> {
  const { supabase, userId } = await authed()
  if (!userId) return { error: 'Please log in.' }

  const parsed = reportReasonSchema.safeParse(input.reason)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const admin = createAdminClient()
  const { data: t } = await admin
    .from('dm_threads')
    .select('player_a, player_b')
    .eq('id', input.threadId)
    .maybeSingle()
  if (!t || (t.player_a !== userId && t.player_b !== userId)) return { error: 'Conversation not found.' }
  const reportedId = t.player_a === userId ? t.player_b : t.player_a

  const { error } = await supabase.from('dm_reports').insert({
    reporter_id: userId,
    reported_id: reportedId,
    thread_id: input.threadId,
    message_id: input.messageId ?? null,
    reason: parsed.data,
  })
  if (error) return { error: 'Could not send this report. Please try again.' }
  return {}
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npx next lint --file lib/messages/actions.ts`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add lib/messages/actions.ts
git commit -m "feat(messages): send / read / block / report server actions

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018zQe17sFEE1YWyDS9X2WfV"
```

---

## Task 7: `/messages` thread list page

**Files:**
- Create: `app/[locale]/messages/page.tsx`
- Create: `components/messages/ThreadListItem.tsx`
- Create: `components/messages/MessagesRealtime.tsx`

**Interfaces:**
- Consumes: `fetchThreadList`, `type ThreadSummary` (Task 5); `Avatar` from `@/components/shared/Avatar`; `formatRelativeTime` from `@/lib/format`; `createClient` from `@/lib/supabase/client`.
- Produces: the `/messages` route — list of `ThreadListItem` rows, each linking to `/messages/[threadId]`; empty state pointing at `/players`; a `<MessagesRealtime>` client island that `router.refresh()`es on any `dm_messages` change.
- Consumed by: nothing (leaf route).

- [ ] **Step 1: `MessagesRealtime.tsx`**

```tsx
'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

// The list is fully server-hydrated (previews, unread counts, other-party
// profiles), so re-running the server component is correct-by-construction —
// same choice as CommunityRealtime. RLS scopes the subscription to this
// viewer's threads; a 400ms debounce keeps a burst cheap.
export function MessagesRealtime() {
  const router = useRouter()
  useEffect(() => {
    const supabase = createClient()
    let timer: ReturnType<typeof setTimeout> | null = null
    const channel = supabase
      .channel('dm:list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dm_messages' }, () => {
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => router.refresh(), 400)
      })
      .subscribe()
    return () => {
      if (timer) clearTimeout(timer)
      supabase.removeChannel(channel)
    }
  }, [router])
  return null
}
```

- [ ] **Step 2: `ThreadListItem.tsx`**

```tsx
import Link from 'next/link'
import { Avatar } from '@/components/shared/Avatar'
import { formatRelativeTime } from '@/lib/format'
import type { ThreadSummary } from '@/lib/messages/query'

export function ThreadListItem({ thread }: { thread: ThreadSummary }) {
  return (
    <Link
      href={`/messages/${thread.threadId}`}
      className="flex items-center gap-3 rounded-xl border border-sx-border bg-sx-surface px-3 py-3 transition-colors hover:border-sx-purple/40"
    >
      <Avatar avatarUrl={thread.otherAvatarUrl} displayName={thread.otherName} username={thread.otherUsername} size={44} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-bold text-white">{thread.otherName}</p>
          <span className="ml-auto shrink-0 text-[11px] text-sx-gray">{formatRelativeTime(thread.lastMessageAt)}</span>
        </div>
        <p className={`truncate text-xs ${thread.unread > 0 ? 'font-semibold text-white' : 'text-sx-gray'}`}>
          {thread.lastMessage ?? 'No messages yet'}
        </p>
      </div>
      {thread.unread > 0 && (
        <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-sx-purple px-1.5 text-[11px] font-bold text-white">
          {thread.unread > 99 ? '99+' : thread.unread}
        </span>
      )}
    </Link>
  )
}
```

- [ ] **Step 3: `page.tsx`**

```tsx
import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { fetchThreadList } from '@/lib/messages/query'
import { ThreadListItem } from '@/components/messages/ThreadListItem'
import { MessagesRealtime } from '@/components/messages/MessagesRealtime'

export const metadata: Metadata = { title: 'Messages · SentinelX Esports', robots: { index: false, follow: false } }

export default async function MessagesPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/messages')

  const threads = await fetchThreadList(user.id)

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 pb-24">
      <MessagesRealtime />
      <h1 className="mb-4 font-display text-2xl font-black uppercase text-white">Messages</h1>
      {threads.length === 0 ? (
        <div className="rounded-xl border border-sx-border bg-sx-surface p-8 text-center">
          <p className="text-sm text-sx-gray">No conversations yet.</p>
          <Link href="/players" className="mt-3 inline-block text-sm font-bold text-sx-purple-text hover:text-sx-purple-light">
            Find players to message →
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {threads.map((t) => (
            <ThreadListItem key={t.threadId} thread={t} />
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit && npx next lint --file "app/[locale]/messages/page.tsx" --file components/messages/ThreadListItem.tsx --file components/messages/MessagesRealtime.tsx`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add "app/[locale]/messages/page.tsx" components/messages/ThreadListItem.tsx components/messages/MessagesRealtime.tsx
git commit -m "feat(messages): /messages thread list

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018zQe17sFEE1YWyDS9X2WfV"
```

---

## Task 8: `/messages/[threadId]` conversation page

**Files:**
- Create: `app/[locale]/messages/[threadId]/page.tsx`
- Create: `components/messages/Conversation.tsx`
- Create: `components/messages/MessageComposer.tsx`
- Create: `components/messages/ThreadMenu.tsx`

**Interfaces:**
- Consumes: `fetchThread`, `type ThreadDetail` (Task 5); `sendMessage`, `markThreadRead`, `blockUser`, `unblockUser`, `reportConversation` (Task 6); `messageBodySchema`, `reportReasonSchema` (Task 4); `Avatar`; `formatRelativeTime`; `createClient` from `@/lib/supabase/client`.
- Produces: the `/messages/[threadId]` route — a header (other player's avatar/name linking to their profile, overflow menu), a scrolling message list that appends in realtime, and a composer. `notFound()` when `fetchThread` returns `null`.
- Consumed by: nothing (leaf route).

- [ ] **Step 1: `MessageComposer.tsx`**

```tsx
'use client'
import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { SendHorizonal } from 'lucide-react'
import { sendMessage } from '@/lib/messages/actions'
import { messageBodySchema } from '@/lib/messages/schema'

export function MessageComposer({ threadId, disabled, disabledReason }: { threadId: string; disabled?: boolean; disabledReason?: string }) {
  const router = useRouter()
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const ref = useRef<HTMLTextAreaElement>(null)

  if (disabled) {
    return (
      <div className="border-t border-sx-border bg-sx-surface px-4 py-3 text-center text-xs text-sx-gray">
        {disabledReason ?? 'You cannot message this player.'}
      </div>
    )
  }

  const ok = messageBodySchema.safeParse(body).success && !pending

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!ok) return
    setError(null)
    const text = body
    setBody('')
    start(async () => {
      const res = await sendMessage({ threadId, body: text })
      if (res.error) {
        setError(res.error)
        setBody(text)
        return
      }
      router.refresh()
      ref.current?.focus()
    })
  }

  return (
    <form onSubmit={submit} className="border-t border-sx-border bg-sx-surface px-3 py-2">
      {error && <p className="mb-1 text-xs text-red-400">{error}</p>}
      <div className="flex items-end gap-2">
        <textarea
          ref={ref}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit(e as unknown as React.FormEvent)
            }
          }}
          rows={1}
          maxLength={2000}
          placeholder="Message…"
          className="max-h-32 min-h-[38px] flex-1 resize-none rounded-lg border border-sx-border bg-sx-bg px-3 py-2 text-sm text-white placeholder:text-sx-gray focus:border-sx-purple focus:outline-none"
        />
        <button
          type="submit"
          disabled={!ok}
          aria-label="Send"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sx-purple text-white hover:bg-sx-purple-light disabled:opacity-40"
        >
          <SendHorizonal className="h-4 w-4" />
        </button>
      </div>
    </form>
  )
}
```

- [ ] **Step 2: `ThreadMenu.tsx`**

```tsx
'use client'
import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { MoreVertical, Ban, Flag, X } from 'lucide-react'
import { blockUser, unblockUser, reportConversation } from '@/lib/messages/actions'
import { reportReasonSchema } from '@/lib/messages/schema'

export function ThreadMenu({ threadId, otherId, otherName, blockedByMe }: { threadId: string; otherId: string; otherName: string; blockedByMe: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [reporting, setReporting] = useState(false)
  const [reason, setReason] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  function toggleBlock() {
    setOpen(false)
    start(async () => {
      const res = blockedByMe ? await unblockUser(otherId) : await blockUser(otherId)
      if (res.error) setMsg(res.error)
      else router.refresh()
    })
  }

  function submitReport(e: React.FormEvent) {
    e.preventDefault()
    if (!reportReasonSchema.safeParse(reason).success) return
    start(async () => {
      const res = await reportConversation({ threadId, reason })
      if (res.error) {
        setMsg(res.error)
        return
      }
      setReporting(false)
      setReason('')
      setMsg('Report sent. Our team will review it.')
    })
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Conversation options"
        className="flex h-9 w-9 items-center justify-center rounded-lg text-white/70 hover:bg-white/5 hover:text-white"
      >
        <MoreVertical className="h-5 w-5" />
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-20 w-44 overflow-hidden rounded-xl border border-sx-border bg-sx-surface py-1 shadow-xl">
          <button
            type="button"
            onClick={toggleBlock}
            disabled={pending}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-white hover:bg-white/5"
          >
            <Ban className="h-4 w-4" /> {blockedByMe ? 'Unblock' : 'Block'} {otherName}
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              setReporting(true)
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-red-400 hover:bg-white/5"
          >
            <Flag className="h-4 w-4" /> Report
          </button>
        </div>
      )}

      {msg && <p className="absolute right-0 top-11 z-20 w-56 rounded-lg border border-sx-border bg-sx-surface p-2 text-[11px] text-sx-gray">{msg}</p>}

      {reporting && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/70 sm:items-center" onClick={() => setReporting(false)}>
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={submitReport}
            className="w-full rounded-t-2xl border border-sx-border bg-sx-surface p-4 sm:max-w-sm sm:rounded-2xl"
          >
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-black uppercase tracking-widest text-white">Report {otherName}</p>
              <button type="button" onClick={() => setReporting(false)} aria-label="Close" className="text-sx-gray hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
              maxLength={1000}
              placeholder="What happened? Staff will see this conversation."
              className="w-full resize-none rounded-lg border border-sx-border bg-sx-bg px-3 py-2 text-sm text-white placeholder:text-sx-gray focus:border-sx-purple focus:outline-none"
              autoFocus
            />
            <button
              type="submit"
              disabled={pending || !reportReasonSchema.safeParse(reason).success}
              className="mt-3 w-full rounded-lg bg-red-500/90 px-4 py-2 text-xs font-bold text-white hover:bg-red-500 disabled:opacity-50"
            >
              {pending ? 'Sending…' : 'Send report'}
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: `Conversation.tsx`**

```tsx
'use client'
import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { markThreadRead } from '@/lib/messages/actions'
import { formatRelativeTime } from '@/lib/format'
import type { ThreadDetail } from '@/lib/messages/query'
import { MessageComposer } from './MessageComposer'

type Msg = ThreadDetail['messages'][number]

export function Conversation({ detail, viewerId }: { detail: ThreadDetail; viewerId: string }) {
  const [messages, setMessages] = useState<Msg[]>(detail.messages)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Realtime append — RLS scopes the stream to this thread's participants; the
  // filter is a second guard. De-dupe on id so our own optimistic refresh and
  // the echo don't double-render.
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`dm:thread:${detail.threadId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'dm_messages', filter: `thread_id=eq.${detail.threadId}` },
        (payload) => {
          const r = payload.new as { id: string; sender_id: string; body: string | null; created_at: string; read_at: string | null }
          setMessages((prev) =>
            prev.some((m) => m.id === r.id)
              ? prev
              : [...prev, { id: r.id, senderId: r.sender_id, body: r.body, createdAt: r.created_at, readAt: r.read_at }],
          )
          if (r.sender_id !== viewerId) void markThreadRead(detail.threadId)
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [detail.threadId, viewerId])

  // Keep local state in sync when the server component re-renders (our own send).
  useEffect(() => {
    setMessages(detail.messages)
  }, [detail.messages])

  // Mark read on open + whenever new inbound arrives.
  useEffect(() => {
    void markThreadRead(detail.threadId)
  }, [detail.threadId, messages.length])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length])

  const disabled = detail.blockedByMe || detail.blockedByThem
  const disabledReason = detail.blockedByMe
    ? 'You blocked this player. Unblock from the menu to message them.'
    : detail.blockedByThem
      ? 'You can no longer message this player.'
      : undefined

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
        {messages.length === 0 && <p className="py-8 text-center text-xs text-sx-gray">Say hello 👋</p>}
        {messages.map((m) => {
          const mine = m.senderId === viewerId
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                  mine ? 'bg-sx-purple text-white' : 'bg-sx-surface text-white'
                }`}
              >
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
                <p className={`mt-0.5 text-[10px] ${mine ? 'text-white/60' : 'text-sx-gray'}`}>
                  {formatRelativeTime(m.createdAt)}
                </p>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>
      <MessageComposer threadId={detail.threadId} disabled={disabled} disabledReason={disabledReason} />
    </div>
  )
}
```

- [ ] **Step 4: `page.tsx`**

```tsx
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { fetchThread } from '@/lib/messages/query'
import { Avatar } from '@/components/shared/Avatar'
import { Conversation } from '@/components/messages/Conversation'
import { ThreadMenu } from '@/components/messages/ThreadMenu'

export const metadata: Metadata = { title: 'Conversation · SentinelX Esports', robots: { index: false, follow: false } }

export default async function ThreadPage({ params }: { params: { threadId: string } }) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect(`/login?next=/messages/${params.threadId}`)

  const detail = await fetchThread(params.threadId, user.id)
  if (!detail) notFound()

  return (
    <div className="mx-auto flex h-[calc(100dvh-var(--site-header-h,64px))] max-w-2xl flex-col px-0 sm:px-4">
      <header className="flex items-center gap-2 border-b border-sx-border px-3 py-2">
        <Link href="/messages" aria-label="Back to messages" className="flex h-9 w-9 items-center justify-center rounded-lg text-white/70 hover:bg-white/5">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <Link
          href={detail.other.username ? `/players/${detail.other.username}` : '#'}
          className="flex min-w-0 items-center gap-2"
        >
          <Avatar avatarUrl={detail.other.avatarUrl} displayName={detail.other.name} username={detail.other.username} size={32} />
          <span className="truncate text-sm font-bold text-white">{detail.other.name}</span>
        </Link>
        <div className="ml-auto">
          <ThreadMenu threadId={detail.threadId} otherId={detail.other.id} otherName={detail.other.name} blockedByMe={detail.blockedByMe} />
        </div>
      </header>
      <Conversation detail={detail} viewerId={user.id} />
    </div>
  )
}
```

> `--site-header-h` may not be a real CSS var in this codebase. Check `components/shared/SiteHeader.tsx` / the root layout for the actual header height (it renders a fixed/sticky header). If there's no variable, hardcode the measured height (e.g. `h-[calc(100dvh-64px)]`) and note it. The goal: the composer sits at the bottom of the viewport, the message list scrolls between header and composer.

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit && npx next lint --file "app/[locale]/messages/[threadId]/page.tsx" --file components/messages/Conversation.tsx --file components/messages/MessageComposer.tsx --file components/messages/ThreadMenu.tsx`
Expected: passes.

- [ ] **Step 6: Commit**

```bash
git add "app/[locale]/messages/[threadId]" components/messages/Conversation.tsx components/messages/MessageComposer.tsx components/messages/ThreadMenu.tsx
git commit -m "feat(messages): conversation view with realtime, block + report

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018zQe17sFEE1YWyDS9X2WfV"
```

---

## Task 9: "Message" button on the profile

**Files:**
- Create: `components/player/MessageButton.tsx`
- Modify: `components/player/ProfileHeader.tsx`

**Interfaces:**
- Consumes: `resolveThreadId` (Task 5) — no; the button is a client component, so it calls a tiny server action. Add `startConversation(otherId: string): Promise<{ threadId?: string; error?: string }>` to `lib/messages/actions.ts` in this task (it wraps `resolveOrCreateThread` — exported via a thin `'use server'` fn). Then the button navigates to `/messages/[threadId]`.
- Produces: `<MessageButton recipientId={string} />` — a button that, on click, calls `startConversation` and `router.push`es to the thread. Shown by `ProfileHeader` for a logged-in non-owner viewer, beside `FriendStatusAction` / `ChallengeButton`.

- [ ] **Step 1: Add `startConversation` to `lib/messages/actions.ts`**

```ts
// Append to lib/messages/actions.ts
export async function startConversation(otherId: string): Promise<{ threadId?: string; error?: string }> {
  const { userId } = await authed()
  if (!userId) return { error: 'Please log in.' }
  if (otherId === userId) return { error: 'That is you.' }
  const resolved = await resolveOrCreateThread(userId, otherId)
  if ('error' in resolved) return resolved
  return { threadId: resolved.threadId }
}
```

- [ ] **Step 2: `MessageButton.tsx`**

```tsx
'use client'
import { useTransition, useState } from 'react'
import { useRouter } from 'next/navigation'
import { MessageCircle } from 'lucide-react'
import { startConversation } from '@/lib/messages/actions'

export function MessageButton({ recipientId }: { recipientId: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null)
            const res = await startConversation(recipientId)
            if (res.error || !res.threadId) {
              setError(res.error ?? 'Could not open the conversation.')
              return
            }
            router.push(`/messages/${res.threadId}`)
          })
        }
        className="inline-flex items-center gap-1.5 rounded-lg border border-sx-border px-3 py-1.5 text-xs font-bold text-white hover:border-sx-purple/50 disabled:opacity-50"
      >
        <MessageCircle className="h-3.5 w-3.5" />
        {pending ? 'Opening…' : 'Message'}
      </button>
      {error && <span className="mt-1 text-[11px] text-red-400">{error}</span>}
    </span>
  )
}
```

- [ ] **Step 3: Wire into `ProfileHeader.tsx`**

Add the import:

```tsx
import { MessageButton } from '@/components/player/MessageButton'
```

In the `{viewerId && !isOwner && (...)}` block, add `<MessageButton recipientId={profile.id} />` after `<ChallengeButton opponentId={profile.id} />`:

```tsx
{viewerId && !isOwner && (
  <div className="mt-4 flex flex-wrap justify-center gap-2 sm:justify-start">
    <FriendStatusAction status={friendshipStatus} profileId={profile.id} />
    <ChallengeButton opponentId={profile.id} />
    <MessageButton recipientId={profile.id} />
  </div>
)}
```

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit && npx next lint --file components/player/MessageButton.tsx --file components/player/ProfileHeader.tsx --file lib/messages/actions.ts`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add components/player/MessageButton.tsx components/player/ProfileHeader.tsx lib/messages/actions.ts
git commit -m "feat(messages): Message button on player profiles

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018zQe17sFEE1YWyDS9X2WfV"
```

---

## Task 10: Admin — `/admin/messages` report queue

**Files:**
- Create: `lib/messages/admin-query.ts`
- Create: `lib/messages/admin-actions.ts`
- Create: `app/[locale]/admin/messages/page.tsx`
- Create: `components/admin/DmReportRow.tsx`
- Modify: `lib/admin/nav.ts`

**Interfaces:**
- Consumes: `requireStaff` from `@/lib/admin/auth`; `createClient` from `@/lib/supabase/server`; `createAdminClient` from `@/lib/supabase/admin`; `formatDateTime` from `@/lib/format`.
- Produces:
  - `type DmReportView = { id: string; reason: string; createdAt: string; resolvedAt: string | null; reporterName: string | null; reportedName: string | null; reportedId: string; threadId: string; transcript: { id: string; senderName: string; body: string | null; createdAt: string; flagged: boolean }[] }`
  - `fetchDmReports(): Promise<DmReportView[]>` — open reports first, then recently resolved; each with the full thread transcript (staff can read it — `dm_messages_participant_read` allows `is_staff()`).
  - `resolveDmReport(_prev, formData): Promise<AdminActionState>` — `id` from the form; sets `resolved_at`/`resolved_by`. Optional `deleteMessageId` in the form → hard-deletes that `dm_messages` row via the admin client.
  - `DmReportRow` — client component, expandable to show the transcript, with "Resolve" and (per flagged message) "Delete message".
- Consumed by: `app/[locale]/admin/messages/page.tsx`.

- [ ] **Step 1: `admin-query.ts`**

```ts
import { createClient } from '@/lib/supabase/server'

export type DmReportView = {
  id: string
  reason: string
  createdAt: string
  resolvedAt: string | null
  reporterName: string | null
  reportedName: string | null
  reportedId: string
  threadId: string
  flaggedMessageId: string | null
  transcript: { id: string; senderName: string; body: string | null; createdAt: string; flagged: boolean }[]
}

export async function fetchDmReports(limit = 40): Promise<DmReportView[]> {
  const supabase = createClient()
  const { data: reports } = await supabase
    .from('dm_reports')
    .select('id, reason, created_at, resolved_at, message_id, thread_id, reporter_id, reported_id')
    .order('resolved_at', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: false })
    .limit(limit)
  if (!reports || reports.length === 0) return []

  const threadIds = [...new Set(reports.map((r) => r.thread_id))]
  const personIds = [...new Set(reports.flatMap((r) => [r.reporter_id, r.reported_id]))]

  const [{ data: profiles }, { data: msgs }] = await Promise.all([
    supabase.from('profiles').select('id, username, display_name').in('id', personIds),
    supabase
      .from('dm_messages')
      .select('id, thread_id, sender_id, body, created_at')
      .in('thread_id', threadIds)
      .order('created_at', { ascending: true }),
  ])
  const nameById = new Map(
    (profiles ?? []).map((p) => [p.id, p.display_name ?? p.username ?? 'Player'] as const),
  )
  const msgsByThread = new Map<string, typeof msgs>()
  for (const m of msgs ?? []) {
    const list = msgsByThread.get(m.thread_id) ?? []
    // @ts-expect-error building the map incrementally
    list.push(m)
    msgsByThread.set(m.thread_id, list as typeof msgs)
  }

  return reports.map((r) => ({
    id: r.id,
    reason: r.reason,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
    reporterName: nameById.get(r.reporter_id) ?? null,
    reportedName: nameById.get(r.reported_id) ?? null,
    reportedId: r.reported_id,
    threadId: r.thread_id,
    flaggedMessageId: r.message_id,
    transcript: (msgsByThread.get(r.thread_id) ?? []).map((m) => ({
      id: m.id,
      senderName: nameById.get(m.sender_id) ?? 'Player',
      body: m.body,
      createdAt: m.created_at,
      flagged: m.id === r.message_id,
    })),
  }))
}
```

> The `@ts-expect-error` above is ugly — replace it with a properly-typed local `Row` type for the message rows (`{ id: string; thread_id: string; sender_id: string; body: string | null; created_at: string }`) and a `Map<string, Row[]>`, matching how `admin-query.ts` (community) does its grouping. Written loose here only to keep the plan short; the executor writes it clean.

- [ ] **Step 2: `admin-actions.ts`**

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { requireStaff } from '@/lib/admin/auth'
import { createAdminClient } from '@/lib/supabase/admin'

export type AdminActionState = { error?: string } | undefined

export async function resolveDmReport(_prev: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const ctx = await requireStaff()
  const id = String(formData.get('id') ?? '')
  const deleteMessageId = String(formData.get('deleteMessageId') ?? '') || null
  if (!id) return { error: 'Missing report.' }

  const admin = createAdminClient()
  if (deleteMessageId) {
    const { error: delErr } = await admin.from('dm_messages').delete().eq('id', deleteMessageId)
    if (delErr) return { error: 'Could not delete the message.' }
  }
  const { error } = await admin
    .from('dm_reports')
    .update({ resolved_at: new Date().toISOString(), resolved_by: ctx.userId })
    .eq('id', id)
  if (error) return { error: 'Could not resolve the report.' }

  revalidatePath('/admin/messages')
  return undefined
}
```

> `requireStaff()` returns `StaffContext` with `userId: string` (confirmed in `lib/admin/auth.ts`) — `resolved_by: ctx.userId` is correct.

- [ ] **Step 3: `DmReportRow.tsx`**

```tsx
'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { formatDateTime } from '@/lib/format'
import { resolveDmReport, type AdminActionState } from '@/lib/messages/admin-actions'
import type { DmReportView } from '@/lib/messages/admin-query'

export function DmReportRow({ report }: { report: DmReportView }) {
  const [state, action] = useFormState<AdminActionState, FormData>(resolveDmReport, undefined)
  const [open, setOpen] = useState(!report.resolvedAt)

  return (
    <div className={`rounded-xl border p-3 ${report.resolvedAt ? 'border-slate-800 bg-slate-900/40 opacity-70' : 'border-red-900/50 bg-slate-900/60'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] text-slate-500">
            {report.reporterName ?? 'Someone'} reported {report.reportedName ?? 'a player'} · {formatDateTime(report.createdAt)}
            {report.resolvedAt && <span className="ml-2 text-green-500">· resolved</span>}
          </p>
          <p className="mt-1 text-sm text-slate-200">{report.reason}</p>
        </div>
        <button type="button" onClick={() => setOpen((o) => !o)} className="shrink-0 text-xs font-semibold text-violet-400">
          {open ? 'Hide' : 'View'} thread
        </button>
      </div>

      {open && (
        <div className="mt-3 space-y-1.5 rounded-lg border border-slate-800 bg-slate-950 p-2">
          {report.transcript.map((m) => (
            <div key={m.id} className={`text-xs ${m.flagged ? 'rounded bg-red-950/50 px-1.5 py-1' : ''}`}>
              <span className="font-bold text-slate-300">{m.senderName}: </span>
              <span className="text-slate-200">{m.body}</span>
              <span className="ml-2 text-[10px] text-slate-600">{formatDateTime(m.createdAt)}</span>
            </div>
          ))}
        </div>
      )}

      {!report.resolvedAt && (
        <form action={action} className="mt-2 flex items-center gap-2">
          <input type="hidden" name="id" value={report.id} />
          {report.flaggedMessageId && (
            <label className="flex items-center gap-1 text-[11px] text-slate-400">
              <input type="checkbox" name="deleteMessageId" value={report.flaggedMessageId} /> delete the flagged message
            </label>
          )}
          <button type="submit" className="ml-auto rounded-lg bg-green-600/80 px-3 py-1 text-xs font-bold text-white hover:bg-green-600">
            Resolve
          </button>
        </form>
      )}
      {state?.error && <p className="mt-1 text-[11px] text-red-400">{state.error}</p>}
    </div>
  )
}
```

- [ ] **Step 4: `page.tsx`**

```tsx
import type { Metadata } from 'next'
import { requireStaff } from '@/lib/admin/auth'
import { fetchDmReports } from '@/lib/messages/admin-query'
import { DmReportRow } from '@/components/admin/DmReportRow'

export const metadata: Metadata = { title: 'Messages · Admin · SentinelX' }

export default async function AdminMessagesPage() {
  await requireStaff()
  const reports = await fetchDmReports()

  return (
    <div className="space-y-4">
      <h2 className="text-base font-bold text-white">Reported conversations</h2>
      {reports.length === 0 ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center text-sm text-slate-500">No reports.</p>
      ) : (
        <div className="space-y-2">
          {reports.map((r) => (
            <DmReportRow key={r.id} report={r} />
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Nav entry**

In `lib/admin/nav.ts`, add to `ADMIN_NAV` after the `Community` / `Challenges` entries:

```ts
  { label: 'Messages', href: '/admin/messages', adminOnly: false },
```

- [ ] **Step 6: Typecheck + lint**

Run: `npx tsc --noEmit && npx next lint --file lib/messages/admin-query.ts --file lib/messages/admin-actions.ts --file components/admin/DmReportRow.tsx --file "app/[locale]/admin/messages/page.tsx" --file lib/admin/nav.ts`
Expected: passes.

- [ ] **Step 7: Commit**

```bash
git add lib/messages/admin-query.ts lib/messages/admin-actions.ts components/admin/DmReportRow.tsx "app/[locale]/admin/messages/page.tsx" lib/admin/nav.ts
git commit -m "feat(messages): admin report queue for reported conversations

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018zQe17sFEE1YWyDS9X2WfV"
```

---

## Task 11: Privacy policy disclosure

**Files:**
- Modify: `messages/en.json`, `messages/fr.json`, `messages/pcm.json`
- Modify: `app/[locale]/(public)/privacy/page.tsx`

**Interfaces:**
- Produces: two new `privacy.*` i18n keys wired into the rendered policy — DM data collection (§2) and staff-can-read-reported-threads (§4).

**Context:** `PrivacyPage` builds a `sections=[...]` array from `t('sN...')` keys. §2 is "What Data We Collect" with `s2Play` / `s2PlayList` sub-blocks. §4 is "Who We Share Your Data With" with `s4List`. The cleanest edit: add one bullet to `s2PlayList` (private messages you send other players) and one paragraph key `s4Dm` rendered inside §4.

- [ ] **Step 1: Add keys to `messages/en.json`**

Under `"privacy"`, add:

```json
"s4Dm": "When you report a private conversation, our moderators can read that conversation in order to review your report and act on it. We do not read private messages otherwise.",
```

And append one `<li>` to the existing `s2PlayList` value (it is a single string of `<li>…</li>` items rendered via `t.rich('s2PlayList', listItemTag)`):
`<li>Private messages you send other players to coordinate matches, and any reports you file</li>`

- [ ] **Step 2: Mirror into `messages/fr.json` and `messages/pcm.json`**

Same keys. Translations:

- **fr.json** `s4Dm`: `"Lorsque vous signalez une conversation privée, nos modérateurs peuvent la lire afin d'examiner votre signalement et d'y donner suite. Nous ne lisons pas les messages privés autrement."`  · `s2PlayList` extra `<li>`: `<li>Les messages privés que vous envoyez à d'autres joueurs pour organiser des matchs, et les signalements que vous déposez</li>`
- **pcm.json** `s4Dm`: `"If you report a private chat, our moderators fit read that chat so dem go fit check your report and do something about am. We no dey read private messages otherwise."` · `s2PlayList` extra `<li>`: `<li>Private messages wey you send other players to arrange matches, and any report wey you file</li>`

- [ ] **Step 3: Render `s4Dm` in the privacy page**

In `app/[locale]/(public)/privacy/page.tsx`, the §4 section is `{ id: 'who-we-share-with', title: t('s4Heading'), body: (<>…</>) }` — its fragment ends with `<p>{t('s4P2')}</p><p>{t('s4P3')}</p>`. Add one line right after `s4P3`:

```tsx
<p>{t('s4P3')}</p>
<p>{t('s4Dm')}</p>
```

- [ ] **Step 4: Typecheck + lint + intl sanity**

Run: `npx tsc --noEmit && npx next lint --file "app/[locale]/(public)/privacy/page.tsx"`
Run: `node -e "['en','fr','pcm'].forEach(l=>{const m=require('./messages/'+l+'.json'); if(!m.privacy.s4Dm) throw new Error(l+' missing s4Dm')}); console.log('keys ok')"`
Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add messages/ "app/[locale]/(public)/privacy/page.tsx"
git commit -m "docs(privacy): disclose DM collection + staff review of reported threads

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018zQe17sFEE1YWyDS9X2WfV"
```

---

## Task 12: End-to-end verification

**Files:** none — manual run on the Vercel preview (do not `npm run build` locally per Global Constraints).

- [ ] **Step 1: Push + full unit sweep**

```bash
git push -u origin worktree-community-dms
npx vitest run lib/messages/
```
Expected: `thread-key` (3) + `predicates` (7) + `schema` (6) green. Wait for the Vercel preview to build READY.

- [ ] **Step 2: Start a conversation**
- Account A → Account B's profile (`/players/<b>`) → "Message" → lands on `/messages/<id>`, empty ("Say hello").
- Send "hey, fixture at 8?" → appears as A's bubble, composer clears.

- [ ] **Step 3: Realtime + unread**
- Account B (other browser) on `/messages` → the thread shows with unread badge `1` and the preview.
- B opens it → A's message shows; badge clears; the header **bell** badge (which had ticked up from the `direct_message` notification) clears for that thread.
- B replies while A has the thread open → A sees it append with no reload.

- [ ] **Step 4: Block**
- B → overflow menu → "Block A" → thread disappears from B's `/messages`; composer in the open thread shows the disabled notice.
- A tries to send → "You can no longer message this player."
- B → (reopen thread via profile? it's hidden) — unblock from A's profile menu path or re-open `/messages/<id>` directly → "Unblock" → messaging works again.

- [ ] **Step 5: Report**
- A → overflow → Report → type a reason → "Send report" → confirmation shown.
- Staff account → `/admin/messages` → the report is listed, "View thread" shows the transcript, the flagged message (if any) is highlighted → "Resolve" (optionally tick delete) → row greys out.

- [ ] **Step 6: Rate limit**
- With `NEW_THREAD_DAILY_CAP = 15`: in the Supabase SQL editor, `INSERT` 15 `dm_threads` rows with `created_by = '<A>'` and `created_at = now()`. Then A → a new player's profile → "Message" → "You've started a lot of new conversations today."
- Delete those rows afterward.

- [ ] **Step 7: Account deletion**
- Create a throwaway account C, message A. Delete C via `/dashboard/settings` → "Delete now".
- Confirm in SQL: `SELECT count(*) FROM dm_threads WHERE player_a='<C>' OR player_b='<C>'` → 0; A's `/messages` no longer shows the C thread.

- [ ] **Step 8: Privacy page**
- `/privacy` → §2 lists private messages; §4 has the moderator-review paragraph. Repeat on `/fr/privacy` and `/pcm/privacy`.

- [ ] **Step 9: Mobile (375px, signed in)**
- `/messages` list scrolls, rows don't overflow. `/messages/<id>`: header + scrolling transcript + composer pinned to the bottom, Enter sends, Shift+Enter newlines. No horizontal body scroll. Overflow menu and report sheet fit.

- [ ] **Step 10: Tick this plan, update the spec + memory**
- Tick every box.
- `docs/superpowers/specs/2026-09-07-direct-messages-design.md` — add `**Status:** shipped <date>` under the title.
- Update `docs/superpowers/specs/2026-09-07-community-system-overview.md`'s piece table if it tracks status.

- [ ] **Step 11: Merge to main**

Per memory `feedback_always_push`: once verified, merge to `main` and push — skip the finishing menu. Merge `origin/main` in first (resolve `lib/supabase/types.ts` by regenerating from the live schema), re-run `npx vitest run` + `npx tsc --noEmit`, push the branch, confirm the Vercel preview is green, then fast-forward `main`.

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| `dm_threads` normalised pair + unique index | 1 (schema), 2 (`orderedPair`) |
| `dm_messages` body/image check, 2000 cap | 1, 4 |
| `dm_blocks` unique per pair | 1 |
| `dm_reports` → admin | 1, 10 |
| RLS: thread + messages readable only by participants | 1 (`dm_threads_participant_read`, `dm_messages_participant_read`) |
| Insert requires participant **and** not blocked either way (in RLS) | 1 (`dm_can_message` + `dm_messages_sender_insert`) |
| Blocking symmetric in effect | 1 (`dm_can_message`), 3 (`isBlockedBetween`), 6 |
| Messages immutable except `read_at` | 1 (only `dm_messages_recipient_mark_read`) |
| Account deletion cascades messages | 1 (`anonymise_account` extension), 12 Step 7 |
| Block from thread **and** from profile | 8 (`ThreadMenu`); profile block — **see gap below** |
| Report a message or a player, with reason, landing in admin | 8, 10 |
| Admin can read a reported thread | 1 (`is_staff()` in read policies), 10 |
| Rate limiting (new-contact cap) | 3 (`newThreadAllowed`), 6 (`resolveOrCreateThread`), 12 Step 6 |
| Privacy policy edit is part of this piece | 11 |
| Realtime `dm_messages` published, RLS on top | 1, 7, 8 |
| Unread = `read_at IS NULL AND sender_id <> me` | 3 (`unreadCount`) |
| `/messages` list: avatar, name, preview, timestamp, unread badge | 7 |
| `/messages/[threadId]`: message list, composer, block/report overflow | 8 |
| Header: unread total on the existing cluster, not a new control | 1 + 6 (DMs write `player_notifications` → existing bell badge; **no header file touched**) |
| Profile: "Message" button | 9 |
| Out: groups, voice, typing, richer receipts, search, reactions | not built |
| Cuttable corner (images) — cut | Global Constraints; `image_url` column kept, no UI |

**Known gap:** the spec wants **Block also reachable from a player's profile**, not just from inside a thread. This plan puts block/unblock only in `ThreadMenu` (Task 8). Options for the executor: (a) accept it — "Message" then block from the thread is one extra tap; (b) add a small block control to `ProfileHeader` in Task 9 (reuses `blockUser`/`unblockUser` — needs the profile page to fetch "did I block them" state, a small `fetchThread`-adjacent query). **Recommend (b)** — it's cheap and the spec is explicit that minors need blocking to be easy to reach. If taking (b), Task 9 also fetches block state on the profile server component and passes it to a `<ProfilePlayerActions>` that shows Message + Block/Unblock.

**Placeholder scan:** two spots flagged inline for the executor to write clean rather than as-shown (`admin-query.ts` grouping `@ts-expect-error`; the `--site-header-h` CSS var in Task 8). Both are noted with the concrete fix. No TBD/TODO left.

**Type consistency:** `orderedPair` returns `{playerA, playerB}` — used consistently in Tasks 5, 6. `ThreadSummary` / `ThreadDetail` defined in Task 5, consumed in 7/8. `AdminActionState` re-defined locally in `admin-actions.ts` (Task 10) matching the community `admin-actions.ts` pattern — not imported. `startConversation` added in Task 9 but lives in `lib/messages/actions.ts` from Task 6 (the file exists; Task 9 appends one export). `NEW_THREAD_DAILY_CAP` from Task 3 used in Task 6.

**Deviation from spec:** none in substance. Images cut per the spec's own "cuttable corner". Header badge achieved via the notification table rather than a bespoke DM counter — satisfies "badge on an existing control, not a new one" more literally than adding a DM-specific count to `NavSession`.
