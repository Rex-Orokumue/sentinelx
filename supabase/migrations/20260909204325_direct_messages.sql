-- Private 1:1 player messaging, text + images. `070_chat_system` is the support
-- chatbot — unrelated and new.
--
-- Thread identity is the *pair*, stored normalised (player_a < player_b as text)
-- with a unique index, so A->B and B->A are one thread. Blocking AND an admin
-- "mute messaging" flag are enforced in the dm_messages INSERT policy via
-- dm_can_message(), not just the UI. Messages are immutable except read_at.
-- Images live in a private bucket; the DB stores the storage path, reads go
-- through server-side signed URLs (same as match-evidence).

-- ---------------------------------------------------------------
-- Threads
-- ---------------------------------------------------------------
CREATE TABLE public.dm_threads (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_a        uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  player_b        uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_by      uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dm_threads_pair_ordered CHECK (player_a < player_b),
  CONSTRAINT dm_threads_pair_unique  UNIQUE (player_a, player_b)
);
CREATE INDEX dm_threads_player_a_idx ON public.dm_threads (player_a, last_message_at DESC);
CREATE INDEX dm_threads_player_b_idx ON public.dm_threads (player_b, last_message_at DESC);
-- Powers the admin "messaged N new people in 24h" signal.
CREATE INDEX dm_threads_created_by_idx ON public.dm_threads (created_by, created_at DESC);

ALTER TABLE public.dm_threads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dm_threads_participant_read" ON public.dm_threads
  FOR SELECT USING (auth.uid() IN (player_a, player_b) OR public.is_staff());
-- Threads are created only via the server action (service-role) — no client
-- write policy. Blocking hides a thread in the query layer, not by deleting it.

-- ---------------------------------------------------------------
-- Admin "mute messaging" — staff-only. Not a ban; a moderator may set it.
-- ---------------------------------------------------------------
CREATE TABLE public.dm_muted_players (
  player_id uuid        PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  muted_at  timestamptz NOT NULL DEFAULT now(),
  muted_by  uuid        REFERENCES public.profiles(id) ON DELETE SET NULL
);
ALTER TABLE public.dm_muted_players ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dm_muted_players_staff_read" ON public.dm_muted_players
  FOR SELECT USING (public.is_staff());
-- Writes are service-role only (setMessagingMuted action).

-- ---------------------------------------------------------------
-- Blocks (created before Messages — dm_can_message() below references it)
-- ---------------------------------------------------------------
CREATE TABLE public.dm_blocks (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  blocked_id uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dm_blocks_not_self   CHECK (blocker_id <> blocked_id),
  CONSTRAINT dm_blocks_pair_unique UNIQUE (blocker_id, blocked_id)
);
CREATE INDEX dm_blocks_blocker_idx ON public.dm_blocks (blocker_id);
CREATE INDEX dm_blocks_blocked_idx ON public.dm_blocks (blocked_id);

ALTER TABLE public.dm_blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dm_blocks_involved_read" ON public.dm_blocks
  FOR SELECT USING (auth.uid() IN (blocker_id, blocked_id) OR public.is_staff());
CREATE POLICY "dm_blocks_own_insert" ON public.dm_blocks
  FOR INSERT WITH CHECK (blocker_id = auth.uid());
CREATE POLICY "dm_blocks_own_delete" ON public.dm_blocks
  FOR DELETE USING (blocker_id = auth.uid());

-- ---------------------------------------------------------------
-- Messages
-- ---------------------------------------------------------------
CREATE TABLE public.dm_messages (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id  uuid        NOT NULL REFERENCES public.dm_threads(id) ON DELETE CASCADE,
  sender_id  uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body       text,
  image_url  text,   -- storage path in the dm-images bucket, not a URL
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at    timestamptz,
  CONSTRAINT dm_messages_has_content
    CHECK ((body IS NOT NULL AND btrim(body) <> '') OR image_url IS NOT NULL),
  CONSTRAINT dm_messages_body_len
    CHECK (body IS NULL OR char_length(body) <= 2000)
);
CREATE INDEX dm_messages_thread_idx ON public.dm_messages (thread_id, created_at);
CREATE INDEX dm_messages_unread_idx ON public.dm_messages (thread_id, read_at) WHERE read_at IS NULL;

ALTER TABLE public.dm_messages ENABLE ROW LEVEL SECURITY;

-- STABLE + SECURITY DEFINER so it can see dm_threads / dm_blocks /
-- dm_muted_players regardless of the caller's own RLS.
CREATE OR REPLACE FUNCTION public.dm_can_message(p_thread uuid, p_sender uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.dm_threads t
    WHERE t.id = p_thread
      AND p_sender IN (t.player_a, t.player_b)
      AND NOT EXISTS (SELECT 1 FROM public.dm_muted_players m WHERE m.player_id = p_sender)
      AND NOT EXISTS (
        SELECT 1 FROM public.dm_blocks b
        WHERE (b.blocker_id = t.player_a AND b.blocked_id = t.player_b)
           OR (b.blocker_id = t.player_b AND b.blocked_id = t.player_a)
      )
  );
$$;

CREATE POLICY "dm_messages_participant_read" ON public.dm_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.dm_threads t
      WHERE t.id = thread_id AND (auth.uid() IN (t.player_a, t.player_b) OR public.is_staff())
    )
  );

CREATE POLICY "dm_messages_sender_insert" ON public.dm_messages
  FOR INSERT WITH CHECK (
    sender_id = auth.uid() AND public.dm_can_message(thread_id, auth.uid())
  );

-- Only permitted update: the recipient marking a message read.
CREATE POLICY "dm_messages_recipient_mark_read" ON public.dm_messages
  FOR UPDATE USING (
    sender_id <> auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.dm_threads t
      WHERE t.id = thread_id AND auth.uid() IN (t.player_a, t.player_b)
    )
  )
  WITH CHECK (sender_id <> auth.uid());

-- ---------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------
CREATE TABLE public.dm_reports (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reported_id uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  thread_id   uuid        NOT NULL REFERENCES public.dm_threads(id) ON DELETE CASCADE,
  message_id  uuid        REFERENCES public.dm_messages(id) ON DELETE SET NULL,
  reason      text        NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 1000),
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid        REFERENCES public.profiles(id) ON DELETE SET NULL
);
CREATE INDEX dm_reports_open_idx ON public.dm_reports (created_at DESC) WHERE resolved_at IS NULL;

ALTER TABLE public.dm_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dm_reports_reporter_or_staff_read" ON public.dm_reports
  FOR SELECT USING (reporter_id = auth.uid() OR public.is_staff());
CREATE POLICY "dm_reports_own_insert" ON public.dm_reports
  FOR INSERT WITH CHECK (reporter_id = auth.uid());
CREATE POLICY "dm_reports_staff_update" ON public.dm_reports
  FOR UPDATE USING (public.is_staff()) WITH CHECK (public.is_staff());

-- ---------------------------------------------------------------
-- Private image bucket — mirrors match-evidence (004_match_evidence_storage.sql)
-- ---------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('dm-images', 'dm-images', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "dm_images_insert_own"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'dm-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Owner or staff (reads normally go through server-side signed URLs).
CREATE POLICY "dm_images_select_own_or_staff"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'dm-images'
    AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_staff())
  );

-- ---------------------------------------------------------------
-- Notification type + realtime
-- ---------------------------------------------------------------
ALTER TABLE public.player_notifications DROP CONSTRAINT player_notifications_type_check;
ALTER TABLE public.player_notifications ADD CONSTRAINT player_notifications_type_check
  CHECK (type = ANY (ARRAY[
    'listing_approved','listing_removed','listing_deleted','listing_sold','withdrawal_paid',
    'withdrawal_rejected','result_confirmed','referral_credited','friend_request','wallet_credited',
    'player_disqualified','noshow_needs_decision','buy_request_in_progress','buy_request_fulfilled',
    'buy_request_closed','masters_invitation','champions_cup_invitation','invitation_accepted',
    'invitation_expired_cascade','tier_upgraded','achievement_unlocked','fixture_assigned',
    'prize_credited','match_reminder','tournament_announced','new_announcement','post_comment',
    'post_reaction','wager_settled','bracket_released','withdrawal_pending','exchange_listing_pending',
    'result_needs_review','result_disputed','result_no_submission','direct_message'
  ]::text[]));

ALTER PUBLICATION supabase_realtime ADD TABLE public.dm_messages;

-- ---------------------------------------------------------------
-- Account deletion — a private conversation ends when one side leaves.
-- ---------------------------------------------------------------
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
END;
$$;

REVOKE ALL ON FUNCTION public.anonymise_account(uuid) FROM public, anon, authenticated;
