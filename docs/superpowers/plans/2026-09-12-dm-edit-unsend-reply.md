# DM Edit, Unsend, Reply Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a player edit or unsend their own message within 10 minutes of sending, and reply to (quote) a specific earlier message — while staff reviewing a report always see the true, unaltered content and full edit history.

**Architecture:** Three additive columns on `dm_messages` (`edited_at`, `deleted_at`, `reply_to_id`) plus a new staff-only `dm_message_edits` audit table. Content is never destroyed — unsend only sets `deleted_at`; the participant-facing query layer (`fetchThread`, `fetchThreadList`, the realtime handler) hides content when it's set via a new pure `resolveParticipantContent` predicate, while the staff-facing layer (`fetchDmReports`) ignores the flag entirely and always reads the real `body`/`image_url` plus the edit history. A new RLS policy lets the sender UPDATE their own message only within 10 minutes, enforced server-side in two new actions (`editMessage`, `unsendMessage`) and backed by the database. Realtime widens from `INSERT`-only to `event: '*'` so edits/unsends/replies show up live on the other side.

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase (Postgres + Auth + Realtime), Tailwind, `zod`, `vitest`, `lucide-react`.

**Spec:** `docs/superpowers/specs/2026-09-12-dm-edit-unsend-reply-design.md` (this piece); `docs/superpowers/specs/2026-09-07-direct-messages-design.md` (the piece this extends).

## Global Constraints

- **10-minute window** on edit and unsend, enforced **server-side** in the action (not just a disabled button) and backed by a DB RLS policy. Reply has **no** time limit.
- **Content is never destroyed.** Unsend sets `deleted_at` only — `body`/`image_url` stay intact in the row. Editing appends the pre-edit value to `dm_message_edits` *before* overwriting `dm_messages`.
- **Staff bypass the hide-on-`deleted_at` rule entirely** — the admin transcript (`fetchDmReports`) always shows real content plus full edit history. This is what makes reversing "messages are immutable" safe.
- **Editing changes text only.** An attached image can't be swapped, only removed via unsend.
- **No new notification type.** Edits/unsends are silent realtime-only updates. A reply still fires the existing `direct_message` notification, unchanged.
- **Visual language follows WhatsApp's interaction conventions** (quote-block layout, edited tag, removed-message treatment) — **not** its colors. Everything stays on the existing `sx-*` dark/purple palette.
- **This is the `community-dms` worktree** at `.claude/worktrees/community-dms`, branch `worktree-community-dms` — the same branch the original DM feature and its post-ship fixes (constraint-race fix, realtime-reconnect fix) already live on. Do not create a new worktree. Concurrent sessions may be active in other worktrees — do not run `npm run build`; verify with `npx tsc --noEmit` + `npx next lint`, and on the Vercel preview.
- **Migrations are timestamp-named:** `YYYYMMDDHHMMSS_name.sql` (UTC) — use the real current UTC timestamp when you create the file, not a placeholder.
- **Supabase project id for type generation / MCP:** `itxubrkbropttfdackmi`.
- **When verifying a background command's real exit code, never trust a `| tail`'d command's reported exit code** — it's `tail`'s, not the piped command's. Redirect to a file and check the command's own `$?` explicitly (`cmd > out.txt 2>&1; echo "EXIT=$?" >> out.txt`), the way the sibling plan's execution had to correct itself mid-stream.

---

## File Structure

**New files:**

| Path | Responsibility |
|---|---|
| `supabase/migrations/<ts>_dm_edit_unsend_reply.sql` | 3 new `dm_messages` columns + `dm_message_edits` table + RLS |
| `components/messages/MessageBubble.tsx` | one message bubble — edited tag, removed placeholder, reply-quote block, swipe-to-reply (+ desktop hover fallback), edit/unsend menu for your own recent messages |

**Modified files:**

| Path | Change |
|---|---|
| `lib/supabase/types.ts` | regenerated after the migration |
| `lib/messages/predicates.ts` | + `canEditOrUnsend`, `resolveParticipantContent` |
| `lib/messages/predicates.test.ts` | + tests for both |
| `lib/messages/query.ts` | `ConversationMessage`/`ThreadSummary` gain edit/unsend/reply fields; `fetchThread`/`fetchThreadList` resolve them |
| `lib/messages/admin-query.ts` | `DmTranscriptMessage` gains edit/unsend fields + history; transcript ignores `deleted_at` |
| `lib/messages/actions.ts` | `sendMessage` gains `replyToId`; + `editMessage`, `unsendMessage` |
| `components/admin/DmReportRow.tsx` | transcript row shows unsent/edited annotations |
| `components/messages/Conversation.tsx` | realtime widened to `event: '*'` + UPDATE patching; renders `MessageBubble`; owns composer mode (reply/edit) state |
| `components/messages/MessageComposer.tsx` | reply-mode quote banner + edit-mode (prefilled, checkmark) |

**Testing note:** `vitest` covers Task 2 (pure). Query/action/component code is verified by `tsc` + `next lint` + the Task 9 end-to-end run — same norm as the original piece. The swipe gesture has no automated test (no gesture-testing tooling in this project); it's covered by Task 9's manual pass.

---

## Task 1: Schema — edit/unsend/reply columns + audit table + RLS

**Files:**
- Create: `supabase/migrations/<ts>_dm_edit_unsend_reply.sql`

**Interfaces:**
- Produces: `dm_messages.edited_at`, `dm_messages.deleted_at`, `dm_messages.reply_to_id` columns; table `dm_message_edits`; RLS policy `dm_messages_sender_edit_or_unsend`; `Database['public']['Tables']` entries updated in `lib/supabase/types.ts`.

- [x] **Step 1: Write the migration**

Create `supabase/migrations/<ts>_dm_edit_unsend_reply.sql` (real current UTC timestamp):

```sql
-- Edit, unsend, and reply-to for direct messages. Additive only — no
-- existing dm_messages column changes shape or meaning.
--
-- Content is never destroyed. Unsend only flags deleted_at; the participant-
-- facing query layer hides content when it's set, the staff-facing layer
-- (admin-query.ts) ignores it. Editing appends the pre-edit body/image_url to
-- dm_message_edits before overwriting dm_messages, so staff can always see
-- the full history regardless of what participants currently see.

ALTER TABLE public.dm_messages
  ADD COLUMN edited_at   timestamptz,
  ADD COLUMN deleted_at  timestamptz,
  ADD COLUMN reply_to_id uuid REFERENCES public.dm_messages(id) ON DELETE SET NULL;

CREATE INDEX dm_messages_reply_to_idx ON public.dm_messages (reply_to_id) WHERE reply_to_id IS NOT NULL;

-- Staff-only audit trail. No participant-facing SELECT policy — participants
-- only ever see the current (post-edit) body plus an "(edited)" tag, never
-- prior versions.
CREATE TABLE public.dm_message_edits (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id       uuid        NOT NULL REFERENCES public.dm_messages(id) ON DELETE CASCADE,
  body_before      text,
  image_url_before text,
  edited_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dm_message_edits_message_idx ON public.dm_message_edits (message_id, edited_at);

ALTER TABLE public.dm_message_edits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dm_message_edits_staff_read" ON public.dm_message_edits
  FOR SELECT USING (public.is_staff());
-- Writes are service-role only (editMessage action).

-- Sender can edit or unsend their own message, but only within 10 minutes of
-- sending. This is a SECOND permissive UPDATE policy on dm_messages
-- (alongside the existing dm_messages_recipient_mark_read) — Postgres
-- combines multiple permissive policies with OR, and the two never overlap
-- (sender_id = auth.uid() here vs sender_id <> auth.uid() there). RLS gates
-- who/when; the server action alone controls which columns a given UPDATE
-- call sets, same as the existing read-receipt policy.
CREATE POLICY "dm_messages_sender_edit_or_unsend" ON public.dm_messages
  FOR UPDATE USING (
    sender_id = auth.uid() AND created_at > now() - interval '10 minutes'
  )
  WITH CHECK (sender_id = auth.uid());
```

- [x] **Step 2: Apply to production**

Supabase MCP `apply_migration` tool (name `dm_edit_unsend_reply`), or `npx supabase db push` from the primary checkout if the CLI is reachable (memory `project_supabase_connectivity_gotcha` — prefer MCP). If neither is available, stop and ask the user.

- [x] **Step 3: Verify in production**

Run via MCP `execute_sql` (one statement per call — a prior session in this same feature learned the hard way that a multi-statement `execute_sql` call only surfaces the *last* statement's result):

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'dm_messages' AND column_name IN ('edited_at', 'deleted_at', 'reply_to_id')
ORDER BY column_name;
```
Expected: all 3 rows.

```sql
SELECT to_regclass('public.dm_message_edits');
```
Expected: non-null.

```sql
SELECT polname FROM pg_policy
WHERE polrelid = 'public.dm_messages'::regclass AND polname = 'dm_messages_sender_edit_or_unsend';
```
Expected: 1 row.

```sql
SELECT polname FROM pg_policy
WHERE polrelid = 'public.dm_message_edits'::regclass AND polname = 'dm_message_edits_staff_read';
```
Expected: 1 row.

- [x] **Step 4: Regenerate types**

MCP `generate_typescript_types` (project `itxubrkbropttfdackmi`). The result comes back as `{"types": "..."}` — if it's too large for the tool result, it's saved to a file; extract the `types` field's string value and write it verbatim to `lib/supabase/types.ts` (a prior session in this feature did this with a one-off `python -c "json.load(...)['types']"` script when the raw JSON was too large to paste). Confirm:

```bash
grep -c "dm_message_edits:" lib/supabase/types.ts   # expect >= 1
sed -n '/dm_messages: {/,/Relationships:/p' lib/supabase/types.ts | grep -c "edited_at:\|deleted_at:\|reply_to_id:"   # expect >= 6 (3 fields x Row+Insert+Update)
```

- [x] **Step 5: Typecheck**

Run: `npx tsc --noEmit`. **Capture the real exit code — do not pipe through `tail` and trust its exit status.**

```bash
npx tsc --noEmit > /tmp/tsc_task1.txt 2>&1; echo "EXIT=$?" >> /tmp/tsc_task1.txt
cat /tmp/tsc_task1.txt
```
Expected: `EXIT=0`, no error lines above it.

- [x] **Step 6: Commit**

```bash
git add supabase/migrations/ lib/supabase/types.ts
git commit -m "feat(messages): schema for edit, unsend, reply-to

Additive only. Content is never destroyed — unsend flags deleted_at,
editing logs the pre-edit value to dm_message_edits before overwriting.
New sender_edit_or_unsend RLS policy, 10-minute window.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018zQe17sFEE1YWyDS9X2WfV"
```

---

## Task 2: Pure — edit/unsend window + participant content-visibility (TDD)

**Files:**
- Modify: `lib/messages/predicates.ts`
- Modify: `lib/messages/predicates.test.ts`

**Interfaces:**
- Produces:
  - `canEditOrUnsend(createdAtIso: string, nowIso: string): boolean` — true if `now - createdAt <= 10 minutes` (inclusive at exactly 10:00).
  - `type MessageContentInput = { body: string | null; imageUrl: string | null; deletedAt: string | null }`
  - `type ParticipantContent = { body: string | null; imageUrl: string | null; removed: boolean }`
  - `resolveParticipantContent(input: MessageContentInput): ParticipantContent` — blanks `body`/`imageUrl` and sets `removed: true` when `deletedAt` is set; passes through unchanged otherwise. Staff never call this — `admin-query.ts` reads `body`/`image_url` directly.
- Consumed by: `lib/messages/actions.ts` (`canEditOrUnsend`), `lib/messages/query.ts` and `components/messages/Conversation.tsx` (`resolveParticipantContent`).

- [x] **Step 1: Failing test**

Add to the bottom of `lib/messages/predicates.test.ts` (keep the existing three `describe` blocks and their import line — add the two new names to it):

```ts
import { describe, it, expect } from 'vitest'
import { unreadCount, isBlockedBetween, countNewContactsSince, canEditOrUnsend, resolveParticipantContent } from './predicates'
```

```ts
describe('canEditOrUnsend', () => {
  it('is true within the 10-minute window', () => {
    expect(canEditOrUnsend('2026-09-12T12:00:00Z', '2026-09-12T12:09:59Z')).toBe(true)
  })
  it('is true at exactly 10 minutes', () => {
    expect(canEditOrUnsend('2026-09-12T12:00:00Z', '2026-09-12T12:10:00Z')).toBe(true)
  })
  it('is false just past 10 minutes', () => {
    expect(canEditOrUnsend('2026-09-12T12:00:00Z', '2026-09-12T12:10:01Z')).toBe(false)
  })
})

describe('resolveParticipantContent', () => {
  it('hides content once deleted', () => {
    expect(resolveParticipantContent({ body: 'hi', imageUrl: null, deletedAt: '2026-09-12T12:00:00Z' })).toEqual({
      body: null,
      imageUrl: null,
      removed: true,
    })
  })
  it('passes through untouched content when not deleted', () => {
    expect(resolveParticipantContent({ body: 'hi', imageUrl: null, deletedAt: null })).toEqual({
      body: 'hi',
      imageUrl: null,
      removed: false,
    })
  })
})
```

- [x] **Step 2: Run — verify fail** — `npx vitest run lib/messages/predicates.test.ts` → FAIL (`canEditOrUnsend`/`resolveParticipantContent` not exported).

- [x] **Step 3: Implement**

Append to `lib/messages/predicates.ts`:

```ts
// 10-minute "change your mind" window for editing/unsending your own
// message. Enforced here for the UI (disable the controls after 10 min) AND
// server-side in the sender_edit_or_unsend RLS policy — same client/DB
// relationship as isBlockedBetween is to dm_can_message().
export function canEditOrUnsend(createdAtIso: string, nowIso: string): boolean {
  const createdAt = new Date(createdAtIso).getTime()
  const now = new Date(nowIso).getTime()
  return now - createdAt <= 10 * 60 * 1000
}

export type MessageContentInput = { body: string | null; imageUrl: string | null; deletedAt: string | null }
export type ParticipantContent = { body: string | null; imageUrl: string | null; removed: boolean }

// What a PARTICIPANT sees. Staff bypass this entirely — admin-query.ts reads
// body/image_url directly and never calls this.
export function resolveParticipantContent(input: MessageContentInput): ParticipantContent {
  if (input.deletedAt) return { body: null, imageUrl: null, removed: true }
  return { body: input.body, imageUrl: input.imageUrl, removed: false }
}
```

- [x] **Step 4: Run — verify pass** — `npx vitest run lib/messages/predicates.test.ts` → PASS (12: the existing 7 + 5 new — 3 for `canEditOrUnsend`, 2 for `resolveParticipantContent`).

- [x] **Step 5: Commit**

```bash
git add lib/messages/predicates.ts lib/messages/predicates.test.ts
git commit -m "feat(messages): edit/unsend window + participant content-visibility predicates

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018zQe17sFEE1YWyDS9X2WfV"
```

---

## Task 3: Query layer — participant-facing

**Files:**
- Modify: `lib/messages/query.ts`

**Interfaces:**
- Consumes: `resolveParticipantContent` (Task 2).
- Produces: `ConversationMessage` gains `editedAt: string | null`, `deletedAt: string | null`, `replyTo: { id: string; senderName: string; body: string | null; removed: boolean } | null`. `ThreadSummary` gains `lastRemoved: boolean`.
- Consumed by: Task 4 is independent of this; Tasks 6/7 (UI) consume `ConversationMessage`; `ThreadListItem.tsx` (existing) consumes `ThreadSummary`.

- [x] **Step 1: Update the predicates import**

In `lib/messages/query.ts`, change:

```ts
import { unreadCount, isBlockedBetween, type BlockRow } from './predicates'
```

to:

```ts
import { unreadCount, isBlockedBetween, resolveParticipantContent, type BlockRow } from './predicates'
```

- [x] **Step 2: `ThreadSummary` gains `lastRemoved`**

Change:

```ts
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
```

to:

```ts
export type ThreadSummary = {
  threadId: string
  otherId: string
  otherName: string
  otherUsername: string | null
  otherAvatarUrl: string | null
  lastMessage: string | null
  lastWasImage: boolean
  lastRemoved: boolean
  lastMessageAt: string
  unread: number
}
```

- [x] **Step 3: `fetchThreadList` selects `deleted_at` and resolves it**

Change the `dm_messages` select inside `fetchThreadList`:

```ts
    supabase
      .from('dm_messages')
      .select('thread_id, sender_id, body, image_url, created_at, read_at')
      .in('thread_id', threadIds)
      .order('created_at', { ascending: true }),
```

to:

```ts
    supabase
      .from('dm_messages')
      .select('thread_id, sender_id, body, image_url, created_at, read_at, deleted_at')
      .in('thread_id', threadIds)
      .order('created_at', { ascending: true }),
```

Change the `byThread` map's value type:

```ts
  const byThread = new Map<string, { sender_id: string; body: string | null; image_url: string | null; read_at: string | null }[]>()
```

to:

```ts
  const byThread = new Map<string, { sender_id: string; body: string | null; image_url: string | null; read_at: string | null; deleted_at: string | null }[]>()
```

Change the `out.push(...)` block:

```ts
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
```

to:

```ts
    const lastContent = last
      ? resolveParticipantContent({ body: last.body, imageUrl: last.image_url, deletedAt: last.deleted_at })
      : null
    out.push({
      threadId: t.id,
      otherId,
      otherName: other?.display_name ?? other?.username ?? 'Player',
      otherUsername: other?.username ?? null,
      otherAvatarUrl: other?.avatar_url ?? null,
      lastMessage: lastContent?.body ?? null,
      lastWasImage: !!lastContent && lastContent.body == null && lastContent.imageUrl != null,
      lastRemoved: lastContent?.removed ?? false,
      lastMessageAt: t.last_message_at,
      unread: unreadCount(list.map((m) => ({ senderId: m.sender_id, readAt: m.read_at })), viewerId),
    })
```

- [x] **Step 4: `ConversationMessage` gains the new fields**

Change:

```ts
export type ConversationMessage = {
  id: string
  senderId: string
  body: string | null
  imageUrl: string | null
  createdAt: string
  readAt: string | null
}
```

to:

```ts
export type ConversationMessage = {
  id: string
  senderId: string
  body: string | null
  imageUrl: string | null
  createdAt: string
  readAt: string | null
  editedAt: string | null
  deletedAt: string | null
  replyTo: { id: string; senderName: string; body: string | null; removed: boolean } | null
}
```

- [x] **Step 5: `fetchThread` selects the new columns, skips signing deleted images, resolves replies**

Change the `dm_messages` select inside `fetchThread`:

```ts
    supabase
      .from('dm_messages')
      .select('id, sender_id, body, image_url, created_at, read_at')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true }),
```

to:

```ts
    supabase
      .from('dm_messages')
      .select('id, sender_id, body, image_url, created_at, read_at, edited_at, deleted_at, reply_to_id')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true }),
```

Change (don't waste a signed-URL call on an image nobody will see):

```ts
  const rows = messages ?? []
  const signed = await signImages(rows.filter((m) => m.image_url).map((m) => m.image_url as string))
```

to:

```ts
  const rows = messages ?? []
  const signed = await signImages(rows.filter((m) => m.image_url && !m.deleted_at).map((m) => m.image_url as string))
```

Immediately after that line (still before `const blockRows = ...`), add reply-target resolution:

```ts
  const replyIds = Array.from(new Set(rows.filter((m) => m.reply_to_id).map((m) => m.reply_to_id as string)))
  const replyTargets = new Map<string, { sender_id: string; body: string | null; image_url: string | null; deleted_at: string | null }>()
  if (replyIds.length > 0) {
    const { data: targets } = await supabase
      .from('dm_messages')
      .select('id, sender_id, body, image_url, deleted_at')
      .in('id', replyIds)
    for (const t of targets ?? []) replyTargets.set(t.id, t)
  }
  function resolveReply(replyToId: string | null): ConversationMessage['replyTo'] {
    if (!replyToId) return null
    const target = replyTargets.get(replyToId)
    if (!target) return null
    const content = resolveParticipantContent({ body: target.body, imageUrl: target.image_url, deletedAt: target.deleted_at })
    return {
      id: replyToId,
      senderName: target.sender_id === viewerId ? 'You' : (other?.display_name ?? other?.username ?? 'Player'),
      body: content.removed ? null : content.body,
      removed: content.removed,
    }
  }
```

Change the final `messages: rows.map(...)`:

```ts
    messages: rows.map((m) => ({
      id: m.id,
      senderId: m.sender_id,
      body: m.body,
      imageUrl: m.image_url ? (signed.get(m.image_url) ?? null) : null,
      createdAt: m.created_at,
      readAt: m.read_at,
    })),
```

to:

```ts
    messages: rows.map((m) => {
      const content = resolveParticipantContent({ body: m.body, imageUrl: m.image_url, deletedAt: m.deleted_at })
      return {
        id: m.id,
        senderId: m.sender_id,
        body: content.body,
        imageUrl: content.imageUrl ? (signed.get(content.imageUrl) ?? null) : null,
        createdAt: m.created_at,
        readAt: m.read_at,
        editedAt: m.edited_at,
        deletedAt: m.deleted_at,
        replyTo: resolveReply(m.reply_to_id),
      }
    }),
```

- [x] **Step 6: Typecheck + lint**

```bash
npx tsc --noEmit > /tmp/tsc_task3.txt 2>&1; echo "EXIT=$?" >> /tmp/tsc_task3.txt; cat /tmp/tsc_task3.txt
npx next lint --file lib/messages/query.ts > /tmp/lint_task3.txt 2>&1; echo "EXIT=$?" >> /tmp/lint_task3.txt; cat /tmp/lint_task3.txt
```
Expected: both `EXIT=0`. (If `dm_*` columns are `never`-typed, Task 1 Step 4 wasn't completed.)

- [x] **Step 7: Commit**

```bash
git add lib/messages/query.ts
git commit -m "feat(messages): participant-facing edit/unsend/reply resolution in the query layer

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018zQe17sFEE1YWyDS9X2WfV"
```

---

## Task 4: Query layer + admin UI — staff-facing

**Files:**
- Modify: `lib/messages/admin-query.ts`
- Modify: `components/admin/DmReportRow.tsx`

**Interfaces:**
- Produces: `DmTranscriptMessage` gains `editedAt: string | null`, `deletedAt: string | null`, `editHistory: { bodyBefore: string | null; editedAt: string }[]`.
- Consumed by: `DmReportRow.tsx`.

- [x] **Step 1: `MsgRow` and `DmTranscriptMessage` gain the new fields**

Change:

```ts
export type DmTranscriptMessage = {
  id: string
  senderName: string
  body: string | null
  imageUrl: string | null
  createdAt: string
  flagged: boolean
}
```

to:

```ts
export type DmTranscriptMessage = {
  id: string
  senderName: string
  body: string | null
  imageUrl: string | null
  createdAt: string
  flagged: boolean
  editedAt: string | null
  deletedAt: string | null
  editHistory: { bodyBefore: string | null; editedAt: string }[]
}
```

Change:

```ts
type MsgRow = { id: string; thread_id: string; sender_id: string; body: string | null; image_url: string | null; created_at: string }
```

to:

```ts
type MsgRow = { id: string; thread_id: string; sender_id: string; body: string | null; image_url: string | null; created_at: string; edited_at: string | null; deleted_at: string | null }
```

- [x] **Step 2: Select the new columns**

Change the `dm_messages` select inside `fetchDmReports`:

```ts
    supabase
      .from('dm_messages')
      .select('id, thread_id, sender_id, body, image_url, created_at')
      .in('thread_id', threadIds)
      .order('created_at', { ascending: true }),
```

to:

```ts
    supabase
      .from('dm_messages')
      .select('id, thread_id, sender_id, body, image_url, created_at, edited_at, deleted_at')
      .in('thread_id', threadIds)
      .order('created_at', { ascending: true }),
```

(Leave the image-signing step untouched — staff see images even for unsent messages, so nothing there needs a `!deleted_at` filter the way the participant-facing path in Task 3 did.)

- [x] **Step 3: Fetch edit history**

Immediately after the `msgsByThread` map is built (right after its closing `for` loop, before the `// Sign every image path once.` comment), add:

```ts
  const allMsgIds = ((msgs ?? []) as MsgRow[]).map((m) => m.id)
  const { data: edits } =
    allMsgIds.length > 0
      ? await supabase.from('dm_message_edits').select('message_id, body_before, edited_at').in('message_id', allMsgIds).order('edited_at', { ascending: true })
      : { data: [] }
  const editsByMessage = new Map<string, { bodyBefore: string | null; editedAt: string }[]>()
  for (const e of edits ?? []) {
    const list = editsByMessage.get(e.message_id) ?? []
    list.push({ bodyBefore: e.body_before, editedAt: e.edited_at })
    editsByMessage.set(e.message_id, list)
  }
```

- [x] **Step 4: Include the new fields in the transcript output**

Change:

```ts
    transcript: (msgsByThread.get(r.thread_id) ?? []).map((m) => ({
      id: m.id,
      senderName: nameById.get(m.sender_id) ?? 'Player',
      body: m.body,
      imageUrl: m.image_url ? (signed.get(m.image_url) ?? null) : null,
      createdAt: m.created_at,
      flagged: m.id === r.message_id,
    })),
```

to:

```ts
    transcript: (msgsByThread.get(r.thread_id) ?? []).map((m) => ({
      id: m.id,
      senderName: nameById.get(m.sender_id) ?? 'Player',
      body: m.body,
      imageUrl: m.image_url ? (signed.get(m.image_url) ?? null) : null,
      createdAt: m.created_at,
      flagged: m.id === r.message_id,
      editedAt: m.edited_at,
      deletedAt: m.deleted_at,
      editHistory: editsByMessage.get(m.id) ?? [],
    })),
```

- [x] **Step 5: Annotate the admin transcript row**

In `components/admin/DmReportRow.tsx`, change:

```tsx
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
```

to:

```tsx
          {report.transcript.map((m) => (
            <div key={m.id} className={`text-xs ${m.flagged ? 'rounded bg-red-950/50 px-1.5 py-1' : ''}`}>
              <span className="font-bold text-slate-300">{m.senderName}: </span>
              {m.body && <span className="text-slate-200">{m.body}</span>}
              {m.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.imageUrl} alt="" className="mt-1 max-h-40 rounded border border-slate-800" />
              )}
              <span className="ml-2 text-[10px] text-slate-600">{formatDateTime(m.createdAt)}</span>
              {m.deletedAt && (
                <span className="ml-2 rounded bg-amber-900/50 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                  unsent by sender at {formatDateTime(m.deletedAt)}
                </span>
              )}
              {m.editHistory.length > 0 && (
                <div className="mt-0.5 text-[10px] text-slate-500">
                  edited — original: &ldquo;{m.editHistory[0].bodyBefore ?? '(no text)'}&rdquo;
                </div>
              )}
            </div>
          ))}
```

- [x] **Step 6: Typecheck + lint**

```bash
npx tsc --noEmit > /tmp/tsc_task4.txt 2>&1; echo "EXIT=$?" >> /tmp/tsc_task4.txt; cat /tmp/tsc_task4.txt
npx next lint --file lib/messages/admin-query.ts --file components/admin/DmReportRow.tsx > /tmp/lint_task4.txt 2>&1; echo "EXIT=$?" >> /tmp/lint_task4.txt; cat /tmp/lint_task4.txt
```
Expected: both `EXIT=0`.

- [x] **Step 7: Commit**

```bash
git add lib/messages/admin-query.ts components/admin/DmReportRow.tsx
git commit -m "feat(messages): admin transcript shows real content + edit history regardless of unsend

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018zQe17sFEE1YWyDS9X2WfV"
```

---

## Task 5: Server actions — editMessage, unsendMessage, reply support

**Files:**
- Modify: `lib/messages/actions.ts`

**Interfaces:**
- Consumes: `canEditOrUnsend` (Task 2).
- Produces:
  - `sendMessage` gains an optional `replyToId?: string` input field, validated to belong to the same thread before use.
  - `editMessage(input: { messageId: string; body: string }): Promise<{ error?: string }>`
  - `unsendMessage(messageId: string): Promise<{ error?: string }>`
- Consumed by: Task 8 (`MessageComposer.tsx`), Task 6 (`MessageBubble.tsx`).

- [x] **Step 1: Import `canEditOrUnsend`**

Change:

```ts
import { messageBodySchema, reportReasonSchema } from './schema'
```

to:

```ts
import { messageBodySchema, reportReasonSchema } from './schema'
import { canEditOrUnsend } from './predicates'
```

- [x] **Step 2: `sendMessage` gains `replyToId`**

Change the signature:

```ts
export async function sendMessage(input: {
  threadId?: string
  recipientId?: string
  body?: string
  imageUrl?: string
}): Promise<{ threadId?: string; error?: string }> {
```

to:

```ts
export async function sendMessage(input: {
  threadId?: string
  recipientId?: string
  body?: string
  imageUrl?: string
  replyToId?: string
}): Promise<{ threadId?: string; error?: string }> {
```

Change the insert:

```ts
  // Insert via the SESSION client so the RLS sender-insert policy applies (defence
  // in depth) — dm_can_message() re-checks block + mute server-side.
  const { error: insErr } = await supabase
    .from('dm_messages')
    .insert({ thread_id: threadId, sender_id: userId, body, image_url: imageUrl })
```

to:

```ts
  // A reply target must belong to THIS thread — a client could otherwise pass
  // an arbitrary message id from a thread the sender has no business quoting.
  let replyToId: string | null = null
  if (input.replyToId) {
    const { data: target } = await admin
      .from('dm_messages')
      .select('id')
      .eq('id', input.replyToId)
      .eq('thread_id', threadId)
      .maybeSingle()
    replyToId = target?.id ?? null
  }

  // Insert via the SESSION client so the RLS sender-insert policy applies (defence
  // in depth) — dm_can_message() re-checks block + mute server-side.
  const { error: insErr } = await supabase
    .from('dm_messages')
    .insert({ thread_id: threadId, sender_id: userId, body, image_url: imageUrl, reply_to_id: replyToId })
```

- [x] **Step 3: Add `editMessage` and `unsendMessage`**

Append to the end of the file:

```ts
export async function editMessage(input: { messageId: string; body: string }): Promise<{ error?: string }> {
  const { supabase, userId } = await authed()
  if (!userId) return { error: 'Please log in.' }

  const parsed = messageBodySchema.safeParse(input.body)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const admin = createAdminClient()
  const { data: existing } = await admin
    .from('dm_messages')
    .select('id, thread_id, sender_id, body, image_url, created_at')
    .eq('id', input.messageId)
    .maybeSingle()
  if (!existing || existing.sender_id !== userId) return { error: 'Message not found.' }
  if (!canEditOrUnsend(existing.created_at, new Date().toISOString())) {
    return { error: 'This message can only be edited within 10 minutes of sending.' }
  }

  // dm_message_edits has no participant write policy — service-role only.
  const { error: histErr } = await admin.from('dm_message_edits').insert({
    message_id: existing.id,
    body_before: existing.body,
    image_url_before: existing.image_url,
  })
  if (histErr) return { error: 'Could not edit this message. Please try again.' }

  // Session client so the new sender_edit_or_unsend RLS policy applies —
  // defence in depth, same reasoning as sendMessage's insert.
  const { error } = await supabase
    .from('dm_messages')
    .update({ body: parsed.data, edited_at: new Date().toISOString() })
    .eq('id', existing.id)
  if (error) return { error: 'Could not edit this message. Please try again.' }

  revalidatePath(`/messages/${existing.thread_id}`)
  return {}
}

export async function unsendMessage(messageId: string): Promise<{ error?: string }> {
  const { supabase, userId } = await authed()
  if (!userId) return { error: 'Please log in.' }

  const admin = createAdminClient()
  const { data: existing } = await admin
    .from('dm_messages')
    .select('id, thread_id, sender_id, created_at')
    .eq('id', messageId)
    .maybeSingle()
  if (!existing || existing.sender_id !== userId) return { error: 'Message not found.' }
  if (!canEditOrUnsend(existing.created_at, new Date().toISOString())) {
    return { error: 'This message can only be unsent within 10 minutes of sending.' }
  }

  const { error } = await supabase
    .from('dm_messages')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', existing.id)
  if (error) return { error: 'Could not unsend this message. Please try again.' }

  revalidatePath(`/messages/${existing.thread_id}`)
  return {}
}
```

- [x] **Step 4: Typecheck + lint**

```bash
npx tsc --noEmit > /tmp/tsc_task5.txt 2>&1; echo "EXIT=$?" >> /tmp/tsc_task5.txt; cat /tmp/tsc_task5.txt
npx next lint --file lib/messages/actions.ts > /tmp/lint_task5.txt 2>&1; echo "EXIT=$?" >> /tmp/lint_task5.txt; cat /tmp/lint_task5.txt
```
Expected: both `EXIT=0`.

- [x] **Step 5: Commit**

```bash
git add lib/messages/actions.ts
git commit -m "feat(messages): editMessage, unsendMessage actions + reply-to on sendMessage

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018zQe17sFEE1YWyDS9X2WfV"
```

---

## Task 6: `MessageBubble` component

**Files:**
- Create: `components/messages/MessageBubble.tsx`

**Interfaces:**
- Consumes: `type ConversationMessage` (Task 3); `canEditOrUnsend` (Task 2); `unsendMessage` (Task 5); `formatRelativeTime` from `@/lib/format`.
- Produces: `MessageBubble({ m, mine, onReply, onEdit }: { m: ConversationMessage; mine: boolean; onReply: (m: ConversationMessage) => void; onEdit: (m: ConversationMessage) => void })` — renders one bubble: reply-quote block (if `m.replyTo`), body/image or "Message removed", "(edited)" tag, swipe-to-reply (touch) + hover-reveal reply icon (desktop), and — only for `mine` messages still inside the 10-minute window — a small "⋯" menu with Edit/Unsend, matching the interaction pattern already established by `ThreadMenu.tsx`'s overflow menu (outside-click-to-close via a `ref` + `mousedown` listener).
- Consumed by: `Conversation.tsx` (Task 7).

- [x] **Step 1: Write `MessageBubble.tsx`**

```tsx
'use client'
import { useEffect, useRef, useState, useTransition } from 'react'
import { Reply, MoreVertical, Pencil, Trash2 } from 'lucide-react'
import { formatRelativeTime } from '@/lib/format'
import { canEditOrUnsend } from '@/lib/messages/predicates'
import { unsendMessage } from '@/lib/messages/actions'
import type { ConversationMessage } from '@/lib/messages/query'

// Swipe-right reveals a reply icon behind the bubble, matching WhatsApp's
// gesture. Desktop has no swipe — hovering reveals the same icon instead
// (see the `sm:opacity-0 sm:group-hover:opacity-100` pair below). No gesture
// library: a plain touch-delta drag, clamped to a max travel distance, with
// a threshold to trigger reply on release.
const SWIPE_REVEAL_PX = 56
const SWIPE_TRIGGER_PX = 36

export function MessageBubble({
  m,
  mine,
  onReply,
  onEdit,
}: {
  m: ConversationMessage
  mine: boolean
  onReply: (m: ConversationMessage) => void
  onEdit: (m: ConversationMessage) => void
}) {
  const [dragX, setDragX] = useState(0)
  const draggingRef = useRef(false)
  const startXRef = useRef<number | null>(null)

  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  function onTouchStart(e: React.TouchEvent) {
    startXRef.current = e.touches[0].clientX
    draggingRef.current = true
  }
  function onTouchMove(e: React.TouchEvent) {
    if (!draggingRef.current || startXRef.current == null) return
    const dx = e.touches[0].clientX - startXRef.current
    setDragX(Math.max(0, Math.min(dx, SWIPE_REVEAL_PX)))
  }
  function onTouchEnd() {
    draggingRef.current = false
    startXRef.current = null
    if (dragX >= SWIPE_TRIGGER_PX) onReply(m)
    setDragX(0)
  }

  function handleUnsend() {
    setMenuOpen(false)
    if (!window.confirm('Unsend this message? This cannot be undone.')) return
    start(async () => {
      const res = await unsendMessage(m.id)
      if (res.error) setError(res.error)
    })
  }

  const editable = mine && !m.deletedAt && canEditOrUnsend(m.createdAt, new Date().toISOString())
  const removed = !!m.deletedAt

  return (
    <div
      className={`group relative flex ${mine ? 'justify-end' : 'justify-start'}`}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      style={{ transform: dragX ? `translateX(${dragX}px)` : undefined }}
    >
      {/* Reply reveal — visible while dragging (mobile) or on hover (desktop, no swipe). */}
      <button
        type="button"
        onClick={() => onReply(m)}
        aria-label="Reply"
        className={`absolute top-1/2 -translate-y-1/2 ${mine ? '-right-9' : '-left-9'} hidden h-7 w-7 items-center justify-center rounded-full text-sx-gray transition-opacity hover:text-white sm:flex sm:opacity-0 sm:group-hover:opacity-100`}
        style={dragX ? { opacity: dragX / SWIPE_REVEAL_PX } : undefined}
      >
        <Reply className="h-4 w-4" />
      </button>

      <div className={`max-w-[80%] overflow-hidden rounded-2xl text-sm ${mine ? 'bg-sx-purple text-white' : 'bg-sx-surface text-white'}`}>
        {m.replyTo && (
          <div className={`mx-2 mt-2 rounded-lg border-l-2 ${mine ? 'border-white/40 bg-white/10' : 'border-sx-purple bg-black/20'} px-2 py-1 text-xs`}>
            <p className="font-semibold opacity-80">{m.replyTo.senderName}</p>
            <p className="truncate opacity-70">{m.replyTo.removed ? 'Original message was removed' : (m.replyTo.body ?? '📷 Photo')}</p>
          </div>
        )}

        {removed ? (
          <p className="px-3 py-2 italic text-white/50">Message removed</p>
        ) : (
          <>
            {m.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={m.imageUrl} alt="" className="max-h-72 w-full object-cover" />
            )}
            {m.body && <p className="whitespace-pre-wrap break-words px-3 py-2">{m.body}</p>}
          </>
        )}

        <p className={`flex items-center gap-1 px-3 pb-1.5 text-[10px] ${mine ? 'text-white/60' : 'text-sx-gray'} ${m.body || removed ? '' : 'pt-1.5'}`}>
          {formatRelativeTime(m.createdAt)}
          {m.editedAt && !removed && <span>(edited)</span>}
        </p>
      </div>

      {editable && (
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Message options"
            className="flex h-7 w-7 shrink-0 items-center justify-center self-center text-sx-gray opacity-0 transition-opacity hover:text-white group-hover:opacity-100"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-8 z-20 w-36 overflow-hidden rounded-xl border border-sx-border bg-sx-surface py-1 shadow-xl">
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false)
                  onEdit(m)
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-white hover:bg-white/5"
              >
                <Pencil className="h-3.5 w-3.5" /> Edit
              </button>
              <button
                type="button"
                onClick={handleUnsend}
                disabled={pending}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-red-400 hover:bg-white/5"
              >
                <Trash2 className="h-3.5 w-3.5" /> Unsend
              </button>
            </div>
          )}
          {error && <p className="absolute right-0 top-9 z-20 w-40 text-[10px] text-red-400">{error}</p>}
        </div>
      )}
    </div>
  )
}
```

- [x] **Step 2: Typecheck + lint**

```bash
npx tsc --noEmit > /tmp/tsc_task6.txt 2>&1; echo "EXIT=$?" >> /tmp/tsc_task6.txt; cat /tmp/tsc_task6.txt
npx next lint --file components/messages/MessageBubble.tsx > /tmp/lint_task6.txt 2>&1; echo "EXIT=$?" >> /tmp/lint_task6.txt; cat /tmp/lint_task6.txt
```
Expected: both `EXIT=0`.

- [x] **Step 3: Commit**

```bash
git add components/messages/MessageBubble.tsx
git commit -m "feat(messages): MessageBubble — swipe-to-reply, edit/unsend menu, removed/edited states

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018zQe17sFEE1YWyDS9X2WfV"
```

---

## Task 7: `Conversation.tsx` — realtime widen + composer mode

**Files:**
- Modify: `components/messages/Conversation.tsx`

**Interfaces:**
- Consumes: `resolveParticipantContent` (Task 2); `MessageBubble` (Task 6).
- Produces: owns `composerMode: { type: 'reply' | 'edit'; target: ConversationMessage } | null`, passed to `MessageComposer` (Task 8) along with a `clearComposerMode` callback.

- [x] **Step 1: Widen the realtime subscription to `'*'` and handle UPDATE**

Change the import line:

```ts
import { markThreadRead } from '@/lib/messages/actions'
```

to:

```ts
import { markThreadRead } from '@/lib/messages/actions'
import { resolveParticipantContent } from '@/lib/messages/predicates'
```

Change the whole `.on('postgres_changes', { event: 'INSERT', ... }, (payload) => {...})` handler — replace:

```tsx
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'dm_messages', filter: `thread_id=eq.${detail.threadId}` },
          (payload) => {
            const r = payload.new as { id: string; sender_id: string; body: string | null; image_url: string | null; created_at: string; read_at: string | null }
            if (r.image_url) {
              router.refresh()
              if (r.sender_id !== viewerId) void markThreadRead(detail.threadId)
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
```

with:

```tsx
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'dm_messages', filter: `thread_id=eq.${detail.threadId}` },
          (payload) => {
            if (payload.eventType === 'UPDATE') {
              const r = payload.new as { id: string; body: string | null; image_url: string | null; edited_at: string | null; deleted_at: string | null }
              const content = resolveParticipantContent({ body: r.body, imageUrl: r.image_url, deletedAt: r.deleted_at })
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === r.id
                    ? { ...m, body: content.body, imageUrl: content.removed ? null : m.imageUrl, editedAt: r.edited_at, deletedAt: r.deleted_at }
                    : m,
                ),
              )
              return
            }
            // INSERT. An image needs a fresh signed URL and a reply needs its
            // target's content resolved — both are server-only work, so those
            // two cases refresh instead of appending the raw payload.
            const r = payload.new as {
              id: string
              sender_id: string
              body: string | null
              image_url: string | null
              created_at: string
              read_at: string | null
              reply_to_id: string | null
            }
            if (r.image_url || r.reply_to_id) {
              router.refresh()
              if (r.sender_id !== viewerId) void markThreadRead(detail.threadId)
              return
            }
            setMessages((prev) =>
              prev.some((m) => m.id === r.id)
                ? prev
                : [
                    ...prev,
                    {
                      id: r.id,
                      senderId: r.sender_id,
                      body: r.body,
                      imageUrl: null,
                      createdAt: r.created_at,
                      readAt: r.read_at,
                      editedAt: null,
                      deletedAt: null,
                      replyTo: null,
                    },
                  ],
            )
            if (r.sender_id !== viewerId) void markThreadRead(detail.threadId)
          },
        )
```

- [x] **Step 2: Add composer-mode state and use `MessageBubble`**

Change the import line:

```ts
import { MessageComposer } from './MessageComposer'
```

to:

```ts
import { MessageComposer } from './MessageComposer'
import { MessageBubble } from './MessageBubble'
```

(`ConversationMessage` is already imported at the top of this file — reuse it directly, no new type import needed.)

Add state, right after the existing `const [messages, setMessages] = useState<ConversationMessage[]>(detail.messages)` line:

```ts
  const [composerMode, setComposerMode] = useState<{ type: 'reply' | 'edit'; target: ConversationMessage } | null>(null)
```

Change the render's message-mapping block — replace:

```tsx
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
```

with:

```tsx
        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            m={m}
            mine={m.senderId === viewerId}
            onReply={(target) => setComposerMode({ type: 'reply', target })}
            onEdit={(target) => setComposerMode({ type: 'edit', target })}
          />
        ))}
```

(`formatRelativeTime` is now only used inside `MessageBubble.tsx` — remove the now-unused `import { formatRelativeTime } from '@/lib/format'` line from `Conversation.tsx` if lint flags it as unused.)

Change the `<MessageComposer .../>` call:

```tsx
      <MessageComposer threadId={detail.threadId} disabled={disabled} disabledReason={disabledReason} />
```

to:

```tsx
      <MessageComposer
        threadId={detail.threadId}
        disabled={disabled}
        disabledReason={disabledReason}
        mode={composerMode}
        onClearMode={() => setComposerMode(null)}
      />
```

- [x] **Step 3: Typecheck + lint**

```bash
npx tsc --noEmit > /tmp/tsc_task7.txt 2>&1; echo "EXIT=$?" >> /tmp/tsc_task7.txt; cat /tmp/tsc_task7.txt
```
Expected `EXIT=0` — but this task's typecheck will only pass once Task 8 gives `MessageComposer` its new `mode`/`onClearMode` props, since this task's own file references them. **Do Task 7 and Task 8 as one typecheck/commit unit**: complete Task 8's Step 1 (below) before running this verification, then commit both files together here instead of separately. (This is the one place in this plan where two tasks' code must land in the same commit — call it out to whoever reviews.)

```bash
npx next lint --file components/messages/Conversation.tsx --file components/messages/MessageComposer.tsx > /tmp/lint_task7.txt 2>&1; echo "EXIT=$?" >> /tmp/lint_task7.txt; cat /tmp/lint_task7.txt
```
Expected: `EXIT=0`.

- [x] **Step 4: Commit (both files)**

```bash
git add components/messages/Conversation.tsx components/messages/MessageComposer.tsx
git commit -m "feat(messages): realtime widened to edit/unsend/reply; composer gains reply + edit mode

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018zQe17sFEE1YWyDS9X2WfV"
```

---

## Task 8: `MessageComposer.tsx` — reply + edit mode

**Files:**
- Modify: `components/messages/MessageComposer.tsx`

**Interfaces:**
- Consumes: `editMessage` (Task 5); `type ConversationMessage` (Task 3).
- Produces: `MessageComposer` gains `mode: { type: 'reply' | 'edit'; target: ConversationMessage } | null` and `onClearMode: () => void` props. In reply mode, shows a quoted-excerpt banner above the input and sends with `replyToId` set. In edit mode, prefills the input with the target's current body, swaps the send icon for a checkmark, and calls `editMessage` instead of `sendMessage` on submit.

- [x] **Step 1: Write the updated composer**

Replace the entire contents of `components/messages/MessageComposer.tsx` with:

```tsx
'use client'
import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { SendHorizonal, ImagePlus, X, Check } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { resizeImageToMaxWidth } from '@/lib/media/resize-image'
import { sendMessage, editMessage } from '@/lib/messages/actions'
import { messageBodySchema } from '@/lib/messages/schema'
import type { ConversationMessage } from '@/lib/messages/query'

type ComposerMode = { type: 'reply' | 'edit'; target: ConversationMessage } | null

export function MessageComposer({
  threadId,
  disabled,
  disabledReason,
  mode,
  onClearMode,
}: {
  threadId: string
  disabled?: boolean
  disabledReason?: string
  mode: ComposerMode
  onClearMode: () => void
}) {
  const router = useRouter()
  const [body, setBody] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const textRef = useRef<HTMLTextAreaElement>(null)

  // Entering edit mode prefills the current text; entering reply mode leaves
  // whatever the player was already typing untouched.
  useEffect(() => {
    if (mode?.type === 'edit') {
      setBody(mode.target.body ?? '')
      textRef.current?.focus()
    }
  }, [mode])

  if (disabled) {
    return (
      <div className="sticky bottom-0 z-10 border-t border-sx-border bg-sx-surface px-4 py-3 text-center text-xs text-sx-gray">
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

  function cancelMode() {
    onClearMode()
    if (mode?.type === 'edit') setBody('')
  }

  const hasText = messageBodySchema.safeParse(body).success
  const ok = mode?.type === 'edit' ? hasText && !pending : (hasText || file != null) && !pending

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!ok) return
    setError(null)
    const text = body
    const img = file
    const activeMode = mode

    if (activeMode?.type === 'edit') {
      setBody('')
      start(async () => {
        const res = await editMessage({ messageId: activeMode.target.id, body: text })
        if (res.error) {
          setError(res.error)
          setBody(text)
          return
        }
        onClearMode()
        textRef.current?.focus()
      })
      return
    }

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
      const res = await sendMessage({
        threadId,
        body: text || undefined,
        imageUrl,
        replyToId: activeMode?.type === 'reply' ? activeMode.target.id : undefined,
      })
      if (res.error) {
        setError(res.error)
        setBody(text)
        return
      }
      if (activeMode?.type === 'reply') onClearMode()
      router.refresh()
      textRef.current?.focus()
    })
  }

  return (
    <form onSubmit={submit} className="sticky bottom-0 z-10 border-t border-sx-border bg-sx-surface px-3 py-2">
      {error && <p className="mb-1 text-xs text-red-400">{error}</p>}

      {mode && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-sx-border bg-sx-bg px-2 py-1.5 text-xs">
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-sx-purple-text">{mode.type === 'edit' ? 'Editing message' : 'Replying to'}</p>
            {mode.type === 'reply' && <p className="truncate text-sx-gray">{mode.target.body ?? '📷 Photo'}</p>}
          </div>
          <button type="button" onClick={cancelMode} aria-label="Cancel" className="shrink-0 text-sx-gray hover:text-white">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

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
        {mode?.type !== 'edit' && (
          <label className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-sx-gray hover:text-white">
            <ImagePlus className="h-5 w-5" />
            <input type="file" accept="image/*" onChange={pickFile} className="hidden" />
          </label>
        )}
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
          aria-label={mode?.type === 'edit' ? 'Save' : 'Send'}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sx-purple text-white hover:bg-sx-purple-light disabled:opacity-40"
        >
          {mode?.type === 'edit' ? <Check className="h-4 w-4" /> : <SendHorizonal className="h-4 w-4" />}
        </button>
      </div>
    </form>
  )
}
```

- [x] **Step 2: Verify — run this as part of Task 7's Step 3**

This file's typecheck/lint verification is Task 7 Step 3 (they must pass together — see the note there). Do not run a separate verification here.

- [x] **Step 3: Commit — folded into Task 7's Step 4**

Both files land in the single commit made at the end of Task 7.

---

## Task 9: End-to-end verification

**Files:** none — manual run on the Vercel preview (do not `npm run build` locally).

- [x] **Step 1: Push + full unit sweep**

```bash
git push
npx vitest run lib/messages/ > /tmp/vitest_task9.txt 2>&1; echo "EXIT=$?" >> /tmp/vitest_task9.txt; cat /tmp/vitest_task9.txt
```
Expected: `EXIT=0`; `thread-key` (3) + `predicates` (12, up from 7) + `schema` (6) all green. Wait for the Vercel preview READY.

**Steps 2–10 below are intentionally left unchecked.** Ran 21/21 (up from 16 pre-piece): `thread-key`(3) + `predicates`(12) + `schema`(6), plus a clean `npx tsc --noEmit` and `next lint` across every task. The user explicitly chose to skip the manual cross-account/gesture QA pass and merge on that basis (2026-09-12) rather than have it attempted via browser automation or deferred. The realtime UPDATE handling, swipe gesture, and RLS-window enforcement have no automated coverage — this is a known gap, not a verified pass.

- [ ] **Step 2: Edit, within the window** — Account A sends a message → within 10 minutes, taps "⋯" → Edit → composer prefills, banner says "Editing message" → change the text → checkmark → bubble updates in place with "(edited)". Account B (open on the thread) sees it update live, no reload.

- [ ] **Step 3: Edit, past the window** — Send a message, wait past 10 minutes (or manually backdate `created_at` in a test row via `execute_sql` to save time) → the "⋯" menu should no longer appear on that bubble at all (menu is conditional on `editable`).

- [ ] **Step 4: Unsend** — A sends a message → "⋯" → Unsend → confirm → bubble becomes "Message removed" for both A and B, live for B without a reload. Reload B's page → still shows "Message removed" (server-resolved, not just a client patch).

- [ ] **Step 5: Reply — swipe (mobile viewport)** — At 375px, swipe a bubble right past the threshold → composer switches to reply mode with the quoted excerpt shown → send → new message shows the quote block above its own content on both sides.

- [ ] **Step 6: Reply — hover (desktop viewport)** — At a desktop width, hover a bubble → a reply icon appears without needing a swipe → click it → same reply-mode flow as Step 5.

- [ ] **Step 7: Reply to a message that gets unsent** — A replies to one of B's messages → B unsends the original → A's reply bubble's quote block flips to "Original message was removed" live (no reload needed, since the quote came through as part of the realtime UPDATE path... note: the quote text itself is resolved server-side and won't auto-update from a raw UPDATE payload the way the bubble's own content does — confirm what actually happens and, if the quote block goes stale until a reload, that's acceptable per the spec's "no automated test for this, manual-verification norm" — note it, don't treat it as a blocker unless it looks broken rather than just stale).

- [ ] **Step 8: Staff sees the truth** — As the player, edit a message once (so there's exactly one `dm_message_edits` row) and unsend a different one. Report the conversation. Staff → `/admin/messages` → "View thread" → the edited message shows `edited — original: "..."` with the ORIGINAL (pre-edit) text, and the unsent message shows its real content annotated `unsent by sender at ...` rather than being hidden.

- [ ] **Step 9: RLS backs the window server-side** — Past the 10-minute mark, attempt `editMessage`/`unsendMessage` directly (e.g. via the browser console calling the server action, or by checking that the UI's own attempt returns the "can only be edited/unsent within 10 minutes" error) — confirm the error comes back rather than silently succeeding.

- [ ] **Step 10: Mobile (375px)** — Swipe gesture doesn't cause horizontal page scroll or get confused with vertical message-list scrolling. Edit/unsend menu, reply banner, and quote blocks all fit without overflow.

- [x] **Step 11: Tick this plan; update the spec**

Tick every box in this plan and in `docs/superpowers/specs/2026-09-12-dm-edit-unsend-reply-design.md` (add `**Status:** shipped <date>`), following the same pattern the original DM piece used.

- [x] **Step 12: Merge to main**

Per memory `feedback_always_push`: merge `origin/main` in first (resolve `lib/supabase/types.ts` by regenerating from the live schema if it conflicts), re-run `npx vitest run` + `npx tsc --noEmit` (capturing real exit codes, not through `tail`), push the branch, confirm the Vercel preview is green, then fast-forward `main`.
