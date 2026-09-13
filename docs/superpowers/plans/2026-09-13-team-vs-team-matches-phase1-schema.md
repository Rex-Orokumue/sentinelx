# Team-vs-Team Matches — Phase 1: Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `matches` and `group_memberships` a nullable "team side" alongside their existing
player side, and lift the constraint that forbids a squad-entered head-to-head tournament — pure
schema, zero behavior change, so the existing test suite stays green untouched.

**Architecture:** One migration. `matches`/`group_memberships` gain nullable `team_a_id`/
`team_b_id`/`team_id` FKs to the already-shipped `squads` table, guarded by CHECK constraints that
only ever *forbid new* row shapes — no existing row (which always has exactly a player on every
populated side) can violate them. `tournaments_squads_are_points_race` — the constraint that
today makes a squad + head-to-head combination impossible to create — is dropped. Regenerate
`lib/supabase/types.ts` so the new columns are visible to TypeScript. No application code changes.

**Tech Stack:** Supabase (PostgreSQL), Supabase CLI / MCP for migration + type generation.

**Spec:** `docs/superpowers/specs/2026-09-13-team-vs-team-matches-design.md` — this plan implements
§4 ("Core model") and the first bullet of §11 ("Phasing"). Read both; this plan argues from that
spec's exact SQL.

## Global Constraints

- Migration filenames use a UTC timestamp prefix (`YYYYMMDDHHMMSS_description.sql`), per
  `CLAUDE.md` — the latest existing migration is `20260913120000_dm_stickers_audio_forward.sql`,
  so this one is timestamped after it.
- Every table this touches already has RLS enabled (`squads`, `matches`, `group_memberships`,
  `tournaments`) — no new tables, no new RLS policies needed; the new columns inherit the
  existing table-level policies automatically.
- The existing test suite (`npm run test`) must stay green **without modification** — per spec
  §10, a test that needs editing here is a signal solo 1v1 was disturbed.
- Solo 1v1 behavior must stay byte-for-byte identical — this phase adds columns and constraints
  only; it does not touch a single `.ts` file.

---

## File Structure

- **Create:** `supabase/migrations/20260913140000_team_matches_schema.sql` — the one file this
  phase touches.
- **Modify:** `lib/supabase/types.ts` — regenerated, not hand-edited.

## Background: why the spec's SQL is already safe against existing data

Two facts, verified directly against the current schema and every code path that writes a
`matches` row, are why this migration needs no data backfill and no defensive extra guard beyond
what's below:

1. `matches.player_a_id` and `matches.player_b_id` are **already nullable** — migration
   `006_knockout_support.sql` dropped `NOT NULL` from both, for bye rows. In practice, though,
   every actual code path that inserts a `matches` row (`lib/tournaments/bracket-admin-actions.ts`,
   `lib/matches/verify-actions.ts`, `lib/tournaments/knockout-pairing-actions.ts`) always sets
   `player_a_id` to a real player; only `player_b_id` ever goes `null`, and only for `status =
   'bye'`. So every existing row has side A populated and side B either populated or fully empty
   (a bye) — exactly the shape the new CHECK constraints below expect.
2. No tournament today can have `entry_unit = 'squad'` and `competition_format = 'head_to_head'`
   at the same time — `tournaments_squads_are_points_race` forbids it, and even after this
   migration drops that constraint, the game-mode catalogue (`game_mode_formats`) still marks
   every head-to-head squad format (Clash Squad 2v2/4v4, Lone Wolf 2v2) `available = false`, so
   the admin UI can't create one. Dropping the constraint makes a previously-impossible
   combination *possible*, not present — it changes nothing about any row that exists today.

### Task 1: Write and apply the schema migration

**Files:**
- Create: `supabase/migrations/20260913140000_team_matches_schema.sql`

**Interfaces:**
- Produces: `matches.team_a_id`, `matches.team_b_id` (nullable `uuid references public.squads(id)`);
  `group_memberships.team_id` (nullable `uuid references public.squads(id)`); the
  `tournaments_squads_are_points_race` CHECK constraint no longer exists. Phase 2 (squad
  lifecycle) and Phase 3 (bracket generation) both read these column names verbatim — do not
  rename them later without updating this plan's downstream phases.

- [ ] **Step 1: Write the migration file**

```sql
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
```

- [ ] **Step 2: Apply the migration**

Check Supabase connectivity via the MCP tools first — the Supabase CLI has been observed
unreachable for 1+ hours at a time from this machine (Windows schannel TLS check) while MCP tools
keep working. Prefer:

```
mcp__claude_ai_Supabase__apply_migration
  name: "team_matches_schema"
  query: <the SQL from Step 1>
```

If MCP is unavailable, fall back to the CLI:

```bash
npx supabase db push
```

- [ ] **Step 3: Verify the migration applied cleanly**

```
mcp__claude_ai_Supabase__list_migrations
```

Confirm `20260913140000` (or the MCP-assigned equivalent) appears, and:

```
mcp__claude_ai_Supabase__get_advisors
  type: "security"
```

Confirm no new advisory was raised (the new columns inherit existing table-level RLS — an
advisory here would mean that assumption was wrong).

- [ ] **Step 4: Regenerate TypeScript types**

```bash
npx supabase gen types typescript --project-id <project-id> > lib/supabase/types.ts
```

(Or `mcp__claude_ai_Supabase__generate_typescript_types` if CLI connectivity is down — same
output file.) Confirm the diff shows `team_a_id`, `team_b_id` on `matches` and `team_id` on
`group_memberships`, and nothing else changed.

- [ ] **Step 5: Confirm the existing suite is untouched and green**

```bash
npm run test
```

Expected: the full existing suite passes with **zero files modified** by this task other than the
new migration and the regenerated `types.ts`. Per CLAUDE.md's Vitest gotcha, first confirm with
`git worktree list` that no linked worktree under the repo root would double-count tests before
trusting the count.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260913140000_team_matches_schema.sql lib/supabase/types.ts
git commit -m "feat(tournaments): team-vs-team match schema — nullable team side on matches/group_memberships

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015CNBGxj7kRKmmFEue5pVdg"
```

---

## Self-Review

**Spec coverage:** §4.1 (matches team columns + CHECK constraints) → Task 1. §4.2
(group_memberships team column + CHECK) → Task 1. §4.3 (drop
`tournaments_squads_are_points_race`) → Task 1. §4.4 (no new team entity — `squads` is reused
directly) — nothing to build, confirmed by the migration referencing `public.squads(id)` rather
than a new table. §10 (compatibility / existing suite stays green) → Task 1 Step 5. §11 phase 1
("No UI, no behaviour change") — confirmed: this plan touches no `.ts`/`.tsx` file.

**Placeholder scan:** none — every step has literal SQL/commands, no "add appropriate X."

**Type consistency:** `team_a_id`/`team_b_id`/`team_id` are the exact names Phase 2's entrant
work and Phase 3's `seededPaidSquads()`/`generate()` branch will read and write — carry them
forward unchanged in those plans.
