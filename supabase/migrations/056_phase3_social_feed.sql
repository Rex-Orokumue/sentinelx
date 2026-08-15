-- =============================================================
-- Phase 3 — Social Feed
-- See docs/superpowers/specs/2026-08-15-phase3-social-feed-design.md
-- =============================================================
--
-- Replaces the v3.6 per-game community_posts/community_replies model
-- (016_community.sql / 017_community_login_gate_and_images.sql) with the
-- Phase 3 social feed schema — one shared feed (no per-game split), public
-- read, post types, reactions, comments. This is a deliberate replacement,
-- not an addition: two competing "Community" systems at the same /community
-- route isn't a real product. Decision + row-count check (11 posts / 19
-- replies, all QA test data) made with the user before this migration was
-- written.
--
-- Existing rows are migrated in place rather than wiped:
--   community_posts.body   -> community_posts.content (truncated to 500)
--   first post image (if any) -> community_posts.image_url
--   community_replies.body -> post_comments.content (truncated to 280)
-- game_id / community_post_images / community_reply_images are dropped —
-- the feed is no longer per-game.

CREATE TEMP TABLE _old_posts AS SELECT * FROM public.community_posts;
CREATE TEMP TABLE _old_replies AS SELECT * FROM public.community_replies;
CREATE TEMP TABLE _old_post_images AS SELECT * FROM public.community_post_images;

DROP TABLE public.community_reply_images;
DROP TABLE public.community_post_images;
DROP TABLE public.community_replies;
DROP TABLE public.community_posts;

-- ---------------------------------------------------------------
-- Posts
-- ---------------------------------------------------------------
CREATE TABLE public.community_posts (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id      uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  content        text        NOT NULL CHECK (char_length(content) <= 500),
  image_url      text,
  post_type      text        NOT NULL DEFAULT 'manual'
                 CHECK (post_type IN ('manual','match_result','achievement','announcement')),
  reference_id   uuid,
  is_pinned      boolean     NOT NULL DEFAULT false,
  is_deleted     boolean     NOT NULL DEFAULT false,
  deleted_reason text,       -- admin soft-delete reason (§11); null for player self-delete
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON public.community_posts (created_at DESC) WHERE is_deleted = false;
CREATE INDEX ON public.community_posts (is_pinned) WHERE is_pinned = true;
CREATE INDEX ON public.community_posts (post_type);

ALTER TABLE public.community_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "community_posts_read" ON public.community_posts
  FOR SELECT USING (is_deleted = false);

CREATE POLICY "community_posts_player_insert" ON public.community_posts
  FOR INSERT WITH CHECK (auth.uid() = author_id AND post_type = 'manual');

-- Player self-delete: only their own post, only flips is_deleted. Note this
-- WITH CHECK constrains the *new row's* is_deleted value, not which columns
-- changed — matches the spec's own §3 policy text; nothing else in the
-- client UI sends other columns on this path.
CREATE POLICY "community_posts_player_delete" ON public.community_posts
  FOR UPDATE USING (auth.uid() = author_id)
  WITH CHECK (is_deleted = true);

-- Staff: pin/unpin + soft-delete any post (§11). Mirrors the is_staff()
-- bypass pattern already used for community moderation in 016_community.sql.
CREATE POLICY "community_posts_staff_manage" ON public.community_posts
  FOR UPDATE USING (public.is_staff()) WITH CHECK (public.is_staff());

-- System/admin inserts (match_result, achievement, announcement) go through
-- createAdminClient() (service role, bypasses RLS) — same pattern as every
-- other system-generated row in this codebase (notifications, sx_score
-- events, etc). No INSERT policy needed for those post_types.

-- ---------------------------------------------------------------
-- Reactions
-- ---------------------------------------------------------------
CREATE TABLE public.post_reactions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id     uuid        NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  player_id   uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reaction    text        NOT NULL CHECK (reaction IN ('fire','crown','strong','wow')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, player_id)
);

CREATE INDEX ON public.post_reactions (post_id);

ALTER TABLE public.post_reactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "post_reactions_read" ON public.post_reactions FOR SELECT USING (true);
CREATE POLICY "post_reactions_manage_own" ON public.post_reactions
  FOR ALL USING (auth.uid() = player_id) WITH CHECK (auth.uid() = player_id);

-- ---------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------
CREATE TABLE public.post_comments (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id     uuid        NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  author_id   uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content     text        NOT NULL CHECK (char_length(content) <= 280),
  is_deleted  boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON public.post_comments (post_id, created_at);

ALTER TABLE public.post_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "post_comments_read" ON public.post_comments FOR SELECT USING (is_deleted = false);
CREATE POLICY "post_comments_insert" ON public.post_comments
  FOR INSERT WITH CHECK (auth.uid() = author_id);
CREATE POLICY "post_comments_player_delete" ON public.post_comments
  FOR UPDATE USING (auth.uid() = author_id) WITH CHECK (is_deleted = true);
CREATE POLICY "post_comments_staff_manage" ON public.post_comments
  FOR UPDATE USING (public.is_staff()) WITH CHECK (public.is_staff());

-- ---------------------------------------------------------------
-- Migrate v3.6 rows into the new shape
-- ---------------------------------------------------------------
INSERT INTO public.community_posts (id, author_id, content, image_url, post_type, created_at)
SELECT
  p.id,
  p.author_id,
  left(p.body, 500),
  (SELECT i.image_url FROM _old_post_images i WHERE i.post_id = p.id ORDER BY i.display_order LIMIT 1),
  'manual',
  p.created_at
FROM _old_posts p;

INSERT INTO public.post_comments (id, post_id, author_id, content, created_at)
SELECT r.id, r.post_id, r.author_id, left(r.body, 280), r.created_at
FROM _old_replies r;

-- ---------------------------------------------------------------
-- Weekly community challenges (§8)
-- ---------------------------------------------------------------
CREATE TABLE public.community_challenges (
  id             uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  slug           text    UNIQUE NOT NULL,
  title          text    NOT NULL,
  description    text    NOT NULL,
  coin_reward    integer NOT NULL DEFAULT 0,
  xp_reward      integer NOT NULL DEFAULT 0,
  challenge_type text    NOT NULL CHECK (challenge_type IN
                 ('matches_played','matches_won','post_created','reactions_given')),
  goal           integer NOT NULL
);

ALTER TABLE public.community_challenges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "community_challenges_read" ON public.community_challenges FOR SELECT USING (true);

INSERT INTO public.community_challenges (slug, title, description, coin_reward, xp_reward, challenge_type, goal) VALUES
  ('weekly_grind',  'The Grind',          'Play 3 matches',    100, 50,  'matches_played',   3),
  ('weekly_winner', 'Winner''s Circle',   'Win 2 matches',     200, 100, 'matches_won',      2),
  ('weekly_post',   'Community Voice',    'Post in the feed',  25,  20,  'post_created',     1),
  ('weekly_react',  'Hype Man',           'React to 5 posts',  15,  10,  'reactions_given',  5);

CREATE TABLE public.player_challenge_progress (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id     uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  challenge_id  uuid        NOT NULL REFERENCES public.community_challenges(id),
  week_start    date        NOT NULL,
  progress      integer     NOT NULL DEFAULT 0,
  completed     boolean     NOT NULL DEFAULT false,
  rewarded_at   timestamptz,
  UNIQUE (player_id, challenge_id, week_start)
);

CREATE INDEX ON public.player_challenge_progress (player_id, week_start);

ALTER TABLE public.player_challenge_progress ENABLE ROW LEVEL SECURITY;
-- Public read — the widget shows everyone's own progress only, but reads as
-- the authenticated player; public SELECT keeps this consistent with every
-- other "read your own economy row" table in this codebase (sx_coins, etc.
-- are actually staff/self only — this one has no sensitive data, so a
-- straight public read is simplest and matches achievements' public-read
-- precedent). All writes are service-role only (no client write policy).
CREATE POLICY "player_challenge_progress_read" ON public.player_challenge_progress FOR SELECT USING (true);

-- ---------------------------------------------------------------
-- Best Play of the Week (§9)
-- ---------------------------------------------------------------
CREATE TABLE public.best_play_nominations (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id      uuid        NOT NULL REFERENCES public.community_posts(id),
  week_start   date        NOT NULL,
  is_winner    boolean     NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON public.best_play_nominations (week_start);

ALTER TABLE public.best_play_nominations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "best_play_nominations_read" ON public.best_play_nominations FOR SELECT USING (true);

CREATE TABLE public.best_play_votes (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  nomination_id   uuid        NOT NULL REFERENCES public.best_play_nominations(id) ON DELETE CASCADE,
  player_id       uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  week_start      date        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (player_id, week_start)
);

CREATE INDEX ON public.best_play_votes (nomination_id);

ALTER TABLE public.best_play_votes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "best_play_votes_read" ON public.best_play_votes FOR SELECT USING (true);
CREATE POLICY "best_play_votes_insert_own" ON public.best_play_votes
  FOR INSERT WITH CHECK (auth.uid() = player_id);

-- ---------------------------------------------------------------
-- Achievements: opt-in feed sharing (§2) + Best Play winner achievement,
-- referenced by §9 but missing from 053_achievements.sql.
-- ---------------------------------------------------------------
ALTER TABLE public.achievements ADD COLUMN share_to_feed boolean NOT NULL DEFAULT false;

INSERT INTO public.achievements (slug, name, description, category, xp_reward, coin_reward, phase, sort_order, share_to_feed) VALUES
  ('best_play_winner', 'Best Play', 'Won Best Play of the Week', 'community', 200, 500, 'phase3', 31, true);
