-- 040_tournament_registrations_waitlisted.sql
-- Extends tournament_registrations.status to allow 'waitlisted' — a player
-- who has signaled availability as a potential substitute once registration
-- is closed/active, but hasn't paid or been placed into a group/bracket.
-- Admin promotes a waitlisted player into an active substitute registration
-- via the existing addSubstitute flow (lib/tournaments/registrations-admin-actions.ts).
ALTER TABLE public.tournament_registrations DROP CONSTRAINT tournament_registrations_status_check;
ALTER TABLE public.tournament_registrations
  ADD CONSTRAINT tournament_registrations_status_check
  CHECK (status IN ('active', 'disqualified', 'withdrawn', 'waitlisted'));
