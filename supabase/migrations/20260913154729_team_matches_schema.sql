-- Team side for matches, alongside the existing player side. A squad never
-- faces a lone player, and side B may be wholly empty (a bye) — side A may
-- not. Every existing row already satisfies this: player_a_id is always set
-- in practice (see 006_knockout_support.sql's bye-only use of a null
-- player_b_id), and team_a_id/team_b_id start out null for every row, so
-- these CHECKs only ever forbid combinations that don't exist yet.
--
-- player_a_id / player_b_id are already nullable (006_knockout_support.sql,
-- for byes) — DROP NOT NULL here is a documented no-op, kept so this
-- migration reads as the complete, self-contained statement of the new shape
-- rather than assuming a reader has 006 memorized.
ALTER TABLE public.matches
  ALTER COLUMN player_a_id DROP NOT NULL,
  ALTER COLUMN player_b_id DROP NOT NULL,
  ADD COLUMN team_a_id uuid REFERENCES public.squads(id),
  ADD COLUMN team_b_id uuid REFERENCES public.squads(id);

ALTER TABLE public.matches
  ADD CONSTRAINT matches_side_a_kind
    CHECK ((player_a_id IS NOT NULL) <> (team_a_id IS NOT NULL)),
  ADD CONSTRAINT matches_side_b_kind
    CHECK (
      (player_b_id IS NULL AND team_b_id IS NULL)
      OR (player_b_id IS NOT NULL) <> (team_b_id IS NOT NULL)
    ),
  ADD CONSTRAINT matches_sides_same_kind
    CHECK (
      (player_b_id IS NULL AND team_b_id IS NULL)  -- bye
      OR (player_a_id IS NOT NULL) = (player_b_id IS NOT NULL)
    );

COMMENT ON COLUMN public.matches.team_a_id IS
  'Squad on side A for a team-vs-team match. Exactly one of player_a_id/team_a_id is set — see matches_side_a_kind.';
COMMENT ON COLUMN public.matches.team_b_id IS
  'Squad on side B for a team-vs-team match, or null for a bye alongside a null player_b_id.';

-- Same treatment for group-stage standings: a team's round wins land in the
-- existing goals_for/goals_against/points columns exactly the way a
-- points-race entrant's placement points already do elsewhere — a team
-- tournament's group table is not a new module.
ALTER TABLE public.group_memberships
  ALTER COLUMN player_id DROP NOT NULL,
  ADD COLUMN team_id uuid REFERENCES public.squads(id),
  ADD CONSTRAINT group_memberships_kind
    CHECK ((player_id IS NOT NULL) <> (team_id IS NOT NULL));

-- Mirrors the existing UNIQUE (group_id, player_id) — without it, the same
-- squad could be inserted into one group twice with nothing to stop it
-- (Postgres treats every NULL player_id as distinct, so the old constraint
-- doesn't cover team rows at all). Not in the spec's §4.2 snippet verbatim;
-- added here because it's the direct team-row analogue of a guarantee the
-- player-row schema already has.
ALTER TABLE public.group_memberships
  ADD CONSTRAINT group_memberships_team_uniq UNIQUE (group_id, team_id);

COMMENT ON COLUMN public.group_memberships.team_id IS
  'Squad standing in this group for a team-vs-team tournament. Exactly one of player_id/team_id is set — see group_memberships_kind.';

-- Lift the "squads are a points-race-only concept" ban (001/…/090000). This
-- only ever forbade entry_unit='squad' + competition_format='head_to_head';
-- dropping it makes that combination possible, it does not change any
-- existing row (game_mode_formats still marks every head-to-head squad
-- format unavailable, so nothing can create one through the product yet).
ALTER TABLE public.tournaments DROP CONSTRAINT tournaments_squads_are_points_race;
