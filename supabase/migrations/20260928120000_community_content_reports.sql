-- Mobile Phase 4 (Community) report feature — spec §5/§6
-- (docs/superpowers/specs/2026-09-27-mobile-phase4-community-design.md).
-- One table for both post- and comment-level reports, modeled on dm_reports
-- (20260909204325_direct_messages.sql), plus a reason_code taxonomy and a
-- resolution enum so the Phase 8 staff review queue this feeds doesn't need
-- its own schema change later.
CREATE TABLE public.community_content_reports (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  post_id     uuid        NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  comment_id  uuid        REFERENCES public.post_comments(id) ON DELETE CASCADE,
  reason_code text        NOT NULL CHECK (reason_code IN (
                            'spam', 'harassment', 'hate_speech',
                            'nudity_or_sexual_content', 'violence', 'misinformation', 'other')),
  reason_note text        CHECK (char_length(reason_note) <= 500),
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolution  text        CHECK (resolution IN ('no_action', 'content_removed', 'user_warned', 'user_banned'))
);

-- Dedupe: one open report per reporter per post, and separately per reporter
-- per comment (partial indexes, not a single UNIQUE(...), because plain
-- UNIQUE treats every NULL comment_id as distinct and would not actually
-- dedupe post-level reports).
CREATE UNIQUE INDEX community_content_reports_post_dedupe
  ON public.community_content_reports (reporter_id, post_id) WHERE comment_id IS NULL;
CREATE UNIQUE INDEX community_content_reports_comment_dedupe
  ON public.community_content_reports (reporter_id, comment_id) WHERE comment_id IS NOT NULL;
CREATE INDEX community_content_reports_open_idx
  ON public.community_content_reports (created_at DESC) WHERE resolved_at IS NULL;

ALTER TABLE public.community_content_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "community_content_reports_reporter_or_staff_read" ON public.community_content_reports
  FOR SELECT USING (reporter_id = auth.uid() OR public.is_staff());
CREATE POLICY "community_content_reports_own_insert" ON public.community_content_reports
  FOR INSERT WITH CHECK (reporter_id = auth.uid());
CREATE POLICY "community_content_reports_staff_update" ON public.community_content_reports
  FOR UPDATE USING (public.is_staff()) WITH CHECK (public.is_staff());

-- Realtime plan for mobile (spec §7, Ruling 3 revised) — community_posts is
-- already public-read (community_posts_read, is_deleted = false), so this is
-- a capability addition, not a new access grant, same justification
-- 081_community_realtime.sql already used for post_comments/post_reactions.
-- Platform-level: web can subscribe to the same publication later without
-- another migration.
ALTER PUBLICATION supabase_realtime ADD TABLE public.community_posts;
