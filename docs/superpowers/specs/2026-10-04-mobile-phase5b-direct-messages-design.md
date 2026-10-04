# Mobile Phase 5b — Direct messages (design)

Status: **draft for owner review (Checkpoint 0)**. No plan and no code until approved.
Mobile master spec §8.10 is the product source; this spec is the web-side contract and the
mobile design. Ground truth below was read from `origin/main` on 2026-10-04.

## 1. Goal and scope

Full-parity direct messages in the Flutter app: inbox, conversation, text / photo / voice note /
sticker, reply, edit and unsend (10-minute window), forward, delivered/read receipts, online dot,
**typing indicator**, block, report, start-from-profile, DM push and tap routing.

Owner decisions (2026-10-04): web parity in one phase, **plus typing, plus message requests**
(both new on web and mobile; the web has neither today). Out of scope: per-thread mute (the web
has none), guide/chatbot (5c), any new notification type. Requests are their own stage in the
plan, built after core DM works (section 3.9), so a delay there does not hold up the rest.

## 2. Ground truth (web, `origin/main`)

| Fact | Where |
|---|---|
| Thread identity is the ordered pair (`player_a < player_b`, unique). Created only service-role. | `20260909204325_direct_messages.sql`, `lib/messages/thread-key.ts`, `actions.ts` |
| `dm_can_message(thread, sender)` = sender is a participant AND not staff-muted AND no block in either direction. **No requests concept exists today**; the master spec's "Requests rules via `dm_can_message`" line describes nothing implemented. 5b adds it (3.9). | migration, `actions.ts` |
| `dm_messages` columns: body (≤2000), image_url, sticker_id, audio_url (+`audio_duration_seconds`, >0), forwarded, reply_to_id, edited_at, deleted_at, read_at, delivered_at. At least one of body/image/sticker/audio. | migrations 0909, 0912, 0913 |
| RLS: participant read; sender insert via `dm_can_message`; recipient may update any column of messages they did not send (read/delivered); sender may update own message only within 10 min (edit/unsend). | migrations |
| Edit writes the old body to `dm_message_edits` (service-role only) before updating. Unsend sets `deleted_at`; participants see no content, staff always can. | `actions.ts`, `resolveParticipantContent` |
| Images/audio live in private buckets `dm-images` / `dm-audio`; DB stores the **path**; reads are server-signed (1 h). Storage insert RLS: first path segment must equal `auth.uid()`. | `query.ts`, migrations |
| `sendMessage` stores the client-supplied `imageUrl`/`audioUrl` as-is. **No prefix or bucket check.** | `actions.ts` |
| `forwardMessage` calls `sendMessage` with the **source row's** paths (the original sender's folder) after checking the forwarder is in the source thread. | `actions.ts` |
| Thread list and thread view load **every** message of every/the thread, unpaged. | `query.ts` |
| Blocked threads are hidden from the list. Block also deletes follows in both directions. | `query.ts`, `blockUser` |
| Realtime: `postgres_changes` on `dm_messages` (list channel unfiltered, thread channel filtered by `thread_id`); `player_notifications` insert for the bell; **one site-wide presence channel `dm-online`**, every online player visible to every other. | `Conversation.tsx`, `MessagesRealtime.tsx`, `PresenceProvider.tsx`, `MessagesBell.tsx` |
| **No typing indicator exists on web.** | grep of `components/messages` |
| DM push is sent by `notifyBoth(otherId, {type:'direct_message', fromName, kind, excerpt?, emoji?}, 'direct_message', {link:'/messages/<id>'})`. Data payload today: `{url, type}`. Pref/mute key `direct_message`; mute silences push only; Android channel `messages_v1`. | `send.ts`, `push.ts`, 5a spec §3.3–3.4 |
| `markThreadRead` stamps read+delivered on the thread and sets matching `player_notifications` (`type=direct_message`, `link=/messages/<id>`) read. | `actions.ts` |
| Sticker pack is a fixed 14-emoji whitelist validated server-side. | `lib/messages/stickers.ts` |
| Mobile messages bell counts unread `player_notifications` of type `direct_message` (one row per message), same signal as the web bell. Correct as long as the read endpoint clears them. | mobile `unread_counts.dart`, web `MessagesBell.tsx` |
| Mobile uploads directly to storage under RLS today (community images, match evidence). The master spec's `/uploads/sign` was never built. | mobile `community_image_uploader.dart`, conventions "Deferred" |

## 3. Design

### 3.1 Reads — API reads, realtime as a nudge (Approach B)

All viewer-specific reads go through `/api/mobile/v1` (signed URLs need service-role; the profile
join must not widen reliance on direct `profiles` reads, S1; the web's load-everything query must
not be copied). Mobile subscribes to `dm_messages` `postgres_changes` **only as a signal**: any
event refetches the loaded window in place via the API. This also covers UPDATEs (edit, unsend,
read/delivered) and reconnect/resume (always refetch).

### 3.2 Service layer

`lib/messages/service.ts` holds the logic, taking an explicit context
`{ supabase, admin, userId }`. The existing server actions (`lib/messages/actions.ts`) and the new
endpoints both call it (conventions §7.1). Behaviour of the web actions must not change except for
the upload-path validation (3.4). Before moving code, add characterization tests for the current
actions' observable results.

### 3.3 Endpoints (`lib/mobile-api/endpoints/messages.ts`)

All `auth: 'user'`. Error codes reuse web `errorCode` strings where one exists.

| Operation | Method and path | Request | Response | Notes |
|---|---|---|---|---|
| `getMessageThreads` | `GET /messages/threads?box=inbox\|requests&cursor&limit` | — | `{ threads: ThreadSummary[], nextCursor, requestCount }` | Ordered by `last_message_at` desc. Blocked and (for the recipient) declined threads excluded. `inbox` = accepted threads plus the viewer's own outgoing pending threads; `requests` = incoming pending. `ThreadSummary` = threadId, other {id, name, username, avatarUrl}, preview {kind: text/image/sticker/voice/removed, text?, stickerId?}, lastMessageAt, unread (count of `read_at IS NULL AND sender<>me`), `requestState` (pending/accepted/declined), `direction` (incoming/outgoing/null). |
| `getMessageThread` | `GET /messages/threads/:id` | — | `{ threadId, other, blockedByMe, blockedByThem, requestState, direction }` | 404 if not a participant. |
| `acceptMessageRequest` | `POST /messages/threads/:id/accept` | — | `{ ok }` | Only the non-creator. Naturally idempotent. |
| `declineMessageRequest` | `POST /messages/threads/:id/decline` | — | `{ ok }` | Only the non-creator, only while pending. Naturally idempotent. |
| `getThreadMessages` | `GET /messages/threads/:id/messages?before&limit` | — | `{ messages: Message[], nextBefore }` | Newest-first page (default 40, max 100). Media signed per page. `replyTo` resolved server-side. Deleted content redacted (`resolveParticipantContent`). |
| `startMessageThread` | `POST /messages/threads` | `{ recipientId }` | `{ threadId, requestState }` | Get-or-create, naturally idempotent. 400 for self. New threads are created `pending` unless exempt (3.9). |
| `sendMessage` | `POST /messages/threads/:id/messages` | `{ body? , imagePath?, stickerId?, audioPath?, audioDurationSeconds?, replyToId? }` | `{ messageId, createdAt }` | **`idempotent: true`** (`Idempotency-Key` required): a retried send must not duplicate a bubble or push. Same validation as web. Block/mute errors reuse the web strings' codes. New codes `request_pending_limit`, `request_media_not_allowed` (3.9). |
| `editMessage` | `PATCH /messages/:id` | `{ body }` | `{ ok }` | 10-minute window, history row written. |
| `unsendMessage` | `DELETE /messages/:id` | — | `{ ok }` | Naturally idempotent. |
| `forwardMessage` | `POST /messages/:id/forward` | `{ toThreadId }` | `{ messageId }` | **`idempotent: true`.** |
| `markThreadRead` | `POST /messages/threads/:id/read` | — | `{ ok }` | Stamps read+delivered; clears matching bell rows. Best-effort, never errors the screen. |
| `markAllDelivered` | `POST /messages/delivered` | — | `{ ok }` | Called on app resume / when a message arrives. |
| `blockPlayer` | `PUT /messages/blocks/:playerId` | — | `{ ok }` | Also severs follows both ways (as `blockUser`). |
| `unblockPlayer` | `DELETE /messages/blocks/:playerId` | — | `{ ok }` | |
| `reportThread` | `POST /messages/threads/:id/report` | `{ messageId?, reason }` | `{ ok }` | reason 1–1000 chars. |

The sticker catalog is **not** an endpoint: mobile bundles the 14 ids/emoji, with a parity test
against `STICKER_PACK` (a drift fails the build; unknown sticker kinds from a newer server degrade
to a placeholder bubble).

### 3.4 Upload-path validation — at the client-input boundary only

Paths are validated in the **new send endpoint and the web action's input parsing**
(`sendMessage` entry), not in the core function that `forwardMessage` reuses.

- Rule: `imagePath` must start with `<callerId>/` and `audioPath` likewise; anything else → 400.
- Forward takes paths from the database row after verifying the forwarder participates in the
  source thread, so it is safe without the check and **must not** be subject to it (it would break
  forwarding every received image/voice note).
- Structure: `service.sendMessageCore(ctx, trustedInput)` (no path check, used by forward) and
  `service.sendClientMessage(ctx, clientInput)` (validates, then calls core).
- Required tests: forwarding a received image succeeds; a send carrying another user's path is
  rejected (endpoint and web action both).

### 3.5 Uploads

Direct to `dm-images` / `dm-audio` under `<userId>/<uuid>.<ext>` using the existing storage RLS
(precedent: community, match evidence). Mobile compresses images (long edge ≤1600 px, JPEG,
EXIF stripped). Voice notes: AAC/m4a, hard cap 120 s (server accepts ≤130 like `audioDurationSchema`),
pause-and-review before sending. Recording and playback packages are chosen with evidence in
Stage C. Server extension handling already covers `m4a`.

### 3.6 Typing indicator — per-thread private broadcast (additive migration)

Typing is **not** carried in `dm-online` presence: that channel is site-wide and readable by every
online player, so adding a thread id would publish who is messaging whom to everyone (most players
are minors). It would also turn each keystroke burst into a presence diff fanned out to every
connected client.

- Channel: private Realtime Broadcast `dm-typing:<threadId>`, event `typing`, payload `{ userId }`.
- New migration `…_dm_typing_broadcast_policies.sql` (additive; precedent
  `20260913193000_dm_delivered_at_and_presence.sql`): `realtime.messages` SELECT and INSERT
  policies for `extension = 'broadcast'` and topic `dm-typing:<id>` where the caller is a
  participant of that thread (via `dm_threads`). Participants only.
- Client behaviour: send at most one `typing` per 3 s while composing; receiver shows the
  indicator for 5 s after the last event; nothing is stored. Both web composer and mobile use it.
- **Schema-change note:** this migration touches only `realtime.messages` policies; the other
  5b migration is message requests (3.9). Applied to staging first, then production by the owner, before the web code that uses it.
- If the owner would rather not ship a migration in 5b, typing is **cut from 5b**; it is not
  shipped over presence.

### 3.7 Push

- Add `threadId` to the DM push data: `{ url, type, threadId }` (keeps `url` for web and the
  existing tap resolver). `notifyBoth` call passes it through `pushToPlayer`'s data argument.
- Platform split, `messages_v1` channel, pref key and timed-mute semantics are unchanged from 5a.
  The bell still records a muted DM.
- App: a foreground DM for the open thread shows no banner; a foreground DM for any other thread
  shows the normal banner and bumps the bell. Tap routing: `/messages/<id>` opens the thread
  (pushed over the current tab).

### 3.9 Message requests (new on both platforms)

Built on the existing schema: `dm_threads.created_by` is the initiator and `friends.status`
already has `accepted`. Rules:

- A new thread starts `pending` **unless** the sender is staff or the two players are accepted
  friends (either direction of the `friends` row). **Follows are not an exemption**: a stranger can
  follow anyone.
- While `pending`, the initiator may send **one text-only message** (no image, voice note or
  sticker). The cap is one SQL constant, `dm_pending_message_cap()` returning 1. Unsent messages
  still count, so unsend-and-resend is not a bypass. Editing the one message is allowed.
- Any message from the **other** participant makes the thread `accepted`; replying is accepting.
  The Accept button does the same. A recipient who previously declined and then sends a message
  also flips it to `accepted` (their own decision, reversible by them).
- **Decline** sets `declined`: hidden from the recipient; the initiator cannot send more and gets
  the **block wording** ("You can no longer message this player"; same error code as a block), so a
  decline is not a separate signal. The pair is unique, so the initiator cannot open a new thread.
- **Grandfathering:** `request_state text NOT NULL DEFAULT 'accepted'` with
  `CHECK (request_state IN ('pending','accepted','declined'))`; existing threads keep `accepted`
  with no backfill. Only thread creation sets `pending`.

**Migration** `…_dm_message_requests.sql` (additive): the column; `dm_is_exempt(a, b)` (one SQL
function: either is staff by role, or an accepted `friends` row exists in either direction — so a
later "opponents in an active fixture" exemption is a change in one place; staff is decided from
the sender's role, not `auth.uid()`, because triggers must not depend on the session); an extended
`dm_can_message` that understands the states; a `BEFORE INSERT` trigger on `dm_messages` and an
`AFTER INSERT` trigger.

**Enforcement lives in the database and in the core send path — the opposite of the upload-path
rule (3.4).** That rule stays at the client-input boundary so forwarding works; the request gate
must be in the core and the database so forwarding cannot get around it.

- `BEFORE INSERT`: `SELECT … FOR UPDATE` on the `dm_threads` row (otherwise two parallel sends
  both pass the cap), then reject media/sticker/voice and anything beyond the cap while the thread
  is `pending` and the sender is `created_by`; reject any send from the initiator when `declined`.
- `AFTER INSERT` (`SECURITY DEFINER`, since `dm_threads` has no client update policy): if the
  sender is not `created_by`, set `request_state = 'accepted'`.
- Forwarding an image into a pending thread is rejected by the trigger. The service keeps
  friendly pre-checks (as it does for block/mute), but the database is the real guard.

**Push, bell and receipts**
- A message into a `pending` thread still writes the bell row, but the **push is suppressed**
  until the thread is accepted. No new notification type, so the 25-type test, prefs and channels
  are unchanged, and a stranger's message stays off a child's lock screen.
- Opening an incoming request clears its bell rows but stamps **no** `read_at` / `delivered_at`
  (and `markAllDelivered` skips pending-thread messages); the sender sees no receipts until
  accepted. (A recipient writing receipts directly through the existing RLS policy remains
  possible and only affects their own view.)

**UI.** Web and mobile inboxes get a Requests section with a count. A request view is preview-only
with Accept, Decline and Block-and-report. The initiator sees "Waiting for X to accept" and a
text-only composer that disables after the one message. Web strings en, fr, pcm; mobile en, fr.

**Known limits.** The initiator is not told when a request is accepted by button (no new
notification type, and `dm_threads` is not in the realtime publication). Mitigation in the app,
not the database: while an **outgoing-pending thread is open and visible**, the client polls the
thread header every 20-30 s; nothing polls in any other state; refetch on resume covers a player
who left the app. Most recipients reply, and a reply arrives as a normal message and flips the
thread. **Not adding `dm_threads` to the realtime publication:** every message bumps
`last_message_at`, so it would fire a thread UPDATE to both participants on every message
(doubling realtime events on the free plan) and need client filtering for `request_state`
changes. If the beta shows the delay matters, the publication migration is the upgrade path. Non-friend opponents reach each other as push-silent requests, which
hurts fixture coordination: watch this in the beta and add the fixture exemption to `dm_is_exempt`.

### 3.8 Mobile structure

- Routes: `/messages` (inbox), `/messages/:threadId`, both pushed (not tab roots).
  `resolveWebLink` maps `/messages` and `/messages/<id>`; tests assert in-app paths are not swallowed.
- Shared realtime helper in `lib/core/realtime/`: one place for subscribe-on-visible,
  unsubscribe-on-dispose, resubscribe on resume/connectivity, refetch on reconnect, and emitting a
  **counter** so consecutive events are never swallowed. Consumers: bell, inbox, thread,
  online-presence, typing.
- Send queue serialized per thread (send/edit/unsend/read on one thread never reorder); each send
  carries an idempotency key; optimistic bubble reconciles by key; rollback reverts only its own change.
- Caller-specific providers watch `viewerIdProvider`. Every authenticated read carries the bearer.
- Tolerant parsing: unknown message kinds degrade; unknown preview kinds degrade.
- ARB en + fr, identical keys, ICU plurals.
- Entry points: messages bell (replaces the coming-soon destination) and the player-profile
  message button (calls `startMessageThread`).

## 4. Rulings (cost if wrong)

1. **API reads with realtime as a nudge** (not direct RLS as master spec §6.3 allows). Cost: one
   extra round trip per event; reversible later by applying payloads in place.
2. **Message requests are added on both platforms** (the web has none today), enforced in the
   database, exempting staff and accepted friends only. Cost: 5b grows to two migrations and a web
   UI surface, so requests are their own plan stage after core DM. Non-friend opponents are
   slower to reach each other (fixture exemption deferred). **Rollout:** staging first, then
   production, with the migration and web UI together; a stricter `dm_can_message` shipped
   without the UI would show senders a generic failure at the cap.
3. **Typing over a per-thread private broadcast channel with a policy migration; never presence.**
   Cost: one additive migration to coordinate; if skipped, typing is cut. Over presence it would
   expose DM relationships site-wide and add presence-diff load per keystroke burst.
4. **Direct uploads with path validation at the client-input boundary only.** Cost: weaker than
   signed upload URLs but matches precedent; validating inside the core function would break
   forwarding of received media, so it must not live there.
5. **Web actions refactored onto a shared service.** Cost: regression risk on web, mitigated by
   characterization tests before the move.
6. **Stickers bundled, not served.** Cost: adding a sticker needs an app release; unknown ids degrade.

## 5. Tests

Requests (run against staging, since they depend on triggers and locks): two parallel sends from
the initiator yield one success; media/sticker/voice rejected while pending; forwarding an image
into a pending thread is rejected; a reply flips the thread to `accepted`; Accept does the same;
Decline hides the thread from the recipient and the initiator gets the block wording and cannot
open a new thread; accepted friends and staff start `accepted`; a follower who is not a friend
starts `pending`; grandfathered threads are unaffected; no receipts stamped on a pending thread;
a pending message writes the bell row but sends no push; an unsent message still counts toward
the cap (the trigger counts rows regardless of `deleted_at`; test: send, unsend, send again, the
second send is rejected); the friends exemption requires `status = 'accepted'` (a pending friend
request does not exempt the pair); `dm_is_exempt` and `is_staff()` agree on who is staff for every
role in the schema (the function reads the sender's role directly, so it is a second
implementation of the same rule and is tested against the first). Mobile: the outgoing-pending
header poll runs only while that thread is open and visible, and stops otherwise.

Web (vitest): service characterization (send, forward, edit/unsend windows, read, block+follow
sever, report); each endpoint's auth, validation and error codes; send idempotency (retry returns
the same message, one push); path validation including the forward regression pair (3.4); thread
list excludes blocked, pages stably; messages paging cursor; redaction of deleted content; push
data contains `threadId` and platform partition snapshot unchanged; typing policy exercised against
staging; OpenAPI snapshot regenerated.

Mobile (flutter test): models and tolerant parsing; each `ApiClient` method (`usedOperations`);
inbox paging, realtime-nudge refetch in place, two consecutive events, resume refetch;
conversation window, optimistic send/retry without duplicate, per-thread serialization, rollback
scope, edit/unsend window UI, forward, receipts; typing indicator timing; block/report; route
mapping incl. non-swallowing; push tap and foreground-banner suppression; bearer header on every
authenticated read; real refreshed `Session` (same user, new token) does not reset providers;
ARB key parity and plurals.

## 6. Not verifiable in this phase

Two-device live behaviour, voice recording on real hardware, DM push in all three app states and
the typing channel under real latency. These go on the device-pass checklist; 5a's device pass
remains outstanding and gates building on push.

## 7. Open items (resolved with evidence in later stages)

- Audio recording/playback package and permission wiring at the pinned versions (Stage C).
- Exact thread-list preview payload size and page defaults (confirm in the web plan).
- Whether `markAllDelivered` should be called on resume only or also per realtime insert (decide
  from the web plan once the endpoint's load is measured).
