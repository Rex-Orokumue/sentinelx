-- Atomic profile-onboarding completion.
--
-- performCompleteProfileOnboarding() used to stamp profiles.profile_completed_at and
-- then replace game_interest in a second, separate write whose failure was ignored,
-- so a failed interests write left a "completed" profile with zero required interests
-- and reported success. Doing both in one function body means one transaction: any
-- failure rolls everything back, including the completion stamp.
--
-- Service-role only (profiles is server-write-only, CLAUDE.md rule 9). Callers verify
-- the user with getUser() first and pass the verified id.
CREATE OR REPLACE FUNCTION public.complete_profile_onboarding(
  p_user_id  uuid,
  p_country  text,
  p_whatsapp text,
  p_consent  boolean,
  p_game_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(cardinality(p_game_ids), 0) = 0 THEN
    RAISE EXCEPTION 'at least one game interest is required' USING ERRCODE = '22023';
  END IF;

  UPDATE public.profiles SET
    country                  = p_country,
    whatsapp_number          = p_whatsapp,
    consent_whatsapp_updates = p_consent,
    -- Keep the original completion time if the player somehow re-submits.
    profile_completed_at     = coalesce(profile_completed_at, now()),
    updated_at               = now()
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found' USING ERRCODE = 'P0002';
  END IF;

  -- Full replace, matching replaceGameInterests(). An unknown game id violates the
  -- game_interest -> games foreign key and aborts the whole function.
  DELETE FROM public.game_interest WHERE user_id = p_user_id;
  INSERT INTO public.game_interest (user_id, game_id)
  SELECT p_user_id, g FROM (SELECT DISTINCT unnest(p_game_ids) AS g) ids;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_profile_onboarding(uuid, text, text, boolean, uuid[]) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_profile_onboarding(uuid, text, text, boolean, uuid[]) TO service_role;

NOTIFY pgrst, 'reload schema';
