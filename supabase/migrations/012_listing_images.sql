-- Multiple images per marketplace listing.
CREATE TABLE public.listing_images (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id    uuid        NOT NULL REFERENCES public.marketplace_listings(id) ON DELETE CASCADE,
  image_url     text        NOT NULL,
  display_order integer     NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.listing_images (listing_id, display_order);
ALTER TABLE public.listing_images ENABLE ROW LEVEL SECURITY;

-- Images are readable when the parent listing is (active is public; own/staff otherwise).
CREATE POLICY "li_select" ON public.listing_images FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.marketplace_listings m
    WHERE m.id = listing_id
      AND (m.status = 'active' OR m.seller_id = auth.uid() OR public.is_staff())
  )
);
-- Seller (owner of the parent) or staff may add/remove images.
CREATE POLICY "li_insert" ON public.listing_images FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.marketplace_listings m
    WHERE m.id = listing_id AND (m.seller_id = auth.uid() OR public.is_staff())
  )
);
CREATE POLICY "li_delete" ON public.listing_images FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM public.marketplace_listings m
    WHERE m.id = listing_id AND (m.seller_id = auth.uid() OR public.is_staff())
  )
);

-- Public bucket for listing images (buyers browse them; public read).
INSERT INTO storage.buckets (id, name, public)
VALUES ('listing-images', 'listing-images', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "listing_images_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'listing-images');
CREATE POLICY "listing_images_insert_own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'listing-images' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "listing_images_delete_own" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'listing-images' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_staff()));

-- Status guard: a non-staff user may only move their listing to 'removed'.
-- Blocks a seller self-approving (status='active') to bypass moderation.
CREATE OR REPLACE FUNCTION public.enforce_listing_status()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT public.is_staff()
     AND NEW.status <> 'removed' THEN
    RAISE EXCEPTION 'Only staff can set a listing status to %', NEW.status;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_enforce_listing_status
  BEFORE UPDATE ON public.marketplace_listings
  FOR EACH ROW EXECUTE FUNCTION public.enforce_listing_status();
