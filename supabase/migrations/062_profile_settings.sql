-- Player Profile & Settings (Phase 3): notification preferences JSONB +
-- one-time username change tracking. RLS: profiles_own_update (migration
-- 001, USING (auth.uid() = id), no column restriction) already permits the
-- player to write both new columns — no new policy needed.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS notification_prefs jsonb NOT NULL DEFAULT '{
    "whatsapp": {
      "match_reminder": true,
      "result_confirmed": true,
      "prize_credited": true,
      "challenge_completed": false,
      "achievement_unlocked": false,
      "registration_confirmed": true
    },
    "push": {
      "match_reminder": true,
      "result_confirmed": true,
      "achievement_unlocked": true,
      "challenge_completed": true,
      "new_announcement": true,
      "tournament_announced": true,
      "wager_settled": true,
      "referral_converted": true,
      "post_comment": true,
      "post_reaction": false,
      "bracket_released": true,
      "match_assigned": true,
      "prize_credited": true
    },
    "achievement_sharing": {
      "tournament": true,
      "milestone": true,
      "streak": true,
      "social": false,
      "other": false
    }
  }'::jsonb;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username_changed_at timestamptz;

-- Atomic single-key merge into profiles.notification_prefs — avoids a
-- client-side read-modify-write race between concurrent saves of different
-- sub-keys (whatsapp vs achievement_sharing). SECURITY INVOKER (the
-- default, stated explicitly) means this runs as the calling (authenticated)
-- role — profiles_own_update RLS still applies, so a player can only ever
-- merge their own row.
CREATE OR REPLACE FUNCTION public.jsonb_merge_notification_prefs(p_id uuid, p_key text, p_patch jsonb)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
AS $$
  UPDATE public.profiles
  SET notification_prefs = jsonb_set(notification_prefs, ARRAY[p_key], COALESCE(notification_prefs -> p_key, '{}'::jsonb) || p_patch)
  WHERE id = p_id;
$$;
