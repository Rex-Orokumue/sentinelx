-- Temporary notification mutes: "quiet for an hour" without giving up a
-- notification type forever.
--
-- Reactions now push (migration 080), which is the right default but also the
-- easiest way to make someone disable notifications wholesale — and once they
-- do, the channel is lost for the ones that matter, like a fixture
-- assignment. A cheap, obvious mute is what keeps the important ones alive.
--
-- Scope is exactly one of:
--   notification_type — "no reaction pushes for a week"
--   post_id           — "nothing more from this thread"
--
-- Permanently muting a TYPE is not stored here: it flips
-- profiles.notification_prefs.push[type] instead, which already means exactly
-- that, so the two can never disagree. A post mute has no equivalent there, so
-- "always" for a post is a far-future muted_until.
CREATE TABLE public.notification_mutes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  notification_type text,
  post_id           uuid REFERENCES public.community_posts(id) ON DELETE CASCADE,
  muted_until       timestamptz NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),

  -- Exactly one scope, never both and never neither.
  CONSTRAINT notification_mutes_one_scope CHECK (
    (notification_type IS NOT NULL AND post_id IS NULL)
    OR (notification_type IS NULL AND post_id IS NOT NULL)
  )
);

-- Re-muting the same thing updates the existing row rather than stacking
-- duplicates, so the actions can upsert.
CREATE UNIQUE INDEX notification_mutes_type_uniq
  ON public.notification_mutes (player_id, notification_type)
  WHERE notification_type IS NOT NULL;
CREATE UNIQUE INDEX notification_mutes_post_uniq
  ON public.notification_mutes (player_id, post_id)
  WHERE post_id IS NOT NULL;

-- The read path is "every live mute for this player", on every push.
CREATE INDEX notification_mutes_player_live_idx
  ON public.notification_mutes (player_id, muted_until);

ALTER TABLE public.notification_mutes ENABLE ROW LEVEL SECURITY;

-- A player manages only their own mutes. Sends read them through the
-- service-role client, which bypasses RLS.
CREATE POLICY "notification_mutes_own_read" ON public.notification_mutes
  FOR SELECT USING (auth.uid() = player_id);
CREATE POLICY "notification_mutes_own_write" ON public.notification_mutes
  FOR ALL USING (auth.uid() = player_id) WITH CHECK (auth.uid() = player_id);
