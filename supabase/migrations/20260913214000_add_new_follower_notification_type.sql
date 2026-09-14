-- Adds 'new_follower' to player_notifications_type_check for the
-- new-follower notification (lib/follows/actions.ts calls notifyBoth, which
-- inserts a player_notifications row via notifyInAppOf).
--
-- This constraint has collided across concurrent-session migrations before
-- (see 20260910065041_restore_direct_message_notification_type.sql) — always
-- verify with `SELECT pg_get_constraintdef(...)` against the live DB
-- immediately before writing a DROP/ADD here, since a local migration file
-- is not proof of what's actually live.
ALTER TABLE public.player_notifications DROP CONSTRAINT player_notifications_type_check;
ALTER TABLE public.player_notifications ADD CONSTRAINT player_notifications_type_check
  CHECK (type = ANY (ARRAY[
    'listing_approved','listing_removed','listing_deleted','listing_sold','withdrawal_paid',
    'withdrawal_rejected','result_confirmed','referral_credited','friend_request','wallet_credited',
    'player_disqualified','noshow_needs_decision','buy_request_in_progress','buy_request_fulfilled',
    'buy_request_closed','masters_invitation','champions_cup_invitation','invitation_accepted',
    'invitation_expired_cascade','tier_upgraded','achievement_unlocked','fixture_assigned',
    'prize_credited','match_reminder','tournament_announced','new_announcement','post_comment',
    'post_reaction','wager_settled','bracket_released','withdrawal_pending','exchange_listing_pending',
    'result_needs_review','result_disputed','result_no_submission','status_from_friend','status_viewed',
    'status_removed','direct_message','new_follower'
  ]::text[]));
