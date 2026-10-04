-- Assertions for 20261005130000_dm_message_requests.sql.
-- Run against STAGING only (never production), as ONE statement (Supabase SQL runner / MCP execute_sql).
-- Everything is inside one DO block that ends by raising, so nothing persists.
-- EXPECTED RESULT: an error whose message is exactly  ALL_PASSED_ROLLBACK
-- Any other message is a failed assertion and names the assertion.
do $$
declare
  zero uuid := '00000000-0000-0000-0000-000000000000';
  s1 uuid := gen_random_uuid();   -- stranger initiator
  s2 uuid := gen_random_uuid();   -- stranger recipient
  f1 uuid := gen_random_uuid();   -- accepted friend of f2
  f2 uuid := gen_random_uuid();
  p1 uuid := gen_random_uuid();   -- PENDING friend request with p2
  p2 uuid := gen_random_uuid();
  fo1 uuid := gen_random_uuid();  -- follower, not a friend
  fo2 uuid := gen_random_uuid();
  adm uuid := gen_random_uuid();
  modr uuid := gen_random_uuid();
  plr uuid := gen_random_uuid();
  t uuid;
  t_old uuid;
  m uuid;
  st text;
  who uuid;
begin
  -- Throwaway players (profiles are created by handle_new_user from the metadata).
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  select u, zero, 'authenticated', 'authenticated', 'zzqa_req_' || substr(u::text, 1, 8) || '@example.invalid',
         jsonb_build_object('username', 'zzqa_req_' || substr(u::text, 1, 8))
  from unnest(array[s1, s2, f1, f2, p1, p2, fo1, fo2, adm, modr, plr]) as u;

  insert into public.user_roles (user_id, role) values (adm, 'admin'), (modr, 'moderator'), (plr, 'player');
  insert into public.friends (requester_id, recipient_id, status) values (f1, f2, 'accepted'), (p1, p2, 'pending');
  insert into public.player_follows (follower_id, following_id) values (fo1, fo2);

  -- ---------- exemption rules ----------
  assert public.dm_is_exempt(f1, f2), 'accepted friends (requester side) must be exempt';
  assert public.dm_is_exempt(f2, f1), 'accepted friends (recipient side) must be exempt';
  assert not public.dm_is_exempt(p1, p2), 'a PENDING friend request must NOT exempt the pair';
  assert not public.dm_is_exempt(fo1, fo2), 'a follow must NOT exempt the pair';
  assert not public.dm_is_exempt(s1, s2), 'strangers are not exempt';
  assert public.dm_is_exempt(adm, s2), 'admin sender is exempt';
  assert public.dm_is_exempt(modr, s2), 'moderator sender is exempt';
  assert not public.dm_is_exempt(plr, s2), 'a plain player is not exempt';

  -- dm_is_exempt's staff branch must agree with is_staff() for every role in the schema
  foreach who in array array[adm, modr, plr, s1] loop
    perform set_config('request.jwt.claim.sub', who::text, true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub', who::text)::text, true);
    assert public.is_staff() = exists (
             select 1 from public.user_roles r where r.user_id = who and r.role in ('admin', 'moderator')),
      'is_staff() and the dm_is_exempt staff rule disagree for ' || who::text;
    assert (public.dm_is_exempt(who, s2) and not exists (select 1 from public.friends f where f.status = 'accepted' and (f.requester_id = who or f.recipient_id = who)))
           = public.is_staff(),
      'dm_is_exempt staff branch disagrees with is_staff() for ' || who::text;
  end loop;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);

  -- ---------- grandfathering ----------
  -- (a thread inserted without request_state gets the default)
  insert into public.dm_threads (player_a, player_b, created_by)
  values (least(fo1, fo2), greatest(fo1, fo2), fo1) returning id into t_old;
  assert (select request_state from public.dm_threads where id = t_old) = 'accepted', 'default must be accepted';

  -- ---------- pending gate ----------
  insert into public.dm_threads (player_a, player_b, created_by, request_state)
  values (least(s1, s2), greatest(s1, s2), s1, 'pending') returning id into t;

  insert into public.dm_messages (thread_id, sender_id, body) values (t, s1, 'hello') returning id into m;  -- the one message

  -- second text refused
  begin
    insert into public.dm_messages (thread_id, sender_id, body) values (t, s1, 'again');
    raise exception 'NO_ERROR_RAISED';
  exception when others then
    if sqlerrm <> 'request_pending_limit' then raise exception 'wanted request_pending_limit, got %', sqlerrm; end if;
  end;

  -- unsend then resend is still refused (cap counts rows regardless of deleted_at)
  update public.dm_messages set deleted_at = now() where id = m;
  begin
    insert into public.dm_messages (thread_id, sender_id, body) values (t, s1, 'resend');
    raise exception 'NO_ERROR_RAISED';
  exception when others then
    if sqlerrm <> 'request_pending_limit' then raise exception 'unsend-resend: wanted request_pending_limit, got %', sqlerrm; end if;
  end;

  -- media / sticker / voice refused while pending (use a fresh pending thread so the cap is not the reason)
  insert into public.dm_threads (player_a, player_b, created_by, request_state)
  values (least(p1, fo2), greatest(p1, fo2), p1, 'pending') returning id into t_old;
  begin
    insert into public.dm_messages (thread_id, sender_id, image_url) values (t_old, p1, 'x/y.jpg');
    raise exception 'NO_ERROR_RAISED';
  exception when others then
    if sqlerrm <> 'request_media_not_allowed' then raise exception 'image: wanted request_media_not_allowed, got %', sqlerrm; end if;
  end;
  begin
    insert into public.dm_messages (thread_id, sender_id, sticker_id) values (t_old, p1, 'gg');
    raise exception 'NO_ERROR_RAISED';
  exception when others then
    if sqlerrm <> 'request_media_not_allowed' then raise exception 'sticker: wanted request_media_not_allowed, got %', sqlerrm; end if;
  end;
  begin
    insert into public.dm_messages (thread_id, sender_id, audio_url, audio_duration_seconds) values (t_old, p1, 'x/v.m4a', 5);
    raise exception 'NO_ERROR_RAISED';
  exception when others then
    if sqlerrm <> 'request_media_not_allowed' then raise exception 'voice: wanted request_media_not_allowed, got %', sqlerrm; end if;
  end;

  -- the RECIPIENT is never gated, and replying accepts the thread
  assert (select request_state from public.dm_threads where id = t) = 'pending', 'still pending before the reply';
  insert into public.dm_messages (thread_id, sender_id, body) values (t, s2, 'hi back');
  assert (select request_state from public.dm_threads where id = t) = 'accepted', 'a reply must accept the thread';
  -- after acceptance the initiator can send freely, with media
  insert into public.dm_messages (thread_id, sender_id, body) values (t, s1, 'now fine');
  insert into public.dm_messages (thread_id, sender_id, image_url) values (t, s1, 's1/pic.jpg');

  -- ---------- declined ----------
  update public.dm_threads set request_state = 'declined' where id = t;
  assert not public.dm_can_message(t, s1), 'the initiator of a declined thread must be refused (same as a block)';
  assert public.dm_can_message(t, s2), 'the recipient of a declined thread may still message';
  insert into public.dm_messages (thread_id, sender_id, body) values (t, s2, 'reopening');
  assert (select request_state from public.dm_threads where id = t) = 'accepted', 'recipient message reopens a declined thread';
  assert public.dm_can_message(t, s1), 'after reopening the initiator may message again';

  -- ---------- block still wins, mute still wins ----------
  insert into public.dm_blocks (blocker_id, blocked_id) values (s2, s1);
  assert not public.dm_can_message(t, s1) and not public.dm_can_message(t, s2), 'a block refuses both directions';

  raise exception 'ALL_PASSED_ROLLBACK';
end $$;
