-- =============================================================
-- Community pillar — require login to view, multi-image posts/replies
-- =============================================================

-- Posts/replies now require login to read at all (was public read).
DROP POLICY "community_posts_public_read"   ON public.community_posts;
DROP POLICY "community_replies_public_read" ON public.community_replies;

CREATE POLICY "community_posts_auth_read"   ON public.community_posts   FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "community_replies_auth_read" ON public.community_replies FOR SELECT USING (auth.uid() IS NOT NULL);

-- Posts move from a single image_url column to a proper multi-image table
-- (same shape as listing_images), so replies can have the same capability.
ALTER TABLE public.community_posts DROP COLUMN image_url;

CREATE TABLE public.community_post_images (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id       uuid        NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  image_url     text        NOT NULL,
  display_order integer     NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.community_post_images (post_id, display_order);
ALTER TABLE public.community_post_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cpi_select" ON public.community_post_images FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "cpi_insert" ON public.community_post_images FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.community_posts p
    WHERE p.id = post_id AND (p.author_id = auth.uid() OR public.is_staff())
  )
);
CREATE POLICY "cpi_delete" ON public.community_post_images FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM public.community_posts p
    WHERE p.id = post_id AND (p.author_id = auth.uid() OR public.is_staff())
  )
);

CREATE TABLE public.community_reply_images (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  reply_id      uuid        NOT NULL REFERENCES public.community_replies(id) ON DELETE CASCADE,
  image_url     text        NOT NULL,
  display_order integer     NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.community_reply_images (reply_id, display_order);
ALTER TABLE public.community_reply_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cri_select" ON public.community_reply_images FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "cri_insert" ON public.community_reply_images FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.community_replies r
    WHERE r.id = reply_id AND (r.author_id = auth.uid() OR public.is_staff())
  )
);
CREATE POLICY "cri_delete" ON public.community_reply_images FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM public.community_replies r
    WHERE r.id = reply_id AND (r.author_id = auth.uid() OR public.is_staff())
  )
);
