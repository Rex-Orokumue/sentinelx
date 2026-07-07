-- Player-initiated prize withdrawal requests. Manual-resolution flow for v1;
-- Paystack Transfer automation is v3.0. Admin resolves in the admin dashboard (#9).
CREATE TABLE public.withdrawal_requests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount         integer NOT NULL CHECK (amount > 0),
  bank_name      text NOT NULL,
  account_number text NOT NULL,
  account_name   text NOT NULL,
  status         text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'paid', 'rejected')),
  admin_note     text,
  requested_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at    timestamptz
);
CREATE INDEX ON public.withdrawal_requests (player_id);
CREATE INDEX ON public.withdrawal_requests (status);

-- At most one pending request per player. Partial unique index enforces this
-- atomically (race-safe): two simultaneous submits cannot both land.
CREATE UNIQUE INDEX withdrawal_requests_one_pending_per_player
  ON public.withdrawal_requests (player_id) WHERE status = 'pending';

ALTER TABLE public.withdrawal_requests ENABLE ROW LEVEL SECURITY;

-- A player may file a request only for themselves, and only as pending.
CREATE POLICY "wr_own_insert" ON public.withdrawal_requests
  FOR INSERT WITH CHECK (player_id = auth.uid() AND status = 'pending');

-- A player sees their own requests; admins see all.
CREATE POLICY "wr_own_or_admin_read" ON public.withdrawal_requests
  FOR SELECT USING (player_id = auth.uid() OR public.is_admin());

-- Only admins resolve requests (financial action — moderators excluded).
CREATE POLICY "wr_admin_update" ON public.withdrawal_requests
  FOR UPDATE USING (public.is_admin());
