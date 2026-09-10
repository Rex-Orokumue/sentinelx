-- Statuses (shipped 2026-09-09) launched with notifications out of scope.
-- This adds three: a friend posted a status, someone viewed your status, a
-- moderator removed your status. All three flow through player_notifications
-- (in-app bell) + FCM push; no WhatsApp.
--
-- Two halves, mirroring 080_enable_reaction_push.sql:
--   1. widen the player_notifications type CHECK (an unknown type makes the
--      best-effort insert silently no-op)
--   2. seed the two user-facing push prefs to true, on the column default and
--      on every existing row (status_removed has no pref — moderation notices
--      are always delivered)

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
    'post_comment', 'post_reaction', 'wager_settled', 'bracket_released',
    'withdrawal_pending', 'exchange_listing_pending', 'result_needs_review',
    'result_disputed', 'result_no_submission',
    'status_from_friend', 'status_viewed', 'status_removed'
  ));

ALTER TABLE public.profiles
  ALTER COLUMN notification_prefs SET DEFAULT '{
    "whatsapp": {
      "match_reminder": true,
      "result_confirmed": true,
      "prize_credited": true,
      "challenge_completed": false,
      "achievement_unlocked": false,
      "registration_confirmed": true
    },
    "push": {
      "match_reminder": true,
      "result_confirmed": true,
      "achievement_unlocked": true,
      "challenge_completed": true,
      "new_announcement": true,
      "tournament_announced": true,
      "wager_settled": true,
      "referral_converted": true,
      "post_comment": true,
      "post_reaction": true,
      "bracket_released": true,
      "match_assigned": true,
      "prize_credited": true,
      "status_from_friend": true,
      "status_viewed": true
    },
    "achievement_sharing": {
      "tournament": true,
      "milestone": true,
      "streak": true,
      "social": false,
      "other": false
    }
  }'::jsonb;

-- Add each key only where it is absent, so a deliberate opt-out made after
-- this ships is never overridden and the statement is safe to re-run.
UPDATE public.profiles
SET notification_prefs = jsonb_set(notification_prefs, '{push,status_from_friend}', 'true'::jsonb)
WHERE notification_prefs -> 'push' -> 'status_from_friend' IS NULL;

UPDATE public.profiles
SET notification_prefs = jsonb_set(notification_prefs, '{push,status_viewed}', 'true'::jsonb)
WHERE notification_prefs -> 'push' -> 'status_viewed' IS NULL;
