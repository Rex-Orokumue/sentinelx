-- 046_third_place_match.sql
-- Adds a 'third_place' round for the bronze match between the two semifinal
-- losers. Deliberately not part of ROUND_ORDER's progression chain (see
-- lib/tournaments/bracket.ts) — it's a sibling of the Final, not a successor.
-- See docs/superpowers/specs/2026-08-03-third-place-match-design.md.

ALTER TABLE public.matches DROP CONSTRAINT matches_round_check;
ALTER TABLE public.matches
  ADD CONSTRAINT matches_round_check
  CHECK (round IN (
    'group', 'round_of_32', 'round_of_16',
    'quarter_final', 'semi_final', 'final', 'third_place'
  ));
