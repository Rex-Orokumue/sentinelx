# Direct Messages — Edit, Unsend, Reply — Design

**Date:** 2026-09-12 · Follow-up to `2026-09-07-direct-messages-design.md` (Piece 2 of the
community rebuild, shipped 2026-09-10 as `2026-09-09-community-direct-messages.md`).

## What it is

Three additions to the shipped 1:1 messaging feature:

- **Edit** — change the text of a message you sent, within 10 minutes of sending.
- **Unsend** — remove a message for both sides, within 10 minutes of sending.
- **Reply** — quote a specific earlier message when composing a new one, triggered
  by swiping the bubble (a tap-reveal icon on desktop, where there's no swipe).

## Why it matters here

QA on the shipped feature surfaced the request directly: players expect the
"fix a typo" / "wrong chat, take it back" affordances every messaging app has.
Reply matters for the same reason DMs exist at all — players use them to
arrange fixture times, and once a thread has more than a few messages,
"replying" to an earlier line without quoting it is genuinely ambiguous.

## Reversing a deliberate constraint — and why it's still safe

The original spec was explicit: *"Messages are immutable... Editing sent
messages in a context where disputes get adjudicated is a liability."* That
concern is real — a no-show or fixture dispute could turn on "what time did we
actually agree?", and a player editing their own message after the fact to win
that argument is a genuine risk this platform can't accept quietly.

The resolution: **content is never destroyed, only hidden from participants.**
Editing appends the pre-edit body to a new audit table before overwriting;
unsending only sets a `deleted_at` flag and leaves the row (and its content)
completely intact. Staff reviewing a report always see the real, current
content plus the full edit history, regardless of what the two players
currently see. The liability the original spec was guarding against was "the
true record disappears" — it doesn't, for the one audience (staff, adjudicating
a report) that needs it not to.

## Schema

Migration `<timestamp>_dm_edit_unsend_reply.sql`, additive only — no existing
column changes shape.

**`dm_messages` gains:**
- `edited_at timestamptz null` — set on edit. Drives an "(edited)" tag for
  participants. `null` = never edited.
- `deleted_at timestamptz null` — set on unsend. Drives a "message removed"
  placeholder for participants. `null` = not unsent.
- `reply_to_id uuid null references dm_messages(id) ON DELETE SET NULL` — the
  quoted message, if any. `SET NULL` so an admin hard-deleting a flagged
  message (the existing `resolveDmReport` "delete flagged message" path)
  doesn't break replies pointing at it — they just fall back to "message no
  longer available", the same as a soft-deleted (unsent) quote target.

**New table `dm_message_edits`** — `id`, `message_id` (→ `dm_messages`,
`ON DELETE CASCADE`), `body_before`, `image_url_before`, `edited_at`. One row
appended *before* each edit overwrites `dm_messages.body`/`image_url`. Staff-only
surface — no participant-facing read policy, since participants only ever see
the current (post-edit) body plus the "(edited)" tag, never prior versions.

**Key invariant:** `dm_messages.body`/`image_url` always hold the true,
current content. Unsend never touches them — it only sets `deleted_at`.
Everything participant-facing that reads a message (`fetchThread`,
`fetchThreadList`, the realtime handler, and reply-quote rendering) must
check `deleted_at` and substitute the placeholder. Everything staff-facing
(`fetchDmReports`, the admin transcript) ignores `deleted_at` and reads the
real fields directly, joining `dm_message_edits` for history.

## Rules

- **10-minute window**, enforced **server-side** in the `editMessage` and
  `unsendMessage` actions (`created_at > now() - interval '10 minutes'`) — never
  just a disabled button. A new RLS policy,
  `dm_messages_sender_edit_or_unsend`, backs this at the database layer too:
  `FOR UPDATE USING (sender_id = auth.uid() AND created_at > now() - interval '10 minutes')`.
  As with the existing `dm_messages_recipient_mark_read` policy, RLS gates *who*
  and *when* — the server action alone controls *which columns* a given call
  sets; there is no per-column RLS here, matching the existing pattern.
- **Reply has no time limit.** Only edit and unsend are windowed.
- **Editing changes text only.** An attached image can't be swapped — only
  removed entirely via unsend. Re-validates through the existing
  `messageBodySchema`.
- **No new notification type.** Edits and unsends are silent, realtime-only UI
  updates. A reply still fires the existing `direct_message` notification —
  nothing new to disclose in the privacy policy; staff read access to
  reported threads is unchanged from what's already disclosed there.
- **Deleting your account**: unaffected. `anonymise_account()` already deletes
  a leaver's `dm_threads` rows (cascading `dm_messages`); the new columns and
  `dm_message_edits` (cascading off `dm_messages`) are cleaned up by the same
  existing cascade with no changes needed.

## Realtime

The conversation channel's subscription widens from `event: 'INSERT'` to
`event: '*'`. An `UPDATE` payload patches the matching message in local state
in place (`body`, `edited_at`, `deleted_at`) instead of appending — this is
how the other party sees an edit or unsend live, and how a reply's quote block
flips to "removed" live if its target gets unsent while visible on screen.

## UI

Visual language follows WhatsApp's conventions for these specific affordances
(quote-block layout, edited tag placement, removed-message treatment) —
**not** its color scheme; this stays on SentinelX's existing dark/purple
palette (`sx-purple`, `sx-surface`, `sx-border`, etc.), consistent with the
rest of the app.

- **Edited:** small, muted "(edited)" beside the timestamp.
- **Unsent:** bubble content replaced with an italic, muted "Message removed"
  for both sides; timestamp stays.
- **Reply — composing:** swiping a bubble (mobile) or hovering it and tapping
  a reveal icon (desktop, no swipe equivalent) enters reply mode — a compact
  quoted excerpt (sender name + truncated preview) appears above the
  composer with an ✕ to cancel.
- **Reply — reading:** a reply bubble shows its quoted excerpt above its own
  content, left-border accent in the WhatsApp style. Tap-to-scroll-to-original
  is **not** included in v1 (YAGNI — nothing today needs it).
- **Edit/unsend entry point:** reachable only on your own bubble, only inside
  the 10-minute window, via the same long-press/tap affordance family as the
  swipe-to-reply gesture — not a new overflow menu.

## Admin (`/admin/messages`)

The report transcript (`fetchDmReports` / `DmReportRow`) keeps showing every
message's real, current content regardless of `deleted_at`, now annotated:

- `(unsent by <sender> at <time>)` when `deleted_at` is set.
- `(edited — original: "<body_before>")` when the message has one or more
  `dm_message_edits` rows, showing the earliest captured version.

This is the piece that makes the whole feature safe to ship despite reversing
"messages are immutable" — staff investigating a report never lose the truth,
even if both players' own views have since changed.

## Scope

**In:** edit (text only, 10 min), unsend (delete-for-everyone, 10 min,
soft-delete/tombstone), reply-to-a-message (swipe + desktop hover fallback, no
time limit), full staff-visible audit trail for both edit and unsend.

**Out:** editing/replacing an attached image, edit history visible to
participants (staff-only), tap-to-scroll-to-original on a reply quote, any new
notification type, any change to the 2000-char body cap or existing
block/mute/report mechanics.

## Testing

Pure logic to unit-test: the 10-minute-window predicate (`canEditOrUnsend(createdAt, now)`),
and the participant-vs-staff content-visibility resolution (given
`{body, deletedAt, editedAt}`, what does a participant see vs. what does staff
see) — mirrors how `unreadCount`/`isBlockedBetween` were tested for the
original piece. RLS is verified the same way as before: attempt an edit/unsend
past the 10-minute mark and confirm it's rejected at the database layer, not
just hidden in the UI.
