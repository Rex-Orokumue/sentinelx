-- Records that a match was ever disputed.
--
-- A win ruled AFTER an admin dispute no longer earns the +90 "no dispute"
-- SX bonus (lib/scoring/events.ts). matches.status can't carry that: disputeResult
-- sets it to 'disputed' and confirmResult overwrites it with 'completed', so once
-- the admin rules there is no trace. disputed_at is set when a match is disputed
-- and never cleared.
--
-- Additive and nullable, so it is safe to apply BEFORE the code that reads it
-- deploys (the scoring query selects this column; deploying the code first would
-- break event regeneration until the column existed).
--
-- Backfill: a dispute that is open right now has no timestamp yet; stamp it so
-- that the ruling, when it comes, is scored under the new rule. Matches already
-- ruled after a dispute are NOT backfilled (nothing reliably identifies them),
-- so no existing score changes.
ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS disputed_at timestamptz;

UPDATE public.matches SET disputed_at = now() WHERE status = 'disputed' AND disputed_at IS NULL;
