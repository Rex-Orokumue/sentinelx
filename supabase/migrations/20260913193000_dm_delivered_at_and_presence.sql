-- Delivered-tick support for DMs: distinguishes "sent, not yet delivered"
-- from "delivered, not yet read" so MessageBubble can render three tick
-- states (sent / delivered / read). No RLS change needed for this column —
-- the existing dm_messages_recipient_mark_read policy (see
-- 20260909204325_direct_messages.sql) already lets the recipient update any
-- column on a row they didn't send.
alter table public.dm_messages
  add column delivered_at timestamptz;

create index dm_messages_undelivered_idx
  on public.dm_messages (thread_id, delivered_at)
  where delivered_at is null;

-- Realtime Presence authorization for the DM "online" indicator
-- (components/messages/PresenceProvider.tsx, topic 'dm-online'). This
-- project has row level security enabled on realtime.messages with no
-- existing policies, so a private channel's .track()/.subscribe() calls
-- fail (silently, from the client's point of view) without an explicit
-- grant here. Scoped to the single fixed topic the DM presence channel
-- uses — any signed-in player can see who else is online and announce
-- their own presence; this is a coarse "online" dot, not sensitive data,
-- so there's no per-payload validation beyond the topic + extension check.
create policy "dm_presence_authenticated_read" on "realtime"."messages"
  for select to authenticated
  using (
    realtime.topic() = 'dm-online'
    and realtime.messages.extension = 'presence'
  );

create policy "dm_presence_authenticated_send" on "realtime"."messages"
  for insert to authenticated
  with check (
    realtime.topic() = 'dm-online'
    and realtime.messages.extension = 'presence'
  );
