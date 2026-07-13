-- =============================================================
-- Community pillar (v1) — per-game posts + one-level replies
-- =============================================================

CREATE TABLE public.community_posts (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id    uuid        NOT NULL REFERENCES public.games(id),
  author_id  uuid        NOT NULL REFERENCES public.profiles(id),
  body       text        NOT NULL CHECK (char_length(body) <= 2000),
  image_url  text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.community_replies (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id    uuid        NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  author_id  uuid        NOT NULL REFERENCES public.profiles(id),
  body       text        NOT NULL CHECK (char_length(body) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON public.community_posts (game_id);
CREATE INDEX ON public.community_posts (created_at DESC);
CREATE INDEX ON public.community_replies (post_id);

CREATE TRIGGER set_community_posts_updated_at
  BEFORE UPDATE ON public.community_posts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.community_posts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_replies ENABLE ROW LEVEL SECURITY;

-- Public read, matching /tournaments and /exchange — logged-out visitors browse.
CREATE POLICY "community_posts_public_read"   ON public.community_posts   FOR SELECT USING (true);
CREATE POLICY "community_replies_public_read" ON public.community_replies FOR SELECT USING (true);

-- Any authenticated player can post/reply as themselves.
CREATE POLICY "community_posts_own_insert"   ON public.community_posts   FOR INSERT WITH CHECK (auth.uid() = author_id);
CREATE POLICY "community_replies_own_insert" ON public.community_replies FOR INSERT WITH CHECK (auth.uid() = author_id);

-- Author deletes their own; staff (admin + moderator) deletes anything.
CREATE POLICY "community_posts_delete"   ON public.community_posts   FOR DELETE USING (auth.uid() = author_id OR is_staff());
CREATE POLICY "community_replies_delete" ON public.community_replies FOR DELETE USING (auth.uid() = author_id OR is_staff());

-- Public bucket for post images (readers browse them; public read).
INSERT INTO storage.buckets (id, name, public)
VALUES ('community-images', 'community-images', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "community_images_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'community-images');
CREATE POLICY "community_images_insert_own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'community-images' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "community_images_delete_own" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'community-images' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_staff()));
