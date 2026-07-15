-- Reusable, admin-manageable homepage promo banner (e.g. season announcements).
-- Independent of tournament status — lets staff promote an upcoming
-- tournament on the homepage while it's still in draft.
CREATE TABLE public.homepage_banners (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title      text        NOT NULL,
  image_url  text        NOT NULL,
  link_url   text        NOT NULL,
  active     boolean     NOT NULL DEFAULT true,
  created_by uuid        NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON public.homepage_banners (created_at DESC);

ALTER TABLE public.homepage_banners ENABLE ROW LEVEL SECURITY;

-- Public sees active rows; staff see everything (for the admin list).
CREATE POLICY "homepage_banners_public_read" ON public.homepage_banners
  FOR SELECT USING (active OR public.is_staff());
CREATE POLICY "homepage_banners_staff_insert" ON public.homepage_banners
  FOR INSERT WITH CHECK (public.is_staff());
CREATE POLICY "homepage_banners_staff_update" ON public.homepage_banners
  FOR UPDATE USING (public.is_staff());
CREATE POLICY "homepage_banners_staff_delete" ON public.homepage_banners
  FOR DELETE USING (public.is_staff());

-- Public bucket for banner images (readers browse them; staff upload).
INSERT INTO storage.buckets (id, name, public)
VALUES ('banner-images', 'banner-images', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "banner_images_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'banner-images');
CREATE POLICY "banner_images_staff_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'banner-images' AND public.is_staff());
CREATE POLICY "banner_images_staff_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'banner-images' AND public.is_staff());
