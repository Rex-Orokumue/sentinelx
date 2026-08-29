-- 074_expire_unconfirmed_signups.sql
-- Hourly sweep of abandoned unconfirmed email signups.
--
-- With the username claim now deferred (073) an unconfirmed auth.users row
-- holds no handle, but it still holds the email address — a repeat signup
-- with the same address just silently resends into the same broken channel,
-- and the rows pile up (20% of signups here never confirm). After 24h
-- unconfirmed with no real activity, delete the row.
--
-- Google / OAuth users always have email_confirmed_at set, so the
-- `email_confirmed_at IS NULL` filter never touches them. The activity guards
-- mirror the one-off cleanup that shipped alongside this migration: anyone
-- who has actually done something (registered, played, has a settled friendly
-- or friend link) is kept regardless of confirmation state.
--
-- profiles.id -> auth.users is ON DELETE CASCADE, and so are most child
-- tables (wallets, xp_events, sx_coins, ...). The handful with a
-- non-cascading FK to profiles are cleared explicitly first.

create or replace function public.expire_unconfirmed_signups()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ids uuid[];
begin
  select array_agg(u.id) into v_ids
  from auth.users u
  where u.email_confirmed_at is null
    and u.created_at < now() - interval '24 hours'
    and not exists (select 1 from public.tournament_registrations r where r.player_id = u.id)
    and not exists (select 1 from public.matches m where u.id in (m.player_a_id, m.player_b_id))
    and not exists (select 1 from public.group_memberships gm where gm.player_id = u.id)
    and not exists (select 1 from public.sx_score_events e where e.player_id = u.id)
    and not exists (select 1 from public.friendly_match_results fmr where fmr.submitted_by = u.id)
    and not exists (
      select 1 from public.friendly_matches fm
      where (fm.challenger_id = u.id or fm.opponent_id = u.id) and fm.status <> 'pending'
    )
    and not exists (
      select 1 from public.friends f
      where (f.requester_id = u.id or f.recipient_id = u.id) and f.status <> 'pending'
    );

  if v_ids is null then
    return;
  end if;

  -- Non-cascading FKs to profiles: clear before the auth.users delete.
  delete from public.friendly_matches where challenger_id = any(v_ids) or opponent_id = any(v_ids);
  delete from public.friends where requester_id = any(v_ids) or recipient_id = any(v_ids);
  delete from public.referrals where referrer_id = any(v_ids) or referred_id = any(v_ids);
  delete from public.player_notifications where player_id = any(v_ids);
  delete from public.notifications where player_id = any(v_ids);

  -- profiles + every cascading child goes with the auth.users row.
  delete from auth.users where id = any(v_ids);
end;
$function$;

-- Guarded so the migration replays cleanly on a fresh environment where the
-- job doesn't exist yet (same convention as 071_remove_full_day_auto_cancel).
do $$
begin
  perform cron.unschedule('expire-unconfirmed-signups');
exception when others then null;
end $$;

select cron.schedule(
  'expire-unconfirmed-signups',
  '17 * * * *',
  $$ select public.expire_unconfirmed_signups() $$
);
