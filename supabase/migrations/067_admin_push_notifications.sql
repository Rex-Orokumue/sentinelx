-- 067_admin_push_notifications.sql
-- Widens player_notifications_type_check for five admin-facing event types
-- that previously only existed in the pull-based admin dashboard queue
-- (lib/admin/notification-queue.ts) and are now pushed to staff in real
-- time via the new notifyStaff() fan-out (lib/admin/staff.ts). Paired with
-- the code fix in lib/matches/noshow-actions.ts that adds the FCM push tier
-- the existing noshow_needs_decision alert was missing (that type is
-- already permitted by this constraint since migration 038 — no schema
-- change needed for it).
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
    'withdrawal_pending', 'exchange_listing_pending',
    'result_needs_review', 'result_disputed', 'result_no_submission'
  ));
