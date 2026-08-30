-- 075_manual_knockout_pairing.sql
-- Opt-in: when true, a finished knockout round (or the finished group stage)
-- does NOT auto-generate the next round. The admin arranges each round's
-- pairings in the bracket page's pairing editor, and createKnockoutRound
-- inserts + notifies. Default false = unchanged auto-advancement.
-- See lib/matches/verify-actions.ts (advanceKnockout / recomputeGroupAndMaybeAdvance)
-- and lib/tournaments/knockout-pairing-actions.ts.

alter table public.tournaments
  add column manual_knockout_pairing boolean not null default false;
