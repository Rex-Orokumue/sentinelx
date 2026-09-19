begin;
create temp table t_results(check_name text, outcome text);
grant all on t_results to anon, authenticated;

do $$
declare
  fake_uid text := gen_random_uuid()::text;
begin
  -- signed-in player
  perform set_config('request.jwt.claims', json_build_object('sub', fake_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- S2: self-update of protected profile columns must be blocked
  begin
    execute 'update public.profiles set xp = xp + 1 where id = $1::uuid' using fake_uid;
    insert into t_results values ('S2 authenticated UPDATE profiles.xp', 'VULNERABLE (allowed)');
  exception when insufficient_privilege then
    insert into t_results values ('S2 authenticated UPDATE profiles.xp', 'PASS');
  end;
  begin
    execute 'update public.profiles set kyc_verified = true where id = $1::uuid' using fake_uid;
    insert into t_results values ('S2 authenticated UPDATE profiles.kyc_verified', 'VULNERABLE (allowed)');
  exception when insufficient_privilege then
    insert into t_results values ('S2 authenticated UPDATE profiles.kyc_verified', 'PASS');
  end;

  -- S3: direct writes to money/result tables must be blocked
  begin
    execute 'insert into public.tournament_registrations(tournament_id, player_id, payment_status) values (gen_random_uuid(), $1::uuid, ''paid'')' using fake_uid;
    insert into t_results values ('S3 authenticated INSERT tournament_registrations', 'VULNERABLE (allowed)');
  exception when insufficient_privilege then
    insert into t_results values ('S3 authenticated INSERT tournament_registrations', 'PASS');
  when others then
    -- Pre-migration the privilege AND the tr_own_insert RLS check both pass, and the
    -- row is only stopped later by a NOT NULL/FK constraint (23502/23503). That means
    -- the attack path is still open, so it must not read as a pass.
    insert into t_results values ('S3 authenticated INSERT tournament_registrations',
      'VULNERABLE (privilege+RLS passed; stopped only by constraint ' || sqlstate || ')');
  end;
  begin
    execute 'update public.friendly_matches set challenger_paid = true';
    insert into t_results values ('S3 authenticated UPDATE friendly_matches', 'VULNERABLE (allowed)');
  exception when insufficient_privilege then
    insert into t_results values ('S3 authenticated UPDATE friendly_matches', 'PASS');
  end;
  begin
    execute 'update public.match_results set status = ''verified''';
    insert into t_results values ('S3 authenticated UPDATE match_results', 'VULNERABLE (allowed)');
  exception when insufficient_privilege then
    insert into t_results values ('S3 authenticated UPDATE match_results', 'PASS');
  end;

  -- S1: private columns must be unreadable; public ones still readable
  begin
    execute 'select whatsapp_number from public.profiles limit 1';
    insert into t_results values ('S1 authenticated SELECT profiles.whatsapp_number', 'VULNERABLE (allowed)');
  exception when insufficient_privilege then
    insert into t_results values ('S1 authenticated SELECT profiles.whatsapp_number', 'PASS');
  end;
  begin
    execute 'select id, username, kyc_verified, deleted_at, phone_verified_at from public.profiles limit 1';
    insert into t_results values ('KEEP authenticated SELECT public profile columns', 'PASS');
  exception when others then
    insert into t_results values ('KEEP authenticated SELECT public profile columns', 'BROKEN: ' || sqlstate);
  end;

  -- anonymous visitor
  reset role;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;

  begin
    execute 'select whatsapp_number from public.profiles limit 1';
    insert into t_results values ('S1 anon SELECT profiles.whatsapp_number', 'VULNERABLE (allowed)');
  exception when insufficient_privilege then
    insert into t_results values ('S1 anon SELECT profiles.whatsapp_number', 'PASS');
  end;
  begin
    execute 'select phone from public.profiles limit 1';
    insert into t_results values ('S1 anon SELECT profiles.phone', 'VULNERABLE (allowed)');
  exception when insufficient_privilege then
    insert into t_results values ('S1 anon SELECT profiles.phone', 'PASS');
  end;
  begin
    execute 'select id, username, sx_score, wins, kyc_verified from public.profiles limit 1';
    insert into t_results values ('KEEP anon SELECT public profile columns', 'PASS');
  exception when others then
    insert into t_results values ('KEEP anon SELECT public profile columns', 'BROKEN: ' || sqlstate);
  end;
  begin
    execute 'select count(id) from public.profiles';
    insert into t_results values ('KEEP anon SELECT count(id) profiles (home page stat)', 'PASS');
  exception when others then
    insert into t_results values ('KEEP anon SELECT count(id) profiles (home page stat)', 'BROKEN: ' || sqlstate);
  end;

  reset role;
end $$;

select * from t_results order by check_name;
rollback;
