-- 072_fc_mobile_and_round_robin.sql
-- Opens EA FC Mobile as the platform's second active game (Circuit Cup +
-- Elite Cup — see docs/superpowers/specs/2026-08-27-fc-mobile-competition-structure-design.md).

-- New tournament format: a single round-robin table with no knockout stage,
-- for Circuit Cup. Existing tournaments are all 'group_knockout' already.
ALTER TABLE public.tournaments DROP CONSTRAINT tournaments_format_check;
ALTER TABLE public.tournaments ADD CONSTRAINT tournaments_format_check
  CHECK (format IN ('group_knockout', 'round_robin'));

-- Generalized prize-split. prize_pool keeps its existing meaning (the
-- total, shown everywhere it's shown today); 1st place's actual credit is
-- derived as prize_pool - prize_second - prize_third, never stored, so
-- there is no prize_first column and no backfill needed. Both NULL (every
-- tournament today) reproduces today's winner-take-all exactly.
ALTER TABLE public.tournaments
  ADD COLUMN prize_second integer CHECK (prize_second IS NULL OR prize_second >= 0),
  ADD COLUMN prize_third  integer CHECK (prize_third  IS NULL OR prize_third  >= 0),
  ADD CONSTRAINT prize_splits_within_pool
    CHECK (COALESCE(prize_second, 0) + COALESCE(prize_third, 0) <= prize_pool);

-- Idempotent guard against double-crediting the 3rd-place prize (the final
-- and the third-place match can resolve in either order, and each is a
-- separate code path — see lib/matches/verify-actions.ts creditThirdPlacePrize).
ALTER TABLE public.tournaments
  ADD COLUMN third_place_prize_credited boolean NOT NULL DEFAULT false;

-- EA FC Mobile already exists (category='football', seeded inactive) —
-- just activate it.
UPDATE public.games SET active = true WHERE slug = 'ea-fc-mobile';
