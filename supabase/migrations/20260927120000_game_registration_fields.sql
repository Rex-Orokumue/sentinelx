-- Per-game registration identity fields, replacing the hardcoded
-- clubName/ignTag every tournament asked regardless of game. Same shape as
-- game_modes: public read (the registration form needs it pre-login),
-- staff write via RLS (see 20260912090000_game_modes.sql for precedent).
CREATE TABLE public.game_registration_fields (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id             uuid NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  field_key           text NOT NULL,
  label               text NOT NULL,
  placeholder         text,
  input_type          text NOT NULL DEFAULT 'text',
  required            boolean NOT NULL DEFAULT true,
  validation_pattern  text,
  validation_message  text,
  -- Surfaced next to a player's name on the PUBLIC bracket (bracket-view.ts).
  -- Not every field belongs there — a numeric platform ID usually shouldn't.
  show_on_bracket     boolean NOT NULL DEFAULT false,
  seq                 int NOT NULL DEFAULT 1,
  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT grf_input_type_valid CHECK (input_type IN ('text', 'number', 'url')),
  CONSTRAINT grf_key_uniq UNIQUE (game_id, field_key)
);

CREATE INDEX game_registration_fields_game_idx ON public.game_registration_fields (game_id, seq);

ALTER TABLE public.game_registration_fields ENABLE ROW LEVEL SECURITY;
CREATE POLICY "grf_public_read"  ON public.game_registration_fields FOR SELECT USING (true);
CREATE POLICY "grf_staff_write" ON public.game_registration_fields FOR ALL USING (is_staff()) WITH CHECK (is_staff());

-- ── Storage cutover: reg_club_name/reg_ign_tag -> registration_details ─────
ALTER TABLE public.tournament_registrations ADD COLUMN registration_details jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.tournament_registrations SET registration_details =
  jsonb_strip_nulls(jsonb_build_object('club_name', reg_club_name, 'ign_tag', reg_ign_tag));

ALTER TABLE public.tournament_registrations DROP COLUMN reg_club_name;
ALTER TABLE public.tournament_registrations DROP COLUMN reg_ign_tag;

-- ── Seed: the three currently-active games ──────────────────────────────────
-- Seeded here, not left for someone to fill in via the admin UI later — a
-- game already live must not go through a window with zero registration
-- fields the moment this migration lands. This is also the reference example
-- for how the Game Designer UI seeds every game after these three.
INSERT INTO public.game_registration_fields (game_id, field_key, label, placeholder, required, show_on_bracket, seq)
SELECT g.id, v.field_key, v.label, v.placeholder, v.required, v.show_on_bracket, v.seq
  FROM public.games g
  JOIN (VALUES
    ('dls',          'club_name', 'Club name',                  'Your in-game club/team', true,  true,  1),
    ('dls',          'ign_tag',   'In-game player ID / tag',    'Your IGN or player tag', false, false, 2),
    ('ea-fc-mobile', 'club_name', 'Club name',                  'Your in-game club/team', true,  true,  1),
    ('ea-fc-mobile', 'ign_tag',   'In-game player ID / tag',    'Your IGN or player tag', false, false, 2)
  ) AS v(slug, field_key, label, placeholder, required, show_on_bracket, seq) ON v.slug = g.slug;

INSERT INTO public.game_registration_fields (game_id, field_key, label, placeholder, required, show_on_bracket, seq)
SELECT g.id, 'in_game_uid', 'In-game UID', 'Your Free Fire UID', true, true, 1
  FROM public.games g WHERE g.slug = 'free-fire';
