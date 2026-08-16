-- Extends sx_coin_transactions.source to cover sources already written by
-- merged Phase 3 social-feed code with no matching CHECK value
-- (weekly_challenge, best_play_winner, best_play_runner_up — those inserts
-- have been failing this constraint since that feature merged), plus every
-- new source this coin-economy extension adds.
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
    'post_boost'
  ));
