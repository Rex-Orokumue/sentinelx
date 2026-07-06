-- =============================================================
-- Sentinel X — Initial Schema
-- =============================================================

-- =============================================================
-- Helper functions
-- =============================================================

-- Sets updated_at to now() on every UPDATE
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Auto-creates a profiles row when a new auth user signs up.
-- SECURITY DEFINER runs as the function owner (postgres) so it
-- bypasses RLS and always succeeds even before the user has a session.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id)
  VALUES (NEW.id)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- =============================================================
-- Tables  (ordered by foreign-key dependency)
-- =============================================================

CREATE TABLE public.games (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL,
  slug       text        NOT NULL UNIQUE,
  icon_url   text,
  active     boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- profiles mirrors auth.users 1-to-1.
-- sentinel_tier is always derived from sentinel_score — never set directly.
CREATE TABLE public.profiles (
  id              uuid    PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username        text    UNIQUE,
  display_name    text,
  avatar_url      text,
  country         text,
  phone           text,
  whatsapp_number text,
  sentinel_score  integer NOT NULL DEFAULT 70
                    CHECK (sentinel_score BETWEEN 0 AND 100),
  sentinel_tier   text    GENERATED ALWAYS AS (
                    CASE
                      WHEN sentinel_score >= 90 THEN 'elite'
                      WHEN sentinel_score >= 75 THEN 'trusted'
                      WHEN sentinel_score >= 60 THEN 'developing'
                      ELSE 'at_risk'
                    END
                  ) STORED,
  total_matches   integer     NOT NULL DEFAULT 0,
  wins            integer     NOT NULL DEFAULT 0,
  losses          integer     NOT NULL DEFAULT 0,
  goals_scored    integer     NOT NULL DEFAULT 0,
  goals_conceded  integer     NOT NULL DEFAULT 0,
  total_titles    integer     NOT NULL DEFAULT 0,
  kyc_verified    boolean     NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.user_roles (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role    text NOT NULL CHECK (role IN ('admin', 'moderator', 'player')),
  UNIQUE (user_id, role)
);

CREATE TABLE public.tournaments (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id            uuid        NOT NULL REFERENCES public.games(id),
  title              text        NOT NULL,
  slug               text        NOT NULL UNIQUE,
  description        text,
  banner_url         text,
  registration_fee   integer     NOT NULL DEFAULT 500,   -- NGN
  prize_pool         integer     NOT NULL DEFAULT 0,     -- NGN
  status             text        NOT NULL DEFAULT 'draft'
                       CHECK (status IN (
                         'draft', 'registration_open', 'registration_closed',
                         'active', 'completed'
                       )),
  format             text        NOT NULL DEFAULT 'group_knockout'
                       CHECK (format IN ('group_knockout')),
  max_players        integer,
  registration_start timestamptz,
  registration_end   timestamptz,
  tournament_start   timestamptz,
  tournament_end     timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.tournament_registrations (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id      uuid        NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  player_id          uuid        NOT NULL REFERENCES public.profiles(id),
  payment_status     text        NOT NULL DEFAULT 'pending'
                       CHECK (payment_status IN ('pending', 'paid', 'refunded')),
  paystack_reference text        UNIQUE,
  registered_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tournament_id, player_id)
);

CREATE TABLE public.groups (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid        NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  name          text        NOT NULL,   -- "Group A", "Group B", …
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.group_memberships (
  id            uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id      uuid    NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  player_id     uuid    NOT NULL REFERENCES public.profiles(id),
  points        integer NOT NULL DEFAULT 0,
  wins          integer NOT NULL DEFAULT 0,
  draws         integer NOT NULL DEFAULT 0,
  losses        integer NOT NULL DEFAULT 0,
  goals_for     integer NOT NULL DEFAULT 0,
  goals_against integer NOT NULL DEFAULT 0,
  UNIQUE (group_id, player_id)
);

CREATE TABLE public.matches (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id      uuid        NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  group_id           uuid        REFERENCES public.groups(id),   -- null in knockout rounds
  round              text        NOT NULL
                       CHECK (round IN (
                         'group', 'round_of_32', 'round_of_16',
                         'quarter_final', 'semi_final', 'final'
                       )),
  player_a_id        uuid        NOT NULL REFERENCES public.profiles(id),
  player_b_id        uuid        NOT NULL REFERENCES public.profiles(id),
  score_a            integer,
  score_b            integer,
  status             text        NOT NULL DEFAULT 'scheduled'
                       CHECK (status IN (
                         'scheduled', 'live', 'completed', 'disputed', 'cancelled'
                       )),
  youtube_stream_url text,
  replay_url         text,
  scheduled_at       timestamptz,
  completed_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.match_results (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id       uuid        NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  submitted_by   uuid        NOT NULL REFERENCES public.profiles(id),
  score_a        integer     NOT NULL,
  score_b        integer     NOT NULL,
  screenshot_url text,
  recording_url  text,
  verified       boolean     NOT NULL DEFAULT false,
  verified_by    uuid        REFERENCES public.profiles(id),
  verified_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.sentinel_score_events (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id    uuid        NOT NULL REFERENCES public.profiles(id),
  match_id     uuid        REFERENCES public.matches(id),
  event_type   text        NOT NULL
                 CHECK (event_type IN (
                   'match_completed', 'no_show', 'rage_quit', 'dispute_lost',
                   'rating_received', 'admin_flag_conduct', 'admin_flag_cheat'
                 )),
  points_delta integer     NOT NULL,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now()
  -- intentionally no updated_at: events are immutable once written
);

CREATE TABLE public.opponent_ratings (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id   uuid        NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  rater_id   uuid        NOT NULL REFERENCES public.profiles(id),
  rated_id   uuid        NOT NULL REFERENCES public.profiles(id),
  stars      integer     NOT NULL CHECK (stars BETWEEN 1 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_id, rater_id)   -- one rating per player per match
);

CREATE TABLE public.admin_flags (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id  uuid        NOT NULL REFERENCES public.profiles(id),
  flagged_by uuid        NOT NULL REFERENCES public.profiles(id),
  reason     text        NOT NULL,
  severity   text        NOT NULL CHECK (severity IN ('conduct', 'cheat')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.marketplace_listings (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id         uuid        NOT NULL REFERENCES public.profiles(id),
  game_id           uuid        REFERENCES public.games(id),
  category          text        NOT NULL
                      CHECK (category IN (
                        'account', 'coins', 'accessories',
                        'gift_card', 'controller', 'phone'
                      )),
  title             text        NOT NULL,
  description       text,
  price             integer     NOT NULL,   -- NGN
  currency          text        NOT NULL DEFAULT 'NGN',
  status            text        NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'active', 'sold', 'removed')),
  escrow_status     text,
  zolarux_reference text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- =============================================================
-- Role-check helpers  (defined after user_roles so references resolve)
-- SECURITY DEFINER bypasses user_roles RLS to prevent circular checks.
-- =============================================================

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
    AND   role = 'admin'
  );
$$;

-- Moderators share most staff privileges except financials and player bans.
CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
    AND   role IN ('admin', 'moderator')
  );
$$;

-- =============================================================
-- Indexes
-- =============================================================

CREATE INDEX ON public.tournaments (game_id);
CREATE INDEX ON public.tournaments (status);

CREATE INDEX ON public.tournament_registrations (tournament_id);
CREATE INDEX ON public.tournament_registrations (player_id);
CREATE INDEX ON public.tournament_registrations (payment_status);

CREATE INDEX ON public.groups (tournament_id);

CREATE INDEX ON public.group_memberships (group_id);
CREATE INDEX ON public.group_memberships (player_id);

CREATE INDEX ON public.matches (tournament_id);
CREATE INDEX ON public.matches (group_id);
CREATE INDEX ON public.matches (player_a_id);
CREATE INDEX ON public.matches (player_b_id);
CREATE INDEX ON public.matches (status);
CREATE INDEX ON public.matches (scheduled_at);

CREATE INDEX ON public.match_results (match_id);
CREATE INDEX ON public.match_results (submitted_by);
CREATE INDEX ON public.match_results (verified);

CREATE INDEX ON public.sentinel_score_events (player_id);
CREATE INDEX ON public.sentinel_score_events (match_id);
CREATE INDEX ON public.sentinel_score_events (created_at DESC);

CREATE INDEX ON public.opponent_ratings (rated_id);

CREATE INDEX ON public.admin_flags (player_id);

CREATE INDEX ON public.marketplace_listings (seller_id);
CREATE INDEX ON public.marketplace_listings (status);
CREATE INDEX ON public.marketplace_listings (game_id);
CREATE INDEX ON public.marketplace_listings (category);

CREATE INDEX ON public.user_roles (user_id);

-- =============================================================
-- Triggers
-- =============================================================

CREATE TRIGGER set_tournaments_updated_at
  BEFORE UPDATE ON public.tournaments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_matches_updated_at
  BEFORE UPDATE ON public.matches
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_marketplace_listings_updated_at
  BEFORE UPDATE ON public.marketplace_listings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Fires after every new auth sign-up to guarantee a profiles row exists.
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =============================================================
-- Row Level Security
-- =============================================================

ALTER TABLE public.games                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournaments              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_memberships        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_results            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sentinel_score_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opponent_ratings         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_flags              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_listings     ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------
-- games — public read, staff write
-- -----------------------------------------------
CREATE POLICY "games_public_read"  ON public.games FOR SELECT USING (true);
CREATE POLICY "games_staff_insert" ON public.games FOR INSERT WITH CHECK (is_staff());
CREATE POLICY "games_staff_update" ON public.games FOR UPDATE USING (is_staff());
CREATE POLICY "games_admin_delete" ON public.games FOR DELETE USING (is_admin());

-- -----------------------------------------------
-- tournaments — public read, staff write
-- -----------------------------------------------
CREATE POLICY "tournaments_public_read"  ON public.tournaments FOR SELECT USING (true);
CREATE POLICY "tournaments_staff_insert" ON public.tournaments FOR INSERT WITH CHECK (is_staff());
CREATE POLICY "tournaments_staff_update" ON public.tournaments FOR UPDATE USING (is_staff());
CREATE POLICY "tournaments_admin_delete" ON public.tournaments FOR DELETE USING (is_admin());

-- -----------------------------------------------
-- profiles — public read, own update
-- INSERT is handled exclusively by the handle_new_user trigger (SECURITY DEFINER).
-- -----------------------------------------------
CREATE POLICY "profiles_public_read"  ON public.profiles FOR SELECT USING (true);
CREATE POLICY "profiles_own_update"   ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "profiles_admin_delete" ON public.profiles FOR DELETE USING (is_admin());

-- -----------------------------------------------
-- user_roles — staff/self read, admin write
-- -----------------------------------------------
CREATE POLICY "user_roles_read"         ON public.user_roles FOR SELECT
  USING (auth.uid() = user_id OR is_staff());
CREATE POLICY "user_roles_admin_insert" ON public.user_roles FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "user_roles_admin_update" ON public.user_roles FOR UPDATE USING (is_admin());
CREATE POLICY "user_roles_admin_delete" ON public.user_roles FOR DELETE USING (is_admin());

-- -----------------------------------------------
-- tournament_registrations
-- Players see only their own; payment_status is set server-side / by staff.
-- -----------------------------------------------
CREATE POLICY "tr_select" ON public.tournament_registrations
  FOR SELECT USING (auth.uid() = player_id OR is_staff());

CREATE POLICY "tr_own_insert" ON public.tournament_registrations
  FOR INSERT WITH CHECK (auth.uid() = player_id);

-- payment_status, paystack_reference transitions are done via service-role
-- webhooks, but staff can also update (e.g. manual refund).
CREATE POLICY "tr_staff_update" ON public.tournament_registrations
  FOR UPDATE USING (is_staff());

CREATE POLICY "tr_admin_delete" ON public.tournament_registrations
  FOR DELETE USING (is_admin());

-- -----------------------------------------------
-- groups — public read, staff write
-- -----------------------------------------------
CREATE POLICY "groups_public_read"  ON public.groups FOR SELECT USING (true);
CREATE POLICY "groups_staff_insert" ON public.groups FOR INSERT WITH CHECK (is_staff());
CREATE POLICY "groups_staff_update" ON public.groups FOR UPDATE USING (is_staff());
CREATE POLICY "groups_staff_delete" ON public.groups FOR DELETE USING (is_staff());

-- -----------------------------------------------
-- group_memberships — public read, staff write
-- -----------------------------------------------
CREATE POLICY "gm_public_read"  ON public.group_memberships FOR SELECT USING (true);
CREATE POLICY "gm_staff_insert" ON public.group_memberships FOR INSERT WITH CHECK (is_staff());
CREATE POLICY "gm_staff_update" ON public.group_memberships FOR UPDATE USING (is_staff());
CREATE POLICY "gm_staff_delete" ON public.group_memberships FOR DELETE USING (is_staff());

-- -----------------------------------------------
-- matches — public read, staff write
-- -----------------------------------------------
CREATE POLICY "matches_public_read"  ON public.matches FOR SELECT USING (true);
CREATE POLICY "matches_staff_insert" ON public.matches FOR INSERT WITH CHECK (is_staff());
CREATE POLICY "matches_staff_update" ON public.matches FOR UPDATE USING (is_staff());
CREATE POLICY "matches_staff_delete" ON public.matches FOR DELETE USING (is_staff());

-- -----------------------------------------------
-- match_results
-- Only the two players in a match can read/submit; only staff can verify.
-- -----------------------------------------------
CREATE POLICY "mr_select" ON public.match_results
  FOR SELECT USING (
    is_staff()
    OR EXISTS (
      SELECT 1 FROM public.matches m
      WHERE m.id = match_id
        AND auth.uid() IN (m.player_a_id, m.player_b_id)
    )
  );

CREATE POLICY "mr_player_insert" ON public.match_results
  FOR INSERT WITH CHECK (
    auth.uid() = submitted_by
    AND EXISTS (
      SELECT 1 FROM public.matches m
      WHERE m.id = match_id
        AND auth.uid() IN (m.player_a_id, m.player_b_id)
    )
  );

-- Only staff can flip verified / set verified_by / verified_at.
CREATE POLICY "mr_staff_update" ON public.match_results
  FOR UPDATE USING (is_staff());

CREATE POLICY "mr_admin_delete" ON public.match_results
  FOR DELETE USING (is_admin());

-- -----------------------------------------------
-- sentinel_score_events — append-only, immutable
-- Players read their own; staff read all.
-- Writes go through service-role API routes (bypasses RLS) or staff directly.
-- No UPDATE or DELETE policy: events cannot be modified once written.
-- -----------------------------------------------
CREATE POLICY "sse_read" ON public.sentinel_score_events
  FOR SELECT USING (auth.uid() = player_id OR is_staff());

CREATE POLICY "sse_staff_insert" ON public.sentinel_score_events
  FOR INSERT WITH CHECK (is_staff());

-- -----------------------------------------------
-- opponent_ratings — participants read, own insert, immutable
-- -----------------------------------------------
CREATE POLICY "or_select" ON public.opponent_ratings
  FOR SELECT USING (auth.uid() IN (rater_id, rated_id) OR is_staff());

CREATE POLICY "or_own_insert" ON public.opponent_ratings
  FOR INSERT WITH CHECK (auth.uid() = rater_id);

-- No UPDATE policy: ratings are immutable once submitted.
CREATE POLICY "or_admin_delete" ON public.opponent_ratings
  FOR DELETE USING (is_admin());

-- -----------------------------------------------
-- admin_flags — staff read, admin write
-- -----------------------------------------------
CREATE POLICY "af_staff_read"   ON public.admin_flags FOR SELECT USING (is_staff());
CREATE POLICY "af_admin_insert" ON public.admin_flags FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "af_admin_delete" ON public.admin_flags FOR DELETE USING (is_admin());

-- -----------------------------------------------
-- marketplace_listings
-- Active listings are public; pending/sold/removed visible only to seller + staff.
-- -----------------------------------------------
CREATE POLICY "ml_select" ON public.marketplace_listings
  FOR SELECT USING (
    status = 'active'
    OR auth.uid() = seller_id
    OR is_staff()
  );

CREATE POLICY "ml_own_insert" ON public.marketplace_listings
  FOR INSERT WITH CHECK (auth.uid() = seller_id);

-- Seller can update their own; staff can update for moderation.
CREATE POLICY "ml_update" ON public.marketplace_listings
  FOR UPDATE USING (auth.uid() = seller_id OR is_staff());

CREATE POLICY "ml_admin_delete" ON public.marketplace_listings
  FOR DELETE USING (is_admin());
