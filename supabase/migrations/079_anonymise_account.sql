-- Steps 2, 3 and 5 of the execution flow in one transaction, so a partial
-- anonymisation cannot occur.
--
-- Deliberately does NOT touch auth.users: that is a separate Auth API call
-- which cannot join this transaction. Nor does it write the ban hashes, which
-- need the plaintext email this function never sees. The caller does both,
-- afterwards.
CREATE OR REPLACE FUNCTION public.anonymise_account(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_username text;
BEGIN
  SELECT username INTO v_username FROM public.profiles WHERE id = p_id;

  -- Retire the handle. Done here rather than at request time, so a cancelled
  -- deletion leaves the username untouched.
  IF v_username IS NOT NULL THEN
    INSERT INTO public.retired_usernames (username)
    VALUES (lower(v_username))
    ON CONFLICT DO NOTHING;
  END IF;

  -- Competitive stats (sx_score, wins, losses, total_titles, xp,
  -- membership_tier, sentinel_tier) are deliberately kept: they are the
  -- substance of the match history being retained and the leaderboards it
  -- feeds. Removing them would renumber historical standings.
  UPDATE public.profiles SET
    username           = 'deleted_' || substr(p_id::text, 1, 8),
    display_name       = 'Deleted player',
    avatar_url         = NULL,
    country            = NULL,
    phone              = NULL,
    whatsapp_number    = NULL,
    bio                = NULL,
    notification_prefs = '{}'::jsonb,
    last_login_date    = NULL,
    login_streak       = 0,
    deleted_at         = now(),
    updated_at         = now()
  WHERE id = p_id;

  -- Private to the user and referenced by nobody.
  DELETE FROM public.fcm_tokens                WHERE player_id = p_id;
  DELETE FROM public.phone_verifications       WHERE user_id   = p_id;
  DELETE FROM public.player_kyc                WHERE player_id = p_id;
  DELETE FROM public.game_interest             WHERE user_id   = p_id;
  DELETE FROM public.player_challenge_progress WHERE player_id = p_id;
  DELETE FROM public.player_store_items        WHERE player_id = p_id;
  DELETE FROM public.notifications             WHERE player_id = p_id;
  DELETE FROM public.player_notifications      WHERE player_id = p_id;
  DELETE FROM public.tournament_invitations    WHERE player_id = p_id;
  DELETE FROM public.user_roles                WHERE user_id   = p_id;
  DELETE FROM public.xp_events                 WHERE player_id = p_id;
  -- A mutual relationship ends when one side leaves.
  DELETE FROM public.friends
    WHERE requester_id = p_id OR recipient_id = p_id;
END;
$$;

-- Service-role only; never callable from a browser session.
REVOKE ALL ON FUNCTION public.anonymise_account(uuid) FROM public, anon, authenticated;
