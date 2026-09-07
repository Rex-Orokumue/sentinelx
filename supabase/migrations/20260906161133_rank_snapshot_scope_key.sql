-- 20260906161133_rank_snapshot_scope_key.sql
-- Fixes upsert on player_rank_snapshots.
--
-- 20260906152919_player_rank_snapshots enforced "one row per player, per scope, per day" with two PARTIAL unique
-- indexes (game_id IS NULL / IS NOT NULL), because Postgres treats NULLs as
-- distinct. That constraint is correct, but a partial index cannot be inferred
-- as an ON CONFLICT target — Postgres requires the statement to repeat the
-- index predicate, which PostgREST cannot emit. Every upsert therefore failed
-- with "no unique or exclusion constraint matching the ON CONFLICT
-- specification" and the job wrote nothing.
--
-- A generated column normalises the NULL away, so a single ordinary unique
-- index covers both scopes and is inferable.

ALTER TABLE public.player_rank_snapshots
  ADD COLUMN scope_key uuid
    GENERATED ALWAYS AS (COALESCE(game_id, '00000000-0000-0000-0000-000000000000'::uuid)) STORED;

DROP INDEX IF EXISTS public.player_rank_snapshots_global_uniq;
DROP INDEX IF EXISTS public.player_rank_snapshots_game_uniq;

CREATE UNIQUE INDEX player_rank_snapshots_scope_uniq
  ON public.player_rank_snapshots (player_id, scope_key, captured_on);
