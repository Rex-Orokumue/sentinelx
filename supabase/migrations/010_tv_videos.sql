-- Curated Sentinel X TV videos (standalone YouTube clips managed by staff).
CREATE TABLE public.tv_videos (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text        NOT NULL,
  description   text,
  youtube_url   text        NOT NULL,
  category      text        NOT NULL
                  CHECK (category IN ('highlight', 'interview', 'recap', 'best_goal')),
  thumbnail_url text,
  published_at  timestamptz NOT NULL DEFAULT now(),
  created_by    uuid        NOT NULL REFERENCES public.profiles(id),
  active        boolean     NOT NULL DEFAULT true
);

CREATE INDEX ON public.tv_videos (published_at DESC);

ALTER TABLE public.tv_videos ENABLE ROW LEVEL SECURITY;

-- Public sees active rows; staff see everything (for the admin list).
CREATE POLICY "tv_videos_public_read" ON public.tv_videos
  FOR SELECT USING (active OR public.is_staff());
CREATE POLICY "tv_videos_staff_insert" ON public.tv_videos
  FOR INSERT WITH CHECK (public.is_staff());
CREATE POLICY "tv_videos_staff_update" ON public.tv_videos
  FOR UPDATE USING (public.is_staff());
CREATE POLICY "tv_videos_staff_delete" ON public.tv_videos
  FOR DELETE USING (public.is_staff());
