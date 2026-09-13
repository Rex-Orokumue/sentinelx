# Community Direct Messages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Private 1:1 messaging between players — text and images — with a thread list, a conversation view, realtime delivery, unread counts, and the safety controls the spec requires: block, report, and an admin "mute messaging" lever with a mass-contact signal in the report queue.

**Architecture:** Five new tables (`dm_threads`, `dm_messages`, `dm_blocks`, `dm_reports`, `dm_muted_players`) with a normalised thread pair. RLS scopes reads to the two participants (plus staff), and a `dm_can_message()` SECURITY DEFINER function refuses an insert when either party has blocked the other or when the sender is admin-muted — enforced in the `dm_messages` INSERT policy, not just the UI. Images go to a **private** `dm-images` bucket (`public: false`); the DB stores the storage path and `fetchThread` mints a fresh 1-hour signed URL per image server-side — the same pattern as `match-evidence`. Pure logic (pair ordering, unread counting, block predicate, recent-contacts count, body validation) is unit-tested; query/action/UI layers follow this codebase's manual-verification norm. New messages write a `player_notifications` row (type `direct_message`) so the **existing header bell** carries the unread badge with zero header changes; the `/messages` list computes its own per-thread unread pips from `dm_messages.read_at`. Realtime reuses the `ALTER PUBLICATION supabase_realtime` + client-`channel` pattern already used by the notification bell and `CommunityRealtime`.

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase (Postgres + Auth + Storage + Realtime), Tailwind, `zod`, `vitest`, `lucide-react`, `next-intl`.

**Spec:**
- `docs/superpowers/specs/2026-09-07-direct-messages-design.md` (this piece)
- `docs/superpowers/specs/2026-09-07-community-system-overview.md` (cross-cutting rules)

## Global Constraints

- **Mobile-first.** Design at 375px. `/messages` and `/messages/[threadId]` are a phone experience first.
- **RLS on every table.** All five DM tables get RLS. The block check **and the admin-mute check** live in the `dm_messages` INSERT policy via `dm_can_message()`, not only in the UI (spec: "Enforced in the RLS policy... so it holds regardless of client").
- **Messages are immutable.** No UPDATE policy except `read_at`. No edit/delete-message UI for players. Staff can delete a message via the admin client when resolving a report.
- **Thread pair is normalised.** `dm_threads.player_a` is always the lexicographically smaller uuid (`player_a < player_b` as text), unique index on `(player_a, player_b)`. A→B and B→A must resolve to one thread.
- **Body cap 2000 chars**, trimmed. A message needs a body **or** an image (DB CHECK + friendly zod message).
- **No preemptive rate limit** (decision 2026-09-09 — a loose cap protects nobody, a tight one blocks real users). Instead: an admin **"mute messaging"** toggle per account (`dm_muted_players`, moderator-usable — it is not a ban), reachable from the report row and the player admin page; a muted account cannot send new DMs. The report row also shows **"messaged N new people in the last 24h"** so a mass-contact pattern is obvious.
- **Block & report — required.** Block from a thread **and** from a player's profile; blocked = no new messages either way + thread hidden from both trays. Report a conversation (optionally a specific message) with a reason → lands in `/admin/messages`. Staff can read a reported thread — **disclosed in the privacy policy as part of this piece.**
- **Images.** Private `dm-images` bucket, `public: false`. Sender uploads (client-side, resized) to `{senderId}/{uuid}.jpg`; the DB `image_url` column stores that **path**, not a URL. Reads go through `admin.storage.from('dm-images').createSignedUrl(path, 3600)` server-side in `fetchThread` / the admin transcript — exactly like `match-evidence` (`app/[locale]/(public)/matches/[id]/page.tsx:147`). Client-side resize via `resizeImageToMaxWidth` from `@/lib/media/resize-image` (max width 1280).
- **No push.** New messages notify in-app only (the bell). FCM push for social events is a later follow-up (overview spec).
- **Account deletion** deletes a leaving player's DM rows — added to `anonymise_account()` (profiles are anonymised in place, never row-deleted, so `ON DELETE CASCADE` never fires for deletion; explicit DELETEs are the mechanism, mirroring how `friends` is handled there).
- **Migrations are timestamp-named:** `YYYYMMDDHHMMSS_name.sql` (UTC).
- **Supabase project id for type generation / MCP:** `itxubrkbropttfdackmi`.
- **This is a git worktree** at `.claude/worktrees/community-dms` on branch `worktree-community-dms`, based on `origin/main`. Concurrent sessions are active in other worktrees. Do **not** run `npm run build` (their `next dev` may be running) — verify with `npx tsc --noEmit` + `npx next lint`, and on the Vercel preview after push.
- **Out of scope (spec):** group chats, voice notes, typing indicators, read receipts beyond one `read_at`, message search, message reactions.

---

## File Structure

**New files:**

| Path | Responsibility |
|---|---|
| `supabase/migrations/<ts>_direct_messages.sql` | 5 tables + `dm-images` bucket + all RLS + `dm_can_message()` + notification type + realtime publication + `anonymise_account` extension |
| `lib/messages/thread-key.ts` | `orderedPair(a,b)` — the one place pair normalisation lives |
| `lib/messages/thread-key.test.ts` | unit tests |
| `lib/messages/predicates.ts` | `unreadCount`, `isBlockedBetween`, `countNewContactsSince` — pure |
| `lib/messages/predicates.test.ts` | unit tests |
| `lib/messages/schema.ts` | `messageBodySchema`, `reportReasonSchema` (zod) |
| `lib/messages/schema.test.ts` | unit tests |
| `lib/messages/query.ts` | server-only reads: `fetchThreadList`, `fetchThread`, `resolveThreadId`, `fetchProfileMessagingState` |
| `lib/messages/actions.ts` | `'use server'`: `sendMessage`, `startConversation`, `markThreadRead`, `blockUser`, `unblockUser`, `reportConversation` |
| `app/[locale]/messages/page.tsx` | thread list (server component) |
| `app/[locale]/messages/[threadId]/page.tsx` | one conversation (server component) |
| `components/messages/ThreadListItem.tsx` | one row in the list |
| `components/messages/MessagesRealtime.tsx` | `'use client'` — refreshes the list on any `dm_messages` change |
| `components/messages/Conversation.tsx` | `'use client'` — message list + realtime append + composer |
| `components/messages/MessageComposer.tsx` | `'use client'` — textarea + image picker + send |
| `components/messages/ThreadMenu.tsx` | `'use client'` — block / report overflow menu + report dialog |
| `components/player/ProfilePlayerActions.tsx` | `'use client'` — Message + Block/Unblock on a player's profile |
| `lib/messages/admin-query.ts` | `fetchDmReports` |
| `lib/messages/admin-actions.ts` | `'use server'`: `resolveDmReport`, `setMessagingMuted` |
| `app/[locale]/admin/messages/page.tsx` | staff report queue |
| `components/admin/DmReportRow.tsx` | `'use client'` — one report, transcript, resolve + mute controls |

**Modified files:**

| Path | Change |
|---|---|
| `lib/supabase/types.ts` | regenerated after the migration |
| `lib/supabase/middleware.ts` | add `/messages` to `PROTECTED` |
| `lib/notifications/inbox.ts` | add `'direct_message'` to `NotificationType` |
| `components/player/ProfileHeader.tsx` | swap the inline `FriendStatusAction + ChallengeButton` block for `<ProfilePlayerActions>` (keeps both, adds Message + Block) |
| `app/[locale]/(public)/players/[username]/page.tsx` | fetch the viewer↔profile messaging state, pass to `ProfileHeader` |
| `lib/admin/nav.ts` | add `{ label: 'Messages', href: '/admin/messages', adminOnly: false }` |
| `messages/en.json`, `messages/fr.json`, `messages/pcm.json` | privacy-policy DM disclosure keys |
| `app/[locale]/(public)/privacy/page.tsx` | wire the new privacy keys into §2 and §4 |

**Testing note:** `vitest` covers Tasks 2–4 (pure). Query/action/component/page code is verified by `tsc` + `next lint` + the Task 12 end-to-end run, matching how `feed-query.ts`, `post-actions.ts`, `NotificationBell.tsx` etc. carry no unit tests while the pure helpers they call do.

---

## Task 1: Schema — tables, RLS, image bucket, notification type, realtime, deletion

**Files:**
- Create: `supabase/migrations/<ts>_direct_messages.sql`
- Modify: `lib/supabase/types.ts` (regenerated)
- Modify: `lib/supabase/middleware.ts`
- Modify: `lib/notifications/inbox.ts`

**Interfaces:**
- Produces: tables `dm_threads`, `dm_messages`, `dm_blocks`, `dm_reports`, `dm_muted_players` in production; `Database['public']['Tables']` entries for all five in `lib/supabase/types.ts`; private bucket `dm-images` with storage RLS; `player_notifications.type` accepts `'direct_message'`; `dm_messages` on the realtime publication; `anonymise_account()` deletes DM rows; `/messages` redirects unauthenticated users to `/login`.

- [x] **Step 1: Write the migration**

Create `supabase/migrations/<ts>_direct_messages.sql` (real current UTC timestamp, e.g. `20260909213000`):

```sql
-- Private 1:1 player messaging, text + images. `070_chat_system` is the support
-- chatbot — unrelated and new.
--
-- Thread identity is the *pair*, stored normalised (player_a < player_b as text)
-- with a unique index, so A->B and B->A are one thread. Blocking AND an admin
-- "mute messaging" flag are enforced in the dm_messages INSERT policy via
-- dm_can_message(), not just the UI. Messages are immutable except read_at.
-- Images live in a private bucket; the DB stores the storage path, reads go
-- through server-side signed URLs (same as match-evidence).

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
-- Powers the admin "messaged N new people in 24h" signal.
CREATE INDEX dm_threads_created_by_idx ON public.dm_threads (created_by, created_at DESC);

ALTER TABLE public.dm_threads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dm_threads_participant_read" ON public.dm_threads
  FOR SELECT USING (auth.uid() IN (player_a, player_b) OR public.is_staff());
-- Threads are created only via the server action (service-role) — no client
-- write policy. Blocking hides a thread in the query layer, not by deleting it.

-- ---------------------------------------------------------------
-- Admin "mute messaging" — staff-only. Not a ban; a moderator may set it.
-- ---------------------------------------------------------------
CREATE TABLE public.dm_muted_players (
  player_id uuid        PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  muted_at  timestamptz NOT NULL DEFAULT now(),
  muted_by  uuid        REFERENCES public.profiles(id) ON DELETE SET NULL
);
ALTER TABLE public.dm_muted_players ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dm_muted_players_staff_read" ON public.dm_muted_players
  FOR SELECT USING (public.is_staff());
-- Writes are service-role only (setMessagingMuted action).

-- ---------------------------------------------------------------
-- Messages
-- ---------------------------------------------------------------
CREATE TABLE public.dm_messages (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id  uuid        NOT NULL REFERENCES public.dm_threads(id) ON DELETE CASCADE,
  sender_id  uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body       text,
  image_url  text,   -- storage path in the dm-images bucket, not a URL
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at    timestamptz,
  CONSTRAINT dm_messages_has_content
    CHECK ((body IS NOT NULL AND btrim(body) <> '') OR image_url IS NOT NULL),
  CONSTRAINT dm_messages_body_len
    CHECK (body IS NULL OR char_length(body) <= 2000)
);
CREATE INDEX dm_messages_thread_idx ON public.dm_messages (thread_id, created_at);
CREATE INDEX dm_messages_unread_idx ON public.dm_messages (thread_id, read_at) WHERE read_at IS NULL;

ALTER TABLE public.dm_messages ENABLE ROW LEVEL SECURITY;

-- STABLE + SECURITY DEFINER so it can see dm_threads / dm_blocks /
-- dm_muted_players regardless of the caller's own RLS.
CREATE OR REPLACE FUNCTION public.dm_can_message(p_thread uuid, p_sender uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.dm_threads t
    WHERE t.id = p_thread
      AND p_sender IN (t.player_a, t.player_b)
      AND NOT EXISTS (SELECT 1 FROM public.dm_muted_players m WHERE m.player_id = p_sender)
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

CREATE POLICY "dm_messages_sender_insert" ON public.dm_messages
  FOR INSERT WITH CHECK (
    sender_id = auth.uid() AND public.dm_can_message(thread_id, auth.uid())
  );

-- Only permitted update: the recipient marking a message read.
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
  CONSTRAINT dm_blocks_not_self   CHECK (blocker_id <> blocked_id),
  CONSTRAINT dm_blocks_pair_unique UNIQUE (blocker_id, blocked_id)
);
CREATE INDEX dm_blocks_blocker_idx ON public.dm_blocks (blocker_id);
CREATE INDEX dm_blocks_blocked_idx ON public.dm_blocks (blocked_id);

ALTER TABLE public.dm_blocks ENABLE ROW LEVEL SECURITY;
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
-- Private image bucket — mirrors match-evidence (004_match_evidence_storage.sql)
-- ---------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('dm-images', 'dm-images', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "dm_images_insert_own"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'dm-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Owner or staff (reads normally go through server-side signed URLs).
CREATE POLICY "dm_images_select_own_or_staff"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'dm-images'
    AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_staff())
  );

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

ALTER PUBLICATION supabase_realtime ADD TABLE public.dm_messages;

-- ---------------------------------------------------------------
-- Account deletion — a private conversation ends when one side leaves.
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
  -- their blocks, any mute row, and reports they filed or that name them.
  DELETE FROM public.dm_threads
    WHERE player_a = p_id OR player_b = p_id;
  DELETE FROM public.dm_blocks
    WHERE blocker_id = p_id OR blocked_id = p_id;
  DELETE FROM public.dm_muted_players WHERE player_id = p_id;
  DELETE FROM public.dm_reports
    WHERE reporter_id = p_id OR reported_id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.anonymise_account(uuid) FROM public, anon, authenticated;
```

> **If the DB's `anonymise_account` body has drifted from `079_anonymise_account.sql`** (check with `SELECT prosrc FROM pg_proc WHERE proname='anonymise_account';` in Step 3), keep every line it currently has and only add the four `dm_*` DELETEs before the final `END;`.

- [x] **Step 2: Apply to production**

Supabase MCP `apply_migration` tool (name `direct_messages`), or `npx supabase db push` from the primary checkout if the CLI is reachable (memory `project_supabase_connectivity_gotcha` — prefer MCP). If neither is available, stop and ask the user.

- [x] **Step 3: Verify in production**

Run via MCP `execute_sql`:

```sql
SELECT to_regclass('public.dm_threads'), to_regclass('public.dm_messages'),
       to_regclass('public.dm_blocks'), to_regclass('public.dm_reports'),
       to_regclass('public.dm_muted_players');
SELECT id, public FROM storage.buckets WHERE id = 'dm-images';
SELECT tablename FROM pg_publication_tables
  WHERE pubname='supabase_realtime' AND tablename='dm_messages';
SELECT prosrc LIKE '%dm_threads%' AS deletion_patched
  FROM pg_proc WHERE proname='anonymise_account';
SELECT pg_get_constraintdef(oid) LIKE '%direct_message%' AS notif_type_ok
  FROM pg_constraint WHERE conname='player_notifications_type_check';
```

Expected: 5 non-null regclasses, `dm-images` bucket with `public = f`, one publication row, `deletion_patched = t`, `notif_type_ok = t`.

- [x] **Step 4: Regenerate types**

MCP `generate_typescript_types` (project `itxubrkbropttfdackmi`) → write the `.types` payload to `lib/supabase/types.ts`. Confirm:

```bash
grep -c "dm_threads:\|dm_messages:\|dm_blocks:\|dm_reports:\|dm_muted_players:" lib/supabase/types.ts   # expect >= 5
```

- [x] **Step 5: Guard `/messages` in middleware**

In `lib/supabase/middleware.ts`, change `const PROTECTED = ['/dashboard', '/admin']` to `const PROTECTED = ['/dashboard', '/admin', '/messages']`.

- [x] **Step 6: Add the notification type**

In `lib/notifications/inbox.ts`, add `| 'direct_message'` to the `NotificationType` union (near `'post_reaction'` is fine).

- [x] **Step 7: Typecheck**

Run: `npx tsc --noEmit` → passes (nothing consumes the new tables yet).

- [x] **Step 8: Commit**

```bash
git add supabase/migrations/ lib/supabase/types.ts lib/supabase/middleware.ts lib/notifications/inbox.ts
git commit -m "feat(messages): schema for private 1:1 messaging

Five tables (threads/messages/blocks/reports/muted), block + admin-mute enforced
in the dm_messages INSERT policy via dm_can_message(), private dm-images bucket,
dm_messages on realtime, anonymise_account extended, /messages guarded.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018zQe17sFEE1YWyDS9X2WfV"
```

---

## Task 2: Pure — thread pair normalisation (TDD)

**Files:**
- Create: `lib/messages/thread-key.ts`
- Test: `lib/messages/thread-key.test.ts`

**Interfaces:**
- Produces: `orderedPair(x: string, y: string): { playerA: string; playerB: string }` — sorts the two uuids as strings. Throws `Error('a player cannot message themselves')` if `x === y`.
- Consumed by: `lib/messages/query.ts` (`resolveThreadId`), `lib/messages/actions.ts`.

- [x] **Step 1: Failing test**

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

- [x] **Step 2: Run — verify fail** — `npx vitest run lib/messages/thread-key.test.ts` → FAIL (module not found).

- [x] **Step 3: Implement**

```ts
// The one place the normalised thread pair is computed. dm_threads has a
// CHECK (player_a < player_b) and UNIQUE (player_a, player_b), so A->B and B->A
// only map to the same row if every caller orders the pair identically.
export function orderedPair(x: string, y: string): { playerA: string; playerB: string } {
  if (x === y) throw new Error('a player cannot message themselves')
  return x < y ? { playerA: x, playerB: y } : { playerA: y, playerB: x }
}
```

- [x] **Step 4: Run — verify pass** — PASS (3).

- [x] **Step 5: Commit**

```bash
git add lib/messages/thread-key.ts lib/messages/thread-key.test.ts
git commit -m "feat(messages): thread pair normalisation

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018zQe17sFEE1YWyDS9X2WfV"
```

---

## Task 3: Pure — unread / block / recent-contacts predicates (TDD)

**Files:**
- Create: `lib/messages/predicates.ts`
- Test: `lib/messages/predicates.test.ts`

**Interfaces:**
- Produces:
  - `type UnreadInput = { senderId: string; readAt: string | null }`
  - `unreadCount(messages: UnreadInput[], viewerId: string): number` — messages not sent by the viewer with `readAt === null`.
  - `type BlockRow = { blockerId: string; blockedId: string }`
  - `isBlockedBetween(blocks: BlockRow[], x: string, y: string): boolean` — true if any row blocks x→y or y→x.
  - `countNewContactsSince(createdAts: string[], sinceIso: string): number` — how many of the given thread `created_at` timestamps are `>= sinceIso`. (Feeds the admin "N new people in 24h" signal — the caller passes the `created_at`s of threads this player started.)
- Consumed by: `lib/messages/query.ts`, `lib/messages/admin-query.ts`, `components/messages/*`.

- [x] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest'
import { unreadCount, isBlockedBetween, countNewContactsSince } from './predicates'

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
  it('is false for an unrelated block', () => {
    expect(isBlockedBetween([{ blockerId: 'x', blockedId: 'z' }], 'x', 'y')).toBe(false)
  })
})

describe('countNewContactsSince', () => {
  it('counts timestamps at or after the cutoff', () => {
    expect(
      countNewContactsSince(
        ['2026-09-09T10:00:00Z', '2026-09-08T10:00:00Z', '2026-09-09T12:00:00Z'],
        '2026-09-09T00:00:00Z',
      ),
    ).toBe(2)
  })
  it('is zero for none', () => {
    expect(countNewContactsSince([], '2026-09-09T00:00:00Z')).toBe(0)
  })
})
```

- [x] **Step 2: Run — verify fail** → FAIL (module not found).

- [x] **Step 3: Implement**

```ts
export type UnreadInput = { senderId: string; readAt: string | null }

// "read_at IS NULL AND sender_id <> me" — the spec's exact definition.
export function unreadCount(messages: UnreadInput[], viewerId: string): number {
  return messages.filter((m) => m.senderId !== viewerId && m.readAt === null).length
}

export type BlockRow = { blockerId: string; blockedId: string }

// Symmetric in effect: if EITHER party blocked the other, neither can send.
// The DB's dm_can_message() enforces the same; this is the client twin.
export function isBlockedBetween(blocks: BlockRow[], x: string, y: string): boolean {
  return blocks.some(
    (b) =>
      (b.blockerId === x && b.blockedId === y) ||
      (b.blockerId === y && b.blockedId === x),
  )
}

// Admin signal: of the threads this player started, how many since the cutoff.
// A high number next to a report is a mass-contact pattern.
export function countNewContactsSince(createdAts: string[], sinceIso: string): number {
  return createdAts.filter((t) => t >= sinceIso).length
}
```

- [x] **Step 4: Run — verify pass** → PASS (7).

- [x] **Step 5: Commit**

```bash
git add lib/messages/predicates.ts lib/messages/predicates.test.ts
git commit -m "feat(messages): unread / block / recent-contacts predicates

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

- [x] **Step 1: Failing test**

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

- [x] **Step 2: Run — verify fail** → FAIL.

- [x] **Step 3: Implement**

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

- [x] **Step 4: Run — verify pass** → PASS (6).

- [x] **Step 5: Commit**

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
- Consumes: `orderedPair` (Task 2), `unreadCount`, `isBlockedBetween`, `type BlockRow` (Task 3); `createClient` from `@/lib/supabase/server`; `createAdminClient` from `@/lib/supabase/admin`.
- Produces:
  - `type ThreadSummary = { threadId: string; otherId: string; otherName: string; otherUsername: string | null; otherAvatarUrl: string | null; lastMessage: string | null; lastWasImage: boolean; lastMessageAt: string; unread: number }`
  - `fetchThreadList(viewerId: string): Promise<ThreadSummary[]>` — the viewer's threads, most-recent first, **excluding threads blocked in either direction**, with the newest message preview (or `lastWasImage`) + per-thread unread.
  - `type ConversationMessage = { id: string; senderId: string; body: string | null; imageUrl: string | null; createdAt: string; readAt: string | null }` — `imageUrl` here is a **signed URL** (or `null`), not the stored path.
  - `type ThreadDetail = { threadId: string; other: { id: string; name: string; username: string | null; avatarUrl: string | null }; messages: ConversationMessage[]; blockedByMe: boolean; blockedByThem: boolean }`
  - `fetchThread(threadId: string, viewerId: string): Promise<ThreadDetail | null>` — `null` if the viewer is not a participant.
  - `resolveThreadId(viewerId: string, otherId: string): Promise<string | null>` — existing thread id for the pair, or `null` (does not create).
  - `type ProfileMessagingState = { blockedByMe: boolean; blockedByThem: boolean }`
  - `fetchProfileMessagingState(viewerId: string, profileId: string): Promise<ProfileMessagingState>` — for the profile page's Block/Unblock button.
- Consumed by: Tasks 7, 8, 9.

- [x] **Step 1: Write `query.ts`**

```ts
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { orderedPair } from './thread-key'
import { unreadCount, isBlockedBetween, type BlockRow } from './predicates'

const PROFILE = 'id, username, display_name, avatar_url'
type ProfileRow = { id: string; username: string | null; display_name: string | null; avatar_url: string | null }

async function signImages(paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (paths.length === 0) return out
  const admin = createAdminClient()
  await Promise.all(
    paths.map(async (p) => {
      const { data } = await admin.storage.from('dm-images').createSignedUrl(p, 3600)
      if (data?.signedUrl) out.set(p, data.signedUrl)
    }),
  )
  return out
}

export type ThreadSummary = {
  threadId: string
  otherId: string
  otherName: string
  otherUsername: string | null
  otherAvatarUrl: string | null
  lastMessage: string | null
  lastWasImage: boolean
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
      .select('thread_id, sender_id, body, image_url, created_at, read_at')
      .in('thread_id', threadIds)
      .order('created_at', { ascending: true }),
    supabase
      .from('dm_blocks')
      .select('blocker_id, blocked_id')
      .or(`blocker_id.eq.${viewerId},blocked_id.eq.${viewerId}`),
  ])

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p as ProfileRow]))
  const blockRows: BlockRow[] = (blocks ?? []).map((b) => ({ blockerId: b.blocker_id, blockedId: b.blocked_id }))
  const byThread = new Map<string, { sender_id: string; body: string | null; image_url: string | null; read_at: string | null }[]>()
  for (const m of msgs ?? []) {
    const list = byThread.get(m.thread_id) ?? []
    list.push(m)
    byThread.set(m.thread_id, list)
  }

  const out: ThreadSummary[] = []
  for (const t of threads) {
    const otherId = t.player_a === viewerId ? t.player_b : t.player_a
    if (isBlockedBetween(blockRows, viewerId, otherId)) continue
    const list = byThread.get(t.id) ?? []
    const last = list[list.length - 1]
    const other = profileById.get(otherId)
    out.push({
      threadId: t.id,
      otherId,
      otherName: other?.display_name ?? other?.username ?? 'Player',
      otherUsername: other?.username ?? null,
      otherAvatarUrl: other?.avatar_url ?? null,
      lastMessage: last?.body ?? null,
      lastWasImage: !!last && last.body == null && last.image_url != null,
      lastMessageAt: t.last_message_at,
      unread: unreadCount(list.map((m) => ({ senderId: m.sender_id, readAt: m.read_at })), viewerId),
    })
  }
  return out
}

export type ConversationMessage = {
  id: string
  senderId: string
  body: string | null
  imageUrl: string | null
  createdAt: string
  readAt: string | null
}

export type ThreadDetail = {
  threadId: string
  other: { id: string; name: string; username: string | null; avatarUrl: string | null }
  messages: ConversationMessage[]
  blockedByMe: boolean
  blockedByThem: boolean
}

export async function fetchThread(threadId: string, viewerId: string): Promise<ThreadDetail | null> {
  const supabase = createClient()
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
      .select('id, sender_id, body, image_url, created_at, read_at')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true }),
    supabase
      .from('dm_blocks')
      .select('blocker_id, blocked_id')
      .or(`blocker_id.eq.${viewerId},blocked_id.eq.${viewerId}`),
  ])

  const rows = messages ?? []
  const signed = await signImages(rows.filter((m) => m.image_url).map((m) => m.image_url as string))
  const blockRows = (blocks ?? []) as { blocker_id: string; blocked_id: string }[]

  return {
    threadId,
    other: {
      id: otherId,
      name: other?.display_name ?? other?.username ?? 'Player',
      username: other?.username ?? null,
      avatarUrl: other?.avatar_url ?? null,
    },
    messages: rows.map((m) => ({
      id: m.id,
      senderId: m.sender_id,
      body: m.body,
      imageUrl: m.image_url ? (signed.get(m.image_url) ?? null) : null,
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

export type ProfileMessagingState = { blockedByMe: boolean; blockedByThem: boolean }

export async function fetchProfileMessagingState(
  viewerId: string,
  profileId: string,
): Promise<ProfileMessagingState> {
  const supabase = createClient()
  const { data } = await supabase
    .from('dm_blocks')
    .select('blocker_id, blocked_id')
    .or(
      `and(blocker_id.eq.${viewerId},blocked_id.eq.${profileId}),and(blocker_id.eq.${profileId},blocked_id.eq.${viewerId})`,
    )
  const rows = data ?? []
  return {
    blockedByMe: rows.some((b) => b.blocker_id === viewerId),
    blockedByThem: rows.some((b) => b.blocker_id === profileId),
  }
}
```

- [x] **Step 2: Typecheck + lint** — `npx tsc --noEmit && npx next lint --file lib/messages/query.ts` → passes. (If `dm_*` are `never`-typed, Task 1 Step 4 was not completed.)

- [x] **Step 3: Commit**

```bash
git add lib/messages/query.ts
git commit -m "feat(messages): thread list + conversation + block-state queries

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018zQe17sFEE1YWyDS9X2WfV"
```

---

## Task 6: Server actions

**Files:**
- Create: `lib/messages/actions.ts`

**Interfaces:**
- Consumes: `orderedPair` (Task 2), `messageBodySchema`, `reportReasonSchema` (Task 4), `createClient` from `@/lib/supabase/server`, `createAdminClient` from `@/lib/supabase/admin`, `notifyInApp` from `@/lib/notifications/inbox`.
- Produces (`'use server'`):
  - `sendMessage(input: { threadId?: string; recipientId?: string; body?: string; imageUrl?: string }): Promise<{ threadId?: string; error?: string }>` — resolves-or-creates the thread, validates (body **or** image required; body if present must pass `messageBodySchema`), inserts, bumps `last_message_at`, notifies the recipient. Rejects when the pair is blocked or the sender is muted (RLS also rejects; this is the friendly path).
  - `startConversation(otherId: string): Promise<{ threadId?: string; error?: string }>` — resolve-or-create only; used by the profile "Message" button.
  - `markThreadRead(threadId: string): Promise<void>` — best-effort; `read_at = now()` on the viewer's unread inbound messages + marks matching `direct_message` notifications read.
  - `blockUser(otherId: string): Promise<{ error?: string }>` / `unblockUser(otherId: string): Promise<{ error?: string }>`
  - `reportConversation(input: { threadId: string; messageId?: string; reason: string }): Promise<{ error?: string }>`
- Consumed by: `MessageComposer`, `Conversation`, `ThreadMenu`, `ProfilePlayerActions`, both pages.

- [x] **Step 1: Write `actions.ts`**

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { orderedPair } from './thread-key'
import { messageBodySchema, reportReasonSchema } from './schema'
import { notifyInApp } from '@/lib/notifications/inbox'

async function authed() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return { supabase, userId: user?.id ?? null }
}

// Existing thread id, or a new one. Service-role — dm_threads has no client
// INSERT policy. No rate limit (decision 2026-09-09); abuse is handled by the
// admin mute + the report-queue signal.
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

export async function startConversation(otherId: string): Promise<{ threadId?: string; error?: string }> {
  const { userId } = await authed()
  if (!userId) return { error: 'Please log in.' }
  if (!otherId || otherId === userId) return { error: 'Pick someone to message.' }
  const res = await resolveOrCreateThread(userId, otherId)
  return 'error' in res ? res : { threadId: res.threadId }
}

export async function sendMessage(input: {
  threadId?: string
  recipientId?: string
  body?: string
  imageUrl?: string
}): Promise<{ threadId?: string; error?: string }> {
  const { supabase, userId } = await authed()
  if (!userId) return { error: 'Please log in.' }

  const rawBody = (input.body ?? '').trim()
  const imageUrl = input.imageUrl?.trim() || null
  if (!rawBody && !imageUrl) return { error: 'Type a message or add a photo.' }
  let body: string | null = null
  if (rawBody) {
    const parsed = messageBodySchema.safeParse(rawBody)
    if (!parsed.success) return { error: parsed.error.issues[0].message }
    body = parsed.data
  }

  let threadId = input.threadId
  let otherId: string
  const admin = createAdminClient()

  if (threadId) {
    const { data: t } = await admin
      .from('dm_threads')
      .select('player_a, player_b')
      .eq('id', threadId)
      .maybeSingle()
    if (!t || (t.player_a !== userId && t.player_b !== userId)) return { error: 'Conversation not found.' }
    otherId = t.player_a === userId ? t.player_b : t.player_a
  } else {
    if (!input.recipientId || input.recipientId === userId) return { error: 'Pick someone to message.' }
    otherId = input.recipientId
    const resolved = await resolveOrCreateThread(userId, otherId)
    if ('error' in resolved) return resolved
    threadId = resolved.threadId
  }

  // Friendly pre-checks (RLS dm_can_message() is the real guard).
  const [{ data: blockRows }, { data: muted }] = await Promise.all([
    admin
      .from('dm_blocks')
      .select('blocker_id')
      .or(
        `and(blocker_id.eq.${userId},blocked_id.eq.${otherId}),and(blocker_id.eq.${otherId},blocked_id.eq.${userId})`,
      ),
    admin.from('dm_muted_players').select('player_id').eq('player_id', userId).maybeSingle(),
  ])
  if (muted) return { error: 'Your messaging is currently restricted. Contact support if you think this is a mistake.' }
  if (blockRows && blockRows.length > 0) {
    const iBlocked = blockRows.some((b) => b.blocker_id === userId)
    return { error: iBlocked ? 'Unblock this player to message them.' : 'You can no longer message this player.' }
  }

  // Insert via the SESSION client so the RLS sender-insert policy applies (defence
  // in depth) — dm_can_message() re-checks block + mute server-side.
  const { error: insErr } = await supabase
    .from('dm_messages')
    .insert({ thread_id: threadId, sender_id: userId, body, image_url: imageUrl })
  if (insErr) {
    console.error('[sendMessage] insert failed', { userId, threadId, code: insErr.code, message: insErr.message })
    return { error: 'Could not send your message. Please try again.' }
  }

  await admin.from('dm_threads').update({ last_message_at: new Date().toISOString() }).eq('id', threadId)

  const { data: me } = await admin.from('profiles').select('display_name, username').eq('id', userId).maybeSingle()
  const fromName = me?.display_name ?? me?.username ?? 'Someone'
  const preview = body ? (body.length > 80 ? `${body.slice(0, 80)}…` : body) : '📷 Photo'
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

- [x] **Step 2: Typecheck + lint** — `npx tsc --noEmit && npx next lint --file lib/messages/actions.ts` → passes.

- [x] **Step 3: Commit**

```bash
git add lib/messages/actions.ts
git commit -m "feat(messages): send / start / read / block / report server actions

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
- Produces: the `/messages` route — `ThreadListItem` rows linking to `/messages/[threadId]`; empty state pointing at `/players`; a `<MessagesRealtime>` island that `router.refresh()`es on any `dm_messages` change.

- [x] **Step 1: `MessagesRealtime.tsx`**

```tsx
'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

// The list is fully server-hydrated (previews, unread, other-party profiles),
// so re-running the server component is correct-by-construction — same as
// CommunityRealtime. RLS scopes the subscription; a 400ms debounce keeps a
// burst cheap.
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

- [x] **Step 2: `ThreadListItem.tsx`**

```tsx
import Link from 'next/link'
import { Avatar } from '@/components/shared/Avatar'
import { formatRelativeTime } from '@/lib/format'
import type { ThreadSummary } from '@/lib/messages/query'

export function ThreadListItem({ thread }: { thread: ThreadSummary }) {
  const preview = thread.lastMessage ?? (thread.lastWasImage ? '📷 Photo' : 'No messages yet')
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
        <p className={`truncate text-xs ${thread.unread > 0 ? 'font-semibold text-white' : 'text-sx-gray'}`}>{preview}</p>
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

- [x] **Step 3: `page.tsx`**

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

- [x] **Step 4: Typecheck + lint** — `npx tsc --noEmit && npx next lint --file "app/[locale]/messages/page.tsx" --file components/messages/ThreadListItem.tsx --file components/messages/MessagesRealtime.tsx` → passes.

- [x] **Step 5: Commit**

```bash
git add "app/[locale]/messages/page.tsx" components/messages/ThreadListItem.tsx components/messages/MessagesRealtime.tsx
git commit -m "feat(messages): /messages thread list

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018zQe17sFEE1YWyDS9X2WfV"
```

---

## Task 8: `/messages/[threadId]` conversation page (text + images)

**Files:**
- Create: `app/[locale]/messages/[threadId]/page.tsx`
- Create: `components/messages/Conversation.tsx`
- Create: `components/messages/MessageComposer.tsx`
- Create: `components/messages/ThreadMenu.tsx`

**Interfaces:**
- Consumes: `fetchThread`, `type ThreadDetail`, `type ConversationMessage` (Task 5); `sendMessage`, `markThreadRead`, `blockUser`, `unblockUser`, `reportConversation` (Task 6); `messageBodySchema`, `reportReasonSchema` (Task 4); `Avatar`; `formatRelativeTime`; `createClient` from `@/lib/supabase/client`; `resizeImageToMaxWidth` from `@/lib/media/resize-image`.
- Produces: the `/messages/[threadId]` route — header (avatar/name → profile, overflow menu), a scrolling message list that appends in realtime (text bubbles + image bubbles), a composer with a text field and an image button. `notFound()` when `fetchThread` returns `null`.

- [x] **Step 1: `MessageComposer.tsx`**

```tsx
'use client'
import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { SendHorizonal, ImagePlus, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { resizeImageToMaxWidth } from '@/lib/media/resize-image'
import { sendMessage } from '@/lib/messages/actions'
import { messageBodySchema } from '@/lib/messages/schema'

export function MessageComposer({ threadId, disabled, disabledReason }: { threadId: string; disabled?: boolean; disabledReason?: string }) {
  const router = useRouter()
  const [body, setBody] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const textRef = useRef<HTMLTextAreaElement>(null)

  if (disabled) {
    return (
      <div className="border-t border-sx-border bg-sx-surface px-4 py-3 text-center text-xs text-sx-gray">
        {disabledReason ?? 'You cannot message this player.'}
      </div>
    )
  }

  function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setFile(f)
    setPreviewUrl(URL.createObjectURL(f))
  }
  function clearImage() {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setFile(null)
    setPreviewUrl(null)
  }

  const hasText = messageBodySchema.safeParse(body).success
  const ok = (hasText || file != null) && !pending

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!ok) return
    setError(null)
    const text = body
    const img = file
    setBody('')
    clearImage()

    start(async () => {
      let imageUrl: string | undefined
      if (img) {
        const supabase = createClient()
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user) {
          setError('Please log in.')
          return
        }
        try {
          const resized = await resizeImageToMaxWidth(img, 1280)
          const path = `${user.id}/${crypto.randomUUID()}.jpg`
          const { error: upErr } = await supabase.storage
            .from('dm-images')
            .upload(path, resized, { upsert: false, contentType: 'image/jpeg' })
          if (upErr) throw upErr
          imageUrl = path // store the PATH, not a URL
        } catch {
          setError('That image failed to upload. Please try again.')
          setBody(text)
          return
        }
      }
      const res = await sendMessage({ threadId, body: text || undefined, imageUrl })
      if (res.error) {
        setError(res.error)
        setBody(text)
        return
      }
      router.refresh()
      textRef.current?.focus()
    })
  }

  return (
    <form onSubmit={submit} className="border-t border-sx-border bg-sx-surface px-3 py-2">
      {error && <p className="mb-1 text-xs text-red-400">{error}</p>}
      {previewUrl && (
        <div className="relative mb-2 inline-block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt="" className="max-h-32 rounded-lg border border-sx-border object-cover" />
          <button
            type="button"
            onClick={clearImage}
            aria-label="Remove image"
            className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <div className="flex items-end gap-2">
        <label className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-sx-gray hover:text-white">
          <ImagePlus className="h-5 w-5" />
          <input type="file" accept="image/*" onChange={pickFile} className="hidden" />
        </label>
        <textarea
          ref={textRef}
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

- [x] **Step 2: `ThreadMenu.tsx`**

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
              placeholder="What happened? Staff will be able to read this conversation."
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

- [x] **Step 3: `Conversation.tsx`**

```tsx
'use client'
import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { markThreadRead } from '@/lib/messages/actions'
import { formatRelativeTime } from '@/lib/format'
import type { ThreadDetail, ConversationMessage } from '@/lib/messages/query'
import { MessageComposer } from './MessageComposer'

export function Conversation({ detail, viewerId }: { detail: ThreadDetail; viewerId: string }) {
  const [messages, setMessages] = useState<ConversationMessage[]>(detail.messages)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Realtime append. RLS scopes the stream; the filter is a second guard. The
  // payload has the storage PATH in image_url, not a signed URL — a message
  // with an image triggers a router.refresh() so the server re-signs it.
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`dm:thread:${detail.threadId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'dm_messages', filter: `thread_id=eq.${detail.threadId}` },
        (payload) => {
          const r = payload.new as { id: string; sender_id: string; body: string | null; image_url: string | null; created_at: string; read_at: string | null }
          if (r.image_url) {
            // needs a signed URL from the server
            void markThreadRead(detail.threadId)
            window.dispatchEvent(new Event('dm:refresh'))
            return
          }
          setMessages((prev) =>
            prev.some((m) => m.id === r.id)
              ? prev
              : [...prev, { id: r.id, senderId: r.sender_id, body: r.body, imageUrl: null, createdAt: r.created_at, readAt: r.read_at }],
          )
          if (r.sender_id !== viewerId) void markThreadRead(detail.threadId)
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [detail.threadId, viewerId])

  // `dm:refresh` (an image arrived) → re-fetch via the router.
  useEffect(() => {
    function onRefresh() {
      // next/navigation router.refresh() isn't available here without the hook;
      // use a full soft refresh via location as a last resort is wrong. Instead
      // import useRouter at top and call router.refresh(). (Executor: add
      // `const router = useRouter()` and call it here.)
    }
    window.addEventListener('dm:refresh', onRefresh)
    return () => window.removeEventListener('dm:refresh', onRefresh)
  }, [])

  useEffect(() => {
    setMessages(detail.messages)
  }, [detail.messages])

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
              <div className={`max-w-[80%] overflow-hidden rounded-2xl text-sm ${mine ? 'bg-sx-purple text-white' : 'bg-sx-surface text-white'}`}>
                {m.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.imageUrl} alt="" className="max-h-72 w-full object-cover" />
                )}
                {m.body && <p className="whitespace-pre-wrap break-words px-3 py-2">{m.body}</p>}
                <p className={`px-3 pb-1.5 text-[10px] ${mine ? 'text-white/60' : 'text-sx-gray'} ${m.body ? '' : 'pt-1.5'}`}>
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

> **Executor cleanup for `Conversation.tsx`:** the `dm:refresh` dance above is a placeholder for "an image message arrived and needs server re-signing." Replace it properly: add `import { useRouter } from 'next/navigation'`, `const router = useRouter()`, and in the realtime handler, when `r.image_url` is truthy, just call `router.refresh()` (drop the `window.dispatchEvent` / event-listener block entirely). Text messages still append optimistically from the payload; only image messages fall back to a refresh. Keep the de-dupe-on-`id` guard so the refresh + any echo don't double-render.

- [x] **Step 4: `page.tsx`**

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
    <div className="mx-auto flex h-[calc(100dvh-64px)] max-w-2xl flex-col px-0 sm:px-4">
      <header className="flex items-center gap-2 border-b border-sx-border px-3 py-2">
        <Link href="/messages" aria-label="Back to messages" className="flex h-9 w-9 items-center justify-center rounded-lg text-white/70 hover:bg-white/5">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <Link href={detail.other.username ? `/players/${detail.other.username}` : '#'} className="flex min-w-0 items-center gap-2">
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

> **`h-[calc(100dvh-64px)]`** assumes a 64px site header. Check `components/shared/SiteHeader.tsx` / the root layout for the real height and adjust the `64px`. Goal: composer pinned to the bottom of the viewport, transcript scrolls between header and composer, no page-level scroll.

- [x] **Step 5: Typecheck + lint** — `npx tsc --noEmit && npx next lint --file "app/[locale]/messages/[threadId]/page.tsx" --file components/messages/Conversation.tsx --file components/messages/MessageComposer.tsx --file components/messages/ThreadMenu.tsx` → passes.

- [x] **Step 6: Commit**

```bash
git add "app/[locale]/messages/[threadId]" components/messages/Conversation.tsx components/messages/MessageComposer.tsx components/messages/ThreadMenu.tsx
git commit -m "feat(messages): conversation view — text, images, realtime, block, report

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018zQe17sFEE1YWyDS9X2WfV"
```

---

## Task 9: Profile — Message + Block/Unblock

**Files:**
- Create: `components/player/ProfilePlayerActions.tsx`
- Modify: `components/player/ProfileHeader.tsx`
- Modify: `app/[locale]/(public)/players/[username]/page.tsx`

**Interfaces:**
- Consumes: `startConversation`, `blockUser`, `unblockUser` (Task 6); `fetchProfileMessagingState`, `type ProfileMessagingState` (Task 5); the existing `AddFriendButton` / `ChallengeButton` / `FriendStatusAction` behaviour in `ProfileHeader`.
- Produces: `<ProfilePlayerActions>` — a client component rendering, for a logged-in non-owner viewer: the existing friend action + `<ChallengeButton>` + a **Message** button (→ `startConversation` → `/messages/[id]`) + a **Block / Unblock** button. `ProfileHeader` gains a `messagingState?: ProfileMessagingState` prop and delegates the action row to this component; the profile page fetches that state.

- [x] **Step 1: `ProfilePlayerActions.tsx`**

```tsx
'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { MessageCircle, Ban } from 'lucide-react'
import { startConversation, blockUser, unblockUser } from '@/lib/messages/actions'
import { AddFriendButton } from '@/components/player/AddFriendButton'
import { ChallengeButton } from '@/components/player/ChallengeButton'
import type { FriendshipStatus } from '@/lib/friends/list'

export function ProfilePlayerActions({
  profileId,
  friendshipStatus,
  blockedByMe,
}: {
  profileId: string
  friendshipStatus: FriendshipStatus
  blockedByMe: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [blocked, setBlocked] = useState(blockedByMe)

  function openConversation() {
    start(async () => {
      setError(null)
      const res = await startConversation(profileId)
      if (res.error || !res.threadId) {
        setError(res.error ?? 'Could not open the conversation.')
        return
      }
      router.push(`/messages/${res.threadId}`)
    })
  }

  function toggleBlock() {
    start(async () => {
      setError(null)
      const res = blocked ? await unblockUser(profileId) : await blockUser(profileId)
      if (res.error) {
        setError(res.error)
        return
      }
      setBlocked((b) => !b)
      router.refresh()
    })
  }

  return (
    <div className="mt-4 flex flex-col items-center gap-2 sm:items-start">
      <div className="flex flex-wrap justify-center gap-2 sm:justify-start">
        <FriendStatusInline status={friendshipStatus} profileId={profileId} />
        <ChallengeButton opponentId={profileId} />
        {!blocked && (
          <button
            type="button"
            disabled={pending}
            onClick={openConversation}
            className="inline-flex items-center gap-1.5 rounded-lg border border-sx-border px-3 py-1.5 text-xs font-bold text-white hover:border-sx-purple/50 disabled:opacity-50"
          >
            <MessageCircle className="h-3.5 w-3.5" /> {pending ? 'Opening…' : 'Message'}
          </button>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={toggleBlock}
          className="inline-flex items-center gap-1.5 rounded-lg border border-sx-border px-3 py-1.5 text-xs font-bold text-sx-gray hover:border-red-500/50 hover:text-red-400 disabled:opacity-50"
        >
          <Ban className="h-3.5 w-3.5" /> {blocked ? 'Unblock' : 'Block'}
        </button>
      </div>
      {error && <span className="text-[11px] text-red-400">{error}</span>}
    </div>
  )
}

// The existing FriendStatusAction lives inside ProfileHeader as a private
// function. Duplicate its small body here (it only renders text or AddFriendButton)
// so ProfilePlayerActions is self-contained.
function FriendStatusInline({ status, profileId }: { status: FriendshipStatus; profileId: string }) {
  if (status === 'friends') return <span className="text-sm font-semibold text-sx-green">✓ Friends</span>
  if (status === 'pending_sent') return <span className="text-sm text-sx-gray">Friend request sent</span>
  if (status === 'pending_received')
    return <span className="text-sm text-sx-gray">They sent you a friend request — check your dashboard</span>
  return <AddFriendButton recipientId={profileId} />
}
```

> Check `components/player/ProfileHeader.tsx` for the exact `FriendStatusAction` body and copy it verbatim into `FriendStatusInline` (the plan shows it from an earlier read — verify the strings/classes still match).

- [x] **Step 2: Wire into `ProfileHeader.tsx`**

Add `messagingState?: { blockedByMe: boolean; blockedByThem: boolean }` to the props. Replace the existing:

```tsx
{viewerId && !isOwner && (
  <div className="mt-4 flex flex-wrap justify-center gap-2 sm:justify-start">
    <FriendStatusAction status={friendshipStatus} profileId={profile.id} />
    <ChallengeButton opponentId={profile.id} />
  </div>
)}
```

with:

```tsx
{viewerId && !isOwner && (
  <ProfilePlayerActions
    profileId={profile.id}
    friendshipStatus={friendshipStatus}
    blockedByMe={messagingState?.blockedByMe ?? false}
  />
)}
```

Add `import { ProfilePlayerActions } from '@/components/player/ProfilePlayerActions'`. Leave the private `FriendStatusAction` / `ChallengeButton` imports in place only if still used elsewhere in the file; otherwise remove the now-dead `FriendStatusAction` and its `ChallengeButton` import (lint will flag unused).

- [x] **Step 3: Fetch the state in the profile page**

In `app/[locale]/(public)/players/[username]/page.tsx`, after resolving `user` and `profile`, add:

```tsx
import { fetchProfileMessagingState } from '@/lib/messages/query'
// ...
const messagingState =
  user && user.id !== profile.id ? await fetchProfileMessagingState(user.id, profile.id) : undefined
```

and pass `messagingState={messagingState}` into `<ProfileHeader .../>`.

- [x] **Step 4: Typecheck + lint** — `npx tsc --noEmit && npx next lint --file components/player/ProfilePlayerActions.tsx --file components/player/ProfileHeader.tsx --file "app/[locale]/(public)/players/[username]/page.tsx"` → passes.

- [x] **Step 5: Commit**

```bash
git add components/player/ProfilePlayerActions.tsx components/player/ProfileHeader.tsx "app/[locale]/(public)/players/[username]/page.tsx"
git commit -m "feat(messages): Message + Block on player profiles

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018zQe17sFEE1YWyDS9X2WfV"
```

---

## Task 10: Admin — `/admin/messages` report queue + mute

**Files:**
- Create: `lib/messages/admin-query.ts`
- Create: `lib/messages/admin-actions.ts`
- Create: `app/[locale]/admin/messages/page.tsx`
- Create: `components/admin/DmReportRow.tsx`
- Modify: `lib/admin/nav.ts`

**Interfaces:**
- Consumes: `requireStaff` from `@/lib/admin/auth` (returns `StaffContext` with `userId: string`); `countNewContactsSince` (Task 3); `createClient` from `@/lib/supabase/server`; `createAdminClient` from `@/lib/supabase/admin`; `formatDateTime` from `@/lib/format`.
- Produces:
  - `type DmTranscriptMessage = { id: string; senderName: string; body: string | null; imageUrl: string | null; createdAt: string; flagged: boolean }` — `imageUrl` is a signed URL or `null`.
  - `type DmReportView = { id: string; reason: string; createdAt: string; resolvedAt: string | null; reporterName: string | null; reportedName: string | null; reportedId: string; reportedMuted: boolean; reportedNewContacts24h: number; threadId: string; flaggedMessageId: string | null; transcript: DmTranscriptMessage[] }`
  - `fetchDmReports(limit?: number): Promise<DmReportView[]>` — open reports first, then recently resolved; each with the full transcript (staff read allowed), the reported player's current mute state, and their 24h new-contact count.
  - `resolveDmReport(_prev, formData): Promise<AdminActionState>` — `id` from the form; sets `resolved_at`/`resolved_by`; optional `deleteMessageId` → hard-deletes that `dm_messages` row.
  - `setMessagingMuted(_prev, formData): Promise<AdminActionState>` — `playerId` + `muted` (`'true'`/`'false'`); upserts / deletes a `dm_muted_players` row (service-role).
  - `DmReportRow` — client component: transcript toggle, "Resolve" (+ optional delete-flagged), "Mute messaging" / "Unmute".
- Consumed by: `app/[locale]/admin/messages/page.tsx`.

- [x] **Step 1: `admin-query.ts`**

```ts
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { countNewContactsSince } from './predicates'

export type DmTranscriptMessage = {
  id: string
  senderName: string
  body: string | null
  imageUrl: string | null
  createdAt: string
  flagged: boolean
}

export type DmReportView = {
  id: string
  reason: string
  createdAt: string
  resolvedAt: string | null
  reporterName: string | null
  reportedName: string | null
  reportedId: string
  reportedMuted: boolean
  reportedNewContacts24h: number
  threadId: string
  flaggedMessageId: string | null
  transcript: DmTranscriptMessage[]
}

type MsgRow = { id: string; thread_id: string; sender_id: string; body: string | null; image_url: string | null; created_at: string }

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
  const reportedIds = [...new Set(reports.map((r) => r.reported_id))]
  const personIds = [...new Set(reports.flatMap((r) => [r.reporter_id, r.reported_id]))]

  const [{ data: profiles }, { data: msgs }, { data: mutes }, { data: startedThreads }] = await Promise.all([
    supabase.from('profiles').select('id, username, display_name').in('id', personIds),
    supabase
      .from('dm_messages')
      .select('id, thread_id, sender_id, body, image_url, created_at')
      .in('thread_id', threadIds)
      .order('created_at', { ascending: true }),
    supabase.from('dm_muted_players').select('player_id').in('player_id', reportedIds),
    supabase.from('dm_threads').select('created_by, created_at').in('created_by', reportedIds),
  ])

  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.display_name ?? p.username ?? 'Player'] as const))
  const mutedSet = new Set((mutes ?? []).map((m) => m.player_id))
  const startedByPlayer = new Map<string, string[]>()
  for (const t of startedThreads ?? []) {
    const list = startedByPlayer.get(t.created_by) ?? []
    list.push(t.created_at)
    startedByPlayer.set(t.created_by, list)
  }
  const msgsByThread = new Map<string, MsgRow[]>()
  for (const m of (msgs ?? []) as MsgRow[]) {
    const list = msgsByThread.get(m.thread_id) ?? []
    list.push(m)
    msgsByThread.set(m.thread_id, list)
  }

  // Sign every image path once.
  const admin = createAdminClient()
  const allPaths = [...new Set(((msgs ?? []) as MsgRow[]).filter((m) => m.image_url).map((m) => m.image_url as string))]
  const signed = new Map<string, string>()
  await Promise.all(
    allPaths.map(async (p) => {
      const { data } = await admin.storage.from('dm-images').createSignedUrl(p, 3600)
      if (data?.signedUrl) signed.set(p, data.signedUrl)
    }),
  )

  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  return reports.map((r) => ({
    id: r.id,
    reason: r.reason,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
    reporterName: nameById.get(r.reporter_id) ?? null,
    reportedName: nameById.get(r.reported_id) ?? null,
    reportedId: r.reported_id,
    reportedMuted: mutedSet.has(r.reported_id),
    reportedNewContacts24h: countNewContactsSince(startedByPlayer.get(r.reported_id) ?? [], dayAgo),
    threadId: r.thread_id,
    flaggedMessageId: r.message_id,
    transcript: (msgsByThread.get(r.thread_id) ?? []).map((m) => ({
      id: m.id,
      senderName: nameById.get(m.sender_id) ?? 'Player',
      body: m.body,
      imageUrl: m.image_url ? (signed.get(m.image_url) ?? null) : null,
      createdAt: m.created_at,
      flagged: m.id === r.message_id,
    })),
  }))
}
```

- [x] **Step 2: `admin-actions.ts`**

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

export async function setMessagingMuted(_prev: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const ctx = await requireStaff()
  const playerId = String(formData.get('playerId') ?? '')
  const muted = String(formData.get('muted') ?? '') === 'true'
  if (!playerId) return { error: 'Missing player.' }

  const admin = createAdminClient()
  if (muted) {
    const { error } = await admin
      .from('dm_muted_players')
      .upsert({ player_id: playerId, muted_by: ctx.userId }, { onConflict: 'player_id', ignoreDuplicates: true })
    if (error) return { error: 'Could not mute this player.' }
  } else {
    const { error } = await admin.from('dm_muted_players').delete().eq('player_id', playerId)
    if (error) return { error: 'Could not unmute this player.' }
  }
  revalidatePath('/admin/messages')
  return undefined
}
```

- [x] **Step 3: `DmReportRow.tsx`**

```tsx
'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { formatDateTime } from '@/lib/format'
import { resolveDmReport, setMessagingMuted, type AdminActionState } from '@/lib/messages/admin-actions'
import type { DmReportView } from '@/lib/messages/admin-query'

export function DmReportRow({ report }: { report: DmReportView }) {
  const [resolveState, resolveAction] = useFormState<AdminActionState, FormData>(resolveDmReport, undefined)
  const [muteState, muteAction] = useFormState<AdminActionState, FormData>(setMessagingMuted, undefined)
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
          <p className="mt-1 text-[11px] text-slate-500">
            {report.reportedName ?? 'This player'} messaged{' '}
            <span className={report.reportedNewContacts24h >= 8 ? 'font-bold text-amber-400' : 'text-slate-300'}>
              {report.reportedNewContacts24h}
            </span>{' '}
            new {report.reportedNewContacts24h === 1 ? 'person' : 'people'} in the last 24h
            {report.reportedMuted && <span className="ml-2 rounded bg-amber-900/50 px-1.5 py-0.5 font-bold text-amber-300">muted</span>}
          </p>
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
              {m.body && <span className="text-slate-200">{m.body}</span>}
              {m.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.imageUrl} alt="" className="mt-1 max-h-40 rounded border border-slate-800" />
              )}
              <span className="ml-2 text-[10px] text-slate-600">{formatDateTime(m.createdAt)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <form action={muteAction}>
          <input type="hidden" name="playerId" value={report.reportedId} />
          <input type="hidden" name="muted" value={(!report.reportedMuted).toString()} />
          <button type="submit" className="rounded-lg border border-amber-700/60 px-3 py-1 text-xs font-bold text-amber-400 hover:bg-amber-950/40">
            {report.reportedMuted ? 'Unmute messaging' : 'Mute messaging'}
          </button>
        </form>
        {!report.resolvedAt && (
          <form action={resolveAction} className="ml-auto flex items-center gap-2">
            <input type="hidden" name="id" value={report.id} />
            {report.flaggedMessageId && (
              <label className="flex items-center gap-1 text-[11px] text-slate-400">
                <input type="checkbox" name="deleteMessageId" value={report.flaggedMessageId} /> delete flagged message
              </label>
            )}
            <button type="submit" className="rounded-lg bg-green-600/80 px-3 py-1 text-xs font-bold text-white hover:bg-green-600">
              Resolve
            </button>
          </form>
        )}
      </div>
      {resolveState?.error && <p className="mt-1 text-[11px] text-red-400">{resolveState.error}</p>}
      {muteState?.error && <p className="mt-1 text-[11px] text-red-400">{muteState.error}</p>}
    </div>
  )
}
```

- [x] **Step 4: `page.tsx`**

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

- [x] **Step 5: Nav entry** — in `lib/admin/nav.ts`, add after `Challenges`:

```ts
  { label: 'Messages', href: '/admin/messages', adminOnly: false },
```

- [x] **Step 6: Typecheck + lint** — `npx tsc --noEmit && npx next lint --file lib/messages/admin-query.ts --file lib/messages/admin-actions.ts --file components/admin/DmReportRow.tsx --file "app/[locale]/admin/messages/page.tsx" --file lib/admin/nav.ts` → passes.

- [x] **Step 7: Commit**

```bash
git add lib/messages/admin-query.ts lib/messages/admin-actions.ts components/admin/DmReportRow.tsx "app/[locale]/admin/messages/page.tsx" lib/admin/nav.ts
git commit -m "feat(messages): admin report queue with transcript, mute + mass-contact signal

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018zQe17sFEE1YWyDS9X2WfV"
```

---

## Task 11: Privacy policy disclosure

**Files:**
- Modify: `messages/en.json`, `messages/fr.json`, `messages/pcm.json`
- Modify: `app/[locale]/(public)/privacy/page.tsx`

**Context:** `PrivacyPage` builds `sections=[...]` from `t('sN...')` keys. §2 ("What Data We Collect") has an `s2Play` / `s2PlayList` sub-block (a single string of `<li>…</li>` rendered via `t.rich('s2PlayList', listItemTag)`). §4 ("Who We Share Your Data With", `id: 'who-we-share-with'`) ends its fragment with `<p>{t('s4P2')}</p><p>{t('s4P3')}</p>`.

- [x] **Step 1: `messages/en.json`** — under `"privacy"`:
  - Add key: `"s4Dm": "When you report a private conversation, our moderators can read that conversation in order to review your report and act on it. We do not read private messages otherwise."`
  - Append one `<li>` to `s2PlayList`: `<li>Private messages and photos you send other players to coordinate matches, and any reports you file</li>`

- [x] **Step 2: `messages/fr.json`** — same keys:
  - `"s4Dm": "Lorsque vous signalez une conversation privée, nos modérateurs peuvent la lire afin d'examiner votre signalement et d'y donner suite. Nous ne lisons pas les messages privés autrement."`
  - `s2PlayList` extra `<li>`: `<li>Les messages privés et photos que vous envoyez à d'autres joueurs pour organiser des matchs, et les signalements que vous déposez</li>`

- [x] **Step 3: `messages/pcm.json`** — same keys:
  - `"s4Dm": "If you report a private chat, our moderators fit read that chat so dem go fit check your report and do something about am. We no dey read private messages otherwise."`
  - `s2PlayList` extra `<li>`: `<li>Private messages and photos wey you send other players to arrange matches, and any report wey you file</li>`

- [x] **Step 4: Render `s4Dm`** — in `app/[locale]/(public)/privacy/page.tsx`, in the §4 section fragment, add right after `<p>{t('s4P3')}</p>`:

```tsx
<p>{t('s4Dm')}</p>
```

- [x] **Step 5: Typecheck + lint + intl sanity**

```bash
npx tsc --noEmit && npx next lint --file "app/[locale]/(public)/privacy/page.tsx"
node -e "['en','fr','pcm'].forEach(l=>{const m=require('./messages/'+l+'.json'); if(!m.privacy.s4Dm) throw new Error(l+' missing s4Dm'); if(!m.privacy.s2PlayList.includes('Private messages')) throw new Error(l+' s2PlayList not updated')}); console.log('keys ok')"
```
Expected: both pass.

- [x] **Step 6: Commit**

```bash
git add messages/ "app/[locale]/(public)/privacy/page.tsx"
git commit -m "docs(privacy): disclose DM collection + staff review of reported threads

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018zQe17sFEE1YWyDS9X2WfV"
```

---

## Task 12: End-to-end verification

**Files:** none — manual run on the Vercel preview (do not `npm run build` locally).

- [ ] **Step 1: Push + full unit sweep**

```bash
git push -u origin worktree-community-dms
npx vitest run lib/messages/
```
Expected: `thread-key` (3) + `predicates` (7) + `schema` (6) green. Wait for the Vercel preview READY.

- [ ] **Step 2: Start a conversation + send text** — Account A → B's profile → "Message" → `/messages/<id>` → send "fixture at 8?" → A's bubble.

- [ ] **Step 3: Send an image** — A picks a photo → preview → send → image bubble renders (signed URL). Reload → still renders (fresh sign).

- [ ] **Step 4: Realtime + unread** — B on `/messages` sees the thread + unread badge + preview ("📷 Photo" for the image-only one). B opens it → text appends live if A sends while open; image message triggers a refresh and shows. Badge clears; header bell entry for the thread clears.

- [ ] **Step 5: Block from thread** — B → overflow → Block A → thread gone from B's `/messages`; composer disabled. A tries to send → "You can no longer message this player." B → reopen `/messages/<id>` → Unblock → works again.

- [ ] **Step 6: Block from profile** — A → B's profile → "Block" → the "Message" button disappears, button flips to "Unblock". Unblock → "Message" returns.

- [ ] **Step 7: Report + admin** — A → overflow → Report → reason → send. Staff → `/admin/messages` → report listed with "messaged N new people in 24h", "View thread" shows the transcript (images inline), flagged message highlighted → "Mute messaging" → the reported account can no longer send (verify as that account: "Your messaging is currently restricted") → "Unmute" restores → "Resolve" (optionally delete flagged) greys the row.

- [ ] **Step 8: Account deletion** — throwaway C messages A, then C deletes via `/dashboard/settings` → "Delete now". SQL: `SELECT count(*) FROM dm_threads WHERE player_a='<C>' OR player_b='<C>'` → 0; A's `/messages` no longer shows C.

- [ ] **Step 9: Privacy** — `/privacy`, `/fr/privacy`, `/pcm/privacy` → §2 lists private messages + photos; §4 has the moderator-review paragraph.

- [ ] **Step 10: Mobile (375px, signed in)** — `/messages` rows don't overflow; `/messages/<id>` header + scrolling transcript + composer pinned bottom, Enter sends / Shift+Enter newline, image preview fits, overflow menu + report sheet fit. No horizontal body scroll.

- [ ] **Step 11: Tick this plan; update the spec + memory** — tick every box; add `**Status:** shipped <date>` to `docs/superpowers/specs/2026-09-07-direct-messages-design.md`; note in `docs/superpowers/specs/2026-09-07-community-system-overview.md` if it tracks piece status; update memory `project_community_statuses` (rename mentally to "community rebuild" — DMs now shipped, follows + media feed remain).

- [ ] **Step 12: Merge to main** — per memory `feedback_always_push`: merge `origin/main` in first (resolve `lib/supabase/types.ts` by regenerating from the live schema), re-run `npx vitest run` + `npx tsc --noEmit`, push the branch, confirm the Vercel preview is green, then fast-forward `main`.

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| `dm_threads` normalised pair + unique index | 1, 2 |
| `dm_messages` body/image check, 2000 cap | 1, 4 |
| `dm_blocks` unique per pair | 1 |
| `dm_reports` → admin | 1, 10 |
| RLS: thread + messages readable only by participants (+ staff) | 1 |
| Insert requires participant **and** not blocked either way, **in RLS** | 1 (`dm_can_message` + `dm_messages_sender_insert`) |
| Blocking symmetric in effect | 1, 3, 6 |
| Messages immutable except `read_at` | 1 (only `dm_messages_recipient_mark_read`) |
| Account deletion cascades messages | 1 (`anonymise_account`), 12 Step 8 |
| Block from thread **and** from profile | 8 (`ThreadMenu`), 9 (`ProfilePlayerActions`) |
| Report a message or a player, with reason, → admin | 8, 10 |
| Admin can read a reported thread | 1 (`is_staff()` reads), 10 |
| Rate limiting / anti-spam | **Replaced** (decision 2026-09-09) by admin mute (`dm_muted_players`, Tasks 1/6/10) + the "N new contacts / 24h" report signal (Tasks 3/10). Documented in Global Constraints and here. |
| Privacy policy edit is part of this piece | 11 |
| Realtime `dm_messages` published, RLS on top | 1, 7, 8 |
| Unread = `read_at IS NULL AND sender_id <> me` | 3 (`unreadCount`) |
| `/messages` list: avatar, name, preview, timestamp, unread badge | 7 |
| `/messages/[threadId]`: message list, composer, block/report overflow | 8 |
| Header: unread total on the existing cluster, not a new control | 1 + 6 (DMs write `player_notifications` → existing bell; **no header file touched**) |
| Profile: "Message" button | 9 |
| Images (spec's cuttable corner — **kept in** per 2026-09-09 decision) | 1 (bucket + RLS), 5 (signed URLs), 8 (upload + render), 10 (transcript) |
| Out: groups, voice, typing, richer receipts, search, reactions | not built |

**Placeholder scan:** one deliberate placeholder — the `dm:refresh` event dance in `Conversation.tsx` (Task 8 Step 3) — is flagged immediately below the code with the exact clean replacement (`useRouter().refresh()` on image-message events). Everything else is literal. No TBD/TODO.

**Type consistency:** `orderedPair` → `{playerA, playerB}` used in Tasks 5/6. `ThreadSummary` / `ThreadDetail` / `ConversationMessage` / `ProfileMessagingState` defined in Task 5, consumed in 7/8/9. `ConversationMessage.imageUrl` is a **signed URL** in the query layer output (not the stored path) — the realtime payload in Task 8 carries the raw path, hence the refresh-to-re-sign. `AdminActionState` defined locally in `admin-actions.ts` (Task 10), matching the community `admin-actions.ts` pattern. `countNewContactsSince` from Task 3 used in Task 10. `startConversation` in `lib/messages/actions.ts` (Task 6), consumed by Task 9.

**Deviations from spec, all deliberate & user-approved (2026-09-09):**
1. **No preemptive rate limit** — replaced with admin mute + report-queue signal. The spec called rate-limiting "not cuttable"; the user's call is that a loose cap is security theatre and a tight one blocks real users, and a fast reactive lever is better for this small, hand-moderated community.
2. **Images kept in** (spec's "cuttable corner") — private bucket + signed URLs.
3. **Header badge via `player_notifications`** rather than a bespoke DM count — satisfies "badge on an existing control, not a new one" more literally.
