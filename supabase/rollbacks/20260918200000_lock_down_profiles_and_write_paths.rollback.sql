-- Inverse of 20260918200000_lock_down_profiles_and_write_paths.sql.
-- Restores the exact pre-change policies observed on production 2026-09-18.
-- NOT in supabase/migrations — apply by hand only if the lock-down breaks the site.

GRANT SELECT, INSERT, UPDATE ON public.profiles TO anon, authenticated;
CREATE POLICY profiles_own_update ON public.profiles FOR UPDATE USING (auth.uid() = id);

GRANT INSERT, UPDATE, DELETE ON
  public.tournament_registrations, public.withdrawal_requests, public.match_results,
  public.friendly_matches, public.friendly_match_results
TO anon, authenticated;

CREATE POLICY tr_own_insert ON public.tournament_registrations
  FOR INSERT WITH CHECK (auth.uid() = player_id);
CREATE POLICY wr_own_insert ON public.withdrawal_requests
  FOR INSERT WITH CHECK (player_id = auth.uid());
CREATE POLICY mr_player_insert ON public.match_results
  FOR INSERT WITH CHECK (
    (auth.uid() = submitted_by) AND EXISTS (
      SELECT 1 FROM public.matches m
      WHERE m.id = match_results.match_id AND (auth.uid() = m.player_a_id OR auth.uid() = m.player_b_id)));
CREATE POLICY mr_own_update_pending ON public.match_results
  FOR UPDATE USING ((submitted_by = auth.uid()) AND (status = 'pending'))
  WITH CHECK (submitted_by = auth.uid());
CREATE POLICY friendly_matches_challenger_insert ON public.friendly_matches
  FOR INSERT WITH CHECK ((challenger_id = auth.uid()) AND (status = 'pending'));
CREATE POLICY friendly_matches_participant_or_staff_update ON public.friendly_matches
  FOR UPDATE USING ((challenger_id = auth.uid()) OR (opponent_id = auth.uid()) OR is_staff());
CREATE POLICY fmr_participant_insert_while_active ON public.friendly_match_results
  FOR INSERT WITH CHECK (
    (auth.uid() = submitted_by) AND EXISTS (
      SELECT 1 FROM public.friendly_matches fm
      WHERE fm.id = friendly_match_results.friendly_match_id AND fm.status = 'active'
        AND (auth.uid() = fm.challenger_id OR auth.uid() = fm.opponent_id)));
CREATE POLICY fmr_own_update_while_active ON public.friendly_match_results
  FOR UPDATE USING (
    (auth.uid() = submitted_by) AND EXISTS (
      SELECT 1 FROM public.friendly_matches fm
      WHERE fm.id = friendly_match_results.friendly_match_id AND fm.status = 'active'));

NOTIFY pgrst, 'reload schema';
