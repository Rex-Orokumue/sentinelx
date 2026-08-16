-- 061_community_challenges_admin.sql
-- Adds admin-editable state to community_challenges — previously DB-only
-- (create/edit/deactivate had no admin UI, only a direct migration/SQL
-- edit). `active` gates both the player-facing widget (challenge-query.ts)
-- and progress tracking (challenges.ts's incrementChallenge) so a
-- deactivated challenge stops appearing and stops accruing progress.
ALTER TABLE public.community_challenges
  ADD COLUMN active boolean NOT NULL DEFAULT true;

-- All 4 seeded challenges (016/056) stay active by default — no backfill
-- needed beyond the column default.
