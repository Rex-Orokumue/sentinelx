-- Lets a staked friendly be denominated in SX Coins as an alternative to
-- naira (user request) — one currency per challenge, symmetric stake,
-- mirrors the existing naira-only flow exactly.

ALTER TABLE public.friendly_matches
  ADD COLUMN stake_currency text CHECK (stake_currency IN ('naira', 'coins'));

-- Every existing staked friendly (stake_amount IS NOT NULL) predates this
-- column and was always naira — backfill before adding the pairing CHECK
-- below, or those historical rows would violate it.
UPDATE public.friendly_matches SET stake_currency = 'naira' WHERE stake_amount IS NOT NULL;

ALTER TABLE public.friendly_matches
  ADD CONSTRAINT friendly_matches_stake_currency_pairing
  CHECK ((stake_amount IS NULL AND stake_currency IS NULL) OR (stake_amount IS NOT NULL AND stake_currency IS NOT NULL));

-- NOTE: the live constraint (checked via pg_get_constraintdef before writing
-- this migration) already includes 'referral_reward'/'referral_milestone' —
-- added by a concurrent session's not-yet-merged referral-system work, not
-- present in this branch's local migration 057 file. Preserving them here
-- so this migration doesn't regress that in-progress feature.
ALTER TABLE public.sx_coin_transactions
  DROP CONSTRAINT sx_coin_transactions_source_check;
ALTER TABLE public.sx_coin_transactions
  ADD CONSTRAINT sx_coin_transactions_source_check CHECK (source IN (
    'match_played', 'match_won', 'tournament_placement',
    'daily_login', 'login_streak', 'achievement_unlocked',
    'store_purchase', 'community_activity',
    'admin_grant', 'admin_deduct',
    'weekly_challenge', 'best_play_winner', 'best_play_runner_up',
    'entry_discount', 'entry_discount_refund',
    'wager_stake', 'wager_won', 'wager_refund',
    'post_boost',
    'referral_reward', 'referral_milestone',
    'friendly_stake', 'friendly_stake_payout'
  ));
