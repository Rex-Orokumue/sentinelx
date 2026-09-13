-- What is actually being PLAYED, as opposed to how it is scored.
--
-- Mode is the parent: it decides competition_format (Battle Royale is a points
-- race; Clash Squad and Lone Wolf are head-to-head), and both the Format and
-- Map pools hang off it. The design mock had this inverted — a tab row of
-- 1v1/2v2/4v4/Battle Royale with Mode nested inside — which mixes game mode
-- with team size and lets Map be chosen independently of Mode. That produced
-- "1v1 · Clash Squad · Bermuda" on screen, and Bermuda is a BR map.
CREATE TABLE public.game_modes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id            uuid NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  slug               text NOT NULL,
  name               text NOT NULL,
  seq                int  NOT NULL DEFAULT 1,
  active             boolean NOT NULL DEFAULT true,
  -- Mode DECIDES the engine, so the admin never picks competition_format
  -- directly for a game that has modes.
  competition_format text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT game_modes_format_valid
    CHECK (competition_format IN ('head_to_head', 'points_race')),
  CONSTRAINT game_modes_slug_uniq UNIQUE (game_id, slug),
  -- Composite target so a format/map can be tied to one game's mode.
  CONSTRAINT game_modes_id_game_uniq UNIQUE (id, game_id)
);

-- The CATALOGUE of team shapes. It defines what "Clash Squad 4v4" means;
-- tournaments.entry_unit / squad_size remain the authoritative stored values
-- (see the next migration and spec 5.0). Only one is ever typed in, so they
-- cannot disagree.
CREATE TABLE public.game_mode_formats (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode_id    uuid NOT NULL REFERENCES public.game_modes(id) ON DELETE CASCADE,
  slug       text NOT NULL,
  name       text NOT NULL,
  seq        int  NOT NULL DEFAULT 1,
  active     boolean NOT NULL DEFAULT true,
  entry_unit text NOT NULL,
  team_size  int  NOT NULL,
  -- false renders greyed as "Coming soon" — visible so the roadmap reads,
  -- unselectable so nobody creates a tournament the platform cannot finish.
  -- A DATA flag on purpose: enabling 4v4 later is an UPDATE, not a deploy.
  available  boolean NOT NULL DEFAULT false,

  CONSTRAINT gmf_entry_unit_valid CHECK (entry_unit IN ('solo', 'squad')),
  CONSTRAINT gmf_team_size_range  CHECK (team_size BETWEEN 1 AND 6),
  CONSTRAINT gmf_slug_uniq        UNIQUE (mode_id, slug)
);

CREATE TABLE public.game_mode_maps (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode_id uuid NOT NULL REFERENCES public.game_modes(id) ON DELETE CASCADE,
  name    text NOT NULL,
  seq     int  NOT NULL DEFAULT 1,
  active  boolean NOT NULL DEFAULT true,

  CONSTRAINT gmm_name_uniq UNIQUE (mode_id, name)
);

-- Series length. Global rather than per-mode because the blocker is global:
-- `matches` is one row with one scoreline, so a best-of-three needs a series
-- concept that exists for no mode at all.
CREATE TABLE public.match_types (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug      text NOT NULL UNIQUE,
  name      text NOT NULL,
  seq       int  NOT NULL DEFAULT 1,
  active    boolean NOT NULL DEFAULT true,
  available boolean NOT NULL DEFAULT false
);

CREATE INDEX game_modes_game_idx        ON public.game_modes (game_id, seq);
CREATE INDEX game_mode_formats_mode_idx ON public.game_mode_formats (mode_id, seq);
CREATE INDEX game_mode_maps_mode_idx    ON public.game_mode_maps (mode_id, seq);

ALTER TABLE public.game_modes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_mode_formats  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_mode_maps     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_types        ENABLE ROW LEVEL SECURITY;

-- Catalogue data is public: a player reading a tournament page needs to see
-- that it is Clash Squad on Bermuda.
CREATE POLICY "game_modes_public_read"  ON public.game_modes        FOR SELECT USING (true);
CREATE POLICY "gmf_public_read"         ON public.game_mode_formats FOR SELECT USING (true);
CREATE POLICY "gmm_public_read"         ON public.game_mode_maps    FOR SELECT USING (true);
CREATE POLICY "match_types_public_read" ON public.match_types       FOR SELECT USING (true);

CREATE POLICY "game_modes_staff_write"  ON public.game_modes        FOR ALL USING (is_staff()) WITH CHECK (is_staff());
CREATE POLICY "gmf_staff_write"         ON public.game_mode_formats FOR ALL USING (is_staff()) WITH CHECK (is_staff());
CREATE POLICY "gmm_staff_write"         ON public.game_mode_maps    FOR ALL USING (is_staff()) WITH CHECK (is_staff());
CREATE POLICY "match_types_staff_write" ON public.match_types       FOR ALL USING (is_staff()) WITH CHECK (is_staff());

-- ── Seed: match types ──────────────────────────────────────────────────────
-- Only bo1 is buildable; bo3/bo5 exist so the roadmap is visible and so
-- enabling them later is an UPDATE.
INSERT INTO public.match_types (slug, name, seq, available) VALUES
  ('bo1', 'Best of 1', 1, true),
  ('bo3', 'Best of 3', 2, false),
  ('bo5', 'Best of 5', 3, false);

-- ── Seed: Free Fire ────────────────────────────────────────────────────────
INSERT INTO public.game_modes (game_id, slug, name, seq, competition_format)
SELECT g.id, v.slug, v.name, v.seq, v.fmt
  FROM public.games g
  JOIN (VALUES
    ('battle_royale', 'Battle Royale', 1, 'points_race'),
    ('clash_squad',   'Clash Squad',   2, 'head_to_head'),
    ('lone_wolf',     'Lone Wolf',     3, 'head_to_head')
  ) AS v(slug, name, seq, fmt) ON true
 WHERE g.slug = 'free-fire';

-- Formats. `available` is true only where the platform can actually finish the
-- tournament today: BR Duo/Squad need squad registration (nothing writes
-- squads yet), and every 2v2/4v4 needs teams on both sides of a matches row.
INSERT INTO public.game_mode_formats (mode_id, slug, name, seq, entry_unit, team_size, available)
SELECT m.id, v.slug, v.name, v.seq, v.unit, v.size, v.avail
  FROM public.game_modes m
  JOIN public.games g ON g.id = m.game_id AND g.slug = 'free-fire'
  JOIN (VALUES
    ('battle_royale', 'solo',  'Solo',  1, 'solo',  1, true),
    ('battle_royale', 'duo',   'Duo',   2, 'squad', 2, false),
    ('battle_royale', 'squad', 'Squad', 3, 'squad', 4, false),
    ('clash_squad',   '1v1',   '1v1',   1, 'solo',  1, true),
    ('clash_squad',   '2v2',   '2v2',   2, 'squad', 2, false),
    ('clash_squad',   '4v4',   '4v4',   3, 'squad', 4, false),
    ('lone_wolf',     '1v1',   '1v1',   1, 'solo',  1, true),
    ('lone_wolf',     '2v2',   '2v2',   2, 'squad', 2, false)
  ) AS v(mode_slug, slug, name, seq, unit, size, avail) ON v.mode_slug = m.slug;

-- Maps. A SEED, not a truth: pools rotate by season and Clash Squad's ranked
-- and custom lists already differ, which is why these are rows and not an enum.
INSERT INTO public.game_mode_maps (mode_id, name, seq)
SELECT m.id, v.name, v.seq
  FROM public.game_modes m
  JOIN public.games g ON g.id = m.game_id AND g.slug = 'free-fire'
  JOIN (VALUES
    ('battle_royale', 'Bermuda',            1),
    ('battle_royale', 'Purgatory',          2),
    ('battle_royale', 'Alpine',             3),
    ('battle_royale', 'Kalahari',           4),
    ('battle_royale', 'NeXTerra',           5),
    ('battle_royale', 'Solara',             6),
    ('clash_squad',   'Bermuda',            1),
    ('clash_squad',   'Bermuda Remastered', 2),
    ('clash_squad',   'Alpine',             3),
    ('clash_squad',   'Kalahari',           4),
    ('clash_squad',   'Purgatory',          5),
    ('clash_squad',   'NeXTerra',           6),
    ('lone_wolf',     'Iron Cage',          1)
  ) AS v(mode_slug, name, seq) ON v.mode_slug = m.slug;
