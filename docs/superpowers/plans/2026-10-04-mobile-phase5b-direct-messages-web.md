# Mobile Phase 5b — Direct messages (web) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Flutter app a complete `/api/mobile/v1` surface for direct messages (reads, writes, receipts, block/report, typing, message requests), and add typing and message requests to the web app, without changing existing web DM behaviour except where the spec says so.

**Architecture:** Move the DM logic out of the Server Actions into `lib/messages/service.ts` (explicit `{supabase, admin, userId}` context). The existing actions become thin wrappers; new `defineEndpoint` handlers call the same functions (conventions §7.1). Reads are API-served with signed media URLs and keyset paging. Message requests are enforced in Postgres (triggers + `dm_can_message`), typing uses a per-thread private Realtime broadcast channel authorised by an RLS policy.

**Tech Stack:** Next.js 14 Route Handlers, Supabase (`@supabase/supabase-js`), zod, vitest, `next-intl`.

**Spec:** `docs/superpowers/specs/2026-10-04-mobile-phase5b-direct-messages-design.md` (read it first; section numbers below refer to it).

## Global Constraints

- All mobile endpoints live under `/api/mobile/v1`, are defined with `defineEndpoint`, appended to `ALL_ENDPOINTS`, have a route file, and ship a regenerated `openapi/mobile-v1.json` (`npm run openapi`).
- Writes that must not double-apply (`sendMessage`, `forwardMessage`) set `idempotent: true`; success envelope `{data}`, errors `{error:{code,message,fields?}}`.
- Caller id comes from `ctx.userId` only, never the body. `ctx.admin` only where the web action already uses the service role.
- Upload-path validation lives at the **client-input boundary only** (`sendClientMessage`), never in `sendMessageCore` (spec 3.4) — forwarding reuses the core with the source row's paths.
- Request gating (spec 3.9) lives in the **database and the core send path**, not at the boundary.
- Existing web user-visible error strings and the `{ error?: string }` action return shape must not change.
- New web UI copy goes in `messages/en.json`, `fr.json`, `pcm.json` under a new top-level key `dmRequests`. (The existing DM UI is hard-coded English and is left as is.)
- Never run a migration or write test data against production (`itxubrkbropttfdackmi`). Staging is `ofxmoxpvwbemfouaowoa`. Migrations reach staging only with the owner's go-ahead per task; production is applied by the owner.
- Work in the worktree `C:\Users\gorok\Videos\sentinelx-p5b-spec`, branch `docs/mobile-phase5b-spec` is for the docs; build on a **new branch** `feat/mobile-5b-dm` created from it. Merge to `main` only after the owner confirms (Checkpoint 1). No PR.
- `npm run test` is a vitest run; type check is `npx tsc --noEmit`; lint is `npm run lint`; also `npm run build` before the checkpoint.
- Commit trailer on every commit: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A forwarded image/voice note into an accepted thread must keep working (path check must not leak into core); and into a **pending** thread it must be rejected by the trigger. (Tasks 3, 10)
2. Two simultaneous sends from the initiator of a pending thread: exactly one succeeds. (Tasks 10, 14)
3. Unsend-then-resend in a pending thread: the second send is rejected (cap counts rows regardless of `deleted_at`). (Tasks 10, 14)
4. A *pending* friend request must not exempt a pair; `dm_is_exempt` must agree with `is_staff()` on who is staff. (Task 10)
5. A pending thread's message must write the bell row but no push, and `markThreadRead`/`markAllDelivered` must stamp no receipts on it. (Task 11)
6. A cursor from one endpoint must not be accepted as a cursor that injects into a PostgREST `.or()` filter. (Task 4)
7. A retried send with the same `Idempotency-Key` returns the original message and sends one push. (Task 6)

---

## File structure

| File | Responsibility |
|---|---|
| `lib/messages/service.ts` (create) | All DM mutations, taking `MessageCtx`. |
| `lib/messages/media-paths.ts` (create) | `isOwnMediaPath` — client-input path rule. |
| `lib/messages/read-service.ts` (create) | Paged thread list, thread header, message page with signed URLs. |
| `lib/messages/actions.ts` (modify) | Thin wrappers over the service; same signatures and return shapes. |
| `lib/messages/actions.characterization.test.ts` (create) | Pins current observable behaviour before the refactor. |
| `lib/mobile-api/history-cursor.ts` (modify) | Add `keysetFilterOn(column, cursor)`. |
| `lib/mobile-api/endpoints/messages-reads.ts` (+test) | Read endpoints. |
| `lib/mobile-api/endpoints/messages-writes.ts` (+test) | Write endpoints. |
| `lib/mobile-api/endpoints/index.ts` (modify) | Register. |
| `app/api/mobile/v1/messages/**/route.ts` (create) | One-line route files. |
| `supabase/migrations/20261005120000_dm_typing_broadcast_policies.sql` | Typing policy. |
| `supabase/migrations/20261005130000_dm_message_requests.sql` | Requests column, `dm_is_exempt`, triggers. |
| `supabase/tests/dm_requests.sql`, `dm_typing_policy.sql` | Staging SQL assertions (run in a rolled-back transaction). |
| `lib/messages/requests.staging.test.ts` | Gated concurrency test (`STAGING_DB_TESTS=1`). |
| `lib/messages/typing.ts`, `components/messages/*` (modify/create) | Web typing + requests UI. |
| `messages/{en,fr,pcm}.json` (modify) | `dmRequests` strings. |

---

## Stage 1 — Core DM API

### Task 1: Characterize the current actions

**Files:**
- Create: `lib/messages/actions.characterization.test.ts`
- Reuse: `lib/notifications/fake-admin.ts` (`fakeAdmin(resolve)` — records chained calls as `[method,args]`, resolves per `Op`)

**Interfaces:**
- Produces: a green test suite that pins send/forward/edit/unsend/read/block/report behaviour. Tasks 3–4 must keep it green.

- [ ] **Step 1: Create the branch**

```bash
cd C:\Users\gorok\Videos\sentinelx-p5b-spec
git checkout -b feat/mobile-5b-dm
```

- [ ] **Step 2: Write the characterization tests**

```ts
// lib/messages/actions.characterization.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeAdmin, type Op } from '@/lib/notifications/fake-admin'

const { notifyBoth } = vi.hoisted(() => ({ notifyBoth: vi.fn() }))
vi.mock('@/lib/notifications/send', () => ({ notifyBoth }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

let sessionUser: string | null = 'u1'
let sessionFake = fakeAdmin()
let adminFake = fakeAdmin()
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: sessionUser ? { id: sessionUser } : null } }) },
    from: (t: string) => (sessionFake.admin as { from: (t: string) => unknown }).from(t),
  }),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => adminFake.admin }))

import { sendMessage, forwardMessage, editMessage, unsendMessage, markThreadRead, blockUser, reportConversation } from './actions'

const T = 'thread-1'
const thread = { player_a: 'u1', player_b: 'u2' }

function adminResolver(over: Record<string, unknown> = {}) {
  return (op: Op) => {
    if (op.table in over) return { data: over[op.table] }
    if (op.table === 'dm_threads') return { data: thread }
    if (op.table === 'profiles') return { data: { display_name: 'Me', username: 'me' } }
    return { data: null }
  }
}

beforeEach(() => {
  sessionUser = 'u1'
  notifyBoth.mockReset()
  sessionFake = fakeAdmin((op) => (op.table === 'dm_messages' ? { data: { id: 'm-new' } } : { data: null }))
  adminFake = fakeAdmin(adminResolver())
})

describe('sendMessage (current behaviour)', () => {
  it('requires login', async () => {
    sessionUser = null
    expect(await sendMessage({ threadId: T, body: 'hi' })).toEqual({ error: 'Please log in.' })
  })
  it('rejects an empty message', async () => {
    expect(await sendMessage({ threadId: T })).toEqual({ error: 'Type a message, add a photo, or send a sticker.' })
  })
  it('rejects a thread the caller is not in', async () => {
    adminFake = fakeAdmin(adminResolver({ dm_threads: { player_a: 'x', player_b: 'y' } }))
    expect(await sendMessage({ threadId: T, body: 'hi' })).toEqual({ error: 'Conversation not found.' })
  })
  it('explains a block the caller placed', async () => {
    adminFake = fakeAdmin(adminResolver({ dm_blocks: [{ blocker_id: 'u1' }] }))
    expect(await sendMessage({ threadId: T, body: 'hi' })).toEqual({ error: 'Unblock this player to message them.' })
  })
  it('uses the neutral wording when the OTHER player blocked', async () => {
    adminFake = fakeAdmin(adminResolver({ dm_blocks: [{ blocker_id: 'u2' }] }))
    expect(await sendMessage({ threadId: T, body: 'hi' })).toEqual({ error: 'You can no longer message this player.' })
  })
  it('inserts via the session client, bumps the thread, notifies once', async () => {
    const res = await sendMessage({ threadId: T, body: 'hello there' })
    expect(res).toEqual({ threadId: T, messageId: 'm-new' })
    expect(sessionFake.calls.some((c) => c.table === 'dm_messages' && c.ops.some(([m]) => m === 'single'))).toBe(true)
    expect(adminFake.calls.some((c) => c.table === 'dm_threads' && c.ops.some(([m]) => m === 'update' || m === 'eq'))).toBe(true)
    expect(notifyBoth).toHaveBeenCalledTimes(1)
    expect(notifyBoth.mock.calls[0][0]).toBe('u2')
    expect(notifyBoth.mock.calls[0][1]).toMatchObject({ type: 'direct_message', kind: 'text', excerpt: 'hello there' })
    expect(notifyBoth.mock.calls[0][3]).toEqual({ link: `/messages/${T}` })
  })
})

describe('forwardMessage (current behaviour)', () => {
  it('copies the SOURCE row paths into the target thread and flags forwarded', async () => {
    adminFake = fakeAdmin((op) => {
      if (op.table === 'dm_messages')
        return { data: { thread_id: 'src', body: null, image_url: 'u2/pic.jpg', sticker_id: null, audio_url: null, audio_duration_seconds: null, deleted_at: null } }
      if (op.table === 'dm_threads') return { data: thread }
      return { data: null }
    })
    const res = await forwardMessage({ messageId: 'm1', toThreadId: T })
    expect(res).toEqual({})
    const insert = sessionFake.calls.find((c) => c.table === 'dm_messages')
    expect(JSON.stringify(insert?.ops)).toContain('u2/pic.jpg')
    expect(JSON.stringify(insert?.ops)).toContain('"forwarded":true')
  })
  it('refuses an unsent message', async () => {
    adminFake = fakeAdmin((op) =>
      op.table === 'dm_messages' ? { data: { thread_id: 'src', deleted_at: '2026-10-01T00:00:00Z' } } : { data: null },
    )
    expect(await forwardMessage({ messageId: 'm1', toThreadId: T })).toEqual({ error: 'This message can no longer be forwarded.' })
  })
})

describe('edit / unsend windows', () => {
  const recent = new Date().toISOString()
  const old = new Date(Date.now() - 11 * 60 * 1000).toISOString()
  const row = (created_at: string) => (op: Op) =>
    op.table === 'dm_messages' ? { data: { id: 'm1', thread_id: T, sender_id: 'u1', body: 'x', image_url: null, created_at } } : { data: null }
  it('edit inside the window writes history then updates', async () => {
    adminFake = fakeAdmin(row(recent))
    expect(await editMessage({ messageId: 'm1', body: 'new' })).toEqual({})
    expect(adminFake.calls.some((c) => c.table === 'dm_message_edits')).toBe(true)
  })
  it('edit outside the window is refused', async () => {
    adminFake = fakeAdmin(row(old))
    expect(await editMessage({ messageId: 'm1', body: 'new' })).toEqual({
      error: 'This message can only be edited within 10 minutes of sending.',
    })
  })
  it('unsend outside the window is refused', async () => {
    adminFake = fakeAdmin(row(old))
    expect(await unsendMessage('m1')).toEqual({ error: 'This message can only be unsent within 10 minutes of sending.' })
  })
  it('only the sender may edit', async () => {
    adminFake = fakeAdmin((op) => (op.table === 'dm_messages' ? { data: { id: 'm1', thread_id: T, sender_id: 'u2', created_at: recent } } : { data: null }))
    expect(await editMessage({ messageId: 'm1', body: 'new' })).toEqual({ error: 'Message not found.' })
  })
})

describe('read / block / report', () => {
  it('markThreadRead stamps read+delivered and clears the matching bell rows', async () => {
    await markThreadRead(T)
    const upd = sessionFake.calls.find((c) => c.table === 'dm_messages')
    expect(JSON.stringify(upd?.ops)).toContain('read_at')
    const bell = adminFake.calls.find((c) => c.table === 'player_notifications')
    expect(JSON.stringify(bell?.ops)).toContain(`/messages/${T}`)
  })
  it('blockUser severs follows in both directions with the admin client', async () => {
    expect(await blockUser('u2')).toEqual({})
    const del = adminFake.calls.find((c) => c.table === 'player_follows')
    expect(JSON.stringify(del?.ops)).toContain('follower_id.eq.u1')
    expect(JSON.stringify(del?.ops)).toContain('follower_id.eq.u2')
  })
  it('cannot block yourself', async () => {
    expect(await blockUser('u1')).toEqual({ error: 'You cannot block yourself.' })
  })
  it('report resolves the reported player from the thread', async () => {
    expect(await reportConversation({ threadId: T, reason: 'spam' })).toEqual({})
    const ins = sessionFake.calls.find((c) => c.table === 'dm_reports')
    expect(JSON.stringify(ins?.ops)).toContain('"reported_id":"u2"')
  })
  it('report needs a reason', async () => {
    expect(await reportConversation({ threadId: T, reason: '   ' })).toEqual({ error: 'Add a reason so staff can act on it' })
  })
})
```

- [ ] **Step 3: Run**

Run: `npx vitest run lib/messages/actions.characterization.test.ts`
Expected: PASS against the *current* actions. If a case fails because the fake's recorded shape differs (e.g. insert payload appears under a different op name), adjust the **assertion** to match what the current code does — this suite documents current behaviour, so never change `actions.ts` in this task.

- [ ] **Step 4: Commit**

```bash
git add lib/messages/actions.characterization.test.ts
git commit -m "test(messages): characterize current DM actions before the service extraction

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Extract `lib/messages/service.ts`

**Files:**
- Create: `lib/messages/service.ts`
- Modify: `lib/messages/actions.ts`
- Test: `lib/messages/actions.characterization.test.ts` (must stay green, unchanged)

**Interfaces:**
- Produces:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import type { createAdminClient } from '@/lib/supabase/admin'

export interface MessageCtx {
  supabase: SupabaseClient<Database> // RLS-scoped as the caller
  admin: ReturnType<typeof createAdminClient>
  userId: string
}
export type MessageErrorCode =
  | 'not_found' | 'validation' | 'blocked_by_me' | 'blocked' | 'messaging_restricted'
  | 'edit_window_closed' | 'not_forwardable' | 'send_failed' | 'action_failed'
export type Failure = { ok: false; errorCode: MessageErrorCode; message: string }
export type SendInput = {
  threadId?: string; recipientId?: string; body?: string; imageUrl?: string; replyToId?: string
  stickerId?: string; audioUrl?: string; audioDurationSeconds?: number; forwarded?: boolean
}
export function sendMessageCore(ctx: MessageCtx, input: SendInput): Promise<{ ok: true; threadId: string; messageId: string } | Failure>
export function startConversation(ctx: MessageCtx, otherId: string): Promise<{ ok: true; threadId: string } | Failure>
export function markAllDelivered(ctx: MessageCtx): Promise<void>
export function markThreadRead(ctx: MessageCtx, threadId: string): Promise<void>
export function blockPlayer(ctx: MessageCtx, otherId: string): Promise<{ ok: true } | Failure>
export function unblockPlayer(ctx: MessageCtx, otherId: string): Promise<{ ok: true } | Failure>
export function reportThread(ctx: MessageCtx, i: { threadId: string; messageId?: string; reason: string }): Promise<{ ok: true } | Failure>
export function editMessageCore(ctx: MessageCtx, i: { messageId: string; body: string }): Promise<{ ok: true } | Failure>
export function unsendMessageCore(ctx: MessageCtx, messageId: string): Promise<{ ok: true } | Failure>
export function forwardMessageCore(ctx: MessageCtx, i: { messageId: string; toThreadId: string }): Promise<{ ok: true; messageId: string } | Failure>
```

Each failure carries the **exact string** the action returns today in `message`.

- [ ] **Step 1: Move the logic.** Copy each function body from `lib/messages/actions.ts` into `service.ts`, replacing `authed()` with the passed `ctx`, `return { error: X }` with `return fail('<code>', X)` where `fail = (errorCode, message): Failure => ({ ok: false, errorCode, message })`, and removing `revalidatePath` calls (they stay in the action wrappers). `sendMessageCore` keeps `notifyBoth(...)` unchanged. `forwardMessageCore` calls `sendMessageCore` (not any client-input wrapper). Code mapping: no thread / not participant / not the sender → `not_found`; `muted` → `messaging_restricted`; block I placed → `blocked_by_me`; other block → `blocked`; validation messages → `validation`; window closed → `edit_window_closed`; unsent forward → `not_forwardable`; insert failure → `send_failed`; other DB failures → `action_failed`.

- [ ] **Step 2: Rewrite the actions as wrappers**

```ts
// lib/messages/actions.ts (shape — every exported signature and return shape is unchanged)
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import * as service from './service'

async function authed() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user ? ({ supabase, admin: createAdminClient(), userId: user.id } satisfies service.MessageCtx) : null
}

export async function sendMessage(input: service.SendInput) {
  const ctx = await authed()
  if (!ctx) return { error: 'Please log in.' }
  const res = await service.sendMessageCore(ctx, input) // Task 4 swaps this for sendClientMessage
  if (!res.ok) return { error: res.message }
  revalidatePath('/messages')
  revalidatePath(`/messages/${res.threadId}`)
  return { threadId: res.threadId, messageId: res.messageId }
}
```

Write the remaining wrappers the same way (`startConversation`, `markAllThreadsDelivered`, `markThreadRead`, `blockUser`, `unblockUser`, `reportConversation`, `editMessage`, `unsendMessage`, `forwardMessage`), each: authed → `Please log in.` or service call → map `!ok` to `{ error: message }` → `revalidatePath` exactly where the old code did.

- [ ] **Step 3: Run**

Run: `npx vitest run lib/messages && npx tsc --noEmit`
Expected: all characterization tests PASS unchanged; type check clean.

- [ ] **Step 4: Commit** — `refactor(messages): move DM logic into lib/messages/service.ts; actions become wrappers`

---

### Task 3: Client-input media-path validation (spec 3.4)

**Files:**
- Create: `lib/messages/media-paths.ts`, `lib/messages/media-paths.test.ts`
- Modify: `lib/messages/service.ts` (add `sendClientMessage`), `lib/messages/actions.ts` (`sendMessage` wrapper uses it)
- Test: `lib/messages/service.send-client.test.ts`

**Interfaces:**
- Produces:

```ts
// media-paths.ts
export function isOwnMediaPath(path: string, userId: string): boolean
// service.ts
export function sendClientMessage(ctx: MessageCtx, input: SendInput): Promise<{ ok: true; threadId: string; messageId: string } | Failure>
```
`Failure.errorCode` gains no new value: a bad path is `validation` with message `'Invalid attachment.'`.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/messages/media-paths.test.ts
import { describe, it, expect } from 'vitest'
import { isOwnMediaPath } from './media-paths'

const U = '11111111-1111-4111-8111-111111111111'
const V = '22222222-2222-4222-8222-222222222222'

describe('isOwnMediaPath', () => {
  it('accepts <userId>/<file>', () => expect(isOwnMediaPath(`${U}/a1.jpg`, U)).toBe(true))
  it('rejects another user folder', () => expect(isOwnMediaPath(`${V}/a1.jpg`, U)).toBe(false))
  it('rejects traversal', () => {
    expect(isOwnMediaPath(`${U}/../${V}/a.jpg`, U)).toBe(false)
    expect(isOwnMediaPath(`${U}//a.jpg`, U)).toBe(false)
  })
  it('rejects a full URL, a bare file and an empty string', () => {
    expect(isOwnMediaPath(`https://x.test/${U}/a.jpg`, U)).toBe(false)
    expect(isOwnMediaPath('a.jpg', U)).toBe(false)
    expect(isOwnMediaPath('', U)).toBe(false)
  })
})
```

```ts
// lib/messages/service.send-client.test.ts
import { describe, it, expect, vi } from 'vitest'
import { fakeAdmin, type Op } from '@/lib/notifications/fake-admin'
vi.mock('@/lib/notifications/send', () => ({ notifyBoth: vi.fn() }))
import { sendClientMessage, forwardMessageCore } from './service'

const U = '11111111-1111-4111-8111-111111111111'
const V = '22222222-2222-4222-8222-222222222222'
const thread = { player_a: U, player_b: V }

function ctx(over: (op: Op) => unknown = () => null) {
  const session = fakeAdmin((op) => (op.table === 'dm_messages' ? { data: { id: 'm-new' } } : { data: null }))
  const admin = fakeAdmin((op) => {
    const o = over(op)
    if (o) return { data: o }
    if (op.table === 'dm_threads') return { data: thread }
    if (op.table === 'profiles') return { data: { display_name: 'A', username: 'a' } }
    return { data: null }
  })
  return { c: { supabase: session.admin, admin: admin.admin, userId: U } as never, session, admin }
}

describe('sendClientMessage path rule', () => {
  it('rejects an image path from another user', async () => {
    const { c, session } = ctx()
    const res = await sendClientMessage(c, { threadId: 't', imageUrl: `${V}/secret.jpg` })
    expect(res).toMatchObject({ ok: false, errorCode: 'validation', message: 'Invalid attachment.' })
    expect(session.calls.some((x) => x.table === 'dm_messages')).toBe(false)
  })
  it('rejects an audio path from another user', async () => {
    const { c } = ctx()
    const res = await sendClientMessage(c, { threadId: 't', audioUrl: `${V}/v.m4a`, audioDurationSeconds: 5 })
    expect(res).toMatchObject({ ok: false, errorCode: 'validation' })
  })
  it('accepts the caller own folder', async () => {
    const { c } = ctx()
    expect(await sendClientMessage(c, { threadId: 't', imageUrl: `${U}/ok.jpg` })).toMatchObject({ ok: true })
  })
})

describe('forwarding is NOT subject to the path rule (regression guard)', () => {
  it('forwards a received image whose path is in the ORIGINAL sender folder', async () => {
    const { c } = ctx((op) =>
      op.table === 'dm_messages'
        ? { thread_id: 'src', body: null, image_url: `${V}/received.jpg`, sticker_id: null, audio_url: null, audio_duration_seconds: null, deleted_at: null }
        : null,
    )
    expect(await forwardMessageCore(c, { messageId: 'm1', toThreadId: 't' })).toMatchObject({ ok: true })
  })
})
```

- [ ] **Step 2: Run to confirm failure** — `npx vitest run lib/messages/media-paths.test.ts lib/messages/service.send-client.test.ts` → FAIL (modules / export missing).

- [ ] **Step 3: Implement**

```ts
// lib/messages/media-paths.ts
// Storage paths for DM media are "<uploaderId>/<file>". Only a path the CALLER uploaded may arrive from
// client input. Forwarding is the one legitimate caller of the core send with someone else's path, and it
// does not go through this check (it reads the path from the database row after a participant check).
const SEGMENT = /^[A-Za-z0-9._-]+$/
export function isOwnMediaPath(path: string, userId: string): boolean {
  const parts = path.split('/')
  if (parts.length !== 2) return false
  const [folder, file] = parts
  return folder === userId && SEGMENT.test(file) && file !== '.' && file !== '..'
}
```

```ts
// service.ts — add
import { isOwnMediaPath } from './media-paths'
export async function sendClientMessage(ctx: MessageCtx, input: SendInput) {
  if (input.imageUrl && !isOwnMediaPath(input.imageUrl.trim(), ctx.userId)) return fail('validation', 'Invalid attachment.')
  if (input.audioUrl && !isOwnMediaPath(input.audioUrl.trim(), ctx.userId)) return fail('validation', 'Invalid attachment.')
  return sendMessageCore(ctx, { ...input, forwarded: false }) // a client can never claim "forwarded"
}
```

In `actions.ts`, change the `sendMessage` wrapper to call `service.sendClientMessage`.

- [ ] **Step 4: Run** — `npx vitest run lib/messages && npx tsc --noEmit` → PASS (characterization suite still green; its image test used `forwardMessage`, not `sendMessage`).

- [ ] **Step 5: Commit** — `fix(messages): only accept the caller's own media paths from client input`

---

### Task 4: Read service — paged thread list, thread header, message page

**Files:**
- Create: `lib/messages/read-service.ts`, `lib/messages/read-service.test.ts`
- Modify: `lib/mobile-api/history-cursor.ts`, `lib/mobile-api/history-cursor.test.ts`

**Interfaces:**
- Consumes: `MessageCtx`, `resolveParticipantContent`, `isBlockedBetween`, `unreadCount`, `stickerById`.
- Produces:

```ts
// history-cursor.ts
export function keysetFilterOn(column: string, c: { t: string; id: string }): string // column must match /^[a-z_]+$/
// read-service.ts
export const THREAD_PAGE_SIZE = 20
export const MESSAGE_PAGE_SIZE = 40
export type ThreadPreview = { kind: 'text' | 'image' | 'sticker' | 'voice' | 'removed' | 'none'; text: string | null; stickerId: string | null }
export type ThreadItem = {
  threadId: string
  other: { id: string; name: string; username: string | null; avatarUrl: string | null }
  preview: ThreadPreview
  lastMessageAt: string
  unread: number
}
export function listThreads(ctx: MessageCtx, opts: { cursor?: string }): Promise<{ threads: ThreadItem[]; nextCursor: string | null }>
export type ThreadHeader = { threadId: string; other: ThreadItem['other']; blockedByMe: boolean; blockedByThem: boolean }
export function getThreadHeader(ctx: MessageCtx, threadId: string): Promise<ThreadHeader | null>
export type MessageItem = { id: string; senderId: string; body: string | null; imageUrl: string | null; stickerId: string | null; audioUrl: string | null; audioDurationSeconds: number | null; forwarded: boolean; createdAt: string; deliveredAt: string | null; readAt: string | null; editedAt: string | null; deletedAt: string | null; replyTo: { id: string; senderName: string; body: string | null; removed: boolean } | null }
export function listMessages(ctx: MessageCtx, threadId: string, opts: { before?: string }): Promise<{ messages: MessageItem[]; nextBefore: string | null } | null>
```

Paging rule: threads ordered `(last_message_at desc, id desc)`, messages `(created_at desc, id desc)`; fetch `size + 1` rows, the extra only signals another page (reuse `encodeCursor`/`decodeCursor`; map `last_message_at` into the cursor's `created_at` slot). Per-thread last message and unread count are fetched per thread in parallel (page size ≤ 20, both indexed; see spec §7 open item).

- [ ] **Step 1: Write failing tests** covering: `keysetFilterOn` rejects a column with a quote/space (`"created_at\""`) and produces `last_message_at.lt."…"`; `listThreads` hides a blocked thread, orders by `last_message_at`, returns `nextCursor` only when more than 20 exist, reports `preview.kind==='removed'` for an unsent last message and `'voice'` for an audio one, counts unread as `read_at IS NULL AND sender<>me`; `listThreads` rejects a malformed cursor with `ApiError(400,'invalid_cursor')`; `getThreadHeader` returns `null` when the caller is not a participant and sets `blockedByMe`/`blockedByThem`; `listMessages` returns newest-first, redacts content of unsent messages, signs `image_url`/`audio_url` via `ctx.admin.storage.from(bucket).createSignedUrl(path, 3600)` and returns `null` signed URL when signing fails, and resolves `replyTo`. Use `fakeAdmin` for tables and add an `admin.storage` stub to the ctx in the test:

```ts
const storage = { from: (_b: string) => ({ createSignedUrl: async (p: string) => ({ data: { signedUrl: `https://signed/${p}` } }) }) }
const ctx = { supabase: sess.admin, admin: Object.assign(adm.admin, { storage }), userId: 'u1' } as never
```

- [ ] **Step 2: Run to confirm failure** — `npx vitest run lib/messages/read-service.test.ts lib/mobile-api/history-cursor.test.ts`.

- [ ] **Step 3: Implement.** `keysetFilterOn`:

```ts
export function keysetFilterOn(column: string, c: { t: string; id: string }): string {
  if (!/^[a-z_]+$/.test(column)) throw new Error('invalid keyset column')
  return `${column}.lt."${c.t}",and(${column}.eq."${c.t}",id.lt.${c.id})`
}
```

`read-service.ts` implements the three functions per the interface; reuse `signPaths` logic from `lib/messages/query.ts` (copy the 10-line helper — do not export `query.ts`' internals) and `resolveParticipantContent` for redaction. Profile reads use `ctx.admin` limited to `id, username, display_name, avatar_url` of the *other* participants only.

- [ ] **Step 4: Run** — same command → PASS; `npx tsc --noEmit`.

- [ ] **Step 5: Commit** — `feat(messages): paged read service with signed media`

---

### Task 5: Read endpoints

**Files:**
- Create: `lib/mobile-api/endpoints/messages-reads.ts`, `…/messages-reads.test.ts`, route files `app/api/mobile/v1/messages/threads/route.ts`, `…/threads/[id]/route.ts`, `…/threads/[id]/messages/route.ts`
- Modify: `lib/mobile-api/endpoints/index.ts`, `openapi/mobile-v1.json` (regenerated)

**Interfaces:**
- Produces: `getMessageThreadsEndpoint` (`GET /messages/threads`, operationId `getMessageThreads`), `getMessageThreadEndpoint` (`GET /messages/threads/{id}`, `getMessageThread`), `getThreadMessagesEndpoint` (`GET /messages/threads/{id}/messages`, `getThreadMessages`).

- [ ] **Step 1: Failing test** (follow `community-reads.test.ts`'s style: mock `../auth`, call `endpoint.handler(new Request(url), { params: { id: 't1' } })`):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
const { authenticate } = vi.hoisted(() => ({ authenticate: vi.fn() }))
vi.mock('../auth', () => ({ authenticate, optionalAuth: vi.fn() }))
const rs = vi.hoisted(() => ({ listThreads: vi.fn(), getThreadHeader: vi.fn(), listMessages: vi.fn() }))
vi.mock('@/lib/messages/read-service', () => rs)
import { getMessageThreadsEndpoint, getMessageThreadEndpoint, getThreadMessagesEndpoint } from './messages-reads'

const ctx = { userId: 'u1', admin: 'a', userClient: 's' }
beforeEach(() => { authenticate.mockResolvedValue(ctx); Object.values(rs).forEach((f) => f.mockReset()) })

describe('messages reads', () => {
  it('lists threads and forwards the cursor', async () => {
    rs.listThreads.mockResolvedValue({ threads: [], nextCursor: null })
    const res = await getMessageThreadsEndpoint.handler(new Request('https://x.test/api/mobile/v1/messages/threads?cursor=abc'), { params: {} })
    expect(res.status).toBe(200)
    expect(rs.listThreads).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1' }), { cursor: 'abc' })
  })
  it('404s a thread the caller is not in', async () => {
    rs.getThreadHeader.mockResolvedValue(null)
    const res = await getMessageThreadEndpoint.handler(new Request('https://x.test/x'), { params: { id: 't1' } })
    expect(res.status).toBe(404)
  })
  it('404s messages for a thread the caller is not in', async () => {
    rs.listMessages.mockResolvedValue(null)
    const res = await getThreadMessagesEndpoint.handler(new Request('https://x.test/x'), { params: { id: 't1' } })
    expect(res.status).toBe(404)
  })
  it('requires auth', async () => {
    authenticate.mockRejectedValue(Object.assign(new Error('x'), { status: 401 }))
    const res = await getMessageThreadsEndpoint.handler(new Request('https://x.test/x'), { params: {} })
    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})
```

- [ ] **Step 2: Run to confirm failure** — `npx vitest run lib/mobile-api/endpoints/messages-reads.test.ts`.

- [ ] **Step 3: Implement.** Response schemas mirror the types in Task 4 (zod, every nullable field `.nullable()`); `listThreads`'s `ApiError('invalid_cursor')` propagates. `ctx` → `MessageCtx` is `{ supabase: ctx.userClient, admin: ctx.admin, userId: ctx.userId }`; put that mapping in one helper `toMessageCtx(ctx)` exported from `messages-reads.ts` for reuse in Task 7. Query parameters (`cursor`, `limit` not exposed — page sizes are fixed) declared via `parameters`. Register the three endpoints in `ALL_ENDPOINTS`; one-line route files:

```ts
// app/api/mobile/v1/messages/threads/route.ts
import { getMessageThreadsEndpoint } from '@/lib/mobile-api/endpoints/messages-reads'
export const GET = getMessageThreadsEndpoint.handler
```
(the `[id]` files export the matching endpoint's `GET`, taking `(req, ctx)` through `.handler`).

- [ ] **Step 4: Regenerate and run** — `npm run openapi && npx vitest run lib/mobile-api && npx tsc --noEmit` → PASS (`route-files.test.ts` proves the route files exist).

- [ ] **Step 5: Commit** — `feat(mobile-api): DM read endpoints`

---

### Task 6: Write endpoints (core set)

**Files:**
- Create: `lib/mobile-api/endpoints/messages-writes.ts`, `…/messages-writes.test.ts`, route files for `POST /messages/threads`, `POST /messages/threads/{id}/messages`, `PATCH`+`DELETE /messages/{id}`, `POST /messages/{id}/forward`, `POST /messages/threads/{id}/read`, `POST /messages/delivered`, `PUT`+`DELETE /messages/blocks/{playerId}`, `POST /messages/threads/{id}/report`
- Modify: `lib/mobile-api/endpoints/index.ts`, `openapi/mobile-v1.json`

**Interfaces:**
- Consumes: `toMessageCtx` (Task 5), service functions (Task 2/3).
- Produces: operationIds `startMessageThread`, `sendMessage`, `editMessage`, `unsendMessage`, `forwardMessage`, `markThreadRead`, `markAllDelivered`, `blockPlayer`, `unblockPlayer`, `reportThread`. Status mapping:

```ts
const STATUS: Record<MessageErrorCode, number> = {
  not_found: 404, validation: 400, blocked_by_me: 403, blocked: 403, messaging_restricted: 403,
  edit_window_closed: 409, not_forwardable: 409, send_failed: 500, action_failed: 500,
}
function throwFailure(f: Failure): never { throw new ApiError(STATUS[f.errorCode], f.errorCode, f.message) }
```

- [ ] **Step 1: Failing tests**, one `describe` per endpoint, mocking `@/lib/messages/service`. Mandatory cases: `sendMessage` returns `{messageId, createdAt}`; a body with another user's `imageUrl` path is forwarded to `sendClientMessage` (and the endpoint's body field is named `imagePath`, mapped to `imageUrl`); **missing `Idempotency-Key` → 400 `idempotency_key_required`** for send and forward; **replay with the same key** (use the real `runIdempotent` mocked as in `community-writes.test.ts`, then a second call with a mock returning the stored outcome) invokes the service once; `editMessage` window failure → 409 `edit_window_closed`; block failure codes map to 403; `markThreadRead`/`markAllDelivered` always 200 even if the service throws (best-effort — they catch and return `{ok:true}`); `blockPlayer` with own id → 400.

- [ ] **Step 2: Run to confirm failure.**

- [ ] **Step 3: Implement.** Bodies (zod):

```ts
const sendBody = z.object({
  body: z.string().max(2000).optional(),
  imagePath: z.string().max(300).optional(),
  stickerId: z.string().max(40).optional(),
  audioPath: z.string().max(300).optional(),
  audioDurationSeconds: z.number().int().positive().max(130).optional(),
  replyToId: z.string().uuid().optional(),
})
```
Handler: `sendClientMessage(toMessageCtx(ctx), { threadId: params.id, body, imageUrl: imagePath, audioUrl: audioPath, audioDurationSeconds, stickerId, replyToId })`. `createdAt` is read back by the service (`select('id, created_at')` in `sendMessageCore`; extend its return to `{ messageId, createdAt }` and update Task 1 expectations only if the characterization test deep-equals the result — it equals the **action** wrapper output, which still returns `{threadId, messageId}`). Response `{ messageId: z.string(), createdAt: z.string() }`. `startMessageThread` body `{ recipientId: uuid }` → `{ threadId }`. Other responses `z.object({ ok: z.literal(true) })`.

- [ ] **Step 4: Run** — `npm run openapi && npx vitest run lib/mobile-api lib/messages && npx tsc --noEmit` → PASS.

- [ ] **Step 5: Commit** — `feat(mobile-api): DM write endpoints (idempotent send/forward)`

---

### Task 7: DM push carries `threadId`

**Files:**
- Modify: `lib/messages/service.ts` (the `notifyBoth` call), `lib/notifications/send.ts` only if `data` cannot be extended
- Test: `lib/messages/service.push.test.ts`

**Interfaces:**
- Produces: DM push `data` = `{ url: '/messages/<id>', type: 'direct_message', threadId: '<id>' }` (`type` is added by `pushToPlayer`).

`notifyBoth(playerId, input, inAppType, opts)` builds `data` as `{ url }` only. Add an optional `opts.data?: Record<string,string>` merged into `pushToPlayer`'s data.

- [ ] **Step 1: Failing tests** — `send.test`-style: `notifyBoth(..., { link: '/messages/t1', data: { threadId: 't1' } })` calls `pushToPlayer` with `{ url: '/messages/t1', threadId: 't1' }`; and a service-level test that `sendMessageCore` passes `data: { threadId }`. Existing `fcm`/`push` tests must still pass (web payload byte-for-byte unchanged for every other type).

- [ ] **Step 2: Run to confirm failure.**

- [ ] **Step 3: Implement** in `send.ts`:

```ts
export function notifyBoth(playerId, input, inAppType, opts: { link?: string; url?: string; postId?: string | null; data?: Record<string, string> } = {}) {
  const url = opts.url ?? opts.link
  return Promise.all([
    notifyInAppOf(playerId, input, inAppType, opts.link),
    pushToPlayer(playerId, input, { ...(url ? { url } : {}), ...(opts.data ?? {}) }, { postId: opts.postId }),
  ]).then(() => undefined)
}
```
and in `sendMessageCore`: `{ link: \`/messages/${threadId}\`, data: { threadId } }`. Update the Task 1 characterization expectation `notifyBoth.mock.calls[0][3]` to `{ link, data: { threadId: T } }` (the one intentional behaviour change).

- [ ] **Step 4: Run** — `npx vitest run lib/notifications lib/messages` → PASS.

- [ ] **Step 5: Commit** — `feat(messages): include threadId in DM push data`

---

### Task 8: Typing — policy migration

**Files:**
- Create: `supabase/migrations/20261005120000_dm_typing_broadcast_policies.sql`, `supabase/tests/dm_typing_policy.sql`

- [ ] **Step 1: Migration**

```sql
-- Typing indicator over a PER-THREAD private Realtime broadcast channel `dm-typing:<threadId>`.
-- Deliberately not carried in the site-wide `dm-online` presence channel (everyone online can read it),
-- which would publish who is messaging whom. Only the two participants may join or send.
create policy "dm_typing_participants_read" on "realtime"."messages"
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() like 'dm-typing:%'
    and exists (
      select 1 from public.dm_threads t
      where t.id::text = substring(realtime.topic() from 11)
        and auth.uid() in (t.player_a, t.player_b)
    )
  );

create policy "dm_typing_participants_send" on "realtime"."messages"
  for insert to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() like 'dm-typing:%'
    and exists (
      select 1 from public.dm_threads t
      where t.id::text = substring(realtime.topic() from 11)
        and auth.uid() in (t.player_a, t.player_b)
    )
  );
```
(`'dm-typing:'` is 10 characters, so the id starts at position 11.)

- [ ] **Step 2: SQL assertions** `supabase/tests/dm_typing_policy.sql` — a single `DO $$ … $$` block that (as the postgres role) creates two throwaway players + a thread, sets `request.jwt.claims` / `set local role authenticated` for each case, and asserts via `has_policy`-style checks that (a) a participant sees `dm-typing:<thread>` messages, (b) a non-participant does not, (c) a malformed topic matches nothing; it ends with `raise exception 'ALL_PASSED_ROLLBACK'` so nothing persists. Header comment documents "expected output: `ALL_PASSED_ROLLBACK`".

- [ ] **Step 3: STOP — owner checkpoint.** Ask the owner to confirm applying to **staging** (`ofxmoxpvwbemfouaowoa`). On yes, apply the migration with the Supabase MCP `apply_migration`, then run the SQL test with `execute_sql` and confirm the sentinel. Do not touch production.

- [ ] **Step 4: Commit** — `feat(db): participant-only policies for the DM typing broadcast channel`

---

### Task 9: Typing — web client

**Files:**
- Create: `lib/messages/typing.ts`, `lib/messages/typing.test.ts`
- Modify: `components/messages/Conversation.tsx`, `components/messages/MessageComposer.tsx`

**Interfaces:**
- Produces:

```ts
export const TYPING_SEND_INTERVAL_MS = 3000
export const TYPING_EXPIRE_MS = 5000
export function createTypingSender(now: () => number, send: () => void): { notifyKeystroke(): void }
export function createTypingTracker(now: () => number): { onEvent(userId: string): void; isTyping(userId: string): boolean }
export function typingTopic(threadId: string): string // `dm-typing:${threadId}`
```

- [ ] **Step 1: Failing tests**

```ts
import { describe, it, expect, vi } from 'vitest'
import { createTypingSender, createTypingTracker, typingTopic } from './typing'

describe('typing', () => {
  it('names the per-thread topic', () => expect(typingTopic('t1')).toBe('dm-typing:t1'))
  it('sends at most once per 3s while keys keep coming', () => {
    let t = 0
    const send = vi.fn()
    const s = createTypingSender(() => t, send)
    s.notifyKeystroke(); t = 1000; s.notifyKeystroke(); t = 2999; s.notifyKeystroke()
    expect(send).toHaveBeenCalledTimes(1)
    t = 3000; s.notifyKeystroke()
    expect(send).toHaveBeenCalledTimes(2)
  })
  it('shows typing for 5s after the last event, then not', () => {
    let t = 0
    const tr = createTypingTracker(() => t)
    expect(tr.isTyping('u2')).toBe(false)
    tr.onEvent('u2'); t = 4999
    expect(tr.isTyping('u2')).toBe(true)
    t = 5001
    expect(tr.isTyping('u2')).toBe(false)
  })
  it('tracks users independently', () => {
    let t = 0
    const tr = createTypingTracker(() => t)
    tr.onEvent('u2')
    expect(tr.isTyping('u3')).toBe(false)
  })
})
```

- [ ] **Step 2: Run to confirm failure.**

- [ ] **Step 3: Implement** `typing.ts`:

```ts
export const TYPING_SEND_INTERVAL_MS = 3000
export const TYPING_EXPIRE_MS = 5000
export const typingTopic = (threadId: string) => `dm-typing:${threadId}`

export function createTypingSender(now: () => number, send: () => void) {
  let last = -Infinity
  return {
    notifyKeystroke() {
      const t = now()
      if (t - last >= TYPING_SEND_INTERVAL_MS) { last = t; send() }
    },
  }
}

export function createTypingTracker(now: () => number) {
  const seen = new Map<string, number>()
  return {
    onEvent(userId: string) { seen.set(userId, now()) },
    isTyping(userId: string) {
      const t = seen.get(userId)
      return t !== undefined && now() - t < TYPING_EXPIRE_MS
    },
  }
}
```

Wire-up in `Conversation.tsx`: a `useEffect` that creates `supabase.channel(typingTopic(detail.threadId), { config: { private: true, broadcast: { self: false } } })`, `.on('broadcast', { event: 'typing' }, ({ payload }) => tracker.onEvent(payload.userId))`, `.subscribe()`, removes the channel on cleanup, and re-renders a "typing…" label under the header with a 1 s interval while a tracker entry is live. Expose `sendTyping()` (channel `.send({ type: 'broadcast', event: 'typing', payload: { userId: viewerId } })`) to `MessageComposer` via a new optional prop `onTyping?: () => void`, called from the textarea `onChange` (`MessageComposer.tsx:383`) through `createTypingSender(Date.now, onTyping)`. Typing is skipped when the thread is blocked or (Task 12) pending-and-outgoing.

- [ ] **Step 4: Run** — `npx vitest run lib/messages/typing.test.ts && npx tsc --noEmit && npm run lint` → PASS.

- [ ] **Step 5: Commit** — `feat(messages): typing indicator over per-thread private broadcast`

---

## Stage 2 — Message requests (own stage; spec 3.9)

### Task 10: Requests migration

**Files:**
- Create: `supabase/migrations/20261005130000_dm_message_requests.sql`, `supabase/tests/dm_requests.sql`
- Modify: `lib/supabase/types.ts` (add `request_state` to `dm_threads` Row/Insert/Update)

- [ ] **Step 1: Migration**

```sql
-- Message requests. A new thread starts 'pending' unless the sender is staff or an accepted friend.
-- Existing threads are grandfathered by the column default.
alter table public.dm_threads
  add column request_state text not null default 'accepted'
  check (request_state in ('pending', 'accepted', 'declined'));

create or replace function public.dm_pending_message_cap() returns int language sql immutable as $$ select 1 $$;

-- ONE definition of "does not need a request". Staff is decided from the sender's role (not auth.uid()), because
-- triggers must not depend on the session. Must agree with public.is_staff() — tested in supabase/tests/dm_requests.sql.
create or replace function public.dm_is_exempt(p_sender uuid, p_other uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    exists (select 1 from public.user_roles r where r.user_id = p_sender and r.role in ('admin', 'moderator'))
    or exists (
      select 1 from public.friends f
      where f.status = 'accepted'
        and ((f.requester_id = p_sender and f.recipient_id = p_other)
          or (f.requester_id = p_other and f.recipient_id = p_sender))
    );
$$;

-- dm_can_message now also refuses the initiator of a DECLINED thread (same outcome as a block, by design).
create or replace function public.dm_can_message(p_thread uuid, p_sender uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.dm_threads t
    where t.id = p_thread
      and p_sender in (t.player_a, t.player_b)
      and not exists (select 1 from public.dm_muted_players m where m.player_id = p_sender)
      and not exists (
        select 1 from public.dm_blocks b
        where (b.blocker_id = t.player_a and b.blocked_id = t.player_b)
           or (b.blocker_id = t.player_b and b.blocked_id = t.player_a)
      )
      and not (t.request_state = 'declined' and p_sender = t.created_by)
  );
$$;

-- BEFORE INSERT: lock the thread row so two parallel sends cannot both pass the cap, then enforce the gate.
create or replace function public.dm_enforce_request_gate() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t public.dm_threads%rowtype;
  sent int;
begin
  select * into t from public.dm_threads where id = new.thread_id for update;
  if t.id is null or t.request_state <> 'pending' or new.sender_id <> t.created_by then
    return new;
  end if;
  if new.image_url is not null or new.sticker_id is not null or new.audio_url is not null then
    raise exception 'request_media_not_allowed' using errcode = 'P0001';
  end if;
  -- counts rows regardless of deleted_at: unsend-then-resend must not bypass the cap
  select count(*) into sent from public.dm_messages where thread_id = new.thread_id and sender_id = t.created_by;
  if sent >= public.dm_pending_message_cap() then
    raise exception 'request_pending_limit' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger dm_messages_request_gate before insert on public.dm_messages
  for each row execute function public.dm_enforce_request_gate();

-- AFTER INSERT: any message from the other participant accepts the thread (also reopens a declined one).
create or replace function public.dm_accept_on_reply() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.dm_threads set request_state = 'accepted'
  where id = new.thread_id and request_state <> 'accepted' and created_by <> new.sender_id;
  return new;
end $$;

create trigger dm_messages_accept_on_reply after insert on public.dm_messages
  for each row execute function public.dm_accept_on_reply();
```

- [ ] **Step 2: SQL test** `supabase/tests/dm_requests.sql` — one `DO` block (sentinel `ALL_PASSED_ROLLBACK`) creating throwaway profiles for: stranger A, stranger B, friend pair (accepted), pending-friend pair, a follower pair, an admin and a moderator. Assertions: (1) first text from a stranger initiator on a `pending` thread succeeds, a second raises `request_pending_limit`; (2) an image/sticker/voice insert raises `request_media_not_allowed`; (3) **send, then set `deleted_at`, then send again → second raises `request_pending_limit`**; (4) a message from the other participant flips `request_state` to `accepted`; (5) a `declined` thread: initiator's insert is refused by `dm_can_message` (RLS path) while the recipient's insert reopens it to `accepted`; (6) `dm_is_exempt` true for accepted friends, **false for a pending friend request**, false for a mere follower, true when the sender is admin/moderator; (7) for every `role` value present in `user_roles` data (`admin`, `moderator`, plain player) `dm_is_exempt(sender, stranger)`'s staff branch equals `is_staff()` evaluated with that user as `auth.uid()` (set via `set_config('request.jwt.claim.sub', …, true)`); (8) an existing thread row keeps `accepted` (default). Header documents the expected sentinel.

- [ ] **Step 3: STOP — owner checkpoint** to apply to staging, same as Task 8. Apply with `apply_migration`, run the test with `execute_sql`, confirm the sentinel. Then regenerate/patch `lib/supabase/types.ts` (`generate_typescript_types` for staging, or hand-add `request_state: string` to `dm_threads` Row/Insert(optional)/Update(optional)) and run `npx tsc --noEmit`.

- [ ] **Step 4: Commit** — `feat(db): DM message requests with database-enforced gate`

---

### Task 11: Service — request logic

**Files:**
- Modify: `lib/messages/service.ts`, `lib/messages/read-service.ts`, `lib/messages/actions.ts`
- Test: `lib/messages/service.requests.test.ts`

**Interfaces:**
- Produces (additions):

```ts
export type RequestState = 'pending' | 'accepted' | 'declined'
// MessageErrorCode gains: 'request_pending_limit' | 'request_media_not_allowed'
export function startConversation(ctx, otherId): Promise<{ ok: true; threadId: string; requestState: RequestState } | Failure>
export function acceptRequest(ctx, threadId): Promise<{ ok: true } | Failure>   // non-creator only; idempotent
export function declineRequest(ctx, threadId): Promise<{ ok: true } | Failure>  // non-creator only; only while pending; idempotent
// read-service
listThreads(ctx, { cursor?, box: 'inbox' | 'requests' }): Promise<{ threads: ThreadItem[]; nextCursor: string | null; requestCount: number }>
ThreadItem  += { requestState: RequestState; direction: 'incoming' | 'outgoing' | null }
ThreadHeader += { requestState: RequestState; direction: 'incoming' | 'outgoing' | null }
```

Semantics: `direction` is `outgoing` when `created_by === me` and state is `pending`, `incoming` when `created_by !== me` and `pending`, else `null`. `inbox` = accepted threads + my own outgoing-pending; `requests` = incoming pending; declined threads are excluded for the recipient and shown to the initiator as ordinary (they stay an accepted-looking outgoing thread; sends fail with the block wording). `requestCount` = number of incoming pending (not blocked).

- [ ] **Step 1: Failing tests** (service with `fakeAdmin`; exemption is evaluated through `ctx.admin.rpc('dm_is_exempt', { p_sender, p_other })` — add `rpc` result support to the test via `fakeAdmin(resolve, { data: true })`): new thread created with `request_state:'accepted'` when exempt and `'pending'` otherwise; the Postgres errors map: `error.message` containing `request_pending_limit` → `Failure{errorCode:'request_pending_limit', message:'Wait for a reply before sending more.'}`, `request_media_not_allowed` → `'Only text can be sent until they accept.'` (the **database** raises these; the service only translates); decline for the initiator is refused with the block wording/code `blocked`; `acceptRequest` by the creator → `not_found`; accept/decline twice is ok; **push suppression:** when the thread was `pending` and sender is `created_by`, `sendMessageCore` writes the bell row but does not push (assert `notifyInApp`-only path — see Step 3); `markThreadRead` on a pending incoming thread clears bell rows but issues **no** `read_at`/`delivered_at` update; `markAllDelivered` skips messages of pending threads; `listThreads` honours `box` and `requestCount`.

- [ ] **Step 2: Run to confirm failure.**

- [ ] **Step 3: Implement.** In `resolveOrCreateThread`, after the get-or-create miss, decide state: `const { data: exempt } = await ctx.admin.rpc('dm_is_exempt', { p_sender: viewerId, p_other: otherId })`; insert with `request_state: exempt ? 'accepted' : 'pending'`. In the send path, load `request_state, created_by` with the participant check; after a successful insert, `const suppressPush = t.request_state === 'pending' && t.created_by === ctx.userId`; if `suppressPush` call `notifyInAppOf(otherId, input, 'direct_message', link)` (from `lib/notifications/inbox`) instead of `notifyBoth`. Translate insert errors:

```ts
const msg = insErr.message ?? ''
if (msg.includes('request_pending_limit')) return fail('request_pending_limit', 'Wait for a reply before sending more.')
if (msg.includes('request_media_not_allowed')) return fail('request_media_not_allowed', 'Only text can be sent until they accept.')
```
For a declined thread the RLS refusal (insert rejected by `dm_can_message`) maps to `fail('blocked', 'You can no longer message this player.')` — the service pre-checks `request_state === 'declined' && created_by === me` before inserting, and the RLS failure remains the backstop. `acceptRequest`/`declineRequest` update `dm_threads.request_state` through `ctx.admin` after verifying `created_by <> ctx.userId` and participation (decline: `.eq('request_state','pending')`). `markThreadRead`: load the thread; if `request_state === 'pending'` and `created_by !== me`, only clear the bell rows. `markAllDelivered`: add `.in('thread_id', <ids of my threads that are not pending-incoming>)` — fetch those ids first via `ctx.admin`.

- [ ] **Step 4: Run** — `npx vitest run lib/messages && npx tsc --noEmit` → PASS (characterization still green: its threads default to accepted because the fake returns no `request_state`; treat a missing value as `'accepted'` in code: `t.request_state ?? 'accepted'`).

- [ ] **Step 5: Commit** — `feat(messages): request state, accept/decline, push and receipt rules`

---

### Task 12: Request endpoints and contract

**Files:**
- Modify: `lib/mobile-api/endpoints/messages-reads.ts`, `messages-writes.ts`, both tests, `lib/mobile-api/endpoints/index.ts`, `openapi/mobile-v1.json`
- Create: route files `app/api/mobile/v1/messages/threads/[id]/accept/route.ts`, `…/decline/route.ts`

**Interfaces:**
- Produces: `acceptMessageRequest` (`POST /messages/threads/{id}/accept`), `declineMessageRequest` (`POST /messages/threads/{id}/decline`); `getMessageThreads` gains query `box` (`inbox` default | `requests`) and response `requestCount`; `startMessageThread` returns `requestState`; `STATUS` gains `request_pending_limit: 409, request_media_not_allowed: 400`.

- [ ] **Step 1: Failing tests:** `box=requests` forwarded; bad `box` → 400 `validation_failed`; accept/decline 200 and 404 for the creator; send maps the two new codes to 409/400 with the exact messages from Task 11; `startMessageThread` returns `requestState`.
- [ ] **Step 2: Run to confirm failure.**
- [ ] **Step 3: Implement** (zod `z.enum(['inbox','requests']).default('inbox')` read from the query string; extend response schemas).
- [ ] **Step 4: Run** — `npm run openapi && npx vitest run lib/mobile-api lib/messages && npx tsc --noEmit` → PASS.
- [ ] **Step 5: Commit** — `feat(mobile-api): message request endpoints and box listing`

---

### Task 13: Web requests UI

**Files:**
- Modify: `app/[locale]/messages/page.tsx`, `app/[locale]/messages/[threadId]/page.tsx`, `components/messages/Conversation.tsx`, `lib/messages/query.ts` (`ThreadSummary`/`ThreadDetail` gain `requestState`, `direction`), `lib/messages/actions.ts` (+ `acceptMessageRequest`, `declineMessageRequest` wrappers), `messages/en.json`, `fr.json`, `pcm.json`
- Create: `components/messages/RequestBanner.tsx`, `components/messages/RequestBanner.test.tsx` (skip if the repo has no component-test setup — then cover via the server-side `box` filtering test in `query.test.ts`)

**Interfaces:**
- Consumes: `service.acceptRequest/declineRequest`, `ThreadSummary.requestState/direction`.
- Strings (en; fr and pcm must have identical keys): 

```json
"dmRequests": {
  "requestsTab": "Requests",
  "requestsCount": "{count, plural, one {# request} other {# requests}}",
  "requestsEmpty": "No message requests.",
  "incomingTitle": "{name} wants to message you",
  "incomingHint": "You can read this without them seeing it. They'll only see a read receipt once you accept.",
  "accept": "Accept",
  "decline": "Decline",
  "blockAndReport": "Block and report",
  "waiting": "Waiting for {name} to accept",
  "waitingHint": "You can send one text message until they accept."
}
```

- [ ] **Step 1:** Add the keys to the three message files (fr/pcm translations written in full; pcm follows the existing pcm register in that file) and extend `lib/messages/query.ts` so `fetchThreadList`/`fetchThread` read `request_state, created_by` and expose `requestState`, `direction`; hide declined threads from the recipient and split inbox/requests (reuse the same rules as Task 11 — a failing test in `lib/messages/query.test.ts` first, using a Supabase fake, asserting an incoming-pending thread lands in `requests` and not in the main list).
- [ ] **Step 2:** `messages/page.tsx`: render a "Requests (n)" link/section above the list when `requests.length > 0`; `[threadId]/page.tsx`: when `direction==='incoming'` render `RequestBanner` (preview-only: messages shown, composer replaced by Accept / Decline / Block-and-report buttons that call the new actions then `router.refresh()`); when `direction==='outgoing'` pass `disabledReason={t('waiting', {name})}` to the composer once one message exists, and restrict the composer's attach/sticker/voice buttons (hide them) while pending.
- [ ] **Step 3: Verify** — `npx vitest run && npx tsc --noEmit && npm run lint`; verify locale key parity with the existing messages-parity test if one exists (`grep -rn "pcm.json" lib/**/*.test.ts`), otherwise add a small test that `Object.keys(dmRequests)` is identical in en/fr/pcm.
- [ ] **Step 4: Commit** — `feat(messages): requests inbox, request view and waiting state on web`

---

### Task 14: Staging integration test, full verification, handoff

**Files:**
- Create: `lib/messages/requests.staging.test.ts`, `docs/agent-handoffs/2026-10-0X-phase5b-stage-b-web-handoff.md`

- [ ] **Step 1: Gated concurrency test.** Skipped unless `STAGING_DB_TESTS=1` and the env points at staging (assert the URL contains `ofxmoxpvwbemfouaowoa` and **not** `itxubrkbropttfdackmi`, else throw). Using the staging service key: create two users via `admin.auth.admin.createUser` with `user_metadata.username` `zzqa_dm_a` / `zzqa_dm_b`, sign each in with password to get user clients, create a pending thread through `service.startConversation`, then `Promise.allSettled` two `sendMessageCore` calls from the initiator with different bodies and `expect` exactly one `fulfilled` and one rejected/failed with `request_pending_limit`. Also: unsend-then-send rejected; reply flips to `accepted`; forwarding an image into the pending thread fails with `request_media_not_allowed`. `afterAll`: call `anonymise_account` for both users (CLAUDE.md convention) and log them in `TESTING-NOTES.md`'s equivalent on the web side if one exists.
- [ ] **Step 2: Run it** with the owner's staging env vars: `STAGING_DB_TESTS=1 npx vitest run lib/messages/requests.staging.test.ts` → PASS.
- [ ] **Step 3: Full verification:** `npx tsc --noEmit && npm run lint && npm run test && npm run build` — all green. `git diff origin/main -- openapi/mobile-v1.json` shows only the new operations.
- [ ] **Step 4: Handoff note** listing: verified facts (test counts, staging SQL sentinels), recommendations, what is **not** verified (live realtime typing on two clients, production migration application, web UI in a browser against staging), rulings applied, and the exact production rollout order (apply both migrations, then deploy web, together).
- [ ] **Step 5: Fresh-context review** of the whole branch, fix findings, re-run Step 3. Then **Checkpoint 1**: report to the owner and wait; on confirmation merge to web `main` and push (no PR), confirm the staging preview picks it up.

---

## Self-review (against the spec)

- **Spec 3.1/3.3 reads and endpoints:** Tasks 4–6, 12. **3.2 service layer:** Task 2 (+ characterization Task 1). **3.4 path rule + forward regression:** Task 3. **3.5 uploads:** no web change (direct upload exists); mobile-side only. **3.6 typing:** Tasks 8–9. **3.7 push `threadId`:** Task 7. **3.9 requests:** Tasks 10–13 incl. every listed test (race and unsend-resend in Tasks 10 and 14, friend `accepted` and staff agreement in Task 10 step 2). **3.8 mobile:** out of scope for this web plan (Stage C/D).
- **Placeholders:** none intended; Task 4 and Task 12 give interfaces and the exact assertions instead of full test bodies where the body is mechanical repetition of the shown pattern — implementers must write each listed assertion as a real test.
- **Type consistency:** `MessageCtx`, `Failure`, `MessageErrorCode`, `SendInput`, `toMessageCtx`, `ThreadItem`, `ThreadHeader`, `RequestState` are defined once (Tasks 2, 4, 5, 11) and reused with the same names.
- **Known gaps to resolve while executing:** (1) per-thread last-message/unread queries in Task 4 are N≤20 parallel calls — measure in Task 14 and, if slow, replace with an RPC in a follow-up; (2) the `user_roles.role` literal values (`admin`, `moderator`) are taken from `lib/mobile-api/auth.ts`; confirm against `is_staff()` in Task 10 step 2 (that is exactly what check (7) proves).
