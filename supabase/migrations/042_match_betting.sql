-- 042_match_betting.sql — pari-mutuel betting on scheduled tournament matches.

ALTER TABLE public.matches
  ADD COLUMN betting_locked boolean NOT NULL DEFAULT false;

CREATE TABLE public.match_bets (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id       uuid        NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  player_id      uuid        NOT NULL REFERENCES public.profiles(id),
  side           text        NOT NULL CHECK (side IN ('player_a', 'player_b')),
  stake_amount   integer     NOT NULL CHECK (stake_amount > 0),
  status         text        NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'won', 'lost', 'refunded', 'voided')),
  payout_amount  integer,
  voided_reason  text,
  placed_at      timestamptz NOT NULL DEFAULT now(),
  settled_at     timestamptz
);

CREATE INDEX ON public.match_bets (match_id);
CREATE INDEX ON public.match_bets (player_id);

ALTER TABLE public.match_bets ENABLE ROW LEVEL SECURITY;

-- Players read their own bets. All writes go through server actions using
-- the admin (service-role) client — no insert policy, so a client can't
-- place a bet by writing the table directly.
CREATE POLICY "Players view own bets" ON public.match_bets
  FOR SELECT USING (auth.uid() = player_id);

-- Extend wallet_transactions.type to cover bet stakes/payouts/refunds.
ALTER TABLE public.wallet_transactions DROP CONSTRAINT wallet_transactions_type_check;
ALTER TABLE public.wallet_transactions ADD CONSTRAINT wallet_transactions_type_check
  CHECK (type IN (
    'prize', 'referral', 'friendly_stake', 'admin_credit',
    'withdrawal_request', 'withdrawal_reversal',
    'bet_stake', 'bet_payout', 'bet_refund'
  ));
