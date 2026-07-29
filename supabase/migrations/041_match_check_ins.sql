-- 041_match_check_ins.sql
-- A player marking themselves present for a match. Evidence for the admin
-- deciding a no-show: "one player showed up and the other never did" is the
-- common case, and until now nothing in the system could tell it apart from
-- a mutual no-show (see the 2026-07-29 detect-and-alert design).
--
-- This records presence only. It never resolves a match on its own — every
-- outcome stays an explicit admin action.
CREATE TABLE public.match_check_ins (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id      uuid        NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  player_id     uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  checked_in_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_id, player_id)
);

CREATE INDEX ON public.match_check_ins (match_id);

ALTER TABLE public.match_check_ins ENABLE ROW LEVEL SECURITY;

-- Public read: both players (and spectators) see who has checked in, the same
-- way scores and fixtures are public.
CREATE POLICY "mci_public_read" ON public.match_check_ins
  FOR SELECT USING (true);

-- A player may only check themselves in. Writes otherwise go through the
-- service-role client, which bypasses RLS.
CREATE POLICY "mci_own_insert" ON public.match_check_ins
  FOR INSERT WITH CHECK (auth.uid() = player_id);

-- Presence is a fact, not a toggle — there is no self-update/delete policy.
-- Staff can clear a mistaken entry via the service-role client if ever needed.
