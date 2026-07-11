-- #13b Gaming Exchange purchase + Zolarux escrow.
-- Local mirror of Zolarux escrow orders + listing lifecycle wiring.

-- 1. Orders table -------------------------------------------------
CREATE TABLE public.marketplace_orders (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id        uuid        NOT NULL REFERENCES public.marketplace_listings(id),
  buyer_id          uuid        NOT NULL REFERENCES public.profiles(id),
  seller_id         uuid        NOT NULL REFERENCES public.profiles(id),
  zolarux_order_id  text        NOT NULL,
  zolarux_order_ref text        NOT NULL UNIQUE,
  amount            integer     NOT NULL,          -- NGN, snapshot of listing.price
  listing_title     text        NOT NULL,          -- snapshot
  status            text        NOT NULL DEFAULT 'initiated'
                      CHECK (status IN ('initiated', 'payment_held', 'completed', 'refunded')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON public.marketplace_orders (buyer_id);
CREATE INDEX ON public.marketplace_orders (seller_id);
CREATE INDEX ON public.marketplace_orders (listing_id);

CREATE TRIGGER set_marketplace_orders_updated_at
  BEFORE UPDATE ON public.marketplace_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.marketplace_orders ENABLE ROW LEVEL SECURITY;

-- Buyer or seller can read their own orders; staff can read all.
-- No INSERT/UPDATE/DELETE policies: writes happen only via the service-role
-- client (buy action insert + webhook updates), which bypasses RLS.
CREATE POLICY "mo_select" ON public.marketplace_orders
  FOR SELECT USING (
    auth.uid() = buyer_id OR auth.uid() = seller_id OR public.is_staff()
  );

-- 2. Listing status: add 'reserved' ------------------------------
ALTER TABLE public.marketplace_listings
  DROP CONSTRAINT marketplace_listings_status_check;
ALTER TABLE public.marketplace_listings
  ADD CONSTRAINT marketplace_listings_status_check
  CHECK (status IN ('pending', 'active', 'sold', 'removed', 'reserved'));

-- 3. Drop the unused placeholder columns (state lives in marketplace_orders now)
ALTER TABLE public.marketplace_listings DROP COLUMN escrow_status;
ALTER TABLE public.marketplace_listings DROP COLUMN zolarux_reference;

-- 4. Let the escrow webhook (service_role) drive listing status.
--    Sellers still may only move a listing to 'removed'.
CREATE OR REPLACE FUNCTION public.enforce_listing_status()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT public.is_staff()
     AND current_user <> 'service_role'
     AND NEW.status <> 'removed' THEN
    RAISE EXCEPTION 'Only staff can set a listing status to %', NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

-- 5. Allow escrow notification types in the audit log.
ALTER TABLE public.notifications
  DROP CONSTRAINT notifications_type_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('registration_confirmed', 'fixture_reminder',
                  'result_confirmed', 'prize_credited',
                  'escrow_sale', 'escrow_completed', 'escrow_refunded'));
