-- 034_round_auto_scheduling.sql
-- Lets an admin set a tournament-wide round start date + gap between rounds,
-- so bracket generation and knockout advancement can auto-assign each new
-- round's full-day scheduled_at instead of requiring a manual date per match.
ALTER TABLE public.tournaments
  ADD COLUMN round_start_date date,
  ADD COLUMN round_gap_days   integer NOT NULL DEFAULT 1 CHECK (round_gap_days >= 1);
