-- 032_tournament_cancellation.sql
-- Adds 'cancelled' as a valid tournament status so admins can cancel a live
-- or announced tournament (e.g. Season 2) and unlock per-registration refunds.
ALTER TABLE public.tournaments DROP CONSTRAINT tournaments_status_check;
ALTER TABLE public.tournaments ADD CONSTRAINT tournaments_status_check
  CHECK (status IN (
    'draft', 'registration_open', 'registration_closed',
    'active', 'completed', 'cancelled'
  ));
