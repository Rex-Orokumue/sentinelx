-- Adds 'chat_budget_alert' to player_notifications_type_check (mobile 5c).
--
-- The support-chat daily budget alert goes to staff through notifyStaff (lib/chat/budget-alert.ts), which
-- writes a bell row of this type. This CHECK is hand-maintained; without the new member the insert fails and
-- is swallowed. lib/notifications/type-check-sync.test.ts pins NotificationType to the newest migration that
-- defines this constraint.
--
-- BEFORE APPLYING: re-verify the live definition still equals the list below minus 'chat_budget_alert' (see the
-- warning in 20260913214000_add_new_follower_notification_type.sql). This was NOT verified against a live
-- database when written (database access was unavailable in the authoring session).
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
    'status_removed','direct_message','new_follower','result_submitted','chat_budget_alert'
  ]::text[]));
