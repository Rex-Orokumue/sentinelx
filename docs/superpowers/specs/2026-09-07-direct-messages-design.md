# Direct Messages — Design

**Date:** 2026-09-07 · **Piece 2 of 4** — see `2026-09-07-community-system-overview.md`

## What it is

Private 1:1 conversations between players, with unread counts, realtime
delivery, and the ability to block and report someone.

Note: `070_chat_system` is the **support chatbot**, not player messaging. This
is new.

## Why it matters here

Players constantly need to arrange fixtures, agree kick-off times and chase
opponents. Today that happens on WhatsApp, which means the platform loses the
conversation and any record of what was agreed when a dispute lands on an admin.

## Schema

Migration `<timestamp>_direct_messages.sql`.

**`dm_threads`** — `id`, `player_a`, `player_b`, `created_at`,
`last_message_at`. A 1:1 thread is uniquely identified by its pair, so the pair
is stored **normalised**: `player_a` is always the lexicographically smaller
uuid, with a unique index on `(player_a, player_b)`. Without that, A→B and B→A
create two threads for one conversation.

**`dm_messages`** — `thread_id`, `sender_id`, `body`, `image_url`,
`created_at`, `read_at`. Check constraint: a message needs a body or an image.
Body capped (2000 chars).

**`dm_blocks`** — `blocker_id`, `blocked_id`, `created_at`, unique per pair.

**`dm_reports`** — `reporter_id`, `reported_id`, `message_id`, `reason`,
`created_at`, `resolved_at`, `resolved_by`. Feeds the existing admin surfaces.

### Rules

- **RLS:** a thread and its messages are readable only by its two participants.
  Insert requires being a participant *and* not blocked in either direction.
- **Blocking is symmetric in effect:** if either party has blocked the other,
  neither can send. Enforced in the RLS policy, not only in the UI, so it holds
  regardless of client.
- **Messages are immutable.** No UPDATE except `read_at`. Editing sent messages
  in a context where disputes get adjudicated is a liability.
- **Deleting your account** cascades your messages, consistent with the
  tombstone behaviour account deletion already implements.

## Safety — not optional

Most players on this platform are minors. Private messaging without controls is
not a smaller version of this feature; it is an unsafe one. **These ship with
it, not after:**

- **Block** — from a thread and from a player's profile. Blocked means no new
  messages either way, and the thread disappears from both trays.
- **Report** — a message or a player, with a reason, landing in admin.
- **Admin visibility** — staff can read a reported thread. This is deliberate
  and must be disclosed in the privacy policy, which already has a section
  structure to extend.
- **Rate limiting** — a cap on messages to people you have never messaged
  before, which is the cheapest effective anti-spam measure.

The privacy policy edit is part of this piece, not a follow-up.

## Realtime

`dm_messages` published via `ALTER PUBLICATION supabase_realtime`, RLS enforced
on top — so a subscriber only receives messages for threads they participate in.
Unread counts derive from `read_at IS NULL AND sender_id <> me`.

## Surfaces

- **`/messages`** — thread list: avatar, name, last message preview, timestamp,
  unread badge.
- **`/messages/[threadId]`** — the conversation: message list, composer,
  block/report in an overflow menu.
- **Header** — unread total on the existing notification cluster. Note the
  mobile header is already width-constrained (it overflowed once today), so this
  must be a badge on an existing control, not a new one.
- **Profile** — a "Message" button on a player's profile.

## Scope for v1

**In:** 1:1 threads, text messages, realtime, unread counts, block, report,
rate limiting.

**Out:** group chats, voice notes, typing indicators, read receipts beyond a
single read timestamp, message search, reactions to messages.

**The cuttable corner:** image attachments. Text-only messaging is a complete
feature; images can follow. Cutting it removes the upload path and its
moderation surface, which is a meaningful saving.

**Not cuttable:** block, report, rate limiting.

## Testing

Pure logic to unit-test first: pair normalisation (A,B and B,A produce the same
thread key), unread counting, and the block predicate (blocked in either
direction blocks both ways). RLS is verified by attempting cross-thread reads as
a non-participant and confirming they return nothing.
