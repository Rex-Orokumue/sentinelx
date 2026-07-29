-- 039_noshow_needs_decision_whatsapp_type.sql
-- Extends notifications.type (the WhatsApp send-log table, distinct from
-- player_notifications) to allow 'noshow_needs_decision'. Discovered during
-- manual verification of the no-show sweep rewrite: notify()'s insert into
-- this table is wrapped in a best-effort try/catch, so without this the
-- WhatsApp alert would silently never send and leave no audit row.
ALTER TABLE public.notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'registration_confirmed', 'fixture_reminder', 'result_confirmed',
    'prize_credited', 'escrow_sale', 'escrow_completed', 'escrow_refunded',
    'noshow_needs_decision'
  ));
