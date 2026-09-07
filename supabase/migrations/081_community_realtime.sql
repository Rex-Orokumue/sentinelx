-- Live community feed. Only player_notifications was published for realtime
-- (the notification bell), so comments and reactions required a page reload
-- before anything appeared — including your own.
--
-- Both tables are already world-readable (post_reactions_read USING (true),
-- and the equivalent on post_comments), and realtime enforces RLS on top of
-- the publication, so publishing them exposes nothing a visitor cannot
-- already select.
ALTER PUBLICATION supabase_realtime ADD TABLE public.post_comments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.post_reactions;
