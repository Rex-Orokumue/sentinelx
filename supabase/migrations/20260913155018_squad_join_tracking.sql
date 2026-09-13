-- A player chooses a squad to join before they pay (self-serve invite-code
-- flow, spec §5.1). The synchronous registration paths (waiver/free/coin-
-- discount-to-zero) can act on that choice immediately — the Paystack path
-- can't, because confirmRegistration only ever receives a bare reference
-- string. This column carries the choice from registerForTournament forward
-- to whichever function actually flips payment_status to 'paid'.
ALTER TABLE public.tournament_registrations
  ADD COLUMN joining_squad_id uuid REFERENCES public.squads(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.tournament_registrations.joining_squad_id IS
  'Squad this registration is joining, if any (entry_unit=squad self-serve). Consumed once by finalizeSquadJoin() when payment_status becomes paid — see lib/tournaments/squad-membership.ts.';
