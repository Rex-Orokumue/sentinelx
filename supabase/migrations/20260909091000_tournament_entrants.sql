-- Squads are scoped to ONE TOURNAMENT on purpose. Persistent clubs, schools and
-- state sides are roadmap #21b — the last open roadmap item — and building a
-- durable team model here would prejudge that design. A squad is a temporary
-- roster assembled to enter one competition.
CREATE TABLE public.squads (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  name          text NOT NULL,
  captain_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  invite_code   text NOT NULL,
  status        text NOT NULL DEFAULT 'forming',
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT squads_status_valid CHECK (status IN ('forming', 'complete', 'withdrawn')),
  CONSTRAINT squads_name_length  CHECK (char_length(btrim(name)) BETWEEN 2 AND 30),
  -- Composite target so squad_members can carry a matching FK; see below.
  CONSTRAINT squads_id_tournament_uniq UNIQUE (id, tournament_id)
);

-- Case-insensitive: "Lagos Vipers" and "lagos vipers" in one bracket is a
-- scoreboard nobody can read.
CREATE UNIQUE INDEX squads_name_per_tournament_uniq
  ON public.squads (tournament_id, lower(btrim(name)));
CREATE UNIQUE INDEX squads_invite_code_uniq ON public.squads (invite_code);

CREATE TABLE public.squad_members (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  squad_id        uuid NOT NULL REFERENCES public.squads(id) ON DELETE CASCADE,
  -- Denormalised from squads purely so the "one squad per player per
  -- tournament" rule can be a real UNIQUE index. A trigger enforcing it would
  -- be racy under concurrent joins — which is exactly the case that matters,
  -- four friends accepting an invite at the same moment. The composite FK below
  -- keeps it honest against the parent row.
  tournament_id   uuid NOT NULL,
  player_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role            text NOT NULL DEFAULT 'member',
  registration_id uuid REFERENCES public.tournament_registrations(id) ON DELETE SET NULL,
  joined_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT squad_members_role_valid CHECK (role IN ('captain', 'member')),
  CONSTRAINT squad_members_squad_fk
    FOREIGN KEY (squad_id, tournament_id)
    REFERENCES public.squads(id, tournament_id) ON DELETE CASCADE,
  CONSTRAINT squad_members_one_per_squad UNIQUE (squad_id, player_id),
  CONSTRAINT squad_members_one_squad_per_tournament UNIQUE (tournament_id, player_id)
);

CREATE INDEX squad_members_player_idx ON public.squad_members (player_id);

-- The unit that actually competes. One standings engine, one lobby table and
-- one results table serve solo and squad because they only ever see entrants.
-- Without this, every query downstream needs an `if (squad)` branch.
--
-- head_to_head tournaments do not use this table at all.
CREATE TABLE public.tournament_entrants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  kind          text NOT NULL,
  player_id     uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  squad_id      uuid REFERENCES public.squads(id) ON DELETE CASCADE,
  -- Frozen at entry time: a squad that renames mid-tournament must not rewrite
  -- the scoreboard of rounds already played.
  display_name  text NOT NULL,
  status        text NOT NULL DEFAULT 'active',
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT tournament_entrants_kind_valid   CHECK (kind IN ('solo', 'squad')),
  CONSTRAINT tournament_entrants_status_valid CHECK (status IN ('active', 'withdrawn', 'disqualified')),
  -- Exactly one referent, matching kind. Both or neither is a corrupt row.
  CONSTRAINT tournament_entrants_solo_ref  CHECK ((kind = 'solo')  = (player_id IS NOT NULL)),
  CONSTRAINT tournament_entrants_squad_ref CHECK ((kind = 'squad') = (squad_id  IS NOT NULL))
);

CREATE UNIQUE INDEX tournament_entrants_player_uniq
  ON public.tournament_entrants (tournament_id, player_id) WHERE player_id IS NOT NULL;
CREATE UNIQUE INDEX tournament_entrants_squad_uniq
  ON public.tournament_entrants (tournament_id, squad_id) WHERE squad_id IS NOT NULL;
CREATE INDEX tournament_entrants_tournament_idx
  ON public.tournament_entrants (tournament_id, status);

-- tournament_registrations keeps its existing job — one row per paying human,
-- carrying payment status, waivers and coin discounts. This only links it to
-- the entrant it bought a place in. Four squad registrations point at one
-- entrant; a solo registration points at its own.
ALTER TABLE public.tournament_registrations
  ADD COLUMN IF NOT EXISTS entrant_id uuid REFERENCES public.tournament_entrants(id) ON DELETE SET NULL;

CREATE INDEX tournament_registrations_entrant_idx
  ON public.tournament_registrations (entrant_id) WHERE entrant_id IS NOT NULL;

ALTER TABLE public.squads              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.squad_members       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_entrants ENABLE ROW LEVEL SECURITY;

-- Competition data is public: brackets, rosters and standings are meant to be
-- readable by anyone, signed in or not.
CREATE POLICY "squads_public_read"   ON public.squads              FOR SELECT USING (true);
CREATE POLICY "members_public_read"  ON public.squad_members       FOR SELECT USING (true);
CREATE POLICY "entrants_public_read" ON public.tournament_entrants FOR SELECT USING (true);

-- Writes go through Server Actions on the service-role client (which bypasses
-- RLS) or an admin. No direct client writes: squad membership decides who gets
-- paid, so it must never be editable from a browser console.
CREATE POLICY "squads_staff_write"   ON public.squads              FOR ALL USING (is_staff()) WITH CHECK (is_staff());
CREATE POLICY "members_staff_write"  ON public.squad_members       FOR ALL USING (is_staff()) WITH CHECK (is_staff());
CREATE POLICY "entrants_staff_write" ON public.tournament_entrants FOR ALL USING (is_staff()) WITH CHECK (is_staff());
