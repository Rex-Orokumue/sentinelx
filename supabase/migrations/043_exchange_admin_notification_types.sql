-- 043_exchange_admin_notification_types.sql
-- Extends player_notifications.type for the new admin "delete listing" and
-- "mark listing sold" actions (see
-- docs/superpowers/plans/2026-08-02-admin-listing-management.md). Without
-- this, notifyInApp() silently fails its insert (caught by its best-effort
-- try/catch) and the seller never sees a bell notification.
ALTER TABLE public.player_notifications DROP CONSTRAINT player_notifications_type_check;
ALTER TABLE public.player_notifications
  ADD CONSTRAINT player_notifications_type_check
  CHECK (type IN (
    'listing_approved', 'listing_removed',
    'withdrawal_paid', 'withdrawal_rejected',
    'result_confirmed', 'referral_credited',
    'friend_request', 'wallet_credited',
    'player_disqualified', 'noshow_needs_decision',
    'listing_deleted', 'listing_sold'
  ));
