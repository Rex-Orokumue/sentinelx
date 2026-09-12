# Game Modes, Formats, Maps & Match Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin state what is actually being played — Mode, Format, Map, Match Rules — as four dependent fields on a Free Fire tournament, with unbuildable combinations visibly disabled rather than hidden.

**Architecture:** Three new catalogue tables (`game_modes`, `game_mode_formats`, `game_mode_maps`) plus a global `match_types` catalogue describe what each game offers; `tournaments` gains nullable FKs pointing into them. Mode decides `competition_format`, and selecting a Format *writes* `entry_unit` / `squad_size` so those columns stay the single source of truth every existing constraint already reads. Availability is a data column everywhere, so enabling 4v4 or Bo3 later is an `UPDATE`, never a deploy.

**Tech Stack:** Next.js 14 (App Router), TypeScript, Supabase (PostgreSQL + RLS), zod, vitest.

**Spec:** `docs/superpowers/specs/2026-09-12-game-modes-formats-maps-design.md`

## Global Constraints

- **The football path must not change.** A game with no modes keeps its Competition Format picker and stores NULL in all five new columns. Existing tests stay green **unmodified**.
- **Baseline: 209 files / 1484 tests, `vitest exit=0`** as of 2026-09-12. Verify with the exit code, never by eyeballing piped output — `vitest | tail && git push` reports `tail`'s status, not the runner's.
- **`node_modules/.bin` is empty** in this checkout. Run tools directly: `node node_modules/vitest/vitest.mjs run`, `node node_modules/typescript/bin/tsc --noEmit`, `node node_modules/next/dist/bin/next lint`.
- **Migrations use a UTC timestamp prefix**, applied via Supabase MCP `apply_migration`, with identical SQL committed under `supabase/migrations/`.
- **Closed value sets are `text` + `CHECK`, never Postgres enums** — the schema contains zero enum types.
- **A CHECK must permit every value the roadmap will ever enable.** `match_type` accepts `bo1|bo3|bo5` even though only `bo1` is selectable; availability is gated by data, not by the constraint.
- **Any new field on `tournamentSchema` MUST also be added to `parseForm`** in `lib/tournaments/admin-form.ts` and covered in `admin-form.test.ts`. A field missed there is silently dropped and the schema default wins — that bug shipped once already and made the whole points-race feature unreachable.
- **RLS on every new table**: public read (catalogue data is public), `is_staff()` for writes.
- **Seed map pools as data, not enums.** Garena rotates them; the lists in spec §6 are a seed, not a truth.

---

### Task 1: Catalogue tables and seed data

**Files:**
- Create: `supabase/migrations/20260912090000_game_modes.sql`
- Modify: `lib/supabase/types.ts` (four new table blocks)

**Interfaces:**
- Consumes: existing `games` table.
- Produces: tables `game_modes`, `game_mode_formats`, `game_mode_maps`, `match_types`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260912090000_game_modes.sql`:

```sql
-- What is actually being PLAYED, as opposed to how it is scored.
--
-- Mode is the parent: it decides competition_format (Battle Royale is a points
-- race; Clash Squad and Lone Wolf are head-to-head), and both the Format and
-- Map pools hang off it. The design mock had this inverted — a tab row of
-- 1v1/2v2/4v4/Battle Royale with Mode nested inside — which mixes game mode
-- with team size and lets Map be chosen independently of Mode. That produced
-- "1v1 · Clash Squad · Bermuda" on screen, and Bermuda is a BR map.
CREATE TABLE public.game_modes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id            uuid NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  slug               text NOT NULL,
  name               text NOT NULL,
  seq                int  NOT NULL DEFAULT 1,
  active             boolean NOT NULL DEFAULT true,
  -- Mode DECIDES the engine, so the admin never picks competition_format
  -- directly for a game that has modes.
  competition_format text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT game_modes_format_valid
    CHECK (competition_format IN ('head_to_head', 'points_race')),
  CONSTRAINT game_modes_slug_uniq UNIQUE (game_id, slug),
  -- Composite target so a format/map can be tied to one game's mode.
  CONSTRAINT game_modes_id_game_uniq UNIQUE (id, game_id)
);

-- The CATALOGUE of team shapes. It defines what "Clash Squad 4v4" means;
-- tournaments.entry_unit / squad_size remain the authoritative stored values
-- (see the migration below and spec 5.0). Only one is ever typed in, so they
-- cannot disagree.
CREATE TABLE public.game_mode_formats (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode_id    uuid NOT NULL REFERENCES public.game_modes(id) ON DELETE CASCADE,
  slug       text NOT NULL,
  name       text NOT NULL,
  seq        int  NOT NULL DEFAULT 1,
  active     boolean NOT NULL DEFAULT true,
  entry_unit text NOT NULL,
  team_size  int  NOT NULL,
  -- false renders greyed as "Coming soon" — visible so the roadmap reads,
  -- unselectable so nobody creates a tournament the platform cannot finish.
  -- A DATA flag on purpose: enabling 4v4 later is an UPDATE, not a deploy.
  available  boolean NOT NULL DEFAULT false,

  CONSTRAINT gmf_entry_unit_valid CHECK (entry_unit IN ('solo', 'squad')),
  CONSTRAINT gmf_team_size_range  CHECK (team_size BETWEEN 1 AND 6),
  CONSTRAINT gmf_slug_uniq        UNIQUE (mode_id, slug)
);

CREATE TABLE public.game_mode_maps (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode_id uuid NOT NULL REFERENCES public.game_modes(id) ON DELETE CASCADE,
  name    text NOT NULL,
  seq     int  NOT NULL DEFAULT 1,
  active  boolean NOT NULL DEFAULT true,

  CONSTRAINT gmm_name_uniq UNIQUE (mode_id, name)
);

-- Series length. Global rather than per-mode because the blocker is global:
-- `matches` is one row with one scoreline, so a best-of-three needs a series
-- concept that exists for no mode at all.
CREATE TABLE public.match_types (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug      text NOT NULL UNIQUE,
  name      text NOT NULL,
  seq       int  NOT NULL DEFAULT 1,
  active    boolean NOT NULL DEFAULT true,
  available boolean NOT NULL DEFAULT false
);

CREATE INDEX game_modes_game_idx        ON public.game_modes (game_id, seq);
CREATE INDEX game_mode_formats_mode_idx ON public.game_mode_formats (mode_id, seq);
CREATE INDEX game_mode_maps_mode_idx    ON public.game_mode_maps (mode_id, seq);

ALTER TABLE public.game_modes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_mode_formats  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_mode_maps     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_types        ENABLE ROW LEVEL SECURITY;

-- Catalogue data is public: a player reading a tournament page needs to see
-- that it is Clash Squad on Bermuda.
CREATE POLICY "game_modes_public_read"    ON public.game_modes        FOR SELECT USING (true);
CREATE POLICY "gmf_public_read"           ON public.game_mode_formats FOR SELECT USING (true);
CREATE POLICY "gmm_public_read"           ON public.game_mode_maps    FOR SELECT USING (true);
CREATE POLICY "match_types_public_read"   ON public.match_types       FOR SELECT USING (true);

CREATE POLICY "game_modes_staff_write"  ON public.game_modes        FOR ALL USING (is_staff()) WITH CHECK (is_staff());
CREATE POLICY "gmf_staff_write"         ON public.game_mode_formats FOR ALL USING (is_staff()) WITH CHECK (is_staff());
CREATE POLICY "gmm_staff_write"         ON public.game_mode_maps    FOR ALL USING (is_staff()) WITH CHECK (is_staff());
CREATE POLICY "match_types_staff_write" ON public.match_types       FOR ALL USING (is_staff()) WITH CHECK (is_staff());

-- ── Seed: match types ──────────────────────────────────────────────────────
-- Only bo1 is buildable; bo3/bo5 exist so the roadmap is visible and so
-- enabling them later is an UPDATE.
INSERT INTO public.match_types (slug, name, seq, available) VALUES
  ('bo1', 'Best of 1', 1, true),
  ('bo3', 'Best of 3', 2, false),
  ('bo5', 'Best of 5', 3, false);

-- ── Seed: Free Fire ────────────────────────────────────────────────────────
INSERT INTO public.game_modes (game_id, slug, name, seq, competition_format)
SELECT g.id, v.slug, v.name, v.seq, v.fmt
  FROM public.games g
  JOIN (VALUES
    ('battle_royale', 'Battle Royale', 1, 'points_race'),
    ('clash_squad',   'Clash Squad',   2, 'head_to_head'),
    ('lone_wolf',     'Lone Wolf',     3, 'head_to_head')
  ) AS v(slug, name, seq, fmt) ON true
 WHERE g.slug = 'free-fire';

-- Formats. `available` is true only where the platform can actually finish the
-- tournament today: BR Duo/Squad need squad registration (nothing writes
-- squads yet), and every 2v2/4v4 needs teams on both sides of a matches row.
INSERT INTO public.game_mode_formats (mode_id, slug, name, seq, entry_unit, team_size, available)
SELECT m.id, v.slug, v.name, v.seq, v.unit, v.size, v.avail
  FROM public.game_modes m
  JOIN public.games g ON g.id = m.game_id AND g.slug = 'free-fire'
  JOIN (VALUES
    ('battle_royale', 'solo',  'Solo',  1, 'solo',  1, true),
    ('battle_royale', 'duo',   'Duo',   2, 'squad', 2, false),
    ('battle_royale', 'squad', 'Squad', 3, 'squad', 4, false),
    ('clash_squad',   '1v1',   '1v1',   1, 'solo',  1, true),
    ('clash_squad',   '2v2',   '2v2',   2, 'squad', 2, false),
    ('clash_squad',   '4v4',   '4v4',   3, 'squad', 4, false),
    ('lone_wolf',     '1v1',   '1v1',   1, 'solo',  1, true),
    ('lone_wolf',     '2v2',   '2v2',   2, 'squad', 2, false)
  ) AS v(mode_slug, slug, name, seq, unit, size, avail) ON v.mode_slug = m.slug;

-- Maps. A SEED, not a truth: pools rotate by season and Clash Squad's ranked
-- and custom lists already differ, which is why these are rows and not an enum.
INSERT INTO public.game_mode_maps (mode_id, name, seq)
SELECT m.id, v.name, v.seq
  FROM public.game_modes m
  JOIN public.games g ON g.id = m.game_id AND g.slug = 'free-fire'
  JOIN (VALUES
    ('battle_royale', 'Bermuda',            1),
    ('battle_royale', 'Purgatory',          2),
    ('battle_royale', 'Alpine',             3),
    ('battle_royale', 'Kalahari',           4),
    ('battle_royale', 'NeXTerra',           5),
    ('battle_royale', 'Solara',             6),
    ('clash_squad',   'Bermuda',            1),
    ('clash_squad',   'Bermuda Remastered', 2),
    ('clash_squad',   'Alpine',             3),
    ('clash_squad',   'Kalahari',           4),
    ('clash_squad',   'Purgatory',          5),
    ('clash_squad',   'NeXTerra',           6),
    ('lone_wolf',     'Iron Cage',          1)
  ) AS v(mode_slug, name, seq) ON v.mode_slug = m.slug;
```

- [ ] **Step 2: Apply and verify**

Apply via Supabase MCP `apply_migration`, name `game_modes`.

Verify with `execute_sql`:

```sql
select m.slug as mode, m.competition_format,
       (select count(*) from game_mode_formats f where f.mode_id = m.id) as formats,
       (select count(*) from game_mode_formats f where f.mode_id = m.id and f.available) as available_formats,
       (select count(*) from game_mode_maps p where p.mode_id = m.id) as maps
  from game_modes m join games g on g.id = m.game_id
 where g.slug = 'free-fire' order by m.seq;

select slug, available from match_types order by seq;

select tablename, count(*) as policies
  from pg_policies where schemaname='public'
   and tablename in ('game_modes','game_mode_formats','game_mode_maps','match_types')
 group by tablename order by tablename;
```

Expected: three modes (`battle_royale/points_race` 3 formats/1 available/6 maps, `clash_squad/head_to_head` 3/1/6, `lone_wolf/head_to_head` 2/1/1); `bo1` available, `bo3`/`bo5` not; **all four tables have 2 policies each** — an RLS-enabled table with zero policies is invisible to clients.

- [ ] **Step 3: Patch the generated types**

Add `game_modes`, `game_mode_formats`, `game_mode_maps` and `match_types` blocks to `lib/supabase/types.ts`, following an existing table block's shape (`Row` / `Insert` / `Update` / `Relationships`). Columns and nullability exactly as in the SQL; defaulted columns are optional in `Insert`/`Update`.

Run `node node_modules/typescript/bin/tsc --noEmit` — expect no output.

- [ ] **Step 4: Verify the suite is unmoved and commit**

Run: `node node_modules/vitest/vitest.mjs run > /tmp/t1.txt 2>&1; echo "exit=$?"` — expect `exit=0` and 1484 tests (schema-only task adds no tests).

```bash
git add supabase/migrations/20260912090000_game_modes.sql lib/supabase/types.ts
git commit -m "feat(games): catalogue tables for modes, formats, maps and match types

Mode is the parent and decides competition_format; formats and map pools hang
off it, so an impossible combination cannot be assembled.

Availability is a DATA column on both formats and match types. Enabling 4v4 or
Bo3 later is an UPDATE, never a deploy — and the CHECK on match_type permits
bo3/bo5 precisely so the flag is the only thing standing in the way.

Map pools are rows, not an enum: Garena rotates them by season and Clash
Squad's ranked and custom lists already differ."
```

---

### Task 2: Tournament columns

**Files:**
- Create: `supabase/migrations/20260912091000_tournament_mode_fields.sql`
- Modify: `lib/supabase/types.ts` (the `tournaments` and `tournament_lobbies` blocks)

**Interfaces:**
- Consumes: the catalogue tables from Task 1.
- Produces: `tournaments.mode_id`, `format_id`, `default_map_id`, `match_rules`, `match_type`; `tournament_lobbies.map_id`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260912091000_tournament_mode_fields.sql`:

```sql
-- All nullable: a football tournament has no mode and keeps its existing
-- Competition Format picker. Verified 2026-09-12 that every one of the 7
-- production tournaments is football (DLS 5, EA FC 2), so no backfill exists
-- to do — this is a fact, not a deferral.
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS mode_id        uuid REFERENCES public.game_modes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS format_id      uuid REFERENCES public.game_mode_formats(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS default_map_id uuid REFERENCES public.game_mode_maps(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS match_rules    text,
  ADD COLUMN IF NOT EXISTS match_type     text;

ALTER TABLE public.tournaments
  ADD CONSTRAINT tournaments_match_rules_valid
    CHECK (match_rules IS NULL OR match_rules IN ('normal', 'headshot_only', 'spam')),
  -- Permits every value the roadmap will ever enable. A CHECK allowing only
  -- 'bo1' would make turning on Bo3 a MIGRATION, defeating the whole point of
  -- gating by data — match_types.available is what hides it today.
  ADD CONSTRAINT tournaments_match_type_valid
    CHECK (match_type IS NULL OR match_type IN ('bo1', 'bo3', 'bo5'));

COMMENT ON COLUMN public.tournaments.match_type IS
  'Series length for head-to-head modes. NULL for Battle Royale, where tournament_stages.rounds_count already owns match length.';

-- A six-match BR event is rarely six Bermudas, so a lobby may override the
-- tournament default.
ALTER TABLE public.tournament_lobbies
  ADD COLUMN IF NOT EXISTS map_id uuid REFERENCES public.game_mode_maps(id) ON DELETE SET NULL;
```

- [ ] **Step 2: Apply and verify the CHECK accepts the gated values**

Apply via Supabase MCP `apply_migration`, name `tournament_mode_fields`.

Verify the constraint is permissive, in a transaction that always rolls back:

```sql
do $$
declare gid uuid; tid uuid; outcome text := '';
begin
  select id into gid from public.games where slug = 'dls';
  insert into public.tournaments (game_id, title, slug, status, registration_fee, prize_pool, format, tournament_type)
  values (gid, 'Repro MT', 'repro-mt', 'draft', 0, 0, 'group_knockout', 'open')
  returning id into tid;

  -- bo3 must be STORABLE even though it is not selectable.
  update public.tournaments set match_type = 'bo3' where id = tid;
  outcome := outcome || 'bo3 storable';

  update public.tournaments set match_type = 'bo5' where id = tid;
  outcome := outcome || ' | bo5 storable';

  begin
    update public.tournaments set match_type = 'bo7' where id = tid;
    outcome := outcome || ' | FAIL: bo7 accepted';
  exception when check_violation then outcome := outcome || ' | bo7 refused';
  end;

  begin
    update public.tournaments set match_rules = 'nonsense' where id = tid;
    outcome := outcome || ' | FAIL: bad rules accepted';
  exception when check_violation then outcome := outcome || ' | bad rules refused';
  end;

  raise exception 'ROLLBACK_OK >> %', outcome;
end $$;
```

Expected: `bo3 storable | bo5 storable | bo7 refused | bad rules refused`. If `bo3` is refused, the CHECK is too tight and enabling Bo3 would need a migration — fix before continuing.

- [ ] **Step 3: Patch the generated types and commit**

Add the five columns to the three `tournaments` sub-blocks and `map_id` to the three `tournament_lobbies` sub-blocks in `lib/supabase/types.ts`. `tsc --noEmit` clean; suite `exit=0`, still 1484.

```bash
git add supabase/migrations/20260912091000_tournament_mode_fields.sql lib/supabase/types.ts
git commit -m "feat(tournaments): mode, format, map, rules and match-type columns

All nullable — a football tournament stores NULL in every one and keeps the
Competition Format picker. No backfill exists to do: all 7 production
tournaments are football and there are zero Free Fire tournaments.

The match_type CHECK permits bo1|bo3|bo5 deliberately. Allowing only bo1 would
turn enabling Bo3 into a migration; match_types.available is what gates it.

Lobbies may override the tournament's default map — a six-match BR event is
rarely six Bermudas."
```

---

### Task 3: Resolving a Format into the columns that already exist

The pure rule that keeps `entry_unit` / `squad_size` a single source of truth.

**Files:**
- Create: `lib/tournaments/mode-selection.ts`
- Test: `lib/tournaments/mode-selection.test.ts`

**Interfaces:**
- Consumes: nothing at runtime (pure).
- Produces:
  - `interface ModeOption { id: string; slug: string; name: string; competitionFormat: string }`
  - `interface FormatOption { id: string; slug: string; name: string; entryUnit: string; teamSize: number; available: boolean }`
  - `interface MapOption { id: string; name: string }`
  - `resolveModeSelection(mode: ModeOption | null, format: FormatOption | null): { competitionFormat: string; entryUnit: string; squadSize: number | '' }`
  - `formatsForMode(all: FormatOption[], modeId: string | null): FormatOption[]`
  - `mapsForMode(all: (MapOption & { modeId: string })[], modeId: string | null): MapOption[]`

- [ ] **Step 1: Write the failing test**

Create `lib/tournaments/mode-selection.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  formatsForMode,
  mapsForMode,
  resolveModeSelection,
  type FormatOption,
  type ModeOption,
} from './mode-selection'

const br: ModeOption = { id: 'm-br', slug: 'battle_royale', name: 'Battle Royale', competitionFormat: 'points_race' }
const cs: ModeOption = { id: 'm-cs', slug: 'clash_squad', name: 'Clash Squad', competitionFormat: 'head_to_head' }

const brSolo: FormatOption = { id: 'f-solo', slug: 'solo', name: 'Solo', entryUnit: 'solo', teamSize: 1, available: true, }
const brSquad: FormatOption = { id: 'f-sq', slug: 'squad', name: 'Squad', entryUnit: 'squad', teamSize: 4, available: false }
const cs1v1: FormatOption = { id: 'f-1v1', slug: '1v1', name: '1v1', entryUnit: 'solo', teamSize: 1, available: true }

describe('resolveModeSelection', () => {
  it('takes the engine from the mode, never from the admin', () => {
    // Mode DECIDES competition_format. The admin never picks it for a game
    // that has modes, so the two can never disagree.
    expect(resolveModeSelection(br, brSolo).competitionFormat).toBe('points_race')
    expect(resolveModeSelection(cs, cs1v1).competitionFormat).toBe('head_to_head')
  })

  it('writes entry unit and squad size from the format catalogue', () => {
    // The catalogue is the definition; these columns are the stored value.
    // Asking the admin separately is what would let them drift.
    expect(resolveModeSelection(br, brSquad)).toEqual({
      competitionFormat: 'points_race',
      entryUnit: 'squad',
      squadSize: 4,
    })
  })

  it('leaves squad size empty for a solo format', () => {
    // tournaments_squad_size_present requires squad_size IS NULL when the
    // entry unit is solo, and '' is what the schema maps to NULL.
    expect(resolveModeSelection(br, brSolo).squadSize).toBe('')
    expect(resolveModeSelection(cs, cs1v1).squadSize).toBe('')
  })

  it('falls back to a solo head-to-head tournament when no mode is chosen', () => {
    // A football game has no modes at all; the result must be exactly what
    // such a tournament stored before any of this existed.
    expect(resolveModeSelection(null, null)).toEqual({
      competitionFormat: 'head_to_head',
      entryUnit: 'solo',
      squadSize: '',
    })
  })

  it('ignores a format when no mode is selected', () => {
    // Defensive: a stale format from a previous mode must not leak settings.
    expect(resolveModeSelection(null, brSquad).entryUnit).toBe('solo')
  })

  it('uses the mode alone when the format is missing', () => {
    expect(resolveModeSelection(br, null)).toEqual({
      competitionFormat: 'points_race',
      entryUnit: 'solo',
      squadSize: '',
    })
  })
})

describe('formatsForMode', () => {
  const all = [
    { ...brSolo, modeId: 'm-br' },
    { ...brSquad, modeId: 'm-br' },
    { ...cs1v1, modeId: 'm-cs' },
  ]

  it('returns only the chosen mode’s formats', () => {
    expect(formatsForMode(all, 'm-br').map((f) => f.slug)).toEqual(['solo', 'squad'])
    expect(formatsForMode(all, 'm-cs').map((f) => f.slug)).toEqual(['1v1'])
  })

  it('keeps unavailable formats in the list', () => {
    // They render greyed as "Coming soon" — visible so the roadmap reads.
    // Filtering them out here would hide the roadmap entirely.
    expect(formatsForMode(all, 'm-br').some((f) => !f.available)).toBe(true)
  })

  it('returns nothing when no mode is selected', () => {
    expect(formatsForMode(all, null)).toEqual([])
  })
})

describe('mapsForMode', () => {
  const all = [
    { id: 'p1', name: 'Bermuda', modeId: 'm-br' },
    { id: 'p2', name: 'Alpine', modeId: 'm-br' },
    { id: 'p3', name: 'Iron Cage', modeId: 'm-lw' },
  ]

  it('returns only the chosen mode’s maps', () => {
    // The bug this prevents: Bermuda is a BR map, and the mock let you pick it
    // for a Clash Squad tournament.
    expect(mapsForMode(all, 'm-br').map((m) => m.name)).toEqual(['Bermuda', 'Alpine'])
  })

  it('returns the single map for a one-map mode', () => {
    expect(mapsForMode(all, 'm-lw')).toEqual([{ id: 'p3', name: 'Iron Cage' }])
  })

  it('returns nothing when no mode is selected', () => {
    expect(mapsForMode(all, null)).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run lib/tournaments/mode-selection.test.ts`
Expected: FAIL — `Cannot find module './mode-selection'`.

- [ ] **Step 3: Write the implementation**

Create `lib/tournaments/mode-selection.ts`:

```ts
// Turning a Mode + Format choice into the columns the rest of the platform
// already reads.
//
// game_mode_formats is the CATALOGUE — it defines what "Clash Squad 4v4"
// means. tournaments.entry_unit / squad_size stay the authoritative stored
// values, because every existing constraint and closeRegistration read them.
// Selecting a Format WRITES them, so the admin is never asked twice and the
// two cannot drift.

export interface ModeOption {
  id: string
  slug: string
  name: string
  competitionFormat: string
}

export interface FormatOption {
  id: string
  slug: string
  name: string
  entryUnit: string
  teamSize: number
  available: boolean
}

export interface MapOption {
  id: string
  name: string
}

export function resolveModeSelection(
  mode: ModeOption | null,
  format: FormatOption | null,
): { competitionFormat: string; entryUnit: string; squadSize: number | '' } {
  // No mode: a football game, which must produce exactly the row it always did.
  if (!mode) return { competitionFormat: 'head_to_head', entryUnit: 'solo', squadSize: '' }

  // A format is only meaningful alongside its own mode; without one, fall back
  // to solo rather than carrying a stale selection across a mode change.
  const entryUnit = format?.entryUnit === 'squad' ? 'squad' : 'solo'

  return {
    competitionFormat: mode.competitionFormat,
    entryUnit,
    // tournaments_squad_size_present requires NULL for solo, and the schema
    // maps '' to NULL.
    squadSize: entryUnit === 'squad' && format ? format.teamSize : '',
  }
}

// Unavailable formats are KEPT, not filtered: they render greyed as "Coming
// soon" so the roadmap is legible. Dropping them here would hide it.
export function formatsForMode<T extends { modeId: string }>(
  all: T[],
  modeId: string | null,
): T[] {
  if (!modeId) return []
  return all.filter((f) => f.modeId === modeId)
}

export function mapsForMode<T extends MapOption & { modeId: string }>(
  all: T[],
  modeId: string | null,
): MapOption[] {
  if (!modeId) return []
  return all.filter((m) => m.modeId === modeId).map((m) => ({ id: m.id, name: m.name }))
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node node_modules/vitest/vitest.mjs run lib/tournaments/mode-selection.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/tournaments/mode-selection.ts lib/tournaments/mode-selection.test.ts
git commit -m "feat(tournaments): resolve a mode+format selection into stored columns

game_mode_formats is the catalogue; tournaments.entry_unit and squad_size stay
the authoritative values every existing constraint reads. Selecting a Format
writes them, so only one is ever typed and they cannot drift.

Unavailable formats are kept in the list rather than filtered — they render
greyed as 'Coming soon', and dropping them would hide the roadmap."
```

---

### Task 4: Schema, parseForm and the row mapper

**Files:**
- Modify: `lib/tournaments/admin-schema.ts`
- Modify: `lib/tournaments/admin-form.ts` (`parseForm`)
- Modify: `lib/tournaments/admin-actions.ts` (`toRow`)
- Test: `lib/tournaments/admin-form.test.ts` (append)

**Interfaces:**
- Consumes: `resolveModeSelection` (Task 3).
- Produces: `tournamentSchema` gains `modeId`, `formatId`, `defaultMapId`, `matchRules`, `matchType`; `toRow` emits the five columns.

- [ ] **Step 1: Write the failing tests**

Append to `lib/tournaments/admin-form.test.ts`:

```ts
describe('parseForm — mode, format, map, rules, match type', () => {
  it('defaults every new field to empty for a football tournament', () => {
    const r = parseForm(footballForm())
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.modeId).toBe('')
      expect(r.data.formatId).toBe('')
      expect(r.data.defaultMapId).toBe('')
      expect(r.data.matchRules).toBe('')
      expect(r.data.matchType).toBe('')
    }
  })

  it('carries the four selections through to the parsed result', () => {
    // The bug this guards: parseForm hand-picks fields, so one added to the
    // schema but not here is dropped and the default silently wins.
    const fd = footballForm()
    fd.set('modeId', '33333333-3333-4333-8333-333333333333')
    fd.set('formatId', '44444444-4444-4444-8444-444444444444')
    fd.set('defaultMapId', '55555555-5555-4555-8555-555555555555')
    fd.set('matchRules', 'headshot_only')
    fd.set('matchType', 'bo1')
    const r = parseForm(fd)

    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.modeId).toBe('33333333-3333-4333-8333-333333333333')
      expect(r.data.formatId).toBe('44444444-4444-4444-8444-444444444444')
      expect(r.data.defaultMapId).toBe('55555555-5555-4555-8555-555555555555')
      expect(r.data.matchRules).toBe('headshot_only')
      expect(r.data.matchType).toBe('bo1')
    }
  })

  it('accepts every match type the CHECK permits, not only the selectable one', () => {
    // Availability is gated by match_types.available, NOT by validation. A
    // schema that rejected bo3 would make enabling it a code change.
    for (const matchType of ['bo1', 'bo3', 'bo5']) {
      const fd = footballForm()
      fd.set('matchType', matchType)
      expect(parseForm(fd).success, matchType).toBe(true)
    }
  })

  it('rejects a match type the database would refuse', () => {
    const fd = footballForm()
    fd.set('matchType', 'bo7')
    expect(parseForm(fd).success).toBe(false)
  })

  it('rejects an unknown match rule', () => {
    const fd = footballForm()
    fd.set('matchRules', 'nonsense')
    expect(parseForm(fd).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run lib/tournaments/admin-form.test.ts`
Expected: FAIL — `modeId` is undefined on the parsed result.

- [ ] **Step 3: Extend the schema**

In `lib/tournaments/admin-schema.ts`, add inside the `z.object({...})` after `squadSize`:

```ts
    // Mode/Format/Map are FKs into the catalogue tables; '' means "not a
    // mode-based game" and maps to NULL.
    modeId: z.union([z.literal(''), z.string().uuid()]).default(''),
    formatId: z.union([z.literal(''), z.string().uuid()]).default(''),
    defaultMapId: z.union([z.literal(''), z.string().uuid()]).default(''),
    matchRules: z.union([z.literal(''), z.enum(['normal', 'headshot_only', 'spam'])]).default(''),
    // Accepts every value the CHECK permits. Availability is gated by
    // match_types.available, never by validation — a schema that rejected bo3
    // would make enabling it a code change rather than a data flip.
    matchType: z.union([z.literal(''), z.enum(['bo1', 'bo3', 'bo5'])]).default(''),
```

- [ ] **Step 4: Add the fields to `parseForm`**

In `lib/tournaments/admin-form.ts`, add inside the `safeParse({...})` after `squadSize`:

```ts
    modeId: formData.get('modeId') ?? '',
    formatId: formData.get('formatId') ?? '',
    defaultMapId: formData.get('defaultMapId') ?? '',
    matchRules: formData.get('matchRules') ?? '',
    matchType: formData.get('matchType') ?? '',
```

- [ ] **Step 5: Run to verify it passes**

Run: `node node_modules/vitest/vitest.mjs run lib/tournaments/admin-form.test.ts`
Expected: PASS, including every pre-existing case unchanged.

- [ ] **Step 6: Map onto the row**

In `lib/tournaments/admin-actions.ts`, add to `toRow` after `squad_size`:

```ts
    mode_id: d.modeId === '' ? null : d.modeId,
    format_id: d.formatId === '' ? null : d.formatId,
    default_map_id: d.defaultMapId === '' ? null : d.defaultMapId,
    match_rules: d.matchRules === '' ? null : d.matchRules,
    match_type: d.matchType === '' ? null : d.matchType,
```

- [ ] **Step 7: Verify and commit**

`tsc --noEmit` clean; `node node_modules/next/dist/bin/next lint` clean; suite `exit=0` with 17 more tests than baseline (12 from Task 3, 5 here).

```bash
git add lib/tournaments/admin-schema.ts lib/tournaments/admin-form.ts lib/tournaments/admin-actions.ts lib/tournaments/admin-form.test.ts
git commit -m "feat(tournaments): accept mode, format, map, rules and match type

Added to parseForm in the same commit as the schema, which is the step that was
missed for competitionFormat and made the whole points-race feature
unreachable. The round-trip tests cover all five.

matchType validates bo1|bo3|bo5 even though only bo1 is selectable: gating
belongs in match_types.available, not in validation, or enabling Bo3 becomes a
code change."
```

---

### Task 5: Loading the catalogue

**Files:**
- Create: `lib/tournaments/mode-catalogue.ts`
- Modify: `app/[locale]/admin/tournaments/new/page.tsx`
- Modify: `app/[locale]/admin/tournaments/[id]/edit/page.tsx`

**Interfaces:**
- Consumes: `ModeOption`, `FormatOption` from Task 3.
- Produces: `fetchModeCatalogue(): Promise<ModeCatalogue>` where

```ts
interface ModeCatalogue {
  modes: (ModeOption & { gameId: string })[]
  formats: (FormatOption & { modeId: string })[]
  maps: { id: string; name: string; modeId: string }[]
  matchTypes: { slug: string; name: string; available: boolean }[]
}
```

- [ ] **Step 1: Write the loader**

Create `lib/tournaments/mode-catalogue.ts`:

```ts
import { createClient } from '@/lib/supabase/server'
import type { FormatOption, ModeOption } from './mode-selection'

export interface ModeCatalogue {
  modes: (ModeOption & { gameId: string })[]
  formats: (FormatOption & { modeId: string })[]
  maps: { id: string; name: string; modeId: string }[]
  matchTypes: { slug: string; name: string; available: boolean }[]
}

// One read for the whole catalogue. It is small (three modes, eight formats,
// thirteen maps for Free Fire) and entirely public, so it ships to the client
// in full and the dependent selects filter it locally — no round trip per
// Mode change.
export async function fetchModeCatalogue(): Promise<ModeCatalogue> {
  const supabase = createClient()
  const [modes, formats, maps, matchTypes] = await Promise.all([
    supabase.from('game_modes').select('id, game_id, slug, name, competition_format').eq('active', true).order('seq'),
    supabase.from('game_mode_formats').select('id, mode_id, slug, name, entry_unit, team_size, available').eq('active', true).order('seq'),
    supabase.from('game_mode_maps').select('id, mode_id, name').eq('active', true).order('seq'),
    supabase.from('match_types').select('slug, name, available').eq('active', true).order('seq'),
  ])

  return {
    modes: (modes.data ?? []).map((m) => ({
      id: m.id,
      gameId: m.game_id,
      slug: m.slug,
      name: m.name,
      competitionFormat: m.competition_format,
    })),
    formats: (formats.data ?? []).map((f) => ({
      id: f.id,
      modeId: f.mode_id,
      slug: f.slug,
      name: f.name,
      entryUnit: f.entry_unit,
      teamSize: f.team_size,
      available: f.available,
    })),
    maps: (maps.data ?? []).map((m) => ({ id: m.id, name: m.name, modeId: m.mode_id })),
    matchTypes: (matchTypes.data ?? []).map((t) => ({ slug: t.slug, name: t.name, available: t.available })),
  }
}
```

- [ ] **Step 2: Feed it from both admin pages**

In both `new/page.tsx` and `[id]/edit/page.tsx`, add `fetchModeCatalogue()` to the existing `Promise.all` and pass the result to `TournamentForm` as a `catalogue` prop.

In `new/page.tsx`, add to the `EMPTY` object:

```ts
  modeId: '',
  formatId: '',
  defaultMapId: '',
  matchRules: '',
  matchType: '',
```

In `edit/page.tsx`, add to the `initial` object (the tournament read is `select('*')`, so the columns are already present):

```ts
    modeId: t.mode_id ?? '',
    formatId: t.format_id ?? '',
    defaultMapId: t.default_map_id ?? '',
    matchRules: t.match_rules ?? '',
    matchType: t.match_type ?? '',
```

- [ ] **Step 3: Verify and commit**

`tsc --noEmit` will fail until Task 6 widens `TournamentFormValues`. That is expected — **do Task 6 before committing this**, or stage both together. If splitting, run `tsc` only after Task 6.

---

### Task 6: The dependent selects

**Files:**
- Modify: `components/admin/TournamentForm.tsx`

**Interfaces:**
- Consumes: `ModeCatalogue` (Task 5); `formatsForMode`, `mapsForMode`, `resolveModeSelection` (Task 3).
- Produces: `TournamentFormValues` gains `modeId`, `formatId`, `defaultMapId`, `matchRules`, `matchType`; `TournamentForm` gains a `catalogue: ModeCatalogue` prop.

- [ ] **Step 1: Widen the value type and add state**

Add the five fields to `TournamentFormValues` as `string`, add `catalogue: ModeCatalogue` to the props, and add state beside the existing `gameId` / `competitionFormat`:

```ts
  const [modeId, setModeId] = useState(initial.modeId)
  const [formatId, setFormatId] = useState(initial.formatId)
  const [mapId, setMapId] = useState(initial.defaultMapId)

  // Modes belong to a game. A game with none keeps the existing Competition
  // Format picker and every mode field stays empty.
  const gameModes = catalogue.modes.filter((m) => m.gameId === gameId)
  const hasModes = gameModes.length > 0
  const selectedMode = gameModes.find((m) => m.id === modeId) ?? null
  const modeFormats = formatsForMode(catalogue.formats, modeId || null)
  const modeMaps = mapsForMode(catalogue.maps, modeId || null)
  const selectedFormat = modeFormats.find((f) => f.id === formatId) ?? null
  const derived = resolveModeSelection(selectedMode, selectedFormat)
```

- [ ] **Step 2: Reset the dependent fields when Mode changes**

Changing Mode must clear Format and Map, or a stale Clash Squad map survives onto a Battle Royale tournament — the exact bug the mock had:

```tsx
  function onModeChange(nextModeId: string) {
    setModeId(nextModeId)
    setFormatId('')
    setMapId('')
  }
```

- [ ] **Step 3: Render the four controls**

Insert after the Game select, and render them **only when `hasModes`**:

```tsx
      {hasModes && (
        <>
          <div className="space-y-1.5">
            <label htmlFor="modeId" className="text-sm font-medium text-slate-300">Mode</label>
            <select
              id="modeId"
              name="modeId"
              value={modeId}
              onChange={(e) => onModeChange(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
            >
              <option value="">Choose a mode</option>
              {gameModes.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>

          {modeFormats.length > 0 && (
            <div className="space-y-1.5">
              <label htmlFor="formatId" className="text-sm font-medium text-slate-300">Format</label>
              <select
                id="formatId"
                name="formatId"
                value={formatId}
                onChange={(e) => setFormatId(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
              >
                <option value="">Choose a format</option>
                {modeFormats.map((f) => (
                  // Unavailable formats stay VISIBLE but disabled — the
                  // roadmap is legible, and nobody can create a tournament the
                  // platform cannot finish.
                  <option key={f.id} value={f.id} disabled={!f.available}>
                    {f.name}{f.available ? '' : ' — coming soon'}
                  </option>
                ))}
              </select>
            </div>
          )}

          {modeMaps.length === 1 ? (
            <div className="space-y-1.5">
              <span className="text-sm font-medium text-slate-300">Map</span>
              <p className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-300">
                {modeMaps[0].name}
              </p>
              <input type="hidden" name="defaultMapId" value={modeMaps[0].id} />
            </div>
          ) : modeMaps.length > 1 ? (
            <div className="space-y-1.5">
              <label htmlFor="defaultMapId" className="text-sm font-medium text-slate-300">Map</label>
              <select
                id="defaultMapId"
                name="defaultMapId"
                value={mapId}
                onChange={(e) => setMapId(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
              >
                <option value="">Choose a map</option>
                {modeMaps.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
              <p className="text-xs text-slate-500">The default. Each lobby can override it.</p>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <label htmlFor="matchRules" className="text-sm font-medium text-slate-300">Match rules</label>
            <select
              id="matchRules"
              name="matchRules"
              defaultValue={initial.matchRules || 'normal'}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
            >
              <option value="normal">Normal</option>
              <option value="headshot_only">Headshot only</option>
              <option value="spam">Spam / unlimited ammo</option>
            </select>
          </div>

          {/* Battle Royale expresses length as a stage's rounds_count, so it
              has no series length at all. */}
          {selectedMode?.competitionFormat === 'head_to_head' && (
            <div className="space-y-1.5">
              <label htmlFor="matchType" className="text-sm font-medium text-slate-300">Match type</label>
              <select
                id="matchType"
                name="matchType"
                defaultValue={initial.matchType || 'bo1'}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
              >
                {catalogue.matchTypes.map((t) => (
                  <option key={t.slug} value={t.slug} disabled={!t.available}>
                    {t.name}{t.available ? '' : ' — coming soon'}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Derived, never asked twice — see mode-selection.ts. */}
          <input type="hidden" name="competitionFormat" value={derived.competitionFormat} />
          <input type="hidden" name="entryUnit" value={derived.entryUnit} />
          <input type="hidden" name="squadSize" value={String(derived.squadSize)} />
        </>
      )}
```

- [ ] **Step 4: Hide the Competition Format picker when the game has modes**

Wrap the existing `availableFormats.length > 1` block so it renders only when `!hasModes`. Mode already implies the engine, and showing both lets an admin set two things that can contradict each other.

The existing `!isPointsRace` wrappers around the groups/knockout controls stay as they are, but must now read the derived value — change `isPointsRace` to:

```ts
  const isPointsRace = hasModes
    ? derived.competitionFormat === 'points_race'
    : competitionFormat === 'points_race'
```

- [ ] **Step 5: Verify**

`tsc --noEmit` clean, lint clean, suite `exit=0`.

Then confirm the wiring actually posts what it should — a headless check against the deployed form, following the drill rules in memory (control assertion first, wait for hydration, assert every step):

1. Assert the control: `#tournamentType` → Masters reveals `#seasonId`.
2. Pick Dream League Soccer → `#modeId` absent, `#competitionFormat` present.
3. Pick Free Fire → `#modeId` present, `#competitionFormat` absent.
4. Pick Mode = Battle Royale → `#formatId` and `#defaultMapId` present; Map lists six BR maps.
5. Assert `new FormData(form).get('competitionFormat')` is `points_race` — derived, not typed.
6. Pick Mode = Lone Wolf → Map renders as a fixed label, no `#defaultMapId` select, hidden input carries the Iron Cage id.
7. Assert the Squad option in `#formatId` has `disabled` set.

- [ ] **Step 6: Commit**

```bash
git add components/admin/TournamentForm.tsx lib/tournaments/mode-catalogue.ts "app/[locale]/admin/tournaments/new/page.tsx" "app/[locale]/admin/tournaments/[id]/edit/page.tsx"
git commit -m "feat(admin): Mode -> Format -> Map as dependent selects

Changing Mode resets Format and Map, so a Clash Squad map cannot survive onto a
Battle Royale tournament — the exact combination the design mock produced.

Mode replaces the Competition Format picker for games that have modes: it
already implies the engine, and showing both lets an admin set two things that
can contradict each other. competition_format, entry_unit and squad_size are
posted as derived hidden inputs rather than asked for twice.

Unavailable formats and match types render disabled with 'coming soon' rather
than being filtered out, so the roadmap stays legible."
```

---

### Task 7: Show it to players

**Files:**
- Modify: `app/[locale]/(public)/tournaments/[slug]/page.tsx`

**Interfaces:**
- Consumes: the `tournaments` columns from Task 2.

- [ ] **Step 1: Read the fields and render them**

Widen the tournament query to embed the catalogue names, then render a line under the title:

```tsx
{modeLine && <p className="text-sm text-slate-400">{modeLine}</p>}
```

where `modeLine` joins the non-null parts of Mode · Format · Map · Rules with ` · `.

**Every part must be optional.** A football tournament has NULL in all of them and must render nothing at all — not an empty separator, not "null". Build the string by filtering:

```ts
const modeLine = [modeName, formatName, mapName, rulesLabel].filter(Boolean).join(' · ')
```

- [ ] **Step 2: Verify and commit**

`tsc --noEmit` clean, lint clean, suite `exit=0`.

Confirm against production data that a football tournament renders no mode line — there are 7 of them and none has a mode, so any regression shows immediately.

```bash
git add "app/[locale]/(public)/tournaments/[slug]/page.tsx"
git commit -m "feat(tournaments): show mode, format, map and rules to players

Every part is optional and the line disappears entirely when all are NULL — all
7 production tournaments are football and have none of these fields, so a
non-optional render would break every existing page."
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §2 Mode → Format → Map, reset on change | 3, 6 |
| §3 Mode decides the engine; picker replaced | 3, 6 |
| §4 availability gating, greyed "coming soon" | 1 (data), 6 (render) |
| §5 catalogue tables, text+CHECK, RLS | 1, 2 |
| §5.0 one source of truth for team size | 3, 6 |
| §5.1 map on the lobby | 2 (column) |
| §5.2 one-map mode shows a label | 6 |
| §6 seed data | 1 |
| §7 match rules | 2, 4, 6 |
| §7.1 + §7.1.1 match type, CHECK permits bo3/bo5, availability is data | 1, 2, 4, 6 |
| §10 compatibility, NULL renders as nothing | 2, 7 |

**Deferred by design:** per-lobby map *editor* UI (the column exists, spec §9), team-vs-team, squad registration.

**Placeholder scan:** none. Task 5 Step 2 and Task 7 Step 1 describe edits to existing files whose exact surrounding code varies; every field name, value and rule is given.

**Type consistency:** `ModeOption`/`FormatOption`/`MapOption` are defined in Task 3 and imported by Tasks 5 and 6. `formatsForMode` is generic over `{ modeId: string }` so it accepts the catalogue's format rows directly. `resolveModeSelection` returns `squadSize: number | ''`, matching `tournamentSchema.squadSize`'s `z.union([z.literal(''), ...number])`.

**Known risk:** Task 6 posts `competitionFormat` / `entryUnit` / `squadSize` as hidden inputs derived from the selection. If a future change makes any of those three required-and-visible again, the two paths will disagree. The `admin-form.test.ts` round-trip tests are what would catch it.
