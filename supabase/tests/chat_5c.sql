-- STAGING ONLY, one statement, ends by raising ALL_PASSED_ROLLBACK.
do $$
declare
  zero uuid := '00000000-0000-0000-0000-000000000000';
  u uuid := gen_random_uuid();
  tid uuid := gen_random_uuid();
  r record;
  n int;
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values (u, zero, 'authenticated', 'authenticated', 'zzqa_c5_' || substr(u::text,1,8) || '@example.invalid',
          jsonb_build_object('username', 'zzqa_c5_' || substr(u::text,1,8)));

  -- unique turn id per (player, turn, role)
  insert into public.chat_messages (player_id, role, content, client_turn_id) values (u, 'user', 'a', tid);
  begin
    insert into public.chat_messages (player_id, role, content, client_turn_id) values (u, 'user', 'a', tid);
    raise exception 'duplicate turn row was allowed';
  exception when unique_violation then null; end;
  insert into public.chat_messages (player_id, role, content, client_turn_id) values (u, 'assistant', 'b', tid);

  -- rate limit: 2 allowed, 3rd denied with a positive retry-after
  select * into r from public.chat_rate_limit_hit('test:' || u, 2, 600, 100, 86400);
  if not r.allowed then raise exception 'hit 1 denied'; end if;
  select * into r from public.chat_rate_limit_hit('test:' || u, 2, 600, 100, 86400);
  if not r.allowed then raise exception 'hit 2 denied'; end if;
  select * into r from public.chat_rate_limit_hit('test:' || u, 2, 600, 100, 86400);
  if r.allowed or r.retry_after_seconds < 1 then raise exception 'hit 3 should be denied with retry-after'; end if;
  select count(*) into n from public.chat_rate_limit_events where subject_key = 'test:' || u;
  if n <> 2 then raise exception 'denied hit was recorded (%)', n; end if;

  -- budget: ceiling 5, alert at 80% fires exactly once, at the 4th turn
  for i in 1..3 loop
    select * into r from public.chat_budget_hit('total', 5, 80);
    if not r.allowed or r.crossed_alert then raise exception 'turn % should be allowed without alert', i; end if;
  end loop;
  select * into r from public.chat_budget_hit('total', 5, 80);
  if not r.allowed or not r.crossed_alert then raise exception 'turn 4 should alert'; end if;
  select * into r from public.chat_budget_hit('total', 5, 80);
  if not r.allowed or r.crossed_alert then raise exception 'turn 5 should be allowed, no second alert'; end if;
  select * into r from public.chat_budget_hit('total', 5, 80);
  if r.allowed then raise exception 'turn 6 should be denied'; end if;

  raise exception 'ALL_PASSED_ROLLBACK';
end $$;
