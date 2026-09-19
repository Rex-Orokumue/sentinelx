-- Contract step for docs/superpowers/specs/2026-09-18-flutter-mobile-app-master-design.md §2.5.
-- Code that depended on user-context access to these objects was moved to the
-- service role first (plan 2026-09-18-mobile-phase0a-security-hardening.md, Tasks 2-3).

-- ── S2: profiles can no longer be written by a signed-in user ──────────────────
-- profiles_own_update had USING (auth.uid() = id) and no column restriction, so a
-- player could PATCH their own xp / sx_score / wins / kyc_verified / membership_tier.
-- Every legitimate profile write is now a server action using the service role.
DROP POLICY IF EXISTS profiles_own_update ON public.profiles;
REVOKE INSERT, UPDATE ON public.profiles FROM anon, authenticated;

-- ── S1: private columns are no longer readable by anon/authenticated ───────────
-- Column privileges cannot be revoked while a table-level SELECT grant exists, so
-- revoke the table-level grant and re-grant an explicit allow-list. Private:
-- phone, whatsapp_number, notification_prefs, referred_by, deletion_requested_at.
-- kyc_verified and deleted_at stay public on purpose (verified badge / tombstones).
REVOKE SELECT ON public.profiles FROM anon, authenticated;
GRANT SELECT (
  id, username, display_name, avatar_url, country, sx_score, total_matches, wins, losses,
  goals_scored, goals_conceded, total_titles, kyc_verified, created_at, updated_at, bio,
  phone_verified_at, sentinel_tier, xp, membership_tier, last_login_date, login_streak,
  username_changed_at, locale, deleted_at, equipped_avatar_border, equipped_bubble_skin
) ON public.profiles TO anon, authenticated;

-- ── S3: money / result tables are written only by the service role ─────────────
DROP POLICY IF EXISTS tr_own_insert                           ON public.tournament_registrations;
DROP POLICY IF EXISTS wr_own_insert                           ON public.withdrawal_requests;
DROP POLICY IF EXISTS mr_player_insert                        ON public.match_results;
DROP POLICY IF EXISTS mr_own_update_pending                   ON public.match_results;
DROP POLICY IF EXISTS friendly_matches_challenger_insert      ON public.friendly_matches;
DROP POLICY IF EXISTS friendly_matches_participant_or_staff_update ON public.friendly_matches;
DROP POLICY IF EXISTS fmr_participant_insert_while_active     ON public.friendly_match_results;
DROP POLICY IF EXISTS fmr_own_update_while_active             ON public.friendly_match_results;

REVOKE INSERT, UPDATE, DELETE ON
  public.tournament_registrations,
  public.withdrawal_requests,
  public.match_results,
  public.friendly_matches,
  public.friendly_match_results
FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
