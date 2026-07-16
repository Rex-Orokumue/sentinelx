-- Tournament fee waivers — admin-granted free entry, one per (tournament, player).
-- Redeeming is an atomic conditional UPDATE (see lib/tournaments/actions.ts),
-- not a check-then-update, so redeemed_at can never be set twice.
CREATE TABLE public.tournament_fee_waivers (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid        NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  player_id     uuid        NOT NULL REFERENCES public.profiles(id),
  granted_by    uuid        NOT NULL REFERENCES public.profiles(id),
  reason        text,
  granted_at    timestamptz NOT NULL DEFAULT now(),
  redeemed_at   timestamptz,
  UNIQUE (tournament_id, player_id)
);

CREATE INDEX ON public.tournament_fee_waivers (tournament_id);

ALTER TABLE public.tournament_fee_waivers ENABLE ROW LEVEL SECURITY;

-- Staff-only visibility — players never read this table directly; the
-- registration flow checks it server-side via the admin (service-role) client.
CREATE POLICY "waivers_staff_read" ON public.tournament_fee_waivers
  FOR SELECT USING (public.is_staff());
-- Granting/revoking waives real money — admin-only, not moderator.
CREATE POLICY "waivers_admin_insert" ON public.tournament_fee_waivers
  FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY "waivers_admin_delete" ON public.tournament_fee_waivers
  FOR DELETE USING (public.is_admin());

-- Distinguishes a comped registration from a real Paystack payment for
-- financial reporting. payment_status stays 'paid' for both, so every
-- existing capacity/bracket/view-state check keeps working unchanged.
ALTER TABLE public.tournament_registrations
  ADD COLUMN fee_waived boolean NOT NULL DEFAULT false;
