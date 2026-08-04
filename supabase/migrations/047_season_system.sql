-- 046_season_system.sql
-- SentinelX Season System: seasons, ranking points, no-show penalties, and
-- tournament invitations (Masters + Champions Cup). See
-- docs/superpowers/specs/2026-08-03-season-system-design.md.

CREATE TABLE public.seasons (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  slug        text        NOT NULL UNIQUE,
  start_date  date        NOT NULL,
  end_date    date        NOT NULL,
  status      text        NOT NULL DEFAULT 'active'
                CHECK (status IN ('upcoming', 'active', 'completed')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.seasons ENABLE ROW LEVEL SECURITY;

-- Public: shown on the logged-out /seasons/[slug] page.
CREATE POLICY "seasons_select" ON public.seasons
  FOR SELECT USING (true);

CREATE TABLE public.season_ranking_points (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id     uuid        NOT NULL REFERENCES public.seasons(id),
  player_id     uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  tournament_id uuid        NOT NULL REFERENCES public.tournaments(id),
  points        integer     NOT NULL DEFAULT 0,
  placement     integer,
  awarded_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (season_id, player_id, tournament_id)
);

CREATE INDEX ON public.season_ranking_points (season_id, player_id);
CREATE INDEX ON public.season_ranking_points (tournament_id);

ALTER TABLE public.season_ranking_points ENABLE ROW LEVEL SECURITY;

-- Player reads their own; staff reads all. No client write policy — every
-- write goes through the service-role client from awardSeasonPoints.
CREATE POLICY "srp_select" ON public.season_ranking_points
  FOR SELECT USING (auth.uid() = player_id OR public.is_staff());

CREATE TABLE public.season_noshow_penalties (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id   uuid        NOT NULL REFERENCES public.seasons(id),
  player_id   uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  match_id    uuid        NOT NULL REFERENCES public.matches(id),
  points      integer     NOT NULL DEFAULT -15,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (season_id, player_id, match_id)
);

CREATE INDEX ON public.season_noshow_penalties (season_id, player_id);

ALTER TABLE public.season_noshow_penalties ENABLE ROW LEVEL SECURITY;

CREATE POLICY "snp_select" ON public.season_noshow_penalties
  FOR SELECT USING (auth.uid() = player_id OR public.is_staff());

CREATE TABLE public.tournament_invitations (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id   uuid        NOT NULL REFERENCES public.tournaments(id),
  player_id       uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  rank_at_invite  integer     NOT NULL,
  status          text        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
  invited_at      timestamptz NOT NULL DEFAULT now(),
  responded_at    timestamptz,
  expires_at      timestamptz NOT NULL,
  UNIQUE (tournament_id, player_id)
);

CREATE INDEX ON public.tournament_invitations (tournament_id, status);
CREATE INDEX ON public.tournament_invitations (player_id);

ALTER TABLE public.tournament_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ti_select" ON public.tournament_invitations
  FOR SELECT USING (auth.uid() = player_id OR public.is_staff());

-- Extend tournaments for season tiers. 'open' preserves existing behavior
-- for every tournament created before this migration.
ALTER TABLE public.tournaments
  ADD COLUMN tournament_type text NOT NULL DEFAULT 'open'
    CHECK (tournament_type IN ('community_club', 'masters', 'champions_cup', 'open')),
  ADD COLUMN season_id uuid REFERENCES public.seasons(id),
  ADD COLUMN invitation_only boolean NOT NULL DEFAULT false;

CREATE INDEX ON public.tournaments (season_id);

-- New notification types for the invitation flow. invitation_accepted is
-- in-app only (staff awareness) so it's added to player_notifications but
-- not the WhatsApp outbox (notifications).
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
    'invitation_accepted', 'invitation_expired_cascade'
  ));

ALTER TABLE public.notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'registration_confirmed', 'fixture_reminder', 'result_confirmed',
    'prize_credited', 'escrow_sale', 'escrow_completed', 'escrow_refunded',
    'noshow_needs_decision',
    'masters_invitation', 'champions_cup_invitation', 'invitation_expired_cascade'
  ));

-- Seed Season 1.
INSERT INTO public.seasons (name, slug, start_date, end_date, status)
VALUES ('Season 1', 'season-1', '2026-08-01', '2027-07-31', 'active');
