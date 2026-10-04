-- Adds 'result_submitted' to player_notifications_type_check.
--
-- submitMatchResult tells the OTHER side when a result is submitted
-- (lib/matches/submit-result-service.ts -> notifyBoth(..., 'result_submitted')).
-- The type exists in NotificationType but was never added to this hand-maintained
-- CHECK, so every bell insert failed and was swallowed (insertRendered catches
-- everything): zero 'result_submitted' rows have ever existed, on any
-- environment. Push was unaffected, which is why nobody noticed.
--
-- Verified against both live databases (identical definition, md5
-- 704d0044b421515012c3c2c4b5210fbb) immediately before writing this, per the
-- warning in 20260913214000_add_new_follower_notification_type.sql.
-- lib/notifications/type-check-sync.test.ts now fails if a NotificationType
-- member is missing from the newest migration that defines this constraint.
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
    'status_removed','direct_message','new_follower','result_submitted'
  ]::text[]));
