-- 024_wallet_system.sql — #28 unified player wallet system.
-- Live-data check (2026-07-13): withdrawal_requests, referral_withdrawal_requests,
-- friendly_withdrawal_requests, referrals, and completed staked friendly_matches
-- are all empty. No backfill needed; the three old withdrawal tables are dropped.

CREATE TABLE public.wallets (
  player_id  uuid        PRIMARY KEY REFERENCES public.profiles(id),
  balance    integer     NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wallets_self_or_staff_read" ON public.wallets
  FOR SELECT USING (player_id = auth.uid() OR public.is_staff());
-- No INSERT/UPDATE policy: only creditWallet/debitWallet (service-role) write here.

CREATE TABLE public.wallet_transactions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id    uuid        NOT NULL REFERENCES public.profiles(id),
  amount       integer     NOT NULL CHECK (amount <> 0),
  type         text        NOT NULL CHECK (type IN (
                  'prize', 'referral', 'friendly_stake', 'admin_credit',
                  'withdrawal_request', 'withdrawal_reversal'
                )),
  reference_id uuid,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.wallet_transactions (player_id, created_at DESC);
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wallet_transactions_self_or_staff_read" ON public.wallet_transactions
  FOR SELECT USING (player_id = auth.uid() OR public.is_staff());
-- No INSERT policy: append-only, service-role only.

-- Drop the two single-purpose withdrawal tables outright (empty, per the
-- live-data check above).
DROP TABLE public.referral_withdrawal_requests;
DROP TABLE public.friendly_withdrawal_requests;

-- Redesign withdrawal_requests into the one unified queue. Also empty, so a
-- clean drop + recreate under the same name is simplest — no application
-- code needs to learn a new table name for "the withdrawal queue" concept.
DROP TABLE public.withdrawal_requests;
CREATE TABLE public.withdrawal_requests (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id       uuid        NOT NULL REFERENCES public.profiles(id),
  amount          integer     NOT NULL CHECK (amount > 0),
  bank_name       text        NOT NULL,
  account_number  text        NOT NULL,
  account_name    text        NOT NULL,
  status          text        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'rejected', 'paid')),
  admin_note      text,
  requested_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz
);
CREATE INDEX ON public.withdrawal_requests (player_id);
CREATE INDEX ON public.withdrawal_requests (status);
CREATE UNIQUE INDEX withdrawal_requests_one_pending_per_player
  ON public.withdrawal_requests (player_id) WHERE status = 'pending';
ALTER TABLE public.withdrawal_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wr_own_insert" ON public.withdrawal_requests
  FOR INSERT WITH CHECK (player_id = auth.uid());
CREATE POLICY "wr_own_or_admin_read" ON public.withdrawal_requests
  FOR SELECT USING (player_id = auth.uid() OR public.is_admin());
CREATE POLICY "wr_admin_update" ON public.withdrawal_requests
  FOR UPDATE USING (public.is_admin());

-- player_notifications: drop every retired referral-/friendly-/prize-specific
-- withdrawal notification type, add the two unified ones. 'withdrawal_paid'
-- and 'withdrawal_rejected' already exist and are reused as-is (they now
-- describe any wallet withdrawal, not just a prize one). 'referral_credited'
-- stays — it fires with its own copy from app/auth/confirm/route.ts, unrelated
-- to the withdrawal flow.
ALTER TABLE public.player_notifications DROP CONSTRAINT player_notifications_type_check;
ALTER TABLE public.player_notifications ADD CONSTRAINT player_notifications_type_check
  CHECK (type IN (
    'listing_approved', 'listing_removed',
    'withdrawal_paid', 'withdrawal_rejected',
    'result_confirmed', 'referral_credited',
    'friend_request', 'wallet_credited'
  ));
