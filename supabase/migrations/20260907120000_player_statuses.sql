-- 20260907120000_player_statuses.sql
-- Ephemeral 24-hour statuses ("stories"): an image and/or a short caption that
-- disappears a day after posting.
--
-- Expiry is a QUERY FILTER, not a job. Every read filters `expires_at > now()`,
-- so a status stops being visible the moment it expires whether or not any
-- cleanup has run. A later job can hard-delete old rows and their images, but
-- that is housekeeping — never the mechanism that makes expiry correct. The
-- platform's cron schedules live outside this repo, so nothing user-visible may
-- depend on one having run.

CREATE TABLE public.player_statuses (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id  uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  image_url  text,
  caption    text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),

  -- A status with neither an image nor words is nothing at all.
  CONSTRAINT player_statuses_has_content
    CHECK (image_url IS NOT NULL OR (caption IS NOT NULL AND btrim(caption) <> '')),
  CONSTRAINT player_statuses_caption_len
    CHECK (caption IS NULL OR char_length(caption) <= 200),
  CONSTRAINT player_statuses_expiry_after_creation
    CHECK (expires_at > created_at)
);

-- The feed reads "live statuses, newest author first", so the partial index
-- matches the query shape rather than indexing long-dead rows.
CREATE INDEX player_statuses_live_idx
  ON public.player_statuses (expires_at DESC, player_id);
CREATE INDEX player_statuses_player_idx
  ON public.player_statuses (player_id, created_at DESC);

ALTER TABLE public.player_statuses ENABLE ROW LEVEL SECURITY;

-- Community is login-gated (017_community_login_gate_and_images), so statuses
-- follow the same rule: signed-in members read, and only expired-free rows are
-- ever selected by the query layer.
CREATE POLICY "player_statuses_auth_read" ON public.player_statuses
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "player_statuses_own_insert" ON public.player_statuses
  FOR INSERT WITH CHECK (auth.uid() = player_id);

-- Authors can take their own status down early. No UPDATE policy: a status is
-- immutable once posted — editing what people have already seen is exactly the
-- behaviour this format should not have.
CREATE POLICY "player_statuses_own_delete" ON public.player_statuses
  FOR DELETE USING (auth.uid() = player_id);

CREATE TABLE public.status_views (
  id        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  status_id uuid        NOT NULL REFERENCES public.player_statuses(id) ON DELETE CASCADE,
  viewer_id uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (status_id, viewer_id)
);

CREATE INDEX status_views_status_idx ON public.status_views (status_id, viewed_at DESC);
CREATE INDEX status_views_viewer_idx ON public.status_views (viewer_id);

ALTER TABLE public.status_views ENABLE ROW LEVEL SECURITY;

-- Who watched is the author's business and the viewer's own — not the whole
-- community's. The author reads the "seen by" list for their own statuses; a
-- viewer can see their own view rows (which is what marks a ring as seen).
CREATE POLICY "status_views_author_or_self_read" ON public.status_views
  FOR SELECT USING (
    auth.uid() = viewer_id
    OR auth.uid() = (SELECT player_id FROM public.player_statuses s WHERE s.id = status_id)
  );

-- You can only record your own view, and only of a status that is still live —
-- so a stale client cannot backfill views onto something already expired.
CREATE POLICY "status_views_own_insert" ON public.status_views
  FOR INSERT WITH CHECK (
    auth.uid() = viewer_id
    AND EXISTS (
      SELECT 1 FROM public.player_statuses s
      WHERE s.id = status_id AND s.expires_at > now()
    )
  );

-- Live rings and view counts without a reload, matching how post_comments and
-- post_reactions are published (081_community_realtime).
ALTER PUBLICATION supabase_realtime ADD TABLE public.player_statuses;
ALTER PUBLICATION supabase_realtime ADD TABLE public.status_views;
