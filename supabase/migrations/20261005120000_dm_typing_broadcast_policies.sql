-- Typing indicator for direct messages, carried on a PER-THREAD private Realtime broadcast channel
-- `dm-typing:<threadId>`.
--
-- Deliberately NOT carried in the site-wide `dm-online` presence channel (20260913193000): every online player can
-- read that channel's presence state, so putting a thread id in it would publish who is messaging whom to everyone
-- online, and every typing burst would become a presence diff fanned out to every connected client.
--
-- Only the two participants of the thread may join the topic or send on it. The membership rule lives in one
-- SECURITY DEFINER function so it can be asserted directly (supabase/tests/dm_typing_policy.sql) and so a malformed
-- topic can never reach a uuid cast.

create or replace function public.dm_typing_topic_allowed(p_topic text, p_user uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select case
    when p_topic ~ '^dm-typing:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then exists (
      select 1 from public.dm_threads t
      where t.id = substring(p_topic from 11)::uuid
        and p_user in (t.player_a, t.player_b)
    )
    else false
  end;
$$;

create policy "dm_typing_participants_read" on "realtime"."messages"
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and public.dm_typing_topic_allowed(realtime.topic(), auth.uid())
  );

create policy "dm_typing_participants_send" on "realtime"."messages"
  for insert to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and public.dm_typing_topic_allowed(realtime.topic(), auth.uid())
  );
