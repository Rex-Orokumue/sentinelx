-- The direct_messages migration (applied earlier as 20260910061722, local file
-- 20260909204325_direct_messages.sql) added 'direct_message' to this CHECK.
-- The concurrent status-notifications migration
-- (20260909210032_status_notification_types.sql, applied later as
-- 20260910064041) did its own DROP/ADD CONSTRAINT on the same check to add
-- its 3 types — clobbering 'direct_message' since neither migration knew
-- about the other. This restores it alongside the status types, matching
-- what's actually live in production right now.
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
    'status_removed','direct_message'
  ]::text[]));
