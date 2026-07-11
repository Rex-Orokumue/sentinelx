-- #14 KYC (BVN) + Paystack Transfer prize withdrawals.

-- 1. player_kyc: BVN verification state + payout account, isolated from
--    profiles (see task header for why). Self may read their own row; staff
--    may read any row (the admin withdrawals queue needs to look up a
--    player's paystack_recipient_code). No INSERT/UPDATE/DELETE policies at
--    all — every write goes through the service-role client (submitKyc, the
--    identification webhook, resetKycForPlayer), same "server-only writes"
--    pattern as marketplace_orders (migration 013).
CREATE TABLE public.player_kyc (
  player_id               uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  kyc_status               text NOT NULL DEFAULT 'unverified'
                              CHECK (kyc_status IN ('unverified', 'pending', 'verified', 'failed')),
  kyc_failure_reason       text,
  paystack_customer_code   text UNIQUE,
  paystack_recipient_code  text UNIQUE,
  payout_bank_code         text,
  payout_bank_name         text,
  payout_account_number    text,
  payout_account_name      text,
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER set_player_kyc_updated_at
  BEFORE UPDATE ON public.player_kyc
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.player_kyc ENABLE ROW LEVEL SECURITY;

CREATE POLICY "player_kyc_self_or_staff_read" ON public.player_kyc
  FOR SELECT USING (auth.uid() = player_id OR public.is_staff());

-- 2. withdrawal_requests: transfer automation columns + statuses --------
ALTER TABLE public.withdrawal_requests
  DROP CONSTRAINT withdrawal_requests_status_check;
ALTER TABLE public.withdrawal_requests
  ADD CONSTRAINT withdrawal_requests_status_check
  CHECK (status IN ('pending', 'processing', 'paid', 'rejected', 'failed'));
ALTER TABLE public.withdrawal_requests
  ADD COLUMN paystack_transfer_code      text,
  ADD COLUMN paystack_transfer_reference text UNIQUE;

-- 3. One *active* (pending or processing) request per player, not just
--    pending — a player shouldn't be able to file a second request while
--    one is actively being paid out.
DROP INDEX public.withdrawal_requests_one_pending_per_player;
CREATE UNIQUE INDEX withdrawal_requests_one_active_per_player
  ON public.withdrawal_requests (player_id)
  WHERE status IN ('pending', 'processing');

-- No RLS policy changes needed on withdrawal_requests itself: wr_own_insert
-- already requires status = 'pending' at insert time (unaffected);
-- wr_admin_update already lets any admin update any column on any row
-- (unaffected, used by resolveWithdrawal via the regular authenticated
-- client, same as before this feature).
