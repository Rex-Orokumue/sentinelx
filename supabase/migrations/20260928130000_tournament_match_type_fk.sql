-- tournaments.match_type was a CHECK-constrained enum ('bo1'/'bo3'/'bo5'),
-- the exact "hardcoded enum" shape the whole Game Designer effort exists to
-- remove (see 2026-09-27-game-designer-registration-fields-design.md §1) —
-- and independently duplicated as a hardcoded z.enum in admin-schema.ts.
-- Swapping it for an FK into match_types lets the new Match Types admin
-- section (this plan, Task 8/13) add a genuinely new option with no
-- migration — same trust model match_rule_id already uses: the FK is the
-- validity check, not a CHECK constraint that duplicates match_types' rows.
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS match_type_id uuid REFERENCES public.match_types(id) ON DELETE SET NULL;

-- Backfill by joining on the slug the old column already stored — this must
-- run before the column is dropped, and must preserve every live
-- tournament's match type (head-to-head football tournaments set this too,
-- not only mode-based games).
UPDATE public.tournaments t
   SET match_type_id = mt.id
  FROM public.match_types mt
 WHERE mt.slug = t.match_type;

ALTER TABLE public.tournaments DROP CONSTRAINT IF EXISTS tournaments_match_type_valid;
ALTER TABLE public.tournaments DROP COLUMN IF EXISTS match_type;
