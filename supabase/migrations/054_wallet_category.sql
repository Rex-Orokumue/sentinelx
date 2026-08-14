-- 054_wallet_category.sql
-- Phase 2 Economy §6: earnings-breakdown category on wallet_transactions.
-- See docs/superpowers/specs/2026-08-05-phase2-economy-design.md §6.

ALTER TABLE public.wallet_transactions
  ADD COLUMN category text
    CHECK (category IN ('tournament_prize', 'referral', 'community', 'bonus', 'withdrawal', 'entry_fee', 'refund'));

-- Backfill from the existing `type` column — a direct, unambiguous mapping
-- for every type value that exists today (see lib/wallet/service.ts
-- WalletTxnType and lib/betting's additions). Rows this doesn't cover
-- (there are none as of this migration — every existing type is listed
-- below) are left NULL rather than guessed.
UPDATE public.wallet_transactions SET category = 'tournament_prize' WHERE type = 'prize';
UPDATE public.wallet_transactions SET category = 'referral' WHERE type = 'referral';
UPDATE public.wallet_transactions SET category = 'bonus' WHERE type IN ('admin_credit', 'friendly_stake', 'bet_stake', 'bet_payout', 'bet_refund', 'deposit');
UPDATE public.wallet_transactions SET category = 'withdrawal' WHERE type IN ('withdrawal_request', 'withdrawal_reversal');
