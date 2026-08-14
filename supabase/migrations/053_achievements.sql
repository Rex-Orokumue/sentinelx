-- 053_achievements.sql
-- Phase 2 Economy §5: achievement catalogue + per-player unlocks. See
-- docs/superpowers/specs/2026-08-05-phase2-economy-design.md §5.

CREATE TABLE public.achievements (
  id           uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         text    NOT NULL UNIQUE,
  name         text    NOT NULL,
  description  text    NOT NULL,
  category     text    NOT NULL CHECK (category IN (
    'matches', 'tournaments', 'score', 'season', 'profile', 'community'
  )),
  icon_url     text,
  xp_reward    integer NOT NULL DEFAULT 0,
  coin_reward  integer NOT NULL DEFAULT 0,
  phase        text    NOT NULL DEFAULT 'phase2'
    CHECK (phase IN ('phase2', 'phase3')),
  sort_order   integer NOT NULL DEFAULT 0
);

ALTER TABLE public.achievements ENABLE ROW LEVEL SECURITY;
-- Public catalogue — needed to render the "greyed-out, unearned" state on
-- any visitor's view of a profile's achievement grid, same as store_items.
CREATE POLICY "achievements_read" ON public.achievements
  FOR SELECT USING (true);

CREATE TABLE public.player_achievements (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id      uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  achievement_id uuid        NOT NULL REFERENCES public.achievements(id),
  unlocked_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (player_id, achievement_id)
);

CREATE INDEX ON public.player_achievements (player_id);

ALTER TABLE public.player_achievements ENABLE ROW LEVEL SECURITY;
-- Public read (Global Constraints #7) — the achievements grid is on the
-- public profile page, visible to any visitor, not just the owner. No
-- client write policy — every unlock is via checkAndUnlockAchievements()'s
-- service-role client, or the admin manual-unlock action.
CREATE POLICY "player_achievements_read" ON public.player_achievements
  FOR SELECT USING (true);

INSERT INTO public.achievements (slug, name, description, category, xp_reward, coin_reward, phase, sort_order) VALUES
  ('first_match', 'First Blood', 'Play your first match', 'matches', 50, 20, 'phase2', 1),
  ('matches_10', 'Getting Started', 'Play 10 matches', 'matches', 100, 50, 'phase2', 2),
  ('matches_50', 'Battle-Hardened', 'Play 50 matches', 'matches', 200, 100, 'phase2', 3),
  ('matches_100', 'Century Club', 'Play 100 matches', 'matches', 500, 250, 'phase2', 4),
  ('first_win', 'First W', 'Win your first match', 'matches', 100, 50, 'phase2', 5),
  ('wins_10', 'On a Roll', 'Win 10 matches', 'matches', 150, 75, 'phase2', 6),
  ('wins_50', 'Relentless', 'Win 50 matches', 'matches', 300, 150, 'phase2', 7),
  ('win_streak_3', 'Hat-Trick', 'Win 3 matches in a row', 'matches', 150, 75, 'phase2', 8),
  ('win_streak_5', 'Unstoppable', 'Win 5 matches in a row', 'matches', 300, 150, 'phase2', 9),
  ('first_tournament', 'Tournament Debut', 'Enter your first tournament', 'tournaments', 100, 50, 'phase2', 10),
  ('first_podium', 'Podium Finish', 'Finish top 3 in any tournament', 'tournaments', 200, 100, 'phase2', 11),
  ('first_champion', 'Champion', 'Win a tournament', 'tournaments', 500, 250, 'phase2', 12),
  ('champion_3x', 'Triple Crown', 'Win 3 tournaments', 'tournaments', 1000, 500, 'phase2', 13),
  ('masters_qualifier', 'Masters Bound', 'Qualify for SentinelX Masters', 'tournaments', 300, 150, 'phase2', 14),
  ('masters_champion', 'Masters Champion', 'Win SentinelX Masters', 'tournaments', 1000, 500, 'phase2', 15),
  ('champions_cup_qualifier', 'Cup Contender', 'Qualify for SentinelX Champions Cup', 'tournaments', 500, 250, 'phase2', 16),
  ('champions_cup_champion', 'SentinelX Legend', 'Win the Champions Cup', 'tournaments', 2000, 1000, 'phase2', 17),
  ('sx_score_100', 'Rising Talent', 'Reach 100 SX Score', 'score', 50, 25, 'phase2', 18),
  ('sx_score_500', 'Proven Player', 'Reach 500 SX Score', 'score', 100, 50, 'phase2', 19),
  ('sx_score_1000', 'Elite Level', 'Reach 1,000 SX Score', 'score', 200, 100, 'phase2', 20),
  ('sx_score_5000', 'Legend Territory', 'Reach 5,000 SX Score', 'score', 500, 250, 'phase2', 21),
  ('season_participant', 'Season Opener', 'Play at least one Community Club in a season', 'season', 100, 50, 'phase2', 22),
  ('season_month_sweep', 'Month Sweep', 'Play every Community Club in a calendar month', 'season', 300, 150, 'phase2', 23),
  ('season_top_100', 'Top 100', 'Finish a season in the top 100 leaderboard', 'season', 200, 100, 'phase2', 24),
  ('season_top_10', 'Top 10', 'Finish a season in the top 10 leaderboard', 'season', 500, 250, 'phase2', 25),
  ('profile_complete', 'Ready to Compete', 'Set your avatar and bio', 'profile', 50, 20, 'phase2', 26),
  ('phone_verified', 'Verified Soldier', 'Verify your phone number', 'profile', 50, 20, 'phase2', 27),
  ('first_post', 'First Post', 'Post in the community feed', 'community', 50, 20, 'phase3', 28),
  ('likes_100', 'Fan Favourite', 'Receive 100 likes', 'community', 150, 75, 'phase3', 29),
  ('posts_50', 'Community Pillar', 'Make 50 community posts', 'community', 300, 150, 'phase3', 30);
