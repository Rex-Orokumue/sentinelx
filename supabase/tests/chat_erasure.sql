-- Assertions for 20261005140000_chat_erasure.sql. STAGING ONLY, one statement, ends by raising.
-- EXPECTED RESULT: an error whose message is exactly  ALL_PASSED_ROLLBACK
do $$
declare
  zero uuid := '00000000-0000-0000-0000-000000000000';
  u1 uuid := gen_random_uuid();   -- anonymised via the function
  u2 uuid := gen_random_uuid();   -- already anonymised (purge path)
  u3 uuid := gen_random_uuid();   -- untouched control
  n int;
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  select u, zero, 'authenticated', 'authenticated', 'zzqa_chat_' || substr(u::text, 1, 8) || '@example.invalid',
         jsonb_build_object('username', 'zzqa_chat_' || substr(u::text, 1, 8))
  from unnest(array[u1, u2, u3]) as u;

  insert into public.chat_messages (player_id, role, content)
  select p, 'user', 'hello' from unnest(array[u1, u2, u3]) as p;
  insert into public.chat_rate_limit_events (subject_key) values ('player:' || u1), ('player:' || u3);

  -- u2 was anonymised by the OLD function: profile marked deleted, chat rows left behind.
  update public.profiles set deleted_at = now() where id = u2;

  perform public.anonymise_account(u1);

  select count(*) into n from public.chat_messages where player_id = u1;
  if n <> 0 then raise exception 'chat rows survived anonymise_account (%)', n; end if;
  select count(*) into n from public.chat_rate_limit_events where subject_key = 'player:' || u1;
  if n <> 0 then raise exception 'rate-limit events survived anonymise_account (%)', n; end if;
  select count(*) into n from public.chat_messages where player_id = u3;
  if n <> 1 then raise exception 'control account lost its chat rows (%)', n; end if;

  -- The one-off purge statement (copied verbatim from the migration) removes u2's rows.
  delete from public.chat_messages
    where player_id in (select id from public.profiles where deleted_at is not null);
  select count(*) into n from public.chat_messages where player_id = u2;
  if n <> 0 then raise exception 'already-anonymised account kept chat rows (%)', n; end if;
  select count(*) into n from public.chat_messages where player_id = u3;
  if n <> 1 then raise exception 'purge removed a live account''s rows (%)', n; end if;

  raise exception 'ALL_PASSED_ROLLBACK';
end $$;
