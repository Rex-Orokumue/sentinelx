-- Competition format lives on the TOURNAMENT, not the game. COD Mobile can
-- host a 1v1 gunfight cup or a battle-royale circuit, and the same games row
-- has to support both. Putting it on the game would force a duplicate game row
-- per format.
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS competition_format text NOT NULL DEFAULT 'head_to_head',
  ADD COLUMN IF NOT EXISTS entry_unit         text NOT NULL DEFAULT 'solo',
  ADD COLUMN IF NOT EXISTS squad_size         int;

ALTER TABLE public.tournaments
  ADD CONSTRAINT tournaments_competition_format_valid
    CHECK (competition_format IN ('head_to_head', 'points_race')),
  ADD CONSTRAINT tournaments_entry_unit_valid
    CHECK (entry_unit IN ('solo', 'squad')),
  -- A squad tournament must say how big a squad is; a solo one must not pretend to.
  ADD CONSTRAINT tournaments_squad_size_present
    CHECK ((entry_unit = 'squad') = (squad_size IS NOT NULL)),
  ADD CONSTRAINT tournaments_squad_size_range
    CHECK (squad_size IS NULL OR squad_size BETWEEN 2 AND 6),
  -- Squads are a points-race concept only, until roadmap #21b (persistent
  -- team/school/state leagues) says otherwise.
  ADD CONSTRAINT tournaments_squads_are_points_race
    CHECK (competition_format = 'points_race' OR entry_unit = 'solo');

COMMENT ON COLUMN public.tournaments.competition_format IS
  'head_to_head = the original 1v1 groups+knockout engine. points_race = battle-royale lobbies scored on placement + kills.';

-- Which formats a game may legitimately be run in. Data, not code, so adding
-- PUBG Mobile as a BR game later is one UPDATE rather than a deploy.
ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS supported_formats      text[] NOT NULL DEFAULT '{head_to_head}',
  ADD COLUMN IF NOT EXISTS default_points_config  jsonb;

-- Battle-royale games. Values are the games' own competitive rulesets (FFWS
-- for Free Fire, PMGC for PUBG Mobile), not invented numbers.
UPDATE public.games
   SET supported_formats = '{head_to_head,points_race}',
       default_points_config =
         '{"placement": [12, 9, 8, 7, 6, 5, 4, 3, 2, 1], "per_kill": 1}'::jsonb
 WHERE slug = 'free-fire';

UPDATE public.games
   SET supported_formats = '{head_to_head,points_race}',
       default_points_config =
         '{"placement": [10, 6, 5, 4, 3, 2, 1, 1], "per_kill": 1}'::jsonb
 WHERE slug IN ('pubg-mobile', 'cod-mobile', 'blood-strike');
