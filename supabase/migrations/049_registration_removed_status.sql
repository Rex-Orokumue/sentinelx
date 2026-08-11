-- 049_registration_removed_status.sql
-- Extends tournament_registrations.status to allow 'removed' — a soft
-- removal by an admin without the sentinel-score penalty of 'disqualified'.
ALTER TABLE public.tournament_registrations DROP CONSTRAINT tournament_registrations_status_check;
ALTER TABLE public.tournament_registrations
  ADD CONSTRAINT tournament_registrations_status_check
  CHECK (status IN ('active', 'disqualified', 'waitlisted', 'removed'));
