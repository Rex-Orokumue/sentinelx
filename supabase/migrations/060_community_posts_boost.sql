-- Spec §6 — 200 coins pins a manual post to the top of the feed (below
-- announcements) for 24h.
ALTER TABLE public.community_posts
  ADD COLUMN boosted_until timestamptz;
