-- 069_guide_system.sql
-- Guide System — Reward: one new onboarding achievement, explicitly claimed
-- via lib/guide/actions.ts (not the automatic checkAndUnlockAchievements()
-- pipeline — this checklist spans profile/registrations/matches at once,
-- three unrelated domains that pipeline evaluates one category at a time).
-- See docs/superpowers/specs/2026-08-18-guide-system-design.md "Reward".
--
-- Deviation from the spec's literal text: the spec calls this achievement
-- "Ready to Compete", not noticing that name already belongs to the
-- existing 'profile_complete' achievement (053_achievements.sql:71) —
-- reusing it would show two identically-named achievements on one profile
-- grid. Renamed here to "Battle Ready" / slug battle_ready.
--
-- category='profile' and phase='phase3' are both already-valid CHECK
-- values (053_achievements.sql, 063_referral_coin_economy.sql) — no ALTER
-- needed. sort_order continues after the highest existing value (35, set
-- by 063's referral milestones).
INSERT INTO public.achievements (slug, name, description, icon_url, category, xp_reward, coin_reward, phase, sort_order)
VALUES (
  'battle_ready',
  'Battle Ready',
  'Complete your profile, enter a tournament, and finish your first match',
  '🧭',
  'profile',
  100,
  50,
  'phase3',
  36
)
ON CONFLICT (slug) DO NOTHING;
