-- Media-first feed — Piece 4 of 4 of the community rebuild (see
-- docs/superpowers/specs/2026-09-07-media-feed-design.md, 2026-09-13 addendum).
--
-- community_post_images existed once (017_community_login_gate_and_images.sql)
-- but was DROPPED by 056_phase3_social_feed.sql, the Phase 3 Social Feed
-- rebuild that replaced the whole v3.6 community schema — only each post's
-- first image was migrated forward into today's single community_posts.image_url
-- column. Nothing since recreated it, and nothing ever wrote to it as "posts
-- support one image" shipped instead. This recreates it, same shape as 017.
--
-- image_url stays the single source of truth for a post's FIRST image (every
-- existing reader — CommunityGallery, AnnouncementCard, admin — keeps working
-- unchanged); this table holds images 2-5, ordered by display_order.

CREATE TABLE public.community_post_images (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id       uuid        NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  image_url     text        NOT NULL,
  display_order integer     NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON public.community_post_images (post_id, display_order);

ALTER TABLE public.community_post_images ENABLE ROW LEVEL SECURITY;

-- Public read — matches community_posts_read (056), which is public, not
-- auth-gated like the original 017 policy was.
CREATE POLICY "cpi_select" ON public.community_post_images FOR SELECT USING (true);

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
