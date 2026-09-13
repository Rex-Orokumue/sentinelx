-- Two things, landing together because the second exposed the first:
--
-- 1. Match rules become a per-MODE catalogue instead of a global text enum.
--    `tournaments.match_rules` + `tournaments_match_rules_valid` offered
--    Free Fire's normal/headshot_only/spam to EVERY game with modes. That was
--    invisible with only one mode-having game in the system; adding PUBG
--    Mobile's TPP/FPP would have shown "Headshot only" on a PUBG tournament
--    and "TPP" on a Free Fire one — the exact cross-mode leak the
--    Mode -> Format -> Map chain exists to prevent, on a field that chain
--    didn't cover. `game_mode_match_rules` closes it the same way maps
--    already work: scoped to `mode_id`, admin-editable, no deploy to change.
--
-- 2. PUBG Mobile gets its own modes/formats/maps/rules, seeded the same way
--    Free Fire's were. Its games row already carries
--    supported_formats = {head_to_head, points_race} and a PMGC-style
--    default_points_config (from 20260909090000_tournament_formats.sql), so
--    only the catalogue is new here.
--
-- No backfill: checked 2026-09-13, zero tournaments have mode_id or
-- match_rules set in production (the game-modes feature merged same day, no
-- Free Fire tournament has been created yet). Dropping the old column loses
-- no data — a fact, not a deferral.

CREATE TABLE public.game_mode_match_rules (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode_id uuid NOT NULL REFERENCES public.game_modes(id) ON DELETE CASCADE,
  slug    text NOT NULL,
  name    text NOT NULL,
  seq     int  NOT NULL DEFAULT 1,
  active  boolean NOT NULL DEFAULT true,

  CONSTRAINT gmmr_slug_uniq UNIQUE (mode_id, slug)
);

CREATE INDEX game_mode_match_rules_mode_idx ON public.game_mode_match_rules (mode_id, seq);

ALTER TABLE public.game_mode_match_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gmmr_public_read" ON public.game_mode_match_rules FOR SELECT USING (true);
CREATE POLICY "gmmr_staff_write" ON public.game_mode_match_rules FOR ALL USING (is_staff()) WITH CHECK (is_staff());

-- Swap the flat enum column for an FK into the new catalogue. Same trust
-- model as mode_id/format_id/default_map_id: the column is a plain nullable
-- FK, not re-validated by a CHECK, because which rules are valid for a mode
-- is the catalogue's job.
ALTER TABLE public.tournaments DROP CONSTRAINT IF EXISTS tournaments_match_rules_valid;
ALTER TABLE public.tournaments DROP COLUMN IF EXISTS match_rules;
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS match_rule_id uuid REFERENCES public.game_mode_match_rules(id) ON DELETE SET NULL;

-- ── Seed: Free Fire match rules ─────────────────────────────────────────────
-- Every existing FF mode keeps the same three custom-room settings it had as
-- a flat enum — this migration only rescopes them, it does not remove any.
INSERT INTO public.game_mode_match_rules (mode_id, slug, name, seq)
SELECT m.id, v.slug, v.name, v.seq
  FROM public.game_modes m
  JOIN public.games g ON g.id = m.game_id AND g.slug = 'free-fire'
  JOIN (VALUES
    ('normal',        'Normal',                1),
    ('headshot_only', 'Headshot only',         2),
    ('spam',          'Spam / unlimited ammo', 3)
  ) AS v(slug, name, seq) ON true;

-- ── Seed: PUBG Mobile ────────────────────────────────────────────────────────
INSERT INTO public.game_modes (game_id, slug, name, seq, competition_format)
SELECT g.id, 'battle_royale', 'Battle Royale', 1, 'points_race'
  FROM public.games g
 WHERE g.slug = 'pubg-mobile';

-- Only Solo runs end to end today. Duo/Squad need squad registration
-- (phase 5 of the multi-format design), the identical gap Free Fire's BR
-- Duo/Squad are blocked on — not a PUBG-specific limitation.
INSERT INTO public.game_mode_formats (mode_id, slug, name, seq, entry_unit, team_size, available)
SELECT m.id, v.slug, v.name, v.seq, v.unit, v.size, v.avail
  FROM public.game_modes m
  JOIN public.games g ON g.id = m.game_id AND g.slug = 'pubg-mobile'
  JOIN (VALUES
    ('solo',  'Solo',  1, 'solo',  1, true),
    ('duo',   'Duo',   2, 'squad', 2, false),
    ('squad', 'Squad', 3, 'squad', 4, false)
  ) AS v(slug, name, seq, unit, size, avail) ON true;

-- The stable, currently-live competitive pool. A seed, not a fixed truth —
-- newer maps (Deston, Rondo) are a data edit away once their rotation settles.
INSERT INTO public.game_mode_maps (mode_id, name, seq)
SELECT m.id, v.name, v.seq
  FROM public.game_modes m
  JOIN public.games g ON g.id = m.game_id AND g.slug = 'pubg-mobile'
  JOIN (VALUES
    ('Erangel', 1),
    ('Miramar', 2),
    ('Sanhok',  3),
    ('Vikendi', 4),
    ('Livik',   5)
  ) AS v(name, seq) ON true;

-- Perspective is PUBG's match-rule axis, standing in for Free Fire's
-- headshot/spam settings — an independent choice from Mode/Format/Map, not a
-- team-size or scoring change, which is why it belongs here rather than as a
-- second mode (see the design note in lib/tournaments/mode-selection.ts).
INSERT INTO public.game_mode_match_rules (mode_id, slug, name, seq)
SELECT m.id, v.slug, v.name, v.seq
  FROM public.game_modes m
  JOIN public.games g ON g.id = m.game_id AND g.slug = 'pubg-mobile'
  JOIN (VALUES
    ('tpp', 'TPP', 1),
    ('fpp', 'FPP', 2)
  ) AS v(slug, name, seq) ON true;
