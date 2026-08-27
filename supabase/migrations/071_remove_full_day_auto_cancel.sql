-- 071_remove_full_day_auto_cancel.sql
-- Removes the full-day-match auto-cancel path entirely (021_full_day_matches.sql,
-- 068_full_day_alert_dedupe.sql). It directly flipped a full-day match to
-- 'cancelled' with no admin decision, no winner, and no group-standings
-- recompute — and because it ran on the same hourly minute as
-- resolve-noshow-matches, it could race ahead of the no-show sweep and cancel
-- a match before that sweep ever got a chance to flag it for review. Full-day
-- matches now go through the exact same admin-decision flow as every other
-- match: the no-show sweep already computes the correct "day has ended"
-- deadline for them (noShowDeadlinePassed, lib/matches/noshow.ts), so nothing
-- else needs to change for them to be flagged and resolved correctly.
--
-- is_full_day/auto_expired/full_day_alert_sent_at columns are left in place
-- (auto_expired/full_day_alert_sent_at simply go unused going forward) —
-- dropping columns is out of scope for this fix.
--
-- Both jobs were scheduled directly against the live DB, not via a tracked
-- migration (same untracked-cron-job convention 070_chat_system.sql already
-- notes) — so on a fresh environment replaying migrations from scratch
-- (a new project, `supabase db reset`, a preview branch) neither job exists
-- yet, and a bare cron.unschedule() errors on "job not found", aborting the
-- whole migration run. Guard each one so this migration replays cleanly
-- regardless of environment.
do $$
begin
  perform cron.unschedule('expire-full-day-matches');
exception when others then null;
end $$;

do $$
begin
  perform cron.unschedule('notify-expired-full-day-matches');
exception when others then null;
end $$;

drop function if exists public.expire_full_day_matches();
