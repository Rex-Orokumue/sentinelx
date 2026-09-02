-- Per-tournament card/hero image. Falls back (in app code) to the game's
-- icon_url, then the local game key art, then a genre emoji — so this is
-- purely an optional override an admin can set to give a specific tournament
-- its own identity on cards, the detail-page hero, brackets, etc.
ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS card_image_url text;

-- Public bucket for tournament images (players browse them; staff upload).
INSERT INTO storage.buckets (id, name, public)
VALUES ('tournament-images', 'tournament-images', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "tournament_images_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'tournament-images');
CREATE POLICY "tournament_images_staff_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'tournament-images' AND public.is_staff());
CREATE POLICY "tournament_images_staff_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'tournament-images' AND public.is_staff());
