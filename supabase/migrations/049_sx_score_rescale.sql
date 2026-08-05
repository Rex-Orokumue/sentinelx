-- 049_sx_score_rescale.sql
-- Phase 2 Economy §2: rename Sentinel Score -> SX Score and rescale ×10,
-- removing the 0-100 upper cap (now floored at 0 only). See
-- docs/superpowers/specs/2026-08-05-phase2-economy-design.md §2.

ALTER TABLE public.sentinel_score_events RENAME TO sx_score_events;
ALTER TABLE public.profiles RENAME COLUMN sentinel_score TO sx_score;

-- Drop the old 0-100 constraint BEFORE rescaling — it still enforces <=100
-- (constraints follow a renamed column, they don't get renamed themselves).
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_sentinel_score_check;

UPDATE public.profiles SET sx_score = sx_score * 10;
UPDATE public.sx_score_events SET points_delta = points_delta * 10;

ALTER TABLE public.profiles ADD CONSTRAINT profiles_sx_score_check CHECK (sx_score >= 0);

-- sentinel_tier is a separate, still-live concept (reliability tier, distinct
-- from the new XP-based membership_tier added in 050) — kept as-is, just
-- rescaled ×10 so it still means the same real-world skill band.
ALTER TABLE public.profiles DROP COLUMN sentinel_tier;
ALTER TABLE public.profiles ADD COLUMN sentinel_tier text GENERATED ALWAYS AS (
  CASE
    WHEN sx_score >= 900 THEN 'elite'
    WHEN sx_score >= 750 THEN 'trusted'
    WHEN sx_score >= 600 THEN 'developing'
    ELSE 'at_risk'
  END
) STORED;

-- RLS policies are attached to the table, not the column/name — renaming the
-- table preserves them under Postgres, but the policy names still say "sse_*"
-- for readability. Recreate with sx_* names for consistency going forward.
DROP POLICY IF EXISTS "sse_read" ON public.sx_score_events;
DROP POLICY IF EXISTS "sse_staff_insert" ON public.sx_score_events;
CREATE POLICY "sx_score_events_read" ON public.sx_score_events
  FOR SELECT USING (auth.uid() = player_id OR public.is_staff());
CREATE POLICY "sx_score_events_staff_insert" ON public.sx_score_events
  FOR INSERT WITH CHECK (public.is_staff());
