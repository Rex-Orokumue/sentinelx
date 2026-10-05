-- 20261005140000_chat_erasure.sql — Stage A0 of mobile 5c.
-- Chat history survived account deletion: anonymise_account never touched chat_messages and the
-- profiles row survives, so ON DELETE CASCADE never fired. Erase it, and purge accounts that
-- were already anonymised before this migration.
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

  IF v_username IS NOT NULL THEN
    INSERT INTO public.retired_usernames (username)
    VALUES (lower(v_username))
    ON CONFLICT DO NOTHING;
  END IF;

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
  DELETE FROM public.friends
    WHERE requester_id = p_id OR recipient_id = p_id;

  -- Private messaging: drop the leaver's threads (cascades dm_messages),
  -- their blocks, any mute row, and reports they filed or that name them.
  DELETE FROM public.dm_threads
    WHERE player_a = p_id OR player_b = p_id;
  DELETE FROM public.dm_blocks
    WHERE blocker_id = p_id OR blocked_id = p_id;
  DELETE FROM public.dm_muted_players WHERE player_id = p_id;
  DELETE FROM public.dm_reports
    WHERE reporter_id = p_id OR reported_id = p_id;

  -- Support chat (mobile 5c): the history and the player's rate-limit trail.
  DELETE FROM public.chat_messages WHERE player_id = p_id;
  DELETE FROM public.chat_rate_limit_events WHERE subject_key = 'player:' || p_id::text;
END;
$$;

REVOKE ALL ON FUNCTION public.anonymise_account(uuid) FROM public, anon, authenticated;

-- One-off: accounts anonymised before this migration still have chat rows.
DELETE FROM public.chat_messages
  WHERE player_id IN (SELECT id FROM public.profiles WHERE deleted_at IS NOT NULL);
DELETE FROM public.chat_rate_limit_events
  WHERE subject_key IN (SELECT 'player:' || id::text FROM public.profiles WHERE deleted_at IS NOT NULL);
