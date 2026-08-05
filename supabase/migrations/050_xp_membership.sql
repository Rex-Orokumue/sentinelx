-- 050_xp_membership.sql
-- Phase 2 Economy §4: XP-based membership tiers, plus daily-login tracking
-- columns (§3.7) landed here since they're both profiles-level additions
-- with no cross-table dependency. See
-- docs/superpowers/specs/2026-08-05-phase2-economy-design.md §4, §3.7.

ALTER TABLE public.profiles
  ADD COLUMN xp integer NOT NULL DEFAULT 0 CHECK (xp >= 0),
  ADD COLUMN membership_tier text NOT NULL DEFAULT 'recruit'
    CHECK (membership_tier IN ('recruit', 'guardian', 'elite', 'sentinel', 'legend')),
  ADD COLUMN last_login_date date,
  ADD COLUMN login_streak integer NOT NULL DEFAULT 0;

CREATE TABLE public.xp_events (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id    uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  xp           integer     NOT NULL CHECK (xp > 0),
  source       text        NOT NULL CHECK (source IN (
    'match_played', 'match_won', 'tournament_entered', 'tournament_completed',
    'tournament_placement', 'achievement_unlocked',
    'daily_login', 'login_streak', 'community_activity',
    'admin_grant'
  )),
  reference_id uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON public.xp_events (player_id);

ALTER TABLE public.xp_events ENABLE ROW LEVEL SECURITY;

-- Same shape as sx_score_events: player reads their own, staff reads all,
-- no client INSERT policy — every write is via awardXP()'s service-role client.
CREATE POLICY "xp_events_read" ON public.xp_events
  FOR SELECT USING (auth.uid() = player_id OR public.is_staff());

-- New in-app notification types (Global Constraints #4 — in-app only, not
-- routed through the WhatsApp/Termii pipeline).
ALTER TABLE public.player_notifications DROP CONSTRAINT player_notifications_type_check;
ALTER TABLE public.player_notifications ADD CONSTRAINT player_notifications_type_check
  CHECK (type IN (
    'listing_approved', 'listing_removed', 'listing_deleted', 'listing_sold',
    'withdrawal_paid', 'withdrawal_rejected',
    'result_confirmed', 'referral_credited',
    'friend_request', 'wallet_credited',
    'player_disqualified', 'noshow_needs_decision',
    'buy_request_in_progress', 'buy_request_fulfilled', 'buy_request_closed',
    'masters_invitation', 'champions_cup_invitation',
    'invitation_accepted', 'invitation_expired_cascade',
    'tier_upgraded', 'achievement_unlocked'
  ));
