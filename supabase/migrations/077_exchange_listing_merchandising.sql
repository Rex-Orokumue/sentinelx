-- 077_exchange_listing_merchandising.sql
-- Merchandising fields for the rebuilt /exchange page: a short spec line, a
-- was-price for discount display, an admin-set promo badge, and a view counter
-- that ranks the Trending Now sidebar.

ALTER TABLE public.marketplace_listings
  ADD COLUMN subtitle       text,
  ADD COLUMN original_price integer,
  ADD COLUMN badge          text,
  ADD COLUMN view_count     integer NOT NULL DEFAULT 0;

ALTER TABLE public.marketplace_listings
  ADD CONSTRAINT marketplace_listings_subtitle_len
    CHECK (subtitle IS NULL OR char_length(subtitle) <= 60),
  ADD CONSTRAINT marketplace_listings_original_price_above_price
    CHECK (original_price IS NULL OR original_price > price),
  ADD CONSTRAINT marketplace_listings_badge_check
    CHECK (badge IS NULL OR badge IN ('featured', 'hot', 'top_deal', 'new'));

-- Serves the Trending Now query (active listings, most-viewed first).
CREATE INDEX marketplace_listings_view_count_idx
  ON public.marketplace_listings (view_count DESC)
  WHERE status = 'active';

-- View counting must work for signed-out visitors, who have no UPDATE path
-- under RLS. SECURITY DEFINER narrows that to exactly one column on exactly
-- one row of an active listing.
CREATE OR REPLACE FUNCTION public.increment_listing_view(p_listing_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.marketplace_listings
     SET view_count = view_count + 1
   WHERE id = p_listing_id
     AND status = 'active';
$$;

GRANT EXECUTE ON FUNCTION public.increment_listing_view(uuid) TO anon, authenticated;
