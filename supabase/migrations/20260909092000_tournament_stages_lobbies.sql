-- Stages of N rounds, with points accumulating WITHIN a stage and the top
-- advance_count carried into the next. This is the shape real BR competition
-- uses — Free Fire World Series, PUBG Mobile Global Championship, and Free
-- Fire's own Nigerian circuits all run qualifiers-then-finals this way.
--
-- A one-off single-lobby scrim is the same model with one stage, one round and
-- advance_count = 1, so there is no special case for the small tournament.
CREATE TABLE public.tournament_stages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  seq           int  NOT NULL,
  name          text NOT NULL,
  rounds_count  int  NOT NULL,
  lobby_size    int  NOT NULL,
  advance_count int  NOT NULL,
  -- Copied from games.default_points_config at creation, then editable per
  -- stage: a qualifier and a final may legitimately weight kills differently.
  points_config jsonb NOT NULL,
  status        text NOT NULL DEFAULT 'pending',
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT stages_status_valid  CHECK (status IN ('pending', 'live', 'complete')),
  CONSTRAINT stages_rounds_range  CHECK (rounds_count BETWEEN 1 AND 20),
  CONSTRAINT stages_lobby_range   CHECK (lobby_size   BETWEEN 2 AND 100),
  CONSTRAINT stages_advance_range CHECK (advance_count >= 1),
  CONSTRAINT stages_seq_positive  CHECK (seq >= 1),
  CONSTRAINT stages_seq_uniq      UNIQUE (tournament_id, seq),
  CONSTRAINT stages_id_tournament_uniq UNIQUE (id, tournament_id)
);

CREATE TABLE public.tournament_lobbies (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id           uuid NOT NULL REFERENCES public.tournament_stages(id) ON DELETE CASCADE,
  round_no           int  NOT NULL,
  label              text NOT NULL,
  -- Custom-room credentials the players need to actually get in. Not secret
  -- from entrants, but not public either — see the RLS note below.
  room_id            text,
  room_password      text,
  scheduled_at       timestamptz,
  youtube_stream_url text,
  status             text NOT NULL DEFAULT 'scheduled',
  created_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT lobbies_status_valid CHECK (status IN ('scheduled', 'live', 'awaiting_results', 'confirmed')),
  CONSTRAINT lobbies_round_positive CHECK (round_no >= 1),
  CONSTRAINT lobbies_label_round_uniq UNIQUE (stage_id, round_no, label)
);

CREATE INDEX lobbies_stage_round_idx ON public.tournament_lobbies (stage_id, round_no);

CREATE TABLE public.lobby_entrants (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lobby_id   uuid NOT NULL REFERENCES public.tournament_lobbies(id) ON DELETE CASCADE,
  entrant_id uuid NOT NULL REFERENCES public.tournament_entrants(id) ON DELETE CASCADE,

  CONSTRAINT lobby_entrants_uniq UNIQUE (lobby_id, entrant_id)
);

CREATE INDEX lobby_entrants_entrant_idx ON public.lobby_entrants (entrant_id);

CREATE TABLE public.lobby_results (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lobby_id         uuid NOT NULL REFERENCES public.tournament_lobbies(id) ON DELETE CASCADE,
  entrant_id       uuid NOT NULL REFERENCES public.tournament_entrants(id) ON DELETE CASCADE,
  placement        int  NOT NULL,
  kills            int  NOT NULL DEFAULT 0,
  -- Points are FROZEN here at confirm time rather than recomputed from the
  -- stage's points_config on read. An admin editing a stage's points table must
  -- not silently rewrite the history of rounds already played.
  placement_points int  NOT NULL DEFAULT 0,
  kill_points      int  NOT NULL DEFAULT 0,
  total_points     int  GENERATED ALWAYS AS (placement_points + kill_points) STORED,
  submitted_by     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  screenshot_url   text,
  status           text NOT NULL DEFAULT 'pending',
  verified_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  verified_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT lobby_results_status_valid CHECK (status IN ('pending', 'confirmed', 'disputed')),
  CONSTRAINT lobby_results_placement_positive CHECK (placement >= 1),
  CONSTRAINT lobby_results_kills_nonneg CHECK (kills >= 0),
  CONSTRAINT lobby_results_one_per_entrant UNIQUE (lobby_id, entrant_id)
);

CREATE INDEX lobby_results_lobby_idx   ON public.lobby_results (lobby_id);
CREATE INDEX lobby_results_entrant_idx ON public.lobby_results (entrant_id, status);

ALTER TABLE public.tournament_stages  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_lobbies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lobby_entrants     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lobby_results      ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stages_public_read"         ON public.tournament_stages  FOR SELECT USING (true);
CREATE POLICY "lobby_entrants_public_read" ON public.lobby_entrants     FOR SELECT USING (true);

-- Only CONFIRMED results are public. A pending submission is one player's
-- unverified claim, and publishing it would let the feed argue about a
-- scoreline before an admin has ruled on it.
CREATE POLICY "lobby_results_confirmed_read" ON public.lobby_results
  FOR SELECT USING (status = 'confirmed' OR is_staff());

-- Lobbies are public EXCEPT their room credentials, which would let anyone
-- walk into a paid custom room. The public tournament page must select columns
-- explicitly and never room_id/room_password; those reach entrants through a
-- Server Action that checks membership.
CREATE POLICY "lobbies_public_read" ON public.tournament_lobbies FOR SELECT USING (true);

CREATE POLICY "stages_staff_write"         ON public.tournament_stages  FOR ALL USING (is_staff()) WITH CHECK (is_staff());
CREATE POLICY "lobbies_staff_write"        ON public.tournament_lobbies FOR ALL USING (is_staff()) WITH CHECK (is_staff());
CREATE POLICY "lobby_entrants_staff_write" ON public.lobby_entrants     FOR ALL USING (is_staff()) WITH CHECK (is_staff());
CREATE POLICY "lobby_results_staff_write"  ON public.lobby_results      FOR ALL USING (is_staff()) WITH CHECK (is_staff());
