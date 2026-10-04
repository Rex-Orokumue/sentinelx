-- Assertions for 20261005120000_dm_typing_broadcast_policies.sql.
-- Run against STAGING only (never production), as a single statement, e.g. via the Supabase SQL runner / MCP execute_sql.
-- Everything happens inside one DO block that ends by raising, so nothing persists.
-- EXPECTED RESULT: an error whose message is exactly  ALL_PASSED_ROLLBACK
-- Any other error message is a failed assertion.
do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  c uuid := gen_random_uuid();
  t_ab uuid;
  t_ac uuid;
  pa uuid; pb uuid;
begin
  -- Throwaway players. profiles.id references auth.users; handle_new_user() creates the profile from the metadata.
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values
    (a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zzqa_typing_a@example.invalid', '{"username":"zzqa_typing_a"}'),
    (b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zzqa_typing_b@example.invalid', '{"username":"zzqa_typing_b"}'),
    (c, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zzqa_typing_c@example.invalid', '{"username":"zzqa_typing_c"}');

  pa := least(a, b); pb := greatest(a, b);
  insert into public.dm_threads (player_a, player_b, created_by) values (pa, pb, a) returning id into t_ab;
  insert into public.dm_threads (player_a, player_b, created_by)
  values (least(a, c), greatest(a, c), a) returning id into t_ac;

  -- participants may use their own thread's topic
  assert public.dm_typing_topic_allowed('dm-typing:' || t_ab, a), 'participant a should be allowed';
  assert public.dm_typing_topic_allowed('dm-typing:' || t_ab, b), 'participant b should be allowed';
  -- a third player may not
  assert not public.dm_typing_topic_allowed('dm-typing:' || t_ab, c), 'non-participant must be refused';
  -- a participant may not use a thread they are not in
  assert not public.dm_typing_topic_allowed('dm-typing:' || t_ac, b), 'b is not in thread a-c';
  -- malformed or foreign topics match nothing and never raise
  assert not public.dm_typing_topic_allowed('dm-typing:not-a-uuid', a), 'malformed id must be refused';
  assert not public.dm_typing_topic_allowed('dm-typing:' || t_ab || 'x', a), 'trailing junk must be refused';
  assert not public.dm_typing_topic_allowed('dm-online', a), 'other topics must be refused';
  assert not public.dm_typing_topic_allowed('', a), 'empty topic must be refused';
  assert not public.dm_typing_topic_allowed(null, a), 'null topic must be refused';
  assert not public.dm_typing_topic_allowed('dm-typing:' || t_ab, null), 'null user must be refused';

  -- the two policies exist, for the right commands, scoped to authenticated
  assert (select count(*) from pg_policies
          where schemaname = 'realtime' and tablename = 'messages'
            and policyname = 'dm_typing_participants_read' and cmd = 'SELECT' and 'authenticated' = any(roles)) = 1,
    'read policy missing';
  assert (select count(*) from pg_policies
          where schemaname = 'realtime' and tablename = 'messages'
            and policyname = 'dm_typing_participants_send' and cmd = 'INSERT' and 'authenticated' = any(roles)) = 1,
    'send policy missing';

  raise exception 'ALL_PASSED_ROLLBACK';
end $$;
