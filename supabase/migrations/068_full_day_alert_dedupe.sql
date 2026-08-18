-- 068_full_day_alert_dedupe.sql
-- Dedupe marker for the full-day-match auto-cancel admin alert (Task 10 of
-- docs/superpowers/plans/2026-08-18-admin-push-notifications.md). Null =
-- not yet alerted. Set once the sweep route successfully notifies staff for
-- this match, so an hourly re-run never double-alerts on a still-cancelled
-- match — the same one-shot-via-timestamp-column pattern noshow_flagged_at
-- (migration 037) already uses for the no-show sweep.
ALTER TABLE public.matches
  ADD COLUMN full_day_alert_sent_at timestamptz;
