-- Message requests for direct messages.
--
-- A new thread starts 'pending' unless the sender is staff or an ACCEPTED friend of the recipient (a follow is not an
-- exemption: a stranger can follow anyone). While pending, the initiator may send one text-only message. Any message
-- from the other participant accepts the thread. Declining hides it from the recipient and stops the initiator, with the
-- same outcome as a block (so a decline is not a separate signal). Existing threads are grandfathered by the column
-- default, so there is no backfill.
--
-- Enforcement is in the database, not at an API boundary, so forwarding and any future caller cannot get around it.

alter table public.dm_threads
  add column request_state text not null default 'accepted'
  check (request_state in ('pending', 'accepted', 'declined'));

-- One tunable constant.
create or replace function public.dm_pending_message_cap() returns int
language sql immutable as $$ select 1 $$;

-- ONE definition of "this pair does not need a request". Staff is decided from the sender's role (not auth.uid()),
-- because triggers must not depend on the session. Must agree with public.is_staff() (same role list) — asserted in
-- supabase/tests/dm_requests.sql. Adding "opponents in an active fixture" later is a change to this function only.
create or replace function public.dm_is_exempt(p_sender uuid, p_other uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select
    exists (select 1 from public.user_roles r where r.user_id = p_sender and r.role in ('admin', 'moderator'))
    or exists (
      select 1 from public.friends f
      where f.status = 'accepted'
        and ((f.requester_id = p_sender and f.recipient_id = p_other)
          or (f.requester_id = p_other and f.recipient_id = p_sender))
    );
$$;

-- dm_can_message now also refuses the initiator of a DECLINED thread.
create or replace function public.dm_can_message(p_thread uuid, p_sender uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
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

-- BEFORE INSERT: take the thread row lock FIRST so two parallel sends from the initiator cannot both pass the cap,
-- then enforce the gate on a pending thread.
create or replace function public.dm_enforce_request_gate() returns trigger
language plpgsql security definer set search_path = public
as $$
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

  -- Counts every row the initiator ever sent in this thread, INCLUDING unsent ones (deleted_at is ignored on purpose):
  -- unsend-then-resend must not be a way around the cap.
  select count(*) into sent
  from public.dm_messages
  where thread_id = new.thread_id and sender_id = t.created_by;
  if sent >= public.dm_pending_message_cap() then
    raise exception 'request_pending_limit' using errcode = 'P0001';
  end if;

  return new;
end $$;

create trigger dm_messages_request_gate
  before insert on public.dm_messages
  for each row execute function public.dm_enforce_request_gate();

-- AFTER INSERT: a message from the OTHER participant accepts the thread (and reopens a declined one).
-- SECURITY DEFINER because dm_threads has no client UPDATE policy.
create or replace function public.dm_accept_on_reply() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  update public.dm_threads
     set request_state = 'accepted'
   where id = new.thread_id
     and request_state <> 'accepted'
     and created_by <> new.sender_id;
  return new;
end $$;

create trigger dm_messages_accept_on_reply
  after insert on public.dm_messages
  for each row execute function public.dm_accept_on_reply();
