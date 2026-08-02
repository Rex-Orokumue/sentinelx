-- 044_wallet_deposits.sql
-- Tracks a player's Paystack wallet top-up attempts. wallet_transactions.
-- reference_id is a uuid FK-shaped column and can't hold a Paystack text
-- reference directly, so — mirroring how tournament_registrations carries
-- its own paystack_reference column — this table exists as the thing
-- creditWallet's referenceId points at (wallet_deposits.id), not the
-- Paystack reference itself.
-- See docs/superpowers/plans/2026-08-02-wallet-funding.md.

CREATE TABLE public.wallet_deposits (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id          uuid        NOT NULL REFERENCES public.profiles(id),
  amount             integer     NOT NULL,  -- NGN credited to the wallet on success
  fee                integer     NOT NULL,  -- NGN surcharge the player also pays
  paystack_reference text        NOT NULL UNIQUE,
  status             text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON public.wallet_deposits (player_id);

CREATE TRIGGER set_wallet_deposits_updated_at
  BEFORE UPDATE ON public.wallet_deposits
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.wallet_deposits ENABLE ROW LEVEL SECURITY;

-- Player reads their own deposit history; staff can read all. No client
-- INSERT/UPDATE/DELETE policy — every write goes through the service-role
-- client from the deposit action and the Paystack confirm path, same as
-- marketplace_orders.
CREATE POLICY "wd_select" ON public.wallet_deposits
  FOR SELECT USING (auth.uid() = player_id OR public.is_staff());

-- Extend wallet_transactions.type for the new 'deposit' ledger entries.
ALTER TABLE public.wallet_transactions DROP CONSTRAINT wallet_transactions_type_check;
ALTER TABLE public.wallet_transactions ADD CONSTRAINT wallet_transactions_type_check
  CHECK (type IN (
    'prize', 'referral', 'friendly_stake', 'admin_credit',
    'withdrawal_request', 'withdrawal_reversal',
    'bet_stake', 'bet_payout', 'bet_refund',
    'deposit'
  ));
