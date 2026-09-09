-- Staff takedown for statuses. The base migration (20260907120000) only lets an
-- author delete their own status. Posts have community_posts_staff_manage; a
-- status shown to the whole community needs the same — most players here are
-- minors and a moderator must be able to pull a harmful status.
--
-- Deleting the player_statuses row cascades its status_views (FK ON DELETE
-- CASCADE), so no separate cleanup. status_views also gets a staff SELECT
-- policy so the admin surface can show a view count without the service role.

CREATE POLICY "player_statuses_staff_delete" ON public.player_statuses
  FOR DELETE USING (public.is_staff());

CREATE POLICY "status_views_staff_read" ON public.status_views
  FOR SELECT USING (public.is_staff());
