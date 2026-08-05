-- "Notify Me" on Coming Soon games (Phase 1 visual overhaul spec §6). Records
-- intent only — no email/WhatsApp send yet, that's Phase 2. A logged-out
-- visitor's click is stored client-side in localStorage instead of here.
CREATE TABLE public.game_interest (
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  game_id    uuid NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, game_id)
);

ALTER TABLE public.game_interest ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select own game interest"
  ON public.game_interest FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "insert own game interest"
  ON public.game_interest FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "delete own game interest"
  ON public.game_interest FOR DELETE
  USING (auth.uid() = user_id);
