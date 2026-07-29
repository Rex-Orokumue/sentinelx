-- 037_noshow_flagged_at.sql
-- Marks the first time the hourly no-show sweep saw this match cross its
-- deadline while still scheduled/live. Purely a detection marker — the
-- sweep itself no longer writes any score or status (see
-- docs/superpowers/specs/2026-07-29-noshow-sweep-detect-and-alert-design.md).
-- NULL means "not yet flagged, or already resolved by an admin action."
ALTER TABLE public.matches ADD COLUMN noshow_flagged_at timestamptz;
