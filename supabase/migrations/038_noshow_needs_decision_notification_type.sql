-- 038_noshow_needs_decision_notification_type.sql
-- Extends player_notifications.type to allow 'noshow_needs_decision' — the
-- in-app admin alert fired by the no-show sweep rewrite (see
-- docs/superpowers/specs/2026-07-29-noshow-sweep-detect-and-alert-design.md).
-- Missed in the original plan; without this, notifyInApp() silently fails
-- its insert (caught by its best-effort try/catch) and no bell notification
-- is ever recorded.
ALTER TABLE public.player_notifications DROP CONSTRAINT player_notifications_type_check;
ALTER TABLE public.player_notifications
  ADD CONSTRAINT player_notifications_type_check
  CHECK (type IN (
    'listing_approved', 'listing_removed',
    'withdrawal_paid', 'withdrawal_rejected',
    'result_confirmed', 'referral_credited',
    'friend_request', 'wallet_credited',
    'player_disqualified', 'noshow_needs_decision'
  ));
