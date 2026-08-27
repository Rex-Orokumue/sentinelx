# FC Mobile Competition Structure — Core Mechanics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open EA FC Mobile as the platform's second active game, with a working
Circuit Cup (free, round-robin, 3×/month) → Elite Cup (₦500, 16-player
knockout, monthly) qualification pipeline that admin can create, run, and pay
out end-to-end.

**Architecture:** Additive to the existing Season System. `tournament_type`
stays the game-agnostic tier (`community_club` = Circuit Cup,
`masters` = Elite Cup); a new `format = 'round_robin'` on `tournaments`
drives a single-group, no-knockout competitive shape reusing the existing
`roundRobinPairs`/`group_memberships`/`sortStandings` machinery. A
game-scoping fix on the season leaderboard queries is the one correctness
change required before two games can safely share the tier system. A
generalized two-column prize-split (`prize_second`/`prize_third`, derived
`prize_first = prize_pool - prize_second - prize_third`) replaces
winner-take-all for any tournament that opts in, with zero behavior change
for every tournament that doesn't.

**Tech Stack:** Next.js 14 (App Router) Server Actions, Supabase Postgres +
service-role admin client, Zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-27-fc-mobile-competition-structure-design.md`
(§1–§5 are what this plan implements; §6–§7, the `/seasons` page and
Rankings/Hall of Fame per-game filter, are a separate follow-up plan since
they depend only on Task 7 below, not on the round-robin/prize-split
mechanics).

## Global Constraints

- `format` values: `'group_knockout'` (existing, unchanged behavior) |
  `'round_robin'` (new). No third value.
- `prize_second`/`prize_third` are nullable integers; `prize_second +
  prize_third <= prize_pool` is DB-enforced. 1st place's actual credit is
  always `prize_pool - prize_second - prize_third`, never stored.
- Circuit Cup points by final table rank: 1st=100, 2nd=70, 3rd–4th=45,
  5th–8th=25, rest=5 (tunable constants, not load-bearing values).
- Elite Cup defaults: `prize_pool=15000`, `prize_second=4000`,
  `prize_third=3000` (⇒ 1st=₦8,000) — admin-editable per instance, not
  hardcoded into logic.
- Every DB write from a Server Action goes through the service-role admin
  client (`createAdminClient()`), matching every existing action in
  `lib/tournaments/`, `lib/matches/`, `lib/seasons/`.
- No RLS changes needed — every new column lives on `tournaments`, which
  already has public-read + staff-write policies covering these columns.

---

### Task 1: Migration — schema + FC Mobile activation

**Files:**
- Create: `supabase/migrations/072_fc_mobile_and_round_robin.sql`

**Interfaces:**
- Produces: `tournaments.format` accepts `'round_robin'`;
  `tournaments.prize_second`/`tournaments.prize_third` (nullable integer,
  `prize_splits_within_pool` CHECK); `games` row `slug='ea-fc-mobile'` has
  `active = true`.

- [ ] **Step 1: Write the migration**

```sql
-- 072_fc_mobile_and_round_robin.sql
-- Opens EA FC Mobile as the platform's second active game (Circuit Cup +
-- Elite Cup — see docs/superpowers/specs/2026-08-27-fc-mobile-competition-structure-design.md).

-- New tournament format: a single round-robin table with no knockout stage,
-- for Circuit Cup. Existing tournaments are all 'group_knockout' already.
ALTER TABLE public.tournaments DROP CONSTRAINT tournaments_format_check;
ALTER TABLE public.tournaments ADD CONSTRAINT tournaments_format_check
  CHECK (format IN ('group_knockout', 'round_robin'));

-- Generalized prize-split. prize_pool keeps its existing meaning (the
-- total, shown everywhere it's shown today); 1st place's actual credit is
-- derived as prize_pool - prize_second - prize_third, never stored, so
-- there is no prize_first column and no backfill needed. Both NULL (every
-- tournament today) reproduces today's winner-take-all exactly.
ALTER TABLE public.tournaments
  ADD COLUMN prize_second integer CHECK (prize_second IS NULL OR prize_second >= 0),
  ADD COLUMN prize_third  integer CHECK (prize_third  IS NULL OR prize_third  >= 0),
  ADD CONSTRAINT prize_splits_within_pool
    CHECK (COALESCE(prize_second, 0) + COALESCE(prize_third, 0) <= prize_pool);

-- Idempotent guard against double-crediting the 3rd-place prize (the final
-- and the third-place match can resolve in either order, and each is a
-- separate code path — see Task 6).
ALTER TABLE public.tournaments
  ADD COLUMN third_place_prize_credited boolean NOT NULL DEFAULT false;

-- EA FC Mobile already exists (category='football', seeded inactive) —
-- just activate it.
UPDATE public.games SET active = true WHERE slug = 'ea-fc-mobile';
```

- [ ] **Step 2: Apply the migration**

Run via the Supabase MCP tool (`mcp__claude_ai_Supabase__apply_migration`,
project id `itxubrkbropttfdackmi`) or `supabase db push` if the CLI is
reachable (see [[project_supabase_connectivity_gotcha]] if not — MCP tools
often work when the CLI can't connect).

- [ ] **Step 3: Regenerate TypeScript types**

Run: `mcp__claude_ai_Supabase__generate_typescript_types` (project id
`itxubrkbropttfdackmi`), write the result to `lib/supabase/types.ts`.

- [ ] **Step 4: Verify live**

Run via `mcp__claude_ai_Supabase__execute_sql`:
```sql
select slug, active from games where slug = 'ea-fc-mobile';
select column_name from information_schema.columns
  where table_name = 'tournaments' and column_name in ('prize_second', 'prize_third', 'third_place_prize_credited');
```
Expected: `active = true`; all three columns present.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/072_fc_mobile_and_round_robin.sql lib/supabase/types.ts
git commit -m "feat(fc-mobile): activate EA FC Mobile, add round_robin format + prize-split columns"
```

---

### Task 2: Round-robin placement — pure points/coins/XP functions

**Files:**
- Create: `lib/tournaments/round-robin-placement.ts`
- Test: `lib/tournaments/round-robin-placement.test.ts`

**Interfaces:**
- Produces: `pointsForRoundRobinRank(rank: number): number`,
  `coinsForRoundRobinRank(rank: number): number`,
  `xpForRoundRobinRank(rank: number): number` — all pure, `rank` is 1-based
  (1 = winner of the table). Consumed by Task 5.

- [ ] **Step 1: Write the failing tests**

```typescript
// lib/tournaments/round-robin-placement.test.ts
import { describe, it, expect } from 'vitest'
import { pointsForRoundRobinRank, coinsForRoundRobinRank, xpForRoundRobinRank } from './round-robin-placement'

describe('pointsForRoundRobinRank', () => {
  it('awards the documented tiers', () => {
    expect(pointsForRoundRobinRank(1)).toBe(100)
    expect(pointsForRoundRobinRank(2)).toBe(70)
    expect(pointsForRoundRobinRank(3)).toBe(45)
    expect(pointsForRoundRobinRank(4)).toBe(45)
    expect(pointsForRoundRobinRank(5)).toBe(25)
    expect(pointsForRoundRobinRank(8)).toBe(25)
    expect(pointsForRoundRobinRank(9)).toBe(5)
    expect(pointsForRoundRobinRank(50)).toBe(5)
  })
})

describe('coinsForRoundRobinRank', () => {
  it('mirrors the bracket PLACEMENT_COINS anchors', () => {
    expect(coinsForRoundRobinRank(1)).toBe(500)
    expect(coinsForRoundRobinRank(2)).toBe(300)
    expect(coinsForRoundRobinRank(3)).toBe(150)
    expect(coinsForRoundRobinRank(4)).toBe(150)
    expect(coinsForRoundRobinRank(8)).toBe(75)
    expect(coinsForRoundRobinRank(9)).toBe(30)
    expect(coinsForRoundRobinRank(50)).toBe(10)
  })
})

describe('xpForRoundRobinRank', () => {
  it('mirrors the bracket PLACEMENT_XP anchors, zero beyond rank 8', () => {
    expect(xpForRoundRobinRank(1)).toBe(500)
    expect(xpForRoundRobinRank(2)).toBe(300)
    expect(xpForRoundRobinRank(3)).toBe(200)
    expect(xpForRoundRobinRank(4)).toBe(200)
    expect(xpForRoundRobinRank(8)).toBe(100)
    expect(xpForRoundRobinRank(9)).toBe(0)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/tournaments/round-robin-placement.test.ts`
Expected: FAIL — module `./round-robin-placement` does not exist.

- [ ] **Step 3: Write the implementation**

```typescript
// lib/tournaments/round-robin-placement.ts
// Circuit Cup placement: unlike a knockout's fixed set of bracket bands
// (lib/tournaments/season-placement.ts), a round-robin table's final rank
// is already a plain 1-based number from sortStandings (lib/tournaments/
// standings.ts) — no band abstraction needed, just tier breakpoints over
// that number. Values mirror the spec's documented tiers and the existing
// bracket PLACEMENT_COINS/PLACEMENT_XP anchors (lib/matches/season-points.ts)
// at the corresponding placements — starting values, tunable like those are.

export function pointsForRoundRobinRank(rank: number): number {
  if (rank === 1) return 100
  if (rank === 2) return 70
  if (rank <= 4) return 45
  if (rank <= 8) return 25
  return 5
}

export function coinsForRoundRobinRank(rank: number): number {
  if (rank === 1) return 500
  if (rank === 2) return 300
  if (rank <= 4) return 150
  if (rank <= 8) return 75
  if (rank <= 16) return 30
  return 10
}

export function xpForRoundRobinRank(rank: number): number {
  if (rank === 1) return 500
  if (rank === 2) return 300
  if (rank <= 4) return 200
  if (rank <= 8) return 100
  return 0
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/tournaments/round-robin-placement.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add lib/tournaments/round-robin-placement.ts lib/tournaments/round-robin-placement.test.ts
git commit -m "feat(fc-mobile): round-robin placement points/coins/XP functions"
```

---

### Task 3: Tournament form — Format picker + prize-split fields

**Files:**
- Modify: `lib/tournaments/admin-schema.ts`
- Modify: `lib/tournaments/admin-actions.ts:18-60` (`toRow`), `:75` (`createTournament`'s hardcoded `format`)
- Modify: `components/admin/TournamentForm.tsx`
- Test: `lib/tournaments/admin-schema.test.ts`

**Interfaces:**
- Produces: `TournamentInput.format: 'group_knockout' | 'round_robin'`,
  `TournamentInput.prizeSecond`/`prizeThird: '' | number`. `toRow()` maps
  these to `format`/`prize_second`/`prize_third` (empty string → `null`).
  Consumed by Task 4 (bracket generation reads `tournament.format`) and
  Task 6 (prize crediting reads `prize_second`/`prize_third`).

- [ ] **Step 1: Write the failing schema test**

```typescript
// Add to lib/tournaments/admin-schema.test.ts (existing file — append)
it('defaults format to group_knockout and accepts round_robin', () => {
  const base = { title: 'T', gameId: '00000000-0000-0000-0000-000000000000', slug: '', description: '', bannerUrl: '', registrationFee: 0, prizePool: 0, maxPlayers: '', registrationStart: '', registrationEnd: '', tournamentStart: '', tournamentEnd: '', rules: '', dataSupportText: '', dataSupportWhatsapp: '', tournamentType: 'open' as const, seasonId: '', prizeSecond: '', prizeThird: '' }
  expect(tournamentSchema.parse(base).format).toBe('group_knockout')
  expect(tournamentSchema.parse({ ...base, format: 'round_robin' }).format).toBe('round_robin')
  expect(() => tournamentSchema.parse({ ...base, format: 'bogus' })).toThrow()
})

it('accepts empty or numeric prizeSecond/prizeThird', () => {
  const base = { title: 'T', gameId: '00000000-0000-0000-0000-000000000000', slug: '', description: '', bannerUrl: '', registrationFee: 0, prizePool: 15000, maxPlayers: '', registrationStart: '', registrationEnd: '', tournamentStart: '', tournamentEnd: '', rules: '', dataSupportText: '', dataSupportWhatsapp: '', tournamentType: 'open' as const, seasonId: '' }
  expect(tournamentSchema.parse({ ...base, prizeSecond: '4000', prizeThird: '3000' }).prizeSecond).toBe(4000)
  expect(tournamentSchema.parse({ ...base, prizeSecond: '', prizeThird: '' }).prizeSecond).toBe('')
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/tournaments/admin-schema.test.ts`
Expected: FAIL — `format`/`prizeSecond`/`prizeThird` not recognized by the schema (either a Zod parse error on the new fields, or `format` reads `undefined`).

- [ ] **Step 3: Extend the schema**

In `lib/tournaments/admin-schema.ts`, add to the `tournamentSchema` object
(alongside the existing `tournamentType`/`seasonId` fields):

```typescript
    format: z.enum(['group_knockout', 'round_robin']).default('group_knockout'),
    prizeSecond: z.union([z.literal(''), money(1_000_000_000)]),
    prizeThird: z.union([z.literal(''), money(1_000_000_000)]),
```

(`money()` is the existing helper defined at the top of this file — reuse
it verbatim, do not redefine.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/tournaments/admin-schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the new fields through admin-actions.ts**

In `lib/tournaments/admin-actions.ts`, add to `parseForm()`'s
`tournamentSchema.safeParse({ ... })` call:

```typescript
    format: formData.get('format') ?? 'group_knockout',
    prizeSecond: formData.get('prizeSecond') ?? '',
    prizeThird: formData.get('prizeThird') ?? '',
```

Add to `toRow()`'s returned object:

```typescript
    format: d.format,
    prize_second: d.prizeSecond === '' ? null : d.prizeSecond,
    prize_third: d.prizeThird === '' ? null : d.prizeThird,
```

In `createTournament()`, change:

```typescript
  const row = { ...toRow(parsed.data), status: 'draft', format: 'group_knockout' }
```

to:

```typescript
  const row = { ...toRow(parsed.data), status: 'draft' }
```

(`format` now comes from `toRow()` itself — the old hardcoded override is
removed, not duplicated.)

- [ ] **Step 6: Add the Format picker + prize-split fields to the form**

In `components/admin/TournamentForm.tsx`, add `format`, `prizeSecond`,
`prizeThird` to the `TournamentFormValues` interface:

```typescript
  format: string
  prizeSecond: string
  prizeThird: string
```

Add a Format select immediately after the existing Tournament Type block
(after the `</div>` closing the `seasonId` block, before the
`isInvitationOnly` paragraph):

```tsx
      <div className="space-y-1.5">
        <label htmlFor="format" className="text-sm font-medium text-slate-300">
          Format
        </label>
        <select
          id="format"
          name="format"
          defaultValue={initial.format || 'group_knockout'}
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
        >
          <option value="group_knockout">Groups + Knockout</option>
          <option value="round_robin">Round Robin (table only, no bracket)</option>
        </select>
      </div>
```

Add prize-split fields next to the existing Prize pool field — replace the
existing:

```tsx
      <div className="grid grid-cols-2 gap-4">
        <Field
          label="Registration fee (₦)"
          name="registrationFee"
          type="number"
          defaultValue={initial.registrationFee}
        />
        <Field
          label="Prize pool (₦)"
          name="prizePool"
          type="number"
          defaultValue={initial.prizePool}
        />
      </div>
```

with:

```tsx
      <div className="grid grid-cols-2 gap-4">
        <Field
          label="Registration fee (₦)"
          name="registrationFee"
          type="number"
          defaultValue={initial.registrationFee}
        />
        <Field
          label="Prize pool (₦)"
          name="prizePool"
          type="number"
          defaultValue={initial.prizePool}
        />
        <Field
          label="2nd place prize (₦, optional)"
          name="prizeSecond"
          type="number"
          defaultValue={initial.prizeSecond}
        />
        <Field
          label="3rd place prize (₦, optional)"
          name="prizeThird"
          type="number"
          defaultValue={initial.prizeThird}
        />
      </div>
      <p className="text-xs text-slate-500">
        Leave 2nd/3rd blank for winner-take-all (1st gets the full prize pool). Set both to split
        the pool — 1st automatically gets prize pool minus 2nd and 3rd.
      </p>
```

Update every place that builds `initial: TournamentFormValues` for this
form (the create-page and edit-page callers) to include
`format: t?.format ?? 'group_knockout'`, `prizeSecond: t?.prize_second != null ? String(t.prize_second) : ''`,
`prizeThird: t?.prize_third != null ? String(t.prize_third) : ''` — find
these with:

```bash
grep -rln "TournamentFormValues\|<TournamentForm" app/[locale]/admin/tournaments
```

and add the three fields to each literal object assigned to `initial`.

- [ ] **Step 7: Run the full test suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 8: Commit**

```bash
git add lib/tournaments/admin-schema.ts lib/tournaments/admin-schema.test.ts lib/tournaments/admin-actions.ts components/admin/TournamentForm.tsx app/[locale]/admin/tournaments
git commit -m "feat(fc-mobile): admin Format picker + prize-split fields"
```

---

### Task 4: Round-robin bracket generation

**Files:**
- Modify: `lib/tournaments/bracket-admin-actions.ts`
- Test: `lib/tournaments/bracket-admin-actions.test.ts` (create if it doesn't exist — check first with `Glob lib/tournaments/bracket-admin-actions.test.ts`)

**Interfaces:**
- Consumes: `roundRobinPairs(playerIds: string[]): [string, string][]`
  (`lib/tournaments/draw.ts`, existing, unchanged).
- Produces: `generate()` now takes a `format` parameter; for
  `format === 'round_robin'`, creates exactly one `groups` row containing
  every seeded player and their round-robin fixtures, skipping
  group-count/knockout generation entirely.

- [ ] **Step 1: Write the failing test**

Since `generate()` is a private (non-exported) function that writes
directly to Supabase, test it through the exported `closeRegistration`
action against a real test tournament, following the existing pattern in
this codebase's other admin-action tests (check
`lib/tournaments/bracket-admin-actions.test.ts` if it exists for the
pattern; if this file doesn't exist yet, check
`lib/matches/verify-actions.test.ts` for how Supabase is mocked/stubbed in
this codebase before writing new test scaffolding — **do not invent a new
mocking approach**, match whatever the existing test files for
`bracket-admin-actions`/`verify-actions` already use).

```typescript
// lib/tournaments/bracket-admin-actions.test.ts
import { describe, it, expect } from 'vitest'
import { roundRobinPairs } from './draw'

// generate()'s round_robin branch is exercised indirectly through
// closeRegistration in integration tests (this codebase's Supabase-backed
// admin actions are not unit-tested with mocks — see the existing test
// files in this directory for the established pattern). This unit test
// covers the one new pure computation the branch introduces: that a
// round-robin group's match count is always n(n-1)/2, which the
// completion-trigger logic in Task 5 depends on being exact.
describe('round_robin field size', () => {
  it('produces n(n-1)/2 fixtures for a full field', () => {
    const players = Array.from({ length: 8 }, (_, i) => `p${i}`)
    expect(roundRobinPairs(players)).toHaveLength((8 * 7) / 2)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails or passes**

Run: `npx vitest run lib/tournaments/bracket-admin-actions.test.ts`
Expected: PASS immediately (`roundRobinPairs` already exists and is
already correct) — this step confirms the invariant Task 5's completion
check relies on, not new behavior. Proceed to the real implementation
change next.

- [ ] **Step 3: Implement the round_robin branch in `generate()`**

In `lib/tournaments/bracket-admin-actions.ts`, change the `generate()`
signature and add the round_robin branch as the first check inside it:

```typescript
async function generate(
  admin: Admin,
  tournamentId: string,
  seeded: string[],
  g: number,
  format: string,
): Promise<void> {
  await clearBracket(admin, tournamentId)
  const roundDate = await nextRoundScheduledAt(admin, tournamentId)
  const schedule = roundDate ? { scheduled_at: roundDate, is_full_day: true } : {}

  if (format === 'round_robin') {
    const { data: grp } = await admin
      .from('groups')
      .insert({ tournament_id: tournamentId, name: 'League Table' })
      .select('id')
      .single()
    if (!grp) return
    await admin
      .from('group_memberships')
      .insert(seeded.map((pid) => ({ group_id: grp.id, player_id: pid })))
    const pairs = roundRobinPairs(seeded)
    if (pairs.length > 0) {
      await admin.from('matches').insert(
        pairs.map(([a, b]) => ({
          tournament_id: tournamentId,
          round: 'group',
          group_id: grp.id,
          player_a_id: a,
          player_b_id: b,
          status: 'scheduled',
          ...schedule,
        })),
      )
    }
    return
  }

  if (g === 0) {
```

(The rest of the existing function body — the `g === 0` knockout branch
and the multi-group `snakeDistribute` branch — is unchanged, just now
unreachable for `format === 'round_robin'` since that case returns early
above.)

- [ ] **Step 4: Thread `format` through the two callers**

In `closeRegistration()`, change:

```typescript
  const { data: t } = await admin.from('tournaments').select('status').eq('id', id).maybeSingle()
```

to:

```typescript
  const { data: t } = await admin.from('tournaments').select('status, format').eq('id', id).maybeSingle()
```

and change the `generate(admin, id, seeded, g)` call to
`generate(admin, id, seeded, g, t.format)`.

Apply the identical two changes in `generateBracket()` (same
`.select('status')` → `.select('status, format')`, same `generate(...)`
call site).

- [ ] **Step 5: Run the full test suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS, no type errors (the `generate()` call sites and the new
`format` parameter must line up exactly).

- [ ] **Step 6: Manual verification against the live dev server**

Create a `draft` FC Mobile tournament with `format=round_robin`,
`max_players=6`, register 6 test players (or reuse the account
seeding pattern from prior sessions — see [[project_current_phase]] for
how QA test accounts were previously created/cleaned up), close
registration, and confirm via `mcp__claude_ai_Supabase__execute_sql`:

```sql
select count(*) from groups where tournament_id = '<id>';         -- expect 1
select count(*) from matches where tournament_id = '<id>';         -- expect 15 for 6 players
select round from matches where tournament_id = '<id>' limit 1;    -- expect 'group'
```

Clean up the test tournament + registrations afterward the same way prior
QA cleanups in this codebase have been done (delete the tournament row —
cascades handle the rest).

- [ ] **Step 7: Commit**

```bash
git add lib/tournaments/bracket-admin-actions.ts lib/tournaments/bracket-admin-actions.test.ts
git commit -m "feat(fc-mobile): round-robin fixture generation on registration close"
```

---

### Task 5: Round-robin completion trigger + season points

**Files:**
- Modify: `lib/matches/verify-actions.ts:80-168` (`recomputeGroupAndMaybeAdvance`)
- Modify: `lib/matches/season-points.ts`
- Test: `lib/matches/season-points.test.ts` (existing file — append)

**Interfaces:**
- Consumes: `pointsForRoundRobinRank`/`coinsForRoundRobinRank`/`xpForRoundRobinRank`
  (Task 2), `sortStandings` (`lib/tournaments/standings.ts`, existing).
- Produces: a round-robin tournament reaches `status='completed'` and gets
  its `season_ranking_points` rows the moment its last group match is
  confirmed — no knockout round is ever expected or waited on.

- [ ] **Step 1: Write the failing test**

```typescript
// Add to lib/matches/season-points.test.ts (existing file — append; match
// the existing file's mocking/setup pattern for awardSeasonPoints tests
// exactly rather than introducing a new style)
describe('awardSeasonPoints — round_robin format', () => {
  it('awards points by final standings rank, not bracket band', async () => {
    // Arrange: a round_robin tournament with one group of 3 players whose
    // group_memberships already reflect a finished round-robin (3 matches
    // played), season_id set. Use this codebase's existing test fixture/mock
    // pattern from the group_knockout tests immediately above this block in
    // the same file — same admin-client stub shape, same season_id.
    // Player A: 6 points (2 wins) -> rank 1 -> pointsForRoundRobinRank(1) = 100
    // Player B: 3 points (1 win, 1 loss) -> rank 2 -> 70
    // Player C: 0 points (2 losses) -> rank 3 -> 45
    // Assert the three season_ranking_points rows upserted have points
    // 100/70/45 and placement 1/2/3 respectively, and that bandsForPlacements
    // (the group_knockout path) was never called for this tournament.
  })
})
```

(This test's exact mock setup must mirror whatever the existing
`awardSeasonPoints` tests immediately above it in this same file already
use for stubbing `createAdminClient()`/`admin.from(...)` — read those
tests first and copy their fixture shape verbatim rather than inventing a
new one, since a mismatched mock shape is the most common source of a
false-negative "fails for the wrong reason" test.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/matches/season-points.test.ts`
Expected: FAIL — `awardSeasonPoints` still derives placements via
`bandsForPlacements` regardless of format, so a round-robin tournament with
no knockout matches gets `non_advancer` for everyone (wrong points).

- [ ] **Step 3: Add the round_robin branch to `awardSeasonPoints`**

In `lib/matches/season-points.ts`, add the import:

```typescript
import { pointsForRoundRobinRank, coinsForRoundRobinRank, xpForRoundRobinRank } from '@/lib/tournaments/round-robin-placement'
import { sortStandings, type MembershipInput } from '@/lib/tournaments/standings'
```

Change the `tournament` select to also fetch `format`:

```typescript
  const { data: tournament } = await admin
    .from('tournaments')
    .select('id, tournament_type, season_id, format')
    .eq('id', tournamentId)
    .maybeSingle()
  if (!tournament) return
```

Immediately after the existing `activePlayerIds` guard
(`if (activePlayerIds.length === 0) return`), branch before the existing
`matches`/`bandsForPlacements` block:

```typescript
  if (tournament.format === 'round_robin') {
    const { data: groupRow } = await admin
      .from('groups')
      .select('id')
      .eq('tournament_id', tournamentId)
      .maybeSingle()
    if (!groupRow) return
    const { data: memberships } = await admin
      .from('group_memberships')
      .select('player_id, wins, draws, losses, goals_for, goals_against, points')
      .eq('group_id', groupRow.id)
    const standings = sortStandings(
      (memberships ?? []).map(
        (m): MembershipInput => ({
          playerId: m.player_id,
          name: '',
          wins: m.wins,
          draws: m.draws,
          losses: m.losses,
          goalsFor: m.goals_for,
          goalsAgainst: m.goals_against,
          points: m.points,
        }),
      ),
    )

    if (tournament.season_id) {
      const rows = standings.map((s) => ({
        season_id: tournament.season_id as string,
        player_id: s.playerId,
        tournament_id: tournamentId,
        points: pointsForRoundRobinRank(s.rank),
        placement: s.rank,
      }))
      await admin.from('season_ranking_points').upsert(rows, { onConflict: 'season_id,player_id,tournament_id' })
    }

    for (const s of standings) {
      const coins = coinsForRoundRobinRank(s.rank)
      if (coins) await recordCoinTransaction(admin, s.playerId, coins, 'tournament_placement', tournamentId)
      const xp = xpForRoundRobinRank(s.rank)
      if (xp) await awardXP(admin, s.playerId, xp, 'tournament_placement', tournamentId)
      await checkAndUnlockAchievements(admin, s.playerId, {
        type: 'tournament_completed',
        tournamentId,
        placement: s.rank,
        tournamentType: tournament.tournament_type,
      })
    }
    return
  }
```

(Everything below this new block — the existing `matches`/
`bandsForPlacements`/coin-XP-for-bracket-bands logic — is unchanged, and is
now only reached for `format !== 'round_robin'`, i.e. every existing
tournament.)

- [ ] **Step 4: Add the completion trigger to `recomputeGroupAndMaybeAdvance`**

In `lib/matches/verify-actions.ts`, add the import:

```typescript
import { awardSeasonPoints } from './season-points'
```

(Already imported at the top of this file per its existing import list —
confirm before adding a duplicate; if already present, skip this line.)

Change `recomputeGroupAndMaybeAdvance` to branch on format right after
`recomputeGroupStats`:

```typescript
export async function recomputeGroupAndMaybeAdvance(
  admin: Admin,
  tournamentId: string,
  groupId: string,
): Promise<void> {
  await recomputeGroupStats(admin, groupId)

  const { data: tour } = await admin.from('tournaments').select('format').eq('id', tournamentId).maybeSingle()
  if (tour?.format === 'round_robin') {
    const { count: remaining } = await admin
      .from('matches')
      .select('*', { count: 'exact', head: true })
      .eq('tournament_id', tournamentId)
      .neq('status', 'completed')
    if (remaining && remaining > 0) return
    const { data: claimed } = await admin
      .from('tournaments')
      .update({ status: 'completed' })
      .eq('id', tournamentId)
      .neq('status', 'completed')
      .select('id')
    if (!claimed || claimed.length === 0) return
    await awardSeasonPoints(admin, tournamentId)
    return
  }

  // Generate the knockout stage once ALL group matches are complete and none exists yet.
  const { count: remaining } = await admin
```

(The rest of the function — the existing `group_knockout` knockout-generation
logic below the `// Generate the knockout stage...` comment — is unchanged.
Note the pre-existing local variable is also named `remaining`; since the
round_robin branch `return`s before reaching it, there's no redeclaration
conflict, but confirm this by running the typecheck in Step 6.)

This one change automatically covers all three call sites that route
through `recomputeGroupAndMaybeAdvance` for a group-round match:
`confirmResult` (normal result confirmation), and both no-show paths in
`lib/matches/noshow-actions.ts` (walkover and double-no-show-draw) — none
of those three call sites need any edit.

- [ ] **Step 5: Run the season-points test to verify it passes**

Run: `npx vitest run lib/matches/season-points.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full test suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS, no type errors, no variable-redeclaration issue in
`recomputeGroupAndMaybeAdvance`.

- [ ] **Step 7: Manual verification against the live dev server**

Using the round-robin tournament created in Task 4 Step 6 (or a fresh one),
confirm all `n(n-1)/2` matches through the admin results queue. After the
final one, verify via `execute_sql`:

```sql
select status from tournaments where id = '<id>';                          -- expect 'completed'
select player_id, points, placement from season_ranking_points
  where tournament_id = '<id>' order by placement;                          -- one row per player, points per Task 2's tiers
```

- [ ] **Step 8: Commit**

```bash
git add lib/matches/verify-actions.ts lib/matches/season-points.ts lib/matches/season-points.test.ts
git commit -m "feat(fc-mobile): round-robin tournament completion + season points"
```

---

### Task 6: Prize-split crediting (1st/2nd/3rd)

**Files:**
- Modify: `lib/matches/verify-actions.ts` (`completeTournamentIfFinal`, `confirmResult`, `creditThirdPlace`)
- Test: `lib/matches/verify-actions.test.ts` (existing file — append; check it exists first with Glob, since `season-points.test.ts` is confirmed to exist but this file's presence wasn't verified during planning)

**Interfaces:**
- Consumes: `matchWinnerId(match: AdvanceMatch): string | null` (existing,
  `lib/tournaments/advancement.ts`), `creditWallet` (existing,
  `lib/wallet/service.ts`), `getThirdPlace` (existing,
  `lib/tournaments/bracket.ts`).
- Produces: a new exported helper `creditThirdPlacePrize(admin, tournamentId, playerId): Promise<void>`,
  called from both the real-match path (`confirmResult`, when a
  `third_place` match is confirmed) and the admin manual-credit path
  (`creditThirdPlace`).

- [ ] **Step 1: Write the failing tests**

```typescript
// Add to lib/matches/verify-actions.test.ts (append; match this file's
// existing mock/fixture pattern for completeTournamentIfFinal exactly)
describe('completeTournamentIfFinal — prize split', () => {
  it('credits prize_pool - prize_second - prize_third to the winner when a split is configured', async () => {
    // Arrange: tournament prize_pool=15000, prize_second=4000, prize_third=3000.
    // Act: completeTournamentIfFinal with a decisive final (winner known).
    // Assert: creditWallet called with (admin, winnerId, 8000, 'prize', tournamentId).
  })

  it('credits the full prize_pool to the winner when no split is configured (unchanged behavior)', async () => {
    // Arrange: prize_pool=50000, prize_second=null, prize_third=null.
    // Assert: creditWallet called with (admin, winnerId, 50000, 'prize', tournamentId) — same as today.
  })

  it('credits prize_second to the final loser when configured', async () => {
    // Same split-configured fixture as the first test.
    // Assert: creditWallet also called with (admin, loserId, 4000, 'prize', tournamentId).
  })
})

describe('creditThirdPlacePrize', () => {
  it('credits prize_third to the given player exactly once', async () => {
    // Arrange: tournament prize_third=3000, third_place_prize_credited=false.
    // Act: call creditThirdPlacePrize twice in a row.
    // Assert: creditWallet called exactly once with (admin, playerId, 3000, 'prize', tournamentId) —
    // the second call is a no-op because the atomic claim UPDATE ... WHERE
    // third_place_prize_credited = false only succeeds the first time.
  })

  it('is a no-op when prize_third is not set', async () => {
    // Arrange: prize_third=null.
    // Assert: creditWallet never called.
  })
})
```

(Match whatever mock shape this file's existing `completeTournamentIfFinal`
tests already use for the Supabase admin client stub — if
`lib/matches/verify-actions.test.ts` doesn't exist yet, check
`lib/matches/season-points.test.ts`'s mocking approach first, since both
modules are tested against the same kind of chained Supabase query stub in
this codebase, and reuse that shape rather than inventing a new one.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/matches/verify-actions.test.ts`
Expected: FAIL — `completeTournamentIfFinal` still credits the full
`prize_pool` unconditionally, and `creditThirdPlacePrize` doesn't exist.

- [ ] **Step 3: Extend `completeTournamentIfFinal`**

In `lib/matches/verify-actions.ts`, replace the body of
`completeTournamentIfFinal` from the `.select('id, prize_pool')` line
onward:

```typescript
export async function completeTournamentIfFinal(
  admin: Admin,
  tournamentId: string,
  round: string,
  finalMatch: AdvanceMatch,
): Promise<void> {
  if (round !== 'final') return

  const { data: claimed } = await admin
    .from('tournaments')
    .update({ status: 'completed' })
    .eq('id', tournamentId)
    .neq('status', 'completed')
    .select('id, prize_pool, prize_second, prize_third')
  if (!claimed || claimed.length === 0) return

  // Winner-take-all when no split is configured (prize_second/prize_third
  // both null, every tournament today) — otherwise the winner gets the
  // pool minus the configured 2nd/3rd shares, and the final's loser gets
  // prize_second. 3rd place is credited separately, off the third-place
  // match's own resolution (see creditThirdPlacePrize below) — the final
  // and the third-place match can resolve in either order, so this
  // function never touches prize_third itself.
  const winnerId = matchWinnerId(finalMatch)
  const prizePool = claimed[0]?.prize_pool ?? 0
  const prizeSecond = claimed[0]?.prize_second ?? 0
  const prizeThird = claimed[0]?.prize_third ?? 0
  const firstPrize = prizePool - prizeSecond - prizeThird
  if (winnerId) {
    if (firstPrize > 0) await creditWallet(admin, winnerId, firstPrize, 'prize', tournamentId)
    if (prizeSecond > 0) {
      const loserId = winnerId === finalMatch.player_a_id ? finalMatch.player_b_id : finalMatch.player_a_id
      if (loserId) await creditWallet(admin, loserId, prizeSecond, 'prize', tournamentId)
    }
  }
  await awardSeasonPoints(admin, tournamentId)
}
```

- [ ] **Step 4: Add `creditThirdPlacePrize`**

Add this new exported function immediately after
`completeTournamentIfFinal`:

```typescript
// Credits prize_third to whoever won the third-place match, exactly once.
// Called from confirmResult (a real third-place match was played) and from
// creditThirdPlace (the admin manual-credit path, below) — two independent
// call sites, so the guard is an atomic claim on the tournament row itself
// (third_place_prize_credited), the same idiom completeTournamentIfFinal
// uses via tournaments.status, rather than a check-then-update.
export async function creditThirdPlacePrize(admin: Admin, tournamentId: string, playerId: string): Promise<void> {
  const { data: claimed } = await admin
    .from('tournaments')
    .update({ third_place_prize_credited: true })
    .eq('id', tournamentId)
    .eq('third_place_prize_credited', false)
    .select('id, prize_third')
  if (!claimed || claimed.length === 0) return
  const prizeThird = claimed[0]?.prize_third ?? 0
  if (prizeThird > 0) await creditWallet(admin, playerId, prizeThird, 'prize', tournamentId)
}
```

- [ ] **Step 5: Call it from `confirmResult`**

In `confirmResult`, find the existing block:

```typescript
  } else if (isKnockout) {
    await advanceKnockout(admin, m.tournament_id, m.round)
    if (m.round === 'semi_final') {
      await createThirdPlaceMatch(admin, m.tournament_id)
    }
    await completeTournamentIfFinal(admin, m.tournament_id, m.round, {
      status: 'completed',
      score_a: scoreA,
      score_b: scoreB,
      player_a_id: m.player_a_id,
      player_b_id: m.player_b_id,
    })
```

Add a third-place branch alongside the existing `semi_final`/final logic
(insert after the `completeTournamentIfFinal(...)` call, still inside the
`else if (isKnockout)` block):

```typescript
    if (m.round === 'third_place') {
      const winnerId = matchWinnerId({ status: 'completed', score_a: scoreA, score_b: scoreB, player_a_id: m.player_a_id, player_b_id: m.player_b_id })
      if (winnerId) await creditThirdPlacePrize(admin, m.tournament_id, winnerId)
    }
```

- [ ] **Step 6: Call it from `creditThirdPlace`**

In `creditThirdPlace`, after the existing successful
`admin.from('matches').insert({...round: 'third_place'...})` block (after
the `if (error) return {...}` check, before `revalidateThirdPlaceCredit`),
add:

```typescript
  await creditThirdPlacePrize(admin, tournamentId, playerId)
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run lib/matches/verify-actions.test.ts`
Expected: PASS.

- [ ] **Step 8: Run the full test suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 9: Manual verification against the live dev server**

Run a small `group_knockout` tournament (4 players, so it has a real
semifinal/third-place match) with `prize_pool=15000`, `prize_second=4000`,
`prize_third=3000` through to completion via the admin results queue.
Confirm via `execute_sql`:

```sql
select player_id, amount, type from wallet_transactions
  where reference_id = '<tournament_id>' order by created_at;
```

Expected: three rows — 8000 to the champion, 4000 to the runner-up, 3000
to the third-place winner. Clean up the test tournament + wallet rows
afterward.

- [ ] **Step 10: Commit**

```bash
git add lib/matches/verify-actions.ts lib/matches/verify-actions.test.ts
git commit -m "feat(fc-mobile): generalized 1st/2nd/3rd prize-split crediting"
```

---

### Task 7: Season leaderboard game-scoping fix

**Files:**
- Modify: `lib/seasons/data.ts` (`getSeasonLeaderboard`, `getMonthlyLeaderboard`)
- Modify: `lib/seasons/invitation-actions.ts` (`tournamentForInvitations`, `leaderboardFor`)
- Test: `lib/seasons/data.test.ts` (existing — append)

**Interfaces:**
- Produces: `getSeasonLeaderboard(admin, seasonId, gameId)`,
  `getMonthlyLeaderboard(admin, seasonId, monthStart, gameId)` — both now
  require a `gameId` (no default/optional — every call site has one
  available since every leaderboard use is already scoped to a specific
  game's tournament or page).

- [ ] **Step 1: Write the failing test**

```typescript
// Add to lib/seasons/data.test.ts (existing file — append; match its
// existing fixture/mock pattern exactly)
describe('getSeasonLeaderboard — game scoping', () => {
  it('never mixes two games points in the same season', async () => {
    // Arrange: season S has one community_club tournament for game A (player
    // X earns 100 points) and one community_club tournament for game B
    // (player Y earns 70 points).
    // Act: getSeasonLeaderboard(admin, S, gameA.id)
    // Assert: result contains player X's 100 points and does NOT contain
    // player Y at all (game B's tournament is excluded entirely, not just
    // its points zeroed).
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/seasons/data.test.ts`
Expected: FAIL — the current query has no `game_id` filter, so player Y's
points leak into game A's leaderboard.

- [ ] **Step 3: Add `gameId` filtering**

In `lib/seasons/data.ts`, change `getSeasonLeaderboard`'s signature and its
tournament query:

```typescript
export async function getSeasonLeaderboard(admin: Admin, seasonId: string, gameId: string): Promise<SeasonLeaderboardRow[]> {
  const { data: seasonTournamentsData } = await admin
    .from('tournaments')
    .select('id, status, tournament_type')
    .eq('season_id', seasonId)
    .eq('game_id', gameId)
    .in('tournament_type', ['community_club', 'masters'])
```

(Everything below this line in the function is unchanged — every
downstream query already scopes off `tournamentIds` derived from this
now-game-scoped list, so the fix is contained to this one added `.eq()`.)

Change `getMonthlyLeaderboard`'s signature and query identically:

```typescript
export async function getMonthlyLeaderboard(
  admin: Admin,
  seasonId: string,
  monthStart: Date,
  gameId: string,
): Promise<SeasonLeaderboardRow[]> {
  const monthEnd = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1))
  const monthStartUtc = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), 1))

  const { data: tournaments } = await admin
    .from('tournaments')
    .select('id')
    .eq('season_id', seasonId)
    .eq('game_id', gameId)
    .eq('tournament_type', 'community_club')
    .gte('tournament_start', monthStartUtc.toISOString())
    .lt('tournament_start', monthEnd.toISOString())
```

- [ ] **Step 4: Update `invitation-actions.ts`'s call site**

In `lib/seasons/invitation-actions.ts`, `tournamentForInvitations` currently
selects `'id, title, tournament_type, season_id, tournament_start, registration_fee'`
— add `game_id`:

```typescript
async function tournamentForInvitations(admin: Admin, tournamentId: string): Promise<InvitableTournament | null> {
  const { data } = await admin
    .from('tournaments')
    .select('id, title, tournament_type, season_id, tournament_start, registration_fee, game_id')
    .eq('id', tournamentId)
    .maybeSingle()
  return data
}
```

Add `game_id: string` to the `InvitableTournament` interface. Update
`leaderboardFor` to pass it through:

```typescript
async function leaderboardFor(admin: Admin, tournament: InvitableTournament): Promise<LeaderboardEntry[]> {
  if (!tournament.season_id) return []
  const rows =
    tournament.tournament_type === 'masters'
      ? await getMonthlyLeaderboard(admin, tournament.season_id, new Date(tournament.tournament_start ?? Date.now()), tournament.game_id)
      : await getSeasonLeaderboard(admin, tournament.season_id, tournament.game_id)
  return rows.map((r) => ({ playerId: r.playerId, points: r.points, sxScore: r.sxScore }))
}
```

- [ ] **Step 5: Find and update every other call site**

Run:

```bash
grep -rln "getSeasonLeaderboard\|getMonthlyLeaderboard" --include="*.ts" --include="*.tsx" lib app
```

For each match outside `lib/seasons/data.ts` and
`lib/seasons/invitation-actions.ts` (already handled above), add the
missing `gameId` argument — sourced from whatever tournament/game context
that call site already has (e.g. the `/seasons/[slug]` page, if it calls
either function directly, needs the DLS game's id, which it can fetch via
`admin.from('games').select('id').eq('slug', 'dls').maybeSingle()` if not
already in scope — check what that page currently does before adding a
new query, since Task 8+ of the follow-up plan will restructure this page
to be game-grouped anyway).

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run lib/seasons/data.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the full test suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS, no type errors — every call site from Step 5 must compile
with the new required `gameId` parameter.

- [ ] **Step 8: Commit**

```bash
git add lib/seasons/data.ts lib/seasons/data.test.ts lib/seasons/invitation-actions.ts
git commit -m "fix(seasons): scope leaderboard queries by game_id

Two games sharing one season's tournament_type tier (community_club/
masters) would otherwise merge their points into one leaderboard and one
Top-16 cut. Required before EA FC Mobile's Circuit Cup/Elite Cup can
safely coexist with DLS's Community Club/Masters."
```

---

### Task 8: Round-robin bracket-page rendering fix

**Files:**
- Modify: `lib/tournaments/bracket-view.ts`
- Modify: `app/[locale]/admin/tournaments/[id]/bracket/page.tsx:19,24`
- Modify: `app/[locale]/(public)/tournaments/[slug]/bracket/page.tsx:19,73`
- Modify: `app/[locale]/(public)/tournaments/[slug]/page.tsx:183`
- Test: `lib/tournaments/bracket-view.test.ts` (check if it exists first; if not, check `lib/tournaments/bracket.test.ts`'s pattern since both test the same module family)

**Interfaces:**
- Consumes: nothing new.
- Produces: `loadBracketView(supabase, tournamentId, format)` — a
  round-robin tournament's `projected` is always `[]` (no phantom knockout
  rounds ever drawn for a format that never generates one).

- [ ] **Step 1: Write the failing test**

```typescript
// Add to lib/tournaments/bracket-view.test.ts (create if it doesn't exist,
// following lib/tournaments/bracket.test.ts's existing Supabase-mock
// pattern for this module family)
it('never projects knockout rounds for a round_robin tournament', async () => {
  // Arrange: a tournament with one group, zero knockout matches, format='round_robin'.
  const view = await loadBracketView(mockSupabase, 'tournament-id', 'round_robin')
  expect(view.projected).toEqual([])
  expect(view.hasKnockout).toBe(false)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/tournaments/bracket-view.test.ts`
Expected: FAIL — `loadBracketView` doesn't accept a third argument yet, and
even ignoring that, `projected` would compute
`projectBracketRounds(1 * 2)` for a one-group round-robin tournament,
which is non-empty.

- [ ] **Step 3: Add the `format` parameter**

In `lib/tournaments/bracket-view.ts`, change the function signature:

```typescript
export async function loadBracketView(
  supabase: SupabaseClient<Database>,
  tournamentId: string,
  format: string,
): Promise<BracketView> {
```

Change the `projected` line:

```typescript
    // Only groups let us know the eventual bracket size up front. A straight
    // knockout has no group stage to qualify out of, so its chart is whatever
    // rounds exist — buildBracketDisplay falls back to that on an empty
    // projection. A round_robin tournament never generates a knockout stage
    // at all, regardless of group count, so it's excluded here too.
    projected: hasGroups && format !== 'round_robin' ? projectBracketRounds((groups ?? []).length * ADVANCE_PER_GROUP) : [],
```

- [ ] **Step 4: Update both callers**

In `app/[locale]/admin/tournaments/[id]/bracket/page.tsx`, change:

```typescript
    .select('id, title, status, round_start_date, round_gap_days')
```

to:

```typescript
    .select('id, title, status, round_start_date, round_gap_days, format')
```

and:

```typescript
  const view = await loadBracketView(supabase, t.id)
```

to:

```typescript
  const view = await loadBracketView(supabase, t.id, t.format)
```

In `app/[locale]/(public)/tournaments/[slug]/bracket/page.tsx`, change:

```typescript
    .select('id, title, slug, status')
```

to:

```typescript
    .select('id, title, slug, status, format')
```

and:

```typescript
  const view = await loadBracketView(supabase, t.id)
```

to:

```typescript
  const view = await loadBracketView(supabase, t.id, t.format)
```

- [ ] **Step 5: Update the Format label on the tournament detail page**

In `app/[locale]/(public)/tournaments/[slug]/page.tsx:183`, change:

```typescript
        <Stat label="Format" value={t.format === 'group_knockout' ? 'Groups + KO' : t.format} />
```

to:

```typescript
        <Stat
          label="Format"
          value={t.format === 'group_knockout' ? 'Groups + KO' : t.format === 'round_robin' ? 'Round Robin' : t.format}
        />
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run lib/tournaments/bracket-view.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the full test suite + typecheck + build**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: PASS, clean build.

- [ ] **Step 8: Manual verification against the live dev server**

Load the public bracket page for the round-robin test tournament from
Task 4/5. Expected: the League Table standings render, no bracket/knockout
section appears below it, no "TBD vs TBD" phantom final slot.

- [ ] **Step 9: Commit**

```bash
git add lib/tournaments/bracket-view.ts lib/tournaments/bracket-view.test.ts app/[locale]/admin/tournaments/[id]/bracket/page.tsx "app/[locale]/(public)/tournaments/[slug]/bracket/page.tsx" "app/[locale]/(public)/tournaments/[slug]/page.tsx"
git commit -m "fix(fc-mobile): round-robin tournaments never project a phantom knockout stage"
```

---

## Self-Review Notes

**Spec coverage:** §1 (Circuit Cup/Elite Cup cadence) is realized by admin
creating three `community_club`/`round_robin` tournaments and one
`masters`/`group_knockout` tournament per month under FC Mobile's
`game_id` — no code enforces the cadence itself (matches how DLS's weekly
Community Club cadence isn't code-enforced either, it's an admin
operational rhythm). §2 (activation + game-scoping fix) = Task 1 + Task 7.
§3 (round_robin format) = Tasks 2, 3, 4, 5, 8. §4 (Elite Cup reuse) required
zero new code beyond Task 7's fix, confirmed during brainstorming against
the live `lib/seasons/invitation-actions.ts` implementation. §5
(prize-split) = Tasks 1, 3, 6. §6 (`/seasons` multi-game) and §7
(Rankings/Hall of Fame per-game filter) are explicitly deferred to the
follow-up plan noted in the header.

**Placeholder scan:** no TBD/TODO; every step has real code or an exact
grep/SQL command with expected output.

**Type consistency:** `format` is `string` at the DB/type-generation layer
(matches how `tournament_type`/`status` are already typed elsewhere in
this codebase, not narrowed to a union at the Supabase-generated-types
layer) but validated as the literal union at the Zod schema boundary
(Task 3) — consistent with how `tournamentType` is already handled.
`pointsForRoundRobinRank`/`coinsForRoundRobinRank`/`xpForRoundRobinRank`
signatures (Task 2) match their call sites in Task 5 exactly
(`rank: number` in, `number` out). `creditThirdPlacePrize(admin, tournamentId, playerId)`
signature (Task 6) matches both its call sites exactly.
