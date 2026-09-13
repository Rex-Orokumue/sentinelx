-- All nullable: a football tournament has no mode and keeps its existing
-- Competition Format picker. Verified 2026-09-12 that every one of the 7
-- production tournaments is football (DLS 5, EA FC 2), so no backfill exists
-- to do — this is a fact, not a deferral.
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS mode_id        uuid REFERENCES public.game_modes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS format_id      uuid REFERENCES public.game_mode_formats(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS default_map_id uuid REFERENCES public.game_mode_maps(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS match_rules    text,
  ADD COLUMN IF NOT EXISTS match_type     text;

ALTER TABLE public.tournaments
  ADD CONSTRAINT tournaments_match_rules_valid
    CHECK (match_rules IS NULL OR match_rules IN ('normal', 'headshot_only', 'spam')),
  -- Permits every value the roadmap will ever enable. A CHECK allowing only
  -- 'bo1' would make turning on Bo3 a MIGRATION, defeating the whole point of
  -- gating by data — match_types.available is what hides it today.
  ADD CONSTRAINT tournaments_match_type_valid
    CHECK (match_type IS NULL OR match_type IN ('bo1', 'bo3', 'bo5'));

COMMENT ON COLUMN public.tournaments.match_type IS
  'Series length for head-to-head modes. NULL for Battle Royale, where tournament_stages.rounds_count already owns match length.';

-- A six-match BR event is rarely six Bermudas, so a lobby may override the
-- tournament default.
ALTER TABLE public.tournament_lobbies
  ADD COLUMN IF NOT EXISTS map_id uuid REFERENCES public.game_mode_maps(id) ON DELETE SET NULL;
