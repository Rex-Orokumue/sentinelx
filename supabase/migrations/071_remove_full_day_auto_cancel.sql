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
select cron.unschedule('expire-full-day-matches');
select cron.unschedule('notify-expired-full-day-matches');

drop function public.expire_full_day_matches();
