# Multi-Format Tournaments — Foundation (Phases 1–2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the schema and the pure scoring engine for battle-royale ("points race") tournaments, without altering the existing 1v1 football path in any way.

**Architecture:** A tournament gains a `competition_format` (`head_to_head` | `points_race`) and an `entry_unit` (`solo` | `squad`). Points-race tournaments compete as `tournament_entrants` — a solo entrant wraps one player, a squad entrant wraps a `squads` row — so one scoring engine serves both modes with no `if (squad)` downstream. Competition is organised as stages → rounds → lobbies, with points accumulating within a stage. All scoring logic in this plan is **pure functions with no database access**, mirroring the existing `standings.ts` / `draw.ts` / `mutes.ts` pattern.

**Tech Stack:** Next.js 14 (App Router), TypeScript, Supabase (PostgreSQL + RLS), vitest.

**Spec:** `docs/superpowers/specs/2026-09-09-multi-format-tournaments-design.md`

## Global Constraints

- **The `head_to_head` path must not change.** No existing function signature is modified. `standings.ts`, `draw.ts`, `bracket.ts`, `submitMatchResult()` are not touched by this plan.
- **The existing test suite must stay green without modification.** As of this plan: 191 files / 1310 tests. A test that needs editing means the football path was disturbed — stop and reconsider.
- **Migrations are named with a UTC timestamp prefix**, never a sequential number (see `CLAUDE.md`): `20260909HHMMSS_name.sql`. Sequential numbers have collided repeatedly between concurrent sessions.
- **RLS on every new table** (`CLAUDE.md` rule 2). Public read for competition data, `is_staff()` for writes; the SQL helpers `public.is_staff()` and `public.is_admin()` already exist.
- **Every new column is nullable or defaulted.** No existing row is rewritten beyond backfilling its already-true format.
- Apply migrations with the Supabase MCP `apply_migration` tool, and commit the identical SQL as a file under `supabase/migrations/`. The Supabase CLI is unreliable on this machine (Windows schannel TLS); MCP is the working path.
- After any migration, patch `lib/supabase/types.ts` by hand to match. Do not regenerate the whole file — it is large and regeneration churns unrelated lines.
- Points values come from the games' real competitive rulesets (spec §6). Do not invent numbers.
- Money is integer naira/kobo. No floats anywhere near prize or fee arithmetic.

---

### Task 1: Format columns on `tournaments` and `games`

Adds the two discriminators the whole feature hangs off, plus the per-game declaration of which formats are legal.

**Files:**
- Create: `supabase/migrations/20260909090000_tournament_formats.sql`
- Modify: `lib/supabase/types.ts` (the `tournaments` and `games` Row/Insert/Update blocks)
- Create: `lib/tournaments/formats.ts`
- Test: `lib/tournaments/formats.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - `type CompetitionFormat = 'head_to_head' | 'points_race'`
  - `type EntryUnit = 'solo' | 'squad'`
  - `COMPETITION_FORMATS: readonly CompetitionFormat[]`
  - `isCompetitionFormat(v: unknown): v is CompetitionFormat`
  - `isEntryUnit(v: unknown): v is EntryUnit`
  - `formatsForGame(supported: string[] | null | undefined): CompetitionFormat[]`
  - `FORMAT_LABEL: Record<CompetitionFormat, string>`

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/20260909090000_tournament_formats.sql`:

```sql
-- Competition format lives on the TOURNAMENT, not the game. COD Mobile can
-- host a 1v1 gunfight cup or a battle-royale circuit, and the same games row
-- has to support both. Putting it on the game would force a duplicate game row
-- per format.
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS competition_format text NOT NULL DEFAULT 'head_to_head',
  ADD COLUMN IF NOT EXISTS entry_unit         text NOT NULL DEFAULT 'solo',
  ADD COLUMN IF NOT EXISTS squad_size         int;

ALTER TABLE public.tournaments
  ADD CONSTRAINT tournaments_competition_format_valid
    CHECK (competition_format IN ('head_to_head', 'points_race')),
  ADD CONSTRAINT tournaments_entry_unit_valid
    CHECK (entry_unit IN ('solo', 'squad')),
  -- A squad tournament must say how big a squad is; a solo one must not pretend to.
  ADD CONSTRAINT tournaments_squad_size_present
    CHECK ((entry_unit = 'squad') = (squad_size IS NOT NULL)),
  ADD CONSTRAINT tournaments_squad_size_range
    CHECK (squad_size IS NULL OR squad_size BETWEEN 2 AND 6),
  -- Squads are a points-race concept only, until roadmap #21b (persistent
  -- team/school/state leagues) says otherwise.
  ADD CONSTRAINT tournaments_squads_are_points_race
    CHECK (competition_format = 'points_race' OR entry_unit = 'solo');

COMMENT ON COLUMN public.tournaments.competition_format IS
  'head_to_head = the original 1v1 groups+knockout engine. points_race = battle-royale lobbies scored on placement + kills.';

-- Which formats a game may legitimately be run in. Data, not code, so adding
-- PUBG Mobile as a BR game later is one UPDATE rather than a deploy.
ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS supported_formats      text[] NOT NULL DEFAULT '{head_to_head}',
  ADD COLUMN IF NOT EXISTS default_points_config  jsonb;

-- Battle-royale games. Values are the games' own competitive rulesets (FFWS
-- for Free Fire, PMGC for PUBG Mobile), not invented numbers.
UPDATE public.games
   SET supported_formats = '{head_to_head,points_race}',
       default_points_config =
         '{"placement": [12, 9, 8, 7, 6, 5, 4, 3, 2, 1], "per_kill": 1}'::jsonb
 WHERE slug = 'free-fire';

UPDATE public.games
   SET supported_formats = '{head_to_head,points_race}',
       default_points_config =
         '{"placement": [10, 6, 5, 4, 3, 2, 1, 1], "per_kill": 1}'::jsonb
 WHERE slug IN ('pubg-mobile', 'cod-mobile', 'blood-strike');
```

- [ ] **Step 2: Apply the migration**

Apply via the Supabase MCP `apply_migration` tool, name `tournament_formats`, with the SQL body above.

Then verify with `execute_sql`:

```sql
select slug, supported_formats, default_points_config from public.games order by slug;
select count(*) filter (where competition_format = 'head_to_head') as h2h,
       count(*) filter (where entry_unit = 'solo') as solo,
       count(*) as total
  from public.tournaments;
```

Expected: four BR games carry `{head_to_head,points_race}` and a config; every other game keeps `{head_to_head}` and NULL. Every existing tournament reports `head_to_head` / `solo`, and `h2h = solo = total`.

- [ ] **Step 3: Patch the generated types**

In `lib/supabase/types.ts`, find the `tournaments:` block (it has `Row:`, `Insert:`, `Update:` sub-blocks) and add to each, keeping the generator's alphabetical order — these sort right after `card_image_url`:

```ts
          competition_format: string          // Row
          competition_format?: string         // Insert and Update
```

and after `created_at` in the same three sub-blocks:

```ts
          entry_unit: string                  // Row
          entry_unit?: string                 // Insert and Update
```

and after `slug` in the same three sub-blocks:

```ts
          squad_size: number | null           // Row
          squad_size?: number | null          // Insert and Update
```

Then find the `games:` block and add to each of its three sub-blocks:

```ts
          default_points_config: Json | null  // Row
          default_points_config?: Json | null // Insert and Update
          supported_formats: string[]         // Row
          supported_formats?: string[]        // Insert and Update
```

Run `npx tsc --noEmit`. Expected: no output (clean).

- [ ] **Step 4: Write the failing test**

Create `lib/tournaments/formats.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  COMPETITION_FORMATS,
  FORMAT_LABEL,
  formatsForGame,
  isCompetitionFormat,
  isEntryUnit,
} from './formats'

describe('isCompetitionFormat', () => {
  it('accepts the two real formats', () => {
    expect(isCompetitionFormat('head_to_head')).toBe(true)
    expect(isCompetitionFormat('points_race')).toBe(true)
  })

  it('rejects anything else, including near-misses and non-strings', () => {
    expect(isCompetitionFormat('group_knockout')).toBe(false)
    expect(isCompetitionFormat('')).toBe(false)
    expect(isCompetitionFormat(null)).toBe(false)
    expect(isCompetitionFormat(undefined)).toBe(false)
    expect(isCompetitionFormat(1)).toBe(false)
  })
})

describe('isEntryUnit', () => {
  it('accepts solo and squad only', () => {
    expect(isEntryUnit('solo')).toBe(true)
    expect(isEntryUnit('squad')).toBe(true)
    expect(isEntryUnit('team')).toBe(false)
    expect(isEntryUnit(null)).toBe(false)
  })
})

describe('formatsForGame', () => {
  it('returns the formats a game declares', () => {
    expect(formatsForGame(['head_to_head', 'points_race'])).toEqual(['head_to_head', 'points_race'])
  })

  it('preserves the canonical order regardless of how the column is stored', () => {
    // The array column has no ordering guarantee, but the format picker must
    // not reshuffle between page loads.
    expect(formatsForGame(['points_race', 'head_to_head'])).toEqual(['head_to_head', 'points_race'])
  })

  it('drops values that are not real formats', () => {
    // Defensive: this column is hand-editable data.
    expect(formatsForGame(['head_to_head', 'battle_royale'])).toEqual(['head_to_head'])
  })

  it('falls back to head_to_head when the column is empty or missing', () => {
    // A game row predating this migration, or one an admin emptied. Every game
    // can always at least run 1v1 — never offer an empty picker.
    expect(formatsForGame([])).toEqual(['head_to_head'])
    expect(formatsForGame(null)).toEqual(['head_to_head'])
    expect(formatsForGame(undefined)).toEqual(['head_to_head'])
  })
})

describe('FORMAT_LABEL', () => {
  it('names every format for the admin picker', () => {
    for (const f of COMPETITION_FORMATS) {
      expect(FORMAT_LABEL[f].length).toBeGreaterThan(0)
    }
  })
})
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npx vitest run lib/tournaments/formats.test.ts`
Expected: FAIL — `Cannot find module './formats'`.

- [ ] **Step 6: Write the implementation**

Create `lib/tournaments/formats.ts`:

```ts
// The competition-format discriminator. Deliberately a property of the
// TOURNAMENT, not the game: COD Mobile can host a 1v1 gunfight cup or a
// battle-royale circuit, and both are legitimate uses of one games row.
//
// 'head_to_head' is everything that existed before multi-format work — two
// players, two scores, groups feeding a knockout bracket.
// 'points_race' is battle royale — lobbies of many entrants ranked by
// placement and kills, points accumulating across a stage's rounds.
export type CompetitionFormat = 'head_to_head' | 'points_race'
export type EntryUnit = 'solo' | 'squad'

// Canonical order — drives the admin picker, so it must be stable.
export const COMPETITION_FORMATS: readonly CompetitionFormat[] = ['head_to_head', 'points_race']
const ENTRY_UNITS: readonly EntryUnit[] = ['solo', 'squad']

export const FORMAT_LABEL: Record<CompetitionFormat, string> = {
  head_to_head: 'Head to head (groups + knockout)',
  points_race: 'Points race (battle royale lobbies)',
}

export function isCompetitionFormat(v: unknown): v is CompetitionFormat {
  return typeof v === 'string' && (COMPETITION_FORMATS as readonly string[]).includes(v)
}

export function isEntryUnit(v: unknown): v is EntryUnit {
  return typeof v === 'string' && (ENTRY_UNITS as readonly string[]).includes(v)
}

// Which formats a game may be run in, from its `supported_formats` column.
//
// Returns them in COMPETITION_FORMATS order rather than column order: a
// Postgres array has no ordering guarantee, and a picker that reshuffles
// between page loads looks broken.
//
// Always yields at least ['head_to_head'] — every game can run 1v1, and an
// empty picker would be a dead end for a game row predating this column or one
// an admin emptied by accident.
export function formatsForGame(supported: string[] | null | undefined): CompetitionFormat[] {
  const declared = (supported ?? []).filter(isCompetitionFormat)
  if (declared.length === 0) return ['head_to_head']
  return COMPETITION_FORMATS.filter((f) => declared.includes(f))
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run lib/tournaments/formats.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 8: Run the full suite to prove football is untouched**

Run: `npx vitest run`
Expected: all files pass, with 9 more tests than before and **zero modified test files**.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/20260909090000_tournament_formats.sql lib/supabase/types.ts lib/tournaments/formats.ts lib/tournaments/formats.test.ts
git commit -m "feat(tournaments): competition_format and entry_unit discriminators

Format is a property of the tournament, not the game — COD Mobile can host a
1v1 gunfight cup or a BR circuit and the same games row must serve both.
games.supported_formats declares what each game may run, so adding PUBG Mobile
as a BR game later is an UPDATE rather than a deploy.

Every existing tournament backfills to head_to_head/solo, which is what it
already was."
```

---

### Task 2: Squads, entrants, and the registration link

The unit that competes. A solo entrant wraps a player; a squad entrant wraps a `squads` row. Everything downstream sees only entrants, which is what keeps one scoring engine serving both modes.

**Files:**
- Create: `supabase/migrations/20260909091000_tournament_entrants.sql`
- Modify: `lib/supabase/types.ts` (new table blocks; `tournament_registrations` gains `entrant_id`)
- Test: verification SQL in Step 2 (schema-only task; the logic that uses these tables is Tasks 4–8)

**Interfaces:**
- Consumes: `tournaments.entry_unit` and `squad_size` (Task 1).
- Produces: tables `squads`, `squad_members`, `tournament_entrants`; column `tournament_registrations.entrant_id`.

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/20260909091000_tournament_entrants.sql`:

```sql
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
CREATE POLICY "squads_public_read"  ON public.squads              FOR SELECT USING (true);
CREATE POLICY "members_public_read" ON public.squad_members       FOR SELECT USING (true);
CREATE POLICY "entrants_public_read" ON public.tournament_entrants FOR SELECT USING (true);

-- Writes go through Server Actions on the service-role client (which bypasses
-- RLS) or an admin. No direct client writes: squad membership decides who gets
-- paid, so it must never be editable from a browser console.
CREATE POLICY "squads_staff_write"   ON public.squads              FOR ALL USING (is_staff()) WITH CHECK (is_staff());
CREATE POLICY "members_staff_write"  ON public.squad_members       FOR ALL USING (is_staff()) WITH CHECK (is_staff());
CREATE POLICY "entrants_staff_write" ON public.tournament_entrants FOR ALL USING (is_staff()) WITH CHECK (is_staff());
```

- [ ] **Step 2: Apply and verify the migration**

Apply via Supabase MCP `apply_migration`, name `tournament_entrants`.

Verify the constraints actually bite, in a transaction that always rolls back:

```sql
do $$
declare tid uuid; ok boolean;
begin
  select id into tid from public.tournaments limit 1;

  -- A squad entrant with no squad_id must be rejected.
  begin
    insert into public.tournament_entrants (tournament_id, kind, display_name)
    values (tid, 'squad', 'Bad');
    raise exception 'FAIL: squad entrant without squad_id was accepted';
  exception when check_violation then null;
  end;

  -- A solo entrant carrying a squad_id must be rejected.
  begin
    insert into public.tournament_entrants (tournament_id, kind, player_id, squad_id, display_name)
    values (tid, 'solo', gen_random_uuid(), gen_random_uuid(), 'Bad');
    raise exception 'FAIL: solo entrant with squad_id was accepted';
  exception when check_violation or foreign_key_violation then null;
  end;

  raise exception 'ROLLBACK_OK all entrant constraints hold';
end $$;
```

Expected: the query "fails" with `ROLLBACK_OK all entrant constraints hold`. Any other message is a real failure. The deliberate exception discards every test row.

- [ ] **Step 3: Patch the generated types**

Add `squads`, `squad_members` and `tournament_entrants` blocks to the `Tables` section of `lib/supabase/types.ts`, following the shape of an existing table block (`Row` / `Insert` / `Update` / `Relationships`). Columns and nullability exactly as in the SQL above; `Insert` and `Update` mark defaulted columns optional. Add `entrant_id: string | null` (and `entrant_id?: string | null`) to the three `tournament_registrations` sub-blocks.

Run `npx tsc --noEmit`. Expected: clean.

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run`
Expected: unchanged from Task 1 — this task adds no application code, so the count must not move.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260909091000_tournament_entrants.sql lib/supabase/types.ts
git commit -m "feat(tournaments): squads, entrants, and the registration link

tournament_entrants is the unit that competes: a solo entrant wraps a player, a
squad entrant wraps a squads row. Everything downstream sees only entrants,
which is what lets one scoring engine serve both modes instead of branching on
squad-ness in every query.

squad_members carries a denormalised tournament_id so 'one squad per player per
tournament' can be a real UNIQUE index — a trigger would be racy under
concurrent joins, which is exactly the case that matters when four friends
accept an invite at once. A composite FK keeps it consistent with the parent.

Squads are tournament-scoped deliberately; persistent teams are #21b."
```

---

### Task 3: Stages, lobbies and results

**Files:**
- Create: `supabase/migrations/20260909092000_tournament_stages_lobbies.sql`
- Modify: `lib/supabase/types.ts` (four new table blocks)
- Test: verification SQL in Step 2

**Interfaces:**
- Consumes: `tournament_entrants` (Task 2).
- Produces: tables `tournament_stages`, `tournament_lobbies`, `lobby_entrants`, `lobby_results`.

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/20260909092000_tournament_stages_lobbies.sql`:

```sql
-- Stages of N rounds, with points accumulating WITHIN a stage and the top
-- advance_count carried into the next. This is the shape real BR competition
-- uses — Free Fire World Series, PUBG Mobile Global Championship, and Free
-- Fire's own Nigerian circuits all run qualifiers-then-finals this way.
--
-- A one-off single-lobby scrim is the same model with one stage, one round and
-- advance_count = 1, so there is no special case for the small tournament.
CREATE TABLE public.tournament_stages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  seq           int  NOT NULL,
  name          text NOT NULL,
  rounds_count  int  NOT NULL,
  lobby_size    int  NOT NULL,
  advance_count int  NOT NULL,
  -- Copied from games.default_points_config at creation, then editable per
  -- stage: a qualifier and a final may legitimately weight kills differently.
  points_config jsonb NOT NULL,
  status        text NOT NULL DEFAULT 'pending',
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT stages_status_valid  CHECK (status IN ('pending', 'live', 'complete')),
  CONSTRAINT stages_rounds_range  CHECK (rounds_count BETWEEN 1 AND 20),
  CONSTRAINT stages_lobby_range   CHECK (lobby_size   BETWEEN 2 AND 100),
  CONSTRAINT stages_advance_range CHECK (advance_count >= 1),
  CONSTRAINT stages_seq_positive  CHECK (seq >= 1),
  CONSTRAINT stages_seq_uniq      UNIQUE (tournament_id, seq),
  CONSTRAINT stages_id_tournament_uniq UNIQUE (id, tournament_id)
);

CREATE TABLE public.tournament_lobbies (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id           uuid NOT NULL REFERENCES public.tournament_stages(id) ON DELETE CASCADE,
  round_no           int  NOT NULL,
  label              text NOT NULL,
  -- Custom-room credentials the players need to actually get in. Not secret
  -- from entrants, but not public either — see the RLS note below.
  room_id            text,
  room_password      text,
  scheduled_at       timestamptz,
  youtube_stream_url text,
  status             text NOT NULL DEFAULT 'scheduled',
  created_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT lobbies_status_valid CHECK (status IN ('scheduled', 'live', 'awaiting_results', 'confirmed')),
  CONSTRAINT lobbies_round_positive CHECK (round_no >= 1),
  CONSTRAINT lobbies_label_round_uniq UNIQUE (stage_id, round_no, label)
);

CREATE INDEX lobbies_stage_round_idx ON public.tournament_lobbies (stage_id, round_no);

CREATE TABLE public.lobby_entrants (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lobby_id   uuid NOT NULL REFERENCES public.tournament_lobbies(id) ON DELETE CASCADE,
  entrant_id uuid NOT NULL REFERENCES public.tournament_entrants(id) ON DELETE CASCADE,

  CONSTRAINT lobby_entrants_uniq UNIQUE (lobby_id, entrant_id)
);

CREATE INDEX lobby_entrants_entrant_idx ON public.lobby_entrants (entrant_id);

CREATE TABLE public.lobby_results (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lobby_id         uuid NOT NULL REFERENCES public.tournament_lobbies(id) ON DELETE CASCADE,
  entrant_id       uuid NOT NULL REFERENCES public.tournament_entrants(id) ON DELETE CASCADE,
  placement        int  NOT NULL,
  kills            int  NOT NULL DEFAULT 0,
  -- Points are FROZEN here at confirm time rather than recomputed from the
  -- stage's points_config on read. An admin editing a stage's points table must
  -- not silently rewrite the history of rounds already played.
  placement_points int  NOT NULL DEFAULT 0,
  kill_points      int  NOT NULL DEFAULT 0,
  total_points     int  GENERATED ALWAYS AS (placement_points + kill_points) STORED,
  submitted_by     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  screenshot_url   text,
  status           text NOT NULL DEFAULT 'pending',
  verified_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  verified_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT lobby_results_status_valid CHECK (status IN ('pending', 'confirmed', 'disputed')),
  CONSTRAINT lobby_results_placement_positive CHECK (placement >= 1),
  CONSTRAINT lobby_results_kills_nonneg CHECK (kills >= 0),
  CONSTRAINT lobby_results_one_per_entrant UNIQUE (lobby_id, entrant_id)
);

CREATE INDEX lobby_results_lobby_idx   ON public.lobby_results (lobby_id);
CREATE INDEX lobby_results_entrant_idx ON public.lobby_results (entrant_id, status);

ALTER TABLE public.tournament_stages  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_lobbies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lobby_entrants     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lobby_results      ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stages_public_read"         ON public.tournament_stages  FOR SELECT USING (true);
CREATE POLICY "lobby_entrants_public_read" ON public.lobby_entrants     FOR SELECT USING (true);

-- Only CONFIRMED results are public. A pending submission is one player's
-- unverified claim, and publishing it would let the feed argue about a
-- scoreline before an admin has ruled on it.
CREATE POLICY "lobby_results_confirmed_read" ON public.lobby_results
  FOR SELECT USING (status = 'confirmed' OR is_staff());

-- Lobbies are public EXCEPT their room credentials, which would let anyone
-- walk into a paid custom room. The public tournament page must select columns
-- explicitly and never room_id/room_password; those reach entrants through a
-- Server Action that checks membership.
CREATE POLICY "lobbies_public_read" ON public.tournament_lobbies FOR SELECT USING (true);

CREATE POLICY "stages_staff_write"         ON public.tournament_stages  FOR ALL USING (is_staff()) WITH CHECK (is_staff());
CREATE POLICY "lobbies_staff_write"        ON public.tournament_lobbies FOR ALL USING (is_staff()) WITH CHECK (is_staff());
CREATE POLICY "lobby_entrants_staff_write" ON public.lobby_entrants     FOR ALL USING (is_staff()) WITH CHECK (is_staff());
CREATE POLICY "lobby_results_staff_write"  ON public.lobby_results      FOR ALL USING (is_staff()) WITH CHECK (is_staff());
```

- [ ] **Step 2: Apply and verify the migration**

Apply via Supabase MCP `apply_migration`, name `tournament_stages_lobbies`.

Verify with `execute_sql`:

```sql
select table_name, count(*) as columns
  from information_schema.columns
 where table_schema = 'public'
   and table_name in ('tournament_stages','tournament_lobbies','lobby_entrants','lobby_results')
 group by table_name order by table_name;

select tablename, count(*) as policies
  from pg_policies
 where schemaname = 'public'
   and tablename in ('tournament_stages','tournament_lobbies','lobby_entrants','lobby_results',
                     'squads','squad_members','tournament_entrants')
 group by tablename order by tablename;
```

Expected: all four tables present; **every one of the seven new tables has at least one policy**. A table with zero policies and RLS enabled is invisible to clients — that is the failure this check exists to catch.

- [ ] **Step 3: Patch the generated types**

Add the four table blocks to `lib/supabase/types.ts`. `total_points` is generated, so it appears in `Row` but **not** in `Insert` or `Update`.

Run `npx tsc --noEmit`. Expected: clean.

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run`
Expected: unchanged — schema-only task.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260909092000_tournament_stages_lobbies.sql lib/supabase/types.ts
git commit -m "feat(tournaments): stages, lobbies and lobby results

Stages of N rounds with points accumulating within a stage and the top N
advancing — the shape FFWS, PMGC and Free Fire's Nigerian circuits actually
use. A one-off scrim is the same model with one stage and one round, so there
is no special case for small tournaments.

Points are frozen onto each result row at confirm time rather than recomputed
from the stage config on read: editing a stage's points table must not rewrite
rounds already played.

Only confirmed results are publicly readable — a pending submission is one
player's unverified claim."
```

---

### Task 4: Points configuration and per-result scoring

**Files:**
- Create: `lib/tournaments/points-config.ts`
- Test: `lib/tournaments/points-config.test.ts`

**Interfaces:**
- Consumes: nothing at runtime (pure).
- Produces:
  - `interface PointsConfig { placement: number[]; perKill: number }`
  - `DEFAULT_POINTS_CONFIG: Record<string, PointsConfig>` keyed by game slug
  - `parsePointsConfig(raw: unknown): PointsConfig | null`
  - `placementPointsFor(config: PointsConfig, placement: number): number`
  - `scoreLobbyResult(config: PointsConfig, r: { placement: number; kills: number }): { placementPoints: number; killPoints: number; totalPoints: number }`

- [ ] **Step 1: Write the failing test**

Create `lib/tournaments/points-config.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_POINTS_CONFIG,
  parsePointsConfig,
  placementPointsFor,
  scoreLobbyResult,
  type PointsConfig,
} from './points-config'

const ff: PointsConfig = DEFAULT_POINTS_CONFIG['free-fire']

describe('DEFAULT_POINTS_CONFIG', () => {
  it('uses the real FFWS table for Free Fire', () => {
    expect(ff.placement).toEqual([12, 9, 8, 7, 6, 5, 4, 3, 2, 1])
    expect(ff.perKill).toBe(1)
  })

  it('uses the real PMGC table for PUBG Mobile', () => {
    expect(DEFAULT_POINTS_CONFIG['pubg-mobile'].placement).toEqual([10, 6, 5, 4, 3, 2, 1, 1])
  })
})

describe('placementPointsFor', () => {
  it('awards the table value for a placing inside the table', () => {
    expect(placementPointsFor(ff, 1)).toBe(12)
    expect(placementPointsFor(ff, 2)).toBe(9)
    expect(placementPointsFor(ff, 10)).toBe(1)
  })

  it('awards zero beyond the end of the table', () => {
    // A 48-player lobby with a 10-deep table: 11th and worse score nothing for
    // placement, but their kills still count.
    expect(placementPointsFor(ff, 11)).toBe(0)
    expect(placementPointsFor(ff, 48)).toBe(0)
  })

  it('awards zero for a nonsensical placing rather than crashing', () => {
    // The DB CHECK forbids placement < 1, but this is a pure function and a
    // caller may hand it unvalidated form input.
    expect(placementPointsFor(ff, 0)).toBe(0)
    expect(placementPointsFor(ff, -3)).toBe(0)
  })
})

describe('scoreLobbyResult', () => {
  it('adds placement and kill points', () => {
    // A Booyah with 7 kills: 12 + 7.
    expect(scoreLobbyResult(ff, { placement: 1, kills: 7 })).toEqual({
      placementPoints: 12,
      killPoints: 7,
      totalPoints: 19,
    })
  })

  it('scores kills for a player who placed outside the table', () => {
    expect(scoreLobbyResult(ff, { placement: 20, kills: 4 })).toEqual({
      placementPoints: 0,
      killPoints: 4,
      totalPoints: 4,
    })
  })

  it('honours a per-kill weight other than 1', () => {
    const doubled: PointsConfig = { placement: [10], perKill: 2 }
    expect(scoreLobbyResult(doubled, { placement: 1, kills: 3 })).toEqual({
      placementPoints: 10,
      killPoints: 6,
      totalPoints: 16,
    })
  })

  it('treats negative kills as zero', () => {
    expect(scoreLobbyResult(ff, { placement: 1, kills: -2 }).killPoints).toBe(0)
  })
})

describe('parsePointsConfig', () => {
  it('reads the jsonb shape stored on the stage', () => {
    expect(parsePointsConfig({ placement: [12, 9, 8], per_kill: 1 })).toEqual({
      placement: [12, 9, 8],
      perKill: 1,
    })
  })

  it('defaults per_kill to zero when absent', () => {
    // A placement-only ruleset is legitimate; a missing key must not become NaN.
    expect(parsePointsConfig({ placement: [10] })).toEqual({ placement: [10], perKill: 0 })
  })

  it('rejects malformed configs rather than half-reading them', () => {
    // Returning null lets the caller fall back to the game default. A partly
    // parsed config would score a real tournament wrongly and silently.
    expect(parsePointsConfig(null)).toBeNull()
    expect(parsePointsConfig({})).toBeNull()
    expect(parsePointsConfig({ placement: 'lots' })).toBeNull()
    expect(parsePointsConfig({ placement: [1, 'two'] })).toBeNull()
    expect(parsePointsConfig({ placement: [1], per_kill: 'one' })).toBeNull()
    expect(parsePointsConfig('{"placement":[1]}')).toBeNull()
  })

  it('rejects negative values anywhere', () => {
    expect(parsePointsConfig({ placement: [-1], per_kill: 1 })).toBeNull()
    expect(parsePointsConfig({ placement: [1], per_kill: -1 })).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/tournaments/points-config.test.ts`
Expected: FAIL — `Cannot find module './points-config'`.

- [ ] **Step 3: Write the implementation**

Create `lib/tournaments/points-config.ts`:

```ts
// How a battle-royale result becomes points.
//
// Values below are the games' OWN competitive rulesets, not invented numbers —
// Free Fire World Series for Free Fire, PUBG Mobile Global Championship for
// PUBG. Players arriving from those circuits already know these tables, and a
// scoring system that disagrees with the one they know reads as broken.

export interface PointsConfig {
  /** placement[i] is the award for finishing (i + 1)-th. Beyond the end: zero. */
  placement: number[]
  perKill: number
}

// Keyed by games.slug.
export const DEFAULT_POINTS_CONFIG: Record<string, PointsConfig> = {
  'free-fire': { placement: [12, 9, 8, 7, 6, 5, 4, 3, 2, 1], perKill: 1 },
  'pubg-mobile': { placement: [10, 6, 5, 4, 3, 2, 1, 1], perKill: 1 },
  'cod-mobile': { placement: [10, 6, 5, 4, 3, 2, 1, 1], perKill: 1 },
  'blood-strike': { placement: [10, 6, 5, 4, 3, 2, 1, 1], perKill: 1 },
}

function isNonNegativeNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0
}

// Reads the jsonb blob stored on tournament_stages.points_config.
//
// All-or-nothing on purpose: returns null rather than a partially understood
// config, so the caller falls back to the game default instead of scoring a
// real tournament with a half-read table. Silent partial parsing here would
// produce a wrong scoreboard that looks entirely plausible.
export function parsePointsConfig(raw: unknown): PointsConfig | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>

  if (!Array.isArray(o.placement)) return null
  if (!o.placement.every(isNonNegativeNumber)) return null

  // Absent per_kill means a placement-only ruleset, which is legitimate.
  // Present-but-invalid is a malformed config.
  const perKillRaw = o.per_kill ?? 0
  if (!isNonNegativeNumber(perKillRaw)) return null

  return { placement: o.placement as number[], perKill: perKillRaw }
}

// `placement` is 1-indexed: 1 is the Booyah / WWCD.
export function placementPointsFor(config: PointsConfig, placement: number): number {
  if (!Number.isFinite(placement) || placement < 1) return 0
  return config.placement[Math.trunc(placement) - 1] ?? 0
}

export function scoreLobbyResult(
  config: PointsConfig,
  r: { placement: number; kills: number },
): { placementPoints: number; killPoints: number; totalPoints: number } {
  const placementPoints = placementPointsFor(config, r.placement)
  const kills = Number.isFinite(r.kills) && r.kills > 0 ? Math.trunc(r.kills) : 0
  const killPoints = kills * config.perKill
  return { placementPoints, killPoints, totalPoints: placementPoints + killPoints }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/tournaments/points-config.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/tournaments/points-config.ts lib/tournaments/points-config.test.ts
git commit -m "feat(tournaments): points config and per-result scoring

Placement tables are the games' own competitive rulesets (FFWS, PMGC), not
invented values — players arriving from those circuits know these numbers, and
a scoring system that disagrees reads as broken.

parsePointsConfig is all-or-nothing: a partially understood config would score
a real tournament wrongly while looking entirely plausible, so a malformed blob
returns null and the caller falls back to the game default."
```

---

### Task 5: Stage standings and tiebreaks

The heart of the feature. Pure, so the tiebreak rules are testable without a database.

**Files:**
- Create: `lib/tournaments/points-standings.ts`
- Test: `lib/tournaments/points-standings.test.ts`

**Interfaces:**
- Consumes: nothing at runtime (pure).
- Produces:
  - `interface StageResultInput { entrantId: string; roundNo: number; placement: number; kills: number; placementPoints: number; killPoints: number }`
  - `interface PointsStandingRow { entrantId: string; displayName: string; played: number; totalPoints: number; totalKills: number; bestPlacement: number | null; lastRoundPlacement: number | null; rank: number; advancing: boolean; unresolvedTieWith: string[] }`
  - `sortPointsStandings(entrants: { id: string; displayName: string }[], results: StageResultInput[], advanceCount: number): PointsStandingRow[]`

- [ ] **Step 1: Write the failing test**

Create `lib/tournaments/points-standings.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { sortPointsStandings, type StageResultInput } from './points-standings'

const entrants = [
  { id: 'a', displayName: 'ShadowX' },
  { id: 'b', displayName: 'Kelvin_G' },
  { id: 'c', displayName: 'ZAYN' },
]

function r(
  entrantId: string,
  roundNo: number,
  placement: number,
  kills: number,
  placementPoints: number,
): StageResultInput {
  return { entrantId, roundNo, placement, kills, placementPoints, killPoints: kills }
}

describe('sortPointsStandings', () => {
  it('ranks by total points across the stage', () => {
    const rows = sortPointsStandings(
      entrants,
      [r('a', 1, 3, 2, 8), r('b', 1, 1, 4, 12), r('c', 1, 5, 1, 6)],
      2,
    )

    expect(rows.map((x) => x.entrantId)).toEqual(['b', 'a', 'c'])
    expect(rows[0].totalPoints).toBe(16) // 12 placement + 4 kills
    expect(rows.map((x) => x.rank)).toEqual([1, 2, 3])
  })

  it('accumulates across every round of the stage', () => {
    const rows = sortPointsStandings(
      entrants,
      [r('a', 1, 1, 0, 12), r('a', 2, 1, 0, 12), r('b', 1, 2, 5, 9), r('b', 2, 2, 5, 9)],
      1,
    )

    expect(rows[0].entrantId).toBe('a')
    expect(rows[0].totalPoints).toBe(24)
    expect(rows[0].played).toBe(2)
    expect(rows[1].totalPoints).toBe(28 - 0 - 0) // 9+5 + 9+5
  })

  it('marks the top advance_count as advancing', () => {
    const rows = sortPointsStandings(
      entrants,
      [r('a', 1, 1, 0, 12), r('b', 1, 2, 0, 9), r('c', 1, 3, 0, 8)],
      2,
    )

    expect(rows.map((x) => x.advancing)).toEqual([true, true, false])
  })

  it('breaks a points tie on total kills', () => {
    // Both on 12. 'b' got there with more kills, which the official rules
    // reward — surviving passively should not beat fighting.
    const rows = sortPointsStandings(
      entrants.slice(0, 2),
      [r('a', 1, 1, 0, 12), r('b', 1, 4, 5, 7)],
      1,
    )

    expect(rows.map((x) => x.entrantId)).toEqual(['b', 'a'])
  })

  it('breaks a points-and-kills tie on best single placement', () => {
    const rows = sortPointsStandings(
      entrants.slice(0, 2),
      [
        r('a', 1, 5, 2, 6), r('a', 2, 5, 0, 6),
        r('b', 1, 1, 2, 12), r('b', 2, 11, 0, 0),
      ],
      1,
    )

    // Both 14 points, both 2 kills; 'b' has a 1st place, 'a' has best 5th.
    expect(rows.map((x) => x.entrantId)).toEqual(['b', 'a'])
  })

  it('breaks a deeper tie on the most recent round placement', () => {
    const rows = sortPointsStandings(
      entrants.slice(0, 2),
      [
        r('a', 1, 1, 1, 12), r('a', 2, 8, 0, 3),
        r('b', 1, 8, 1, 3), r('b', 2, 1, 0, 12),
      ],
      1,
    )

    // Identical points, kills and best placement. 'b' won the latest round.
    expect(rows.map((x) => x.entrantId)).toEqual(['b', 'a'])
  })

  it('flags a tie that survives every tiebreak instead of inventing a winner', () => {
    const rows = sortPointsStandings(
      entrants.slice(0, 2),
      [r('a', 1, 3, 2, 8), r('b', 1, 3, 2, 8)],
      1,
    )

    // The system surfaces the tie; an admin resolves it. Advancement is
    // genuinely ambiguous here and guessing would silently eliminate someone.
    expect(rows[0].unresolvedTieWith).toContain(rows[1].entrantId)
    expect(rows[1].unresolvedTieWith).toContain(rows[0].entrantId)
  })

  it('includes an entrant who has played nothing yet, last and not advancing', () => {
    // Registered but their first lobby has not been confirmed. They must appear
    // on the table — an entrant missing from standings looks like a data loss
    // bug to the player refreshing the page.
    const rows = sortPointsStandings(entrants, [r('a', 1, 1, 0, 12)], 1)

    expect(rows).toHaveLength(3)
    const zero = rows.filter((x) => x.played === 0)
    expect(zero).toHaveLength(2)
    expect(zero.every((x) => !x.advancing)).toBe(true)
    expect(zero.every((x) => x.bestPlacement === null)).toBe(true)
  })

  it('ignores results for entrants not in this stage', () => {
    // Defensive: a stale row from a withdrawn entrant must not appear.
    const rows = sortPointsStandings(entrants.slice(0, 2), [r('a', 1, 1, 0, 12), r('zzz', 1, 1, 0, 12)], 1)

    expect(rows.map((x) => x.entrantId).sort()).toEqual(['a', 'b'])
  })

  it('returns an empty table for no entrants', () => {
    expect(sortPointsStandings([], [], 2)).toEqual([])
  })

  it('never marks more entrants advancing than exist', () => {
    const rows = sortPointsStandings(entrants.slice(0, 2), [r('a', 1, 1, 0, 12)], 10)
    expect(rows.filter((x) => x.advancing)).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/tournaments/points-standings.test.ts`
Expected: FAIL — `Cannot find module './points-standings'`.

- [ ] **Step 3: Write the implementation**

Create `lib/tournaments/points-standings.ts`:

```ts
// Stage standings for a points-race (battle-royale) tournament.
//
// The sibling of sortStandings() in standings.ts, NOT a modification of it:
// that one is football (wins/draws/losses, goals for and against) and must keep
// behaving exactly as it does. This one is placement and kills.
//
// Pure, so the tiebreak rules are testable without a database.

export interface StageResultInput {
  entrantId: string
  roundNo: number
  placement: number
  kills: number
  placementPoints: number
  killPoints: number
}

export interface PointsStandingRow {
  entrantId: string
  displayName: string
  played: number
  totalPoints: number
  totalKills: number
  /** Best (numerically lowest) placement achieved in this stage; null if unplayed. */
  bestPlacement: number | null
  lastRoundPlacement: number | null
  rank: number
  advancing: boolean
  /** Entrants this row is still exactly level with after every tiebreak. */
  unresolvedTieWith: string[]
}

// Official BR tiebreak order: total points, then total kills, then best single
// placement, then placement in the most recent round. An entrant who has played
// nothing sorts last on every key rather than winning by vacuous "best"
// placement.
function compare(a: PointsStandingRow, b: PointsStandingRow): number {
  if (a.totalPoints !== b.totalPoints) return b.totalPoints - a.totalPoints
  if (a.totalKills !== b.totalKills) return b.totalKills - a.totalKills

  const bestA = a.bestPlacement ?? Number.POSITIVE_INFINITY
  const bestB = b.bestPlacement ?? Number.POSITIVE_INFINITY
  if (bestA !== bestB) return bestA - bestB

  const lastA = a.lastRoundPlacement ?? Number.POSITIVE_INFINITY
  const lastB = b.lastRoundPlacement ?? Number.POSITIVE_INFINITY
  if (lastA !== lastB) return lastA - lastB

  return 0
}

export function sortPointsStandings(
  entrants: { id: string; displayName: string }[],
  results: StageResultInput[],
  advanceCount: number,
): PointsStandingRow[] {
  const byEntrant = new Map<string, PointsStandingRow>()
  for (const e of entrants) {
    byEntrant.set(e.id, {
      entrantId: e.id,
      displayName: e.displayName,
      played: 0,
      totalPoints: 0,
      totalKills: 0,
      bestPlacement: null,
      lastRoundPlacement: null,
      rank: 0,
      advancing: false,
      unresolvedTieWith: [],
    })
  }

  // Highest round seen per entrant, so "most recent round placement" survives
  // results arriving out of order.
  const latestRound = new Map<string, number>()

  for (const r of results) {
    const row = byEntrant.get(r.entrantId)
    if (!row) continue // stale row for a withdrawn entrant — ignore, don't crash

    row.played += 1
    row.totalPoints += r.placementPoints + r.killPoints
    row.totalKills += r.kills
    row.bestPlacement = row.bestPlacement === null ? r.placement : Math.min(row.bestPlacement, r.placement)

    const seen = latestRound.get(r.entrantId)
    if (seen === undefined || r.roundNo >= seen) {
      latestRound.set(r.entrantId, r.roundNo)
      row.lastRoundPlacement = r.placement
    }
  }

  const rows = Array.from(byEntrant.values()).sort(compare)

  rows.forEach((row, i) => {
    row.rank = i + 1
    row.advancing = i < advanceCount
  })

  // Surface ties that every tiebreak failed to separate. Advancement across
  // such a boundary is genuinely ambiguous and the system must not guess — an
  // invented winner silently eliminates someone who did not lose.
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      if (compare(rows[i], rows[j]) !== 0) break
      rows[i].unresolvedTieWith.push(rows[j].entrantId)
      rows[j].unresolvedTieWith.push(rows[i].entrantId)
    }
  }

  return rows
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/tournaments/points-standings.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/tournaments/points-standings.ts lib/tournaments/points-standings.test.ts
git commit -m "feat(tournaments): stage standings and BR tiebreaks

The sibling of sortStandings(), not a modification of it — that one is football
and stays football. Tiebreak order is the official BR one: total points, total
kills, best single placement, then most recent round.

A tie surviving all four is flagged rather than broken arbitrarily. Advancement
across that boundary is genuinely ambiguous, and inventing a winner silently
eliminates someone who did not lose.

Entrants who have played nothing still appear, last — an entrant missing from
the table reads as data loss to the player refreshing the page."
```

---

### Task 6: Lobby assignment

**Files:**
- Create: `lib/tournaments/lobby-assignment.ts`
- Test: `lib/tournaments/lobby-assignment.test.ts`

**Interfaces:**
- Consumes: `snakeDistribute(orderedPlayerIds: string[], groups: number): string[][]` from `lib/tournaments/draw.ts` — existing, unmodified.
- Produces:
  - `lobbyCountFor(entrants: number, lobbySize: number): number`
  - `lobbyLabel(index: number): string`
  - `assignLobbies(orderedEntrantIds: string[], lobbySize: number): { label: string; entrantIds: string[] }[]`

- [ ] **Step 1: Write the failing test**

Create `lib/tournaments/lobby-assignment.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { assignLobbies, lobbyCountFor, lobbyLabel } from './lobby-assignment'

describe('lobbyCountFor', () => {
  it('fits everyone into as few lobbies as the size allows', () => {
    expect(lobbyCountFor(48, 48)).toBe(1)
    expect(lobbyCountFor(49, 48)).toBe(2)
    expect(lobbyCountFor(96, 48)).toBe(2)
    expect(lobbyCountFor(12, 4)).toBe(3)
  })

  it('returns zero lobbies for no entrants', () => {
    expect(lobbyCountFor(0, 48)).toBe(0)
  })

  it('never returns zero lobbies while entrants exist', () => {
    expect(lobbyCountFor(1, 48)).toBe(1)
  })

  it('treats a nonsensical lobby size as one lobby rather than dividing by zero', () => {
    expect(lobbyCountFor(10, 0)).toBe(1)
    expect(lobbyCountFor(10, -5)).toBe(1)
  })
})

describe('lobbyLabel', () => {
  it('labels lobbies A, B, C', () => {
    expect(lobbyLabel(0)).toBe('A')
    expect(lobbyLabel(1)).toBe('B')
    expect(lobbyLabel(25)).toBe('Z')
  })

  it('continues past Z without repeating a label', () => {
    expect(lobbyLabel(26)).toBe('AA')
    expect(lobbyLabel(27)).toBe('AB')
  })
})

describe('assignLobbies', () => {
  it('splits entrants across the right number of lobbies', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `e${i}`)
    const lobbies = assignLobbies(ids, 4)

    expect(lobbies).toHaveLength(3)
    expect(lobbies.map((l) => l.label)).toEqual(['A', 'B', 'C'])
    expect(lobbies.flatMap((l) => l.entrantIds)).toHaveLength(12)
  })

  it('places every entrant exactly once', () => {
    const ids = Array.from({ length: 25 }, (_, i) => `e${i}`)
    const placed = assignLobbies(ids, 8).flatMap((l) => l.entrantIds)

    expect(new Set(placed).size).toBe(25)
    expect(placed.sort()).toEqual([...ids].sort())
  })

  it('keeps lobby sizes within one of each other on an uneven split', () => {
    // 10 entrants, size 4 -> 3 lobbies. 4/3/3, never 4/4/2.
    const ids = Array.from({ length: 10 }, (_, i) => `e${i}`)
    const sizes = assignLobbies(ids, 4).map((l) => l.entrantIds.length)

    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1)
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(10)
  })

  it('never exceeds the lobby size', () => {
    const ids = Array.from({ length: 100 }, (_, i) => `e${i}`)
    for (const lobby of assignLobbies(ids, 48)) {
      expect(lobby.entrantIds.length).toBeLessThanOrEqual(48)
    }
  })

  it('seeds by snake draft so the strongest are spread, not stacked', () => {
    // Input is ordered strongest first. Ranks 1 and 2 must not share a lobby
    // while ranks 3 and 4 get an easy one.
    const ids = ['r1', 'r2', 'r3', 'r4']
    const lobbies = assignLobbies(ids, 2)

    const withR1 = lobbies.find((l) => l.entrantIds.includes('r1'))!
    expect(withR1.entrantIds).not.toContain('r2')
  })

  it('returns no lobbies for no entrants', () => {
    expect(assignLobbies([], 48)).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/tournaments/lobby-assignment.test.ts`
Expected: FAIL — `Cannot find module './lobby-assignment'`.

- [ ] **Step 3: Write the implementation**

Create `lib/tournaments/lobby-assignment.ts`:

```ts
import { snakeDistribute } from './draw'

// Splitting a stage's entrants into lobbies.
//
// Reuses snakeDistribute() from the group-draw code unchanged: "spread evenly,
// strongest not stacked together, sizes never differing by more than one" is
// exactly the same problem groups already solved, and solving it twice invites
// the two to disagree.

export function lobbyCountFor(entrants: number, lobbySize: number): number {
  if (entrants <= 0) return 0
  // A zero or negative size is bad data, not a reason to divide by zero. One
  // lobby holding everyone is recoverable; a crash mid-stage-open is not.
  if (lobbySize <= 0) return 1
  return Math.ceil(entrants / lobbySize)
}

// A, B, ... Z, AA, AB, ... Spreadsheet-column style, so a 30-lobby qualifier
// still has unique readable labels.
export function lobbyLabel(index: number): string {
  let n = index
  let label = ''
  do {
    label = String.fromCharCode(65 + (n % 26)) + label
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return label
}

// `orderedEntrantIds` must be ordered strongest-first (current standings) so the
// snake draft spreads seeds across lobbies. For round 1 of stage 1 there are no
// standings yet, so the caller passes a shuffled list.
export function assignLobbies(
  orderedEntrantIds: string[],
  lobbySize: number,
): { label: string; entrantIds: string[] }[] {
  const count = lobbyCountFor(orderedEntrantIds.length, lobbySize)
  if (count === 0) return []

  return snakeDistribute(orderedEntrantIds, count).map((entrantIds, i) => ({
    label: lobbyLabel(i),
    entrantIds,
  }))
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/tournaments/lobby-assignment.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/tournaments/lobby-assignment.ts lib/tournaments/lobby-assignment.test.ts
git commit -m "feat(tournaments): lobby assignment by snake draft

Reuses snakeDistribute() from the group draw unchanged — 'spread evenly,
strongest not stacked, sizes never differing by more than one' is the same
problem groups already solved, and solving it twice invites the two to
disagree.

Labels are spreadsheet-style (A..Z, AA..) so a 30-lobby qualifier still reads."
```

---

### Task 7: Lobby result validation flags

What the admin grid shows before confirming. Flags contradictions; never resolves them — automation may detect, only an admin decides (project rule: admin final say).

**Files:**
- Create: `lib/tournaments/lobby-validation.ts`
- Test: `lib/tournaments/lobby-validation.test.ts`

**Interfaces:**
- Consumes: nothing at runtime (pure).
- Produces:
  - `type LobbyFlagCode = 'duplicate_placement' | 'placement_out_of_range' | 'impossible_kills' | 'missing_submission'`
  - `interface LobbyFlag { code: LobbyFlagCode; message: string; entrantIds: string[] }`
  - `validateLobbyResults(input: { entrantIds: string[]; rows: { entrantId: string; placement: number | null; kills: number | null }[] }): LobbyFlag[]`

- [ ] **Step 1: Write the failing test**

Create `lib/tournaments/lobby-validation.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { validateLobbyResults } from './lobby-validation'

const three = ['a', 'b', 'c']

describe('validateLobbyResults', () => {
  it('passes a clean lobby', () => {
    const flags = validateLobbyResults({
      entrantIds: three,
      rows: [
        { entrantId: 'a', placement: 1, kills: 2 },
        { entrantId: 'b', placement: 2, kills: 1 },
        { entrantId: 'c', placement: 3, kills: 0 },
      ],
    })

    expect(flags).toEqual([])
  })

  it('flags two entrants claiming the same placement', () => {
    const flags = validateLobbyResults({
      entrantIds: three,
      rows: [
        { entrantId: 'a', placement: 1, kills: 0 },
        { entrantId: 'b', placement: 1, kills: 0 },
        { entrantId: 'c', placement: 3, kills: 0 },
      ],
    })

    const dup = flags.find((f) => f.code === 'duplicate_placement')
    expect(dup).toBeDefined()
    expect(dup!.entrantIds.sort()).toEqual(['a', 'b'])
  })

  it('flags a placement beyond the number of entrants', () => {
    const flags = validateLobbyResults({
      entrantIds: three,
      rows: [
        { entrantId: 'a', placement: 9, kills: 0 },
        { entrantId: 'b', placement: 1, kills: 0 },
        { entrantId: 'c', placement: 2, kills: 0 },
      ],
    })

    expect(flags.find((f) => f.code === 'placement_out_of_range')?.entrantIds).toEqual(['a'])
  })

  it('flags total kills exceeding the maximum possible', () => {
    // Three entrants means at most two can be eliminated, so kills cannot
    // exceed two. More than that is a miscount or a false claim.
    const flags = validateLobbyResults({
      entrantIds: three,
      rows: [
        { entrantId: 'a', placement: 1, kills: 2 },
        { entrantId: 'b', placement: 2, kills: 2 },
        { entrantId: 'c', placement: 3, kills: 0 },
      ],
    })

    expect(flags.some((f) => f.code === 'impossible_kills')).toBe(true)
  })

  it('flags entrants who submitted nothing', () => {
    const flags = validateLobbyResults({
      entrantIds: three,
      rows: [{ entrantId: 'a', placement: 1, kills: 0 }],
    })

    const missing = flags.find((f) => f.code === 'missing_submission')
    expect(missing!.entrantIds.sort()).toEqual(['b', 'c'])
  })

  it('treats a blank placement as missing, not as zero', () => {
    // The admin grid renders empty cells for anyone who has not reported.
    const flags = validateLobbyResults({
      entrantIds: ['a', 'b'],
      rows: [
        { entrantId: 'a', placement: 1, kills: 0 },
        { entrantId: 'b', placement: null, kills: null },
      ],
    })

    expect(flags.find((f) => f.code === 'missing_submission')!.entrantIds).toEqual(['b'])
    expect(flags.some((f) => f.code === 'placement_out_of_range')).toBe(false)
  })

  it('reports every problem at once rather than stopping at the first', () => {
    // The admin fixes the grid in one pass; revealing one error at a time
    // turns a single correction into several round trips.
    const flags = validateLobbyResults({
      entrantIds: three,
      rows: [
        { entrantId: 'a', placement: 1, kills: 5 },
        { entrantId: 'b', placement: 1, kills: 5 },
      ],
    })

    expect(flags.map((f) => f.code).sort()).toEqual(
      ['duplicate_placement', 'impossible_kills', 'missing_submission'].sort(),
    )
  })

  it('gives every flag a message an admin can act on', () => {
    const flags = validateLobbyResults({
      entrantIds: three,
      rows: [
        { entrantId: 'a', placement: 1, kills: 0 },
        { entrantId: 'b', placement: 1, kills: 0 },
      ],
    })

    for (const f of flags) expect(f.message.length).toBeGreaterThan(0)
  })

  it('returns nothing for an empty lobby', () => {
    expect(validateLobbyResults({ entrantIds: [], rows: [] })).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/tournaments/lobby-validation.test.ts`
Expected: FAIL — `Cannot find module './lobby-validation'`.

- [ ] **Step 3: Write the implementation**

Create `lib/tournaments/lobby-validation.ts`:

```ts
// Contradiction checks for the admin's lobby grid.
//
// These FLAG, never fix. The project rule is that automation may detect and
// surface, but only an admin takes the resolving action — a system that
// silently "corrected" two players both claiming first place would be deciding
// a disputed result on its own.
//
// Every problem is reported at once, not first-error-only: the admin fixes the
// grid in a single pass, and revealing one error at a time turns one correction
// into several round trips.

export type LobbyFlagCode =
  | 'duplicate_placement'
  | 'placement_out_of_range'
  | 'impossible_kills'
  | 'missing_submission'

export interface LobbyFlag {
  code: LobbyFlagCode
  message: string
  entrantIds: string[]
}

export function validateLobbyResults(input: {
  entrantIds: string[]
  rows: { entrantId: string; placement: number | null; kills: number | null }[]
}): LobbyFlag[] {
  const { entrantIds, rows } = input
  if (entrantIds.length === 0) return []

  const flags: LobbyFlag[] = []
  // A blank placement means "has not reported", never zeroth place.
  const reported = rows.filter((r) => r.placement !== null && r.placement !== undefined)

  const missing = entrantIds.filter((id) => !reported.some((r) => r.entrantId === id))
  if (missing.length > 0) {
    flags.push({
      code: 'missing_submission',
      message: `${missing.length} entrant(s) have not submitted a result.`,
      entrantIds: missing,
    })
  }

  const byPlacement = new Map<number, string[]>()
  for (const r of reported) {
    const p = r.placement as number
    byPlacement.set(p, [...(byPlacement.get(p) ?? []), r.entrantId])
  }
  const duplicated = Array.from(byPlacement.entries()).filter(([, ids]) => ids.length > 1)
  if (duplicated.length > 0) {
    flags.push({
      code: 'duplicate_placement',
      message: `Two or more entrants claim the same placement: ${duplicated
        .map(([p]) => `#${p}`)
        .join(', ')}.`,
      entrantIds: duplicated.flatMap(([, ids]) => ids),
    })
  }

  const outOfRange = reported
    .filter((r) => (r.placement as number) < 1 || (r.placement as number) > entrantIds.length)
    .map((r) => r.entrantId)
  if (outOfRange.length > 0) {
    flags.push({
      code: 'placement_out_of_range',
      message: `Placement must be between 1 and ${entrantIds.length} for this lobby.`,
      entrantIds: outOfRange,
    })
  }

  // At most everyone-but-one can be eliminated, so that caps the kills.
  const totalKills = rows.reduce((sum, r) => sum + (r.kills ?? 0), 0)
  const maxKills = entrantIds.length - 1
  if (totalKills > maxKills) {
    flags.push({
      code: 'impossible_kills',
      message: `Total kills (${totalKills}) exceeds the maximum possible (${maxKills}) for ${entrantIds.length} entrants.`,
      entrantIds: rows.filter((r) => (r.kills ?? 0) > 0).map((r) => r.entrantId),
    })
  }

  return flags
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/tournaments/lobby-validation.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Run the full suite and lint**

Run: `npx vitest run`
Expected: all pass. Total should be **1310 + 55 = 1365 tests**, with **zero pre-existing test files modified**.

Run: `npx tsc --noEmit && npx next lint`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add lib/tournaments/lobby-validation.ts lib/tournaments/lobby-validation.test.ts
git commit -m "feat(tournaments): lobby result validation flags

Flags contradictions for the admin grid — duplicate placements, placements
beyond the lobby size, impossible kill totals, missing submissions — and never
resolves them. Automation may detect and surface; only an admin takes the
resolving action.

Reports every problem at once rather than first-error-only, so the admin fixes
the grid in one pass."
```

---

## Self-Review

**Spec coverage (phases 1–2):**

| Spec section | Task |
|---|---|
| §4.1 tournament format columns | Task 1 |
| §4.2 `games.supported_formats`, `default_points_config` | Task 1 |
| §4.3 `tournament_entrants`, registration link | Task 2 |
| §5 stages / lobbies / lobby_entrants / lobby_results | Task 3 |
| §5.1 lobby assignment by snake draft | Task 6 |
| §6 points config + real defaults | Task 4 |
| §6.1 tiebreak order | Task 5 |
| §7 validation flags | Task 7 |
| §8 squads schema | Task 2 |
| §11 compatibility (suite green unmodified) | Global Constraints + Task 1 Step 8, Task 7 Step 5 |

Deferred to later plans, as designed: §7 result submission UI and admin grid (phase 4), §8 squad lifecycle actions and prize splitting (phases 5, 7), §9 SX Score events (phase 7), §10 UI surfaces (phases 3, 6).

**Placeholder scan:** none. Every code step carries real code; every verification step names the command and the expected output.

**Type consistency:** `PointsConfig` (Task 4) is consumed by nothing in this plan beyond its own tests — Task 5 takes pre-computed `placementPoints`/`killPoints` deliberately, since points are frozen at confirm time (§5) and the standings function must not re-derive them. `snakeDistribute` (Task 6) matches the existing signature in `draw.ts:43` exactly. `StageResultInput` field names match `lobby_results` columns in camelCase.

**Known gap, flagged deliberately:** Task 5's second test asserts `rows[1].totalPoints` via `28 - 0 - 0`, which is written oddly to make the arithmetic visible (9+5 twice). If the executor finds it confusing, replacing it with the literal `28` is correct and equivalent.

---

## Next Plans

- **Phase 3** — admin creation and stage management (format-aware `TournamentForm`, stages editor, lobby generation, room credentials)
- **Phase 4** — result flow (player submission, admin lobby grid, confirm, standings recompute, disputes)
- **Phase 5** — squad lifecycle (create/invite/join, per-member payment, `forming` → `complete`, close-time refunds)
- **Phase 6** — public surfaces (Standings tab, stage tables, lobby cards, champion recording)
- **Phase 7** — economy (prize splitting with the captain-remainder rule, SX Score events, recompute support)
