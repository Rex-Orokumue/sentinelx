-- 20260906152919_player_rank_snapshots.sql
-- Rank history for the leaderboard's Trend column. Rank is otherwise computed
-- per request and discarded, so there is nothing to compare "now" against.
-- game_id NULL = the global, all-games board.

CREATE TABLE public.player_rank_snapshots (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id    uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  game_id      uuid        REFERENCES public.games(id) ON DELETE CASCADE,
  rank         integer     NOT NULL CHECK (rank > 0),
  metric_value integer     NOT NULL,
  captured_on  date        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- One row per player per scope per day. Postgres treats NULLs as distinct, so a
-- single constraint over a nullable game_id would not stop duplicate global
-- rows — hence two partial unique indexes.
CREATE UNIQUE INDEX player_rank_snapshots_global_uniq
  ON public.player_rank_snapshots (player_id, captured_on)
  WHERE game_id IS NULL;

CREATE UNIQUE INDEX player_rank_snapshots_game_uniq
  ON public.player_rank_snapshots (player_id, game_id, captured_on)
  WHERE game_id IS NOT NULL;

CREATE INDEX player_rank_snapshots_lookup
  ON public.player_rank_snapshots (player_id, game_id, captured_on DESC);

ALTER TABLE public.player_rank_snapshots ENABLE ROW LEVEL SECURITY;

-- The leaderboard is public, so history is publicly readable. No write policies:
-- the cron route writes with the service-role client, which bypasses RLS.
CREATE POLICY "prs_public_read" ON public.player_rank_snapshots
  FOR SELECT USING (true);
