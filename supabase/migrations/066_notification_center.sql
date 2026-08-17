-- 066_notification_center.sql
-- Notification Center (Phase 3): FCM web push as a new tier alongside the
-- existing WhatsApp (notifications table) and in-app (player_notifications)
-- tiers. See docs/superpowers/specs/2026-08-16-notification-center-design.md
-- and docs/superpowers/specs/2026-08-16-whatsapp-notifications-design.md.
-- Per docs/superpowers/plans/2026-08-17-notification-center.md, this repo
-- already has a working notifications/player_notifications pipeline — this
-- migration extends it rather than replacing it. No new "notifications" or
-- "notification_logs" table: those names are already taken by the existing
-- WhatsApp send log, which serves the same purpose the spec's
-- notification_logs table would.

-- New: FCM device tokens, one row per browser/device a player has granted
-- push permission on.
CREATE TABLE public.fcm_tokens (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id   uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token       text        NOT NULL UNIQUE,
  last_active timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.fcm_tokens (player_id);

ALTER TABLE public.fcm_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fcm_tokens_owner" ON public.fcm_tokens FOR ALL
  USING (player_id = auth.uid())
  WITH CHECK (player_id = auth.uid());

-- Bugfix: notifyNewFixtures (lib/notifications/fixture-created.ts) has
-- called notify()/notifyInApp() with type='fixture_assigned' since it
-- shipped, but neither CHECK constraint has ever allowed that value — every
-- "new fixture" WhatsApp message and bell notification has silently
-- no-op'd (both helpers are best-effort try/catch, so the failure was
-- invisible). Fixed here as part of the same migration that widens these
-- constraints for the new types below.
ALTER TABLE public.notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'registration_confirmed', 'fixture_reminder', 'result_confirmed',
    'prize_credited', 'escrow_sale', 'escrow_completed', 'escrow_refunded',
    'noshow_needs_decision', 'fixture_assigned'
  ));

ALTER TABLE public.player_notifications DROP CONSTRAINT player_notifications_type_check;
ALTER TABLE public.player_notifications ADD CONSTRAINT player_notifications_type_check
  CHECK (type IN (
    'listing_approved', 'listing_removed', 'listing_deleted', 'listing_sold',
    'withdrawal_paid', 'withdrawal_rejected',
    'result_confirmed', 'referral_credited',
    'friend_request', 'wallet_credited',
    'player_disqualified', 'noshow_needs_decision',
    'buy_request_in_progress', 'buy_request_fulfilled', 'buy_request_closed',
    'masters_invitation', 'champions_cup_invitation',
    'invitation_accepted', 'invitation_expired_cascade',
    'tier_upgraded', 'achievement_unlocked',
    'fixture_assigned', 'prize_credited', 'match_reminder',
    'tournament_announced', 'new_announcement',
    'post_comment', 'post_reaction', 'wager_settled', 'bracket_released'
  ));

-- Realtime: the notification drawer (Task 13) subscribes to INSERTs on this
-- table so the bell badge updates live without a page reload. Guarded so
-- re-running this migration (or a project where it's already enabled)
-- doesn't error on a duplicate ADD TABLE.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'player_notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.player_notifications;
  END IF;
END $$;
