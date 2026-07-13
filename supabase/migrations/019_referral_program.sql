-- =============================================================
-- Referral program (#22): referred_by, referrals log, referral
-- withdrawal requests — entirely separate from withdrawal_requests.
-- =============================================================

-- Set once at signup via handle_new_user(); never edited afterward.
ALTER TABLE public.profiles ADD COLUMN referred_by uuid REFERENCES public.profiles(id);

-- One row per CONFIRMED referral (credited at email verification — see
-- app/auth/confirm/route.ts — not raw signup). Source of truth; referral
-- balance is derived from this, never stored directly.
CREATE TABLE public.referrals (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id uuid        NOT NULL REFERENCES public.profiles(id),
  referred_id uuid        NOT NULL REFERENCES public.profiles(id) UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.referrals (referrer_id);

-- Entirely separate from withdrawal_requests (prize money). Same shape,
-- same manual-resolution flow as withdrawal_requests, different table.
CREATE TABLE public.referral_withdrawal_requests (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id      uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount         integer     NOT NULL CHECK (amount > 0),
  bank_name      text        NOT NULL,
  account_number text        NOT NULL,
  account_name   text        NOT NULL,
  status         text        NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'rejected', 'paid')),
  admin_note     text,
  requested_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at    timestamptz
);
CREATE INDEX ON public.referral_withdrawal_requests (player_id);
CREATE INDEX ON public.referral_withdrawal_requests (status);

-- At most one pending referral withdrawal per player at a time.
CREATE UNIQUE INDEX referral_withdrawal_requests_one_pending_per_player
  ON public.referral_withdrawal_requests (player_id) WHERE status = 'pending';

ALTER TABLE public.referrals                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_withdrawal_requests  ENABLE ROW LEVEL SECURITY;

-- referrals: referrer reads their own referral log; admin reads all
-- (money-adjacent, matches the withdrawal_requests admin-only read).
-- No client INSERT policy at all — the only writer is
-- app/auth/confirm/route.ts via the service-role admin client.
CREATE POLICY "referrals_own_or_admin_read" ON public.referrals
  FOR SELECT USING (referrer_id = auth.uid() OR public.is_admin());

-- referral_withdrawal_requests: mirrors withdrawal_requests exactly.
CREATE POLICY "rwr_own_insert" ON public.referral_withdrawal_requests
  FOR INSERT WITH CHECK (player_id = auth.uid() AND status = 'pending');
CREATE POLICY "rwr_own_or_admin_read" ON public.referral_withdrawal_requests
  FOR SELECT USING (player_id = auth.uid() OR public.is_admin());
CREATE POLICY "rwr_admin_update" ON public.referral_withdrawal_requests
  FOR UPDATE USING (public.is_admin());

-- Extend the existing signup trigger to also resolve a referral code (the
-- referrer's username, passed through as raw_user_meta_data->>'ref') into
-- referred_by. Unknown or missing ref codes resolve to NULL silently — no
-- signup error over a bad/stale referral link.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, username, display_name, referred_by)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'username',
    NEW.raw_user_meta_data->>'username',
    (SELECT id FROM public.profiles WHERE username = NEW.raw_user_meta_data->>'ref')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
