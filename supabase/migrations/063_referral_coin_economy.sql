-- 063_referral_coin_economy.sql
-- Referral system redesign (Phase 3): converts the existing flat ₦100-per-
-- referral naira credit (#22, migration 019) into a coin-based system with
-- milestone bonuses + achievements, tied into the SX Coins economy (Phase 2).
-- See docs/superpowers/specs/2026-08-16-referral-system-design.md.
--
-- Do NOT drop/recreate `referrals` — it already has production history.
-- Existing rows (previously inserted only at the moment of conversion, under
-- the old ₦100-at-paid-entry flow) are backfilled as already-converted;
-- their historical ₦100 credit lives on unchanged in wallet_transactions.
-- Going forward, a referrals row is created 'pending' at signup (via
-- handle_new_user()) and flipped to 'converted' + coin-rewarded when the
-- referred player's first paid tournament entry confirms.

ALTER TABLE public.referrals
  ADD COLUMN status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'converted', 'invalid')),
  ADD COLUMN converted_at timestamptz,
  ADD COLUMN coins_awarded integer;

-- Backfill: every existing row was only ever inserted at the old ₦100
-- credit moment, so it was already a completed conversion. coins_awarded
-- stays NULL for these — they were paid in naira, not coins.
UPDATE public.referrals SET status = 'converted', converted_at = created_at;

-- Spec §4 RLS: the referred player can now also read their own row (019
-- only let the referrer or an admin see it).
CREATE POLICY "referrals_referred_read" ON public.referrals
  FOR SELECT USING (referred_id = auth.uid());

-- Extend the signup trigger to also create the pending referrals row
-- atomically with the profile itself, so the referrals dashboard can show
-- "signed up, hasn't converted yet" players immediately. Self-referral is
-- structurally impossible here: v_referrer_id is resolved from EXISTING
-- profiles rows, and NEW's own row doesn't exist yet at this point.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_referrer_id uuid;
BEGIN
  v_referrer_id := (SELECT id FROM public.profiles WHERE username = NEW.raw_user_meta_data->>'ref');

  INSERT INTO public.profiles (id, username, display_name, referred_by)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'username',
    NEW.raw_user_meta_data->>'username',
    v_referrer_id
  )
  ON CONFLICT (id) DO NOTHING;

  IF v_referrer_id IS NOT NULL THEN
    INSERT INTO public.referrals (referrer_id, referred_id, status)
    VALUES (v_referrer_id, NEW.id, 'pending')
    ON CONFLICT (referred_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- Extend sx_coin_transactions.source for the two new referral sources.
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
    'referral_reward', 'referral_milestone'
  ));

-- Extend achievements.category for the new 'social' bucket.
ALTER TABLE public.achievements
  DROP CONSTRAINT achievements_category_check;
ALTER TABLE public.achievements
  ADD CONSTRAINT achievements_category_check CHECK (category IN (
    'matches', 'tournaments', 'score', 'season', 'profile', 'community', 'social'
  ));

INSERT INTO public.achievements (slug, name, description, icon_url, category, xp_reward, coin_reward, phase, share_to_feed, sort_order)
VALUES
  ('referral_first',    'First Recruit',       'Refer your first player who competes', '🤝', 'social', 100,   250, 'phase3', true, 31),
  ('referral_squad',    'Squad Builder',       'Refer 5 players who compete',          '👥', 'social', 300,   500, 'phase3', true, 32),
  ('referral_champion', 'Community Champion',  'Refer 10 players who compete',         '🌍', 'social', 500,  1000, 'phase3', true, 33),
  ('referral_sentinel', 'Sentinel Recruiter',  'Refer 25 players who compete',         '⚔️', 'social', 1000, 2500, 'phase3', true, 34),
  ('referral_legend',   'Legend Recruiter',    'Refer 50 players who compete',         '🏆', 'social', 2000, 5000, 'phase3', true, 35)
ON CONFLICT (slug) DO NOTHING;
