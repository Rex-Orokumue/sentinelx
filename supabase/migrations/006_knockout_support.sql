-- Knockout support: brackets materialize one round at a time (round N+1's players
-- are unknown until round N is verified) and byes are one-sided rows. Allow null
-- player slots and a 'bye' status. Safe because these nulls only occur on knockout
-- TBD/bye rows; group + played matches always set both players.
ALTER TABLE public.matches ALTER COLUMN player_a_id DROP NOT NULL;
ALTER TABLE public.matches ALTER COLUMN player_b_id DROP NOT NULL;

ALTER TABLE public.matches DROP CONSTRAINT matches_status_check;
ALTER TABLE public.matches
  ADD CONSTRAINT matches_status_check
  CHECK (status IN ('scheduled', 'live', 'completed', 'disputed', 'cancelled', 'bye'));
