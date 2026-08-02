-- 045_buy_requests.sql
-- Private, admin-brokered "looking for X" requests. Explicitly NOT a public
-- wanted board — the platform is the middleman for coordination and scam
-- prevention (see docs/superpowers/specs/2026-08-02-buy-requests-design.md).

CREATE TABLE public.buy_requests (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id    uuid        NOT NULL REFERENCES public.profiles(id),
  title       text        NOT NULL,
  category    text        NOT NULL CHECK (category IN (
                'account', 'coins', 'accessories', 'gift_card', 'controller', 'phone'
              )),
  game_id     uuid        REFERENCES public.games(id),
  budget      integer     NOT NULL,  -- NGN, max the buyer will pay
  description text,
  status      text        NOT NULL DEFAULT 'open'
                CHECK (status IN ('open', 'in_progress', 'fulfilled', 'closed')),
  admin_note  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON public.buy_requests (buyer_id);
CREATE INDEX ON public.buy_requests (status);

CREATE TRIGGER set_buy_requests_updated_at
  BEFORE UPDATE ON public.buy_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.buy_requests ENABLE ROW LEVEL SECURITY;

-- Private: buyer reads their own; staff reads all. No public clause, unlike
-- marketplace_listings' ml_select (which allows status='active' public read).
CREATE POLICY "br_select" ON public.buy_requests
  FOR SELECT USING (auth.uid() = buyer_id OR public.is_staff());

CREATE POLICY "br_own_insert" ON public.buy_requests
  FOR INSERT WITH CHECK (auth.uid() = buyer_id);

CREATE POLICY "br_update" ON public.buy_requests
  FOR UPDATE USING (auth.uid() = buyer_id OR public.is_staff());

-- Status guard: the buyer may only cancel their own still-open request
-- (open -> closed). Every other transition is staff-only. Mirrors
-- enforce_listing_status() in 012_listing_images.sql.
CREATE OR REPLACE FUNCTION public.enforce_buy_request_status()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT public.is_staff()
     AND NOT (OLD.status = 'open' AND NEW.status = 'closed' AND auth.uid() = OLD.buyer_id) THEN
    RAISE EXCEPTION 'Only staff can set a buy request status to %', NEW.status;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_enforce_buy_request_status
  BEFORE UPDATE ON public.buy_requests
  FOR EACH ROW EXECUTE FUNCTION public.enforce_buy_request_status();

-- Notification types for the three status transitions the buyer sees.
ALTER TABLE public.player_notifications DROP CONSTRAINT player_notifications_type_check;
ALTER TABLE public.player_notifications ADD CONSTRAINT player_notifications_type_check
  CHECK (type IN (
    'listing_approved', 'listing_removed', 'listing_deleted', 'listing_sold',
    'withdrawal_paid', 'withdrawal_rejected',
    'result_confirmed', 'referral_credited',
    'friend_request', 'wallet_credited',
    'player_disqualified', 'noshow_needs_decision',
    'buy_request_in_progress', 'buy_request_fulfilled', 'buy_request_closed'
  ));
