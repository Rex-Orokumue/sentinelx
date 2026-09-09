# Multi-Format Tournaments — Phase 4b: Results & Standings

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Score a points-race tournament. Players report their placement and kills, an admin confirms a whole lobby in one grid, points freeze onto the results, and stage standings decide who advances.

**Architecture:** Players self-report (mirroring the existing 1v1 flow), but the admin side is **one grid per lobby** — every entrant on a row with their submission pre-filled — confirmed in a single action, because 48 individual approvals per round is not an operation anyone will perform. Confirming freezes each row's points from the stage's `points_config` at that moment, so a later edit to the points table cannot rewrite rounds already played. Merging submissions into grid rows and deciding when a stage is finished are pure functions, tested without a database.

**Tech Stack:** Next.js 14 (App Router), TypeScript, Supabase, zod, vitest.

**Spec:** `docs/superpowers/specs/2026-09-09-multi-format-tournaments-design.md` (§5, §6, §7)

**Builds on:** phases 1–2, 3 and 4a — all shipped.

## Global Constraints

- **The `head_to_head` path must not change.** Nothing in this phase touches `submitMatchResult`, `verify-actions.ts` or the existing review queue. Existing tests stay green **unmodified**.
- **Existing suite: 204 files / 1447 tests** at the start of this phase. Known flake: `lib/auth/actions.test.ts` (2 tests, full-suite concurrency only, another workstream) — re-run that file alone before investigating.
- **`node_modules/.bin` is currently empty** in this checkout (a concurrent `npm install`). Run tools directly: `node node_modules/vitest/vitest.mjs run`, `node node_modules/typescript/bin/tsc --noEmit`, `node node_modules/next/dist/bin/next lint`. If `.bin` has been restored, the usual `npx` forms work again.
- **No migration in this phase.** Every table and column already exists.
- **Admin final say.** Validation flags contradictions; it never resolves them. Nothing auto-confirms.
- **Points freeze at confirm time** — write `placement_points` / `kill_points` onto each row from the stage's config as it stands then. Never recompute them on read.
- **Only confirmed results count.** Standings, advancement and stage completion all read `status = 'confirmed'` exclusively; a pending row is one player's unverified claim.
- **Deferred to phase 7:** SX Score events for lobby play (`lobby_completed`, `lobby_podium`, `lobby_no_show`) and prize credit. This phase produces standings, not economy.
- **Deferred to phase 5:** squads. Everything here is solo-entrant only, which is all `closeRegistration` creates today.

---

### Task 1: Lift stage standings into a plain module

Clears the debt noted in 4a: `stageStanding` currently lives inside a `'use server'` file where it cannot be exported, but both the actions and the pages need it.

**Files:**
- Create: `lib/tournaments/stage-standing.ts`
- Modify: `lib/tournaments/lobby-admin-actions.ts` (import it, delete the local copy)

**Interfaces:**
- Consumes: `sortPointsStandings`, `StageResultInput` (phase 2).
- Produces: `stageStanding(admin, stage): Promise<PointsStandingRow[]>` and `interface StageRef { id: string; advance_count: number }`.

- [ ] **Step 1: Move the function**

Create `lib/tournaments/stage-standing.ts` containing the `stageStanding` implementation currently in `lobby-admin-actions.ts`, exported, with its parameter narrowed to `StageRef` (it only ever reads `id` and `advance_count`):

```ts
import type { createAdminClient } from '@/lib/supabase/admin'
import { sortPointsStandings, type PointsStandingRow, type StageResultInput } from './points-standings'

type Admin = ReturnType<typeof createAdminClient>

/** Only the fields standings actually need, so callers can pass any stage row. */
export interface StageRef {
  id: string
  advance_count: number
}
```

Keep the existing body and its comment about confirmed-only results verbatim. This module has **no** `'use server'` directive, which is the whole point — it is a library function, not an action.

In `lobby-admin-actions.ts`, delete the local `stageStanding` (and the now-unused `sortPointsStandings` / `StageResultInput` / `PointsStandingRow` imports) and import it instead:

```ts
import { stageStanding } from './stage-standing'
```

- [ ] **Step 2: Verify and commit**

Run: `node node_modules/typescript/bin/tsc --noEmit` and `node node_modules/vitest/vitest.mjs run` — clean, count unchanged (pure move).

```bash
git add lib/tournaments/stage-standing.ts lib/tournaments/lobby-admin-actions.ts
git commit -m "refactor(tournaments): lift stage standings out of the actions module

Every export from a 'use server' file becomes a client-callable action, so this
could not be exported from where it was written — but phase 4b's results flow
and its pages both need it. A plain module is where it belonged."
```

---

### Task 2: Merging submissions into admin grid rows

**Files:**
- Create: `lib/tournaments/lobby-grid.ts`
- Test: `lib/tournaments/lobby-grid.test.ts`

**Interfaces:**
- Consumes: nothing at runtime (pure).
- Produces:
  - `interface GridEntrant { entrantId: string; displayName: string }`
  - `interface GridSubmission { entrantId: string; placement: number; kills: number; screenshotUrl: string | null; status: string }`
  - `interface LobbyGridRow { entrantId: string; displayName: string; placement: number | null; kills: number | null; screenshotUrl: string | null; submitted: boolean; status: string }`
  - `buildLobbyGrid(entrants: GridEntrant[], submissions: GridSubmission[]): LobbyGridRow[]`

- [ ] **Step 1: Write the failing test**

Create `lib/tournaments/lobby-grid.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildLobbyGrid } from './lobby-grid'

const entrants = [
  { entrantId: 'a', displayName: 'ShadowX' },
  { entrantId: 'b', displayName: 'Kelvin_G' },
  { entrantId: 'c', displayName: 'ZAYN' },
]

describe('buildLobbyGrid', () => {
  it('gives every entrant a row, submitted or not', () => {
    // The grid IS the lobby. An entrant missing from it cannot be scored, and
    // the admin would have no way to notice.
    const rows = buildLobbyGrid(entrants, [
      { entrantId: 'a', placement: 1, kills: 5, screenshotUrl: 's1', status: 'pending' },
    ])

    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.entrantId).sort()).toEqual(['a', 'b', 'c'])
  })

  it('pre-fills a submitted row', () => {
    const rows = buildLobbyGrid(entrants, [
      { entrantId: 'b', placement: 2, kills: 3, screenshotUrl: 's2', status: 'pending' },
    ])
    const row = rows.find((r) => r.entrantId === 'b')!

    expect(row).toMatchObject({
      placement: 2,
      kills: 3,
      screenshotUrl: 's2',
      submitted: true,
      status: 'pending',
    })
  })

  it('leaves an unsubmitted row blank rather than zeroed', () => {
    // Zeros would look like a real claim of 0 kills and be silently confirmed.
    // Null is the admin's cue that nobody reported.
    const rows = buildLobbyGrid(entrants, [])

    for (const row of rows) {
      expect(row.placement).toBeNull()
      expect(row.kills).toBeNull()
      expect(row.submitted).toBe(false)
    }
  })

  it('keeps entrant order stable', () => {
    // Rows must not jump around between renders as submissions arrive.
    const rows = buildLobbyGrid(entrants, [
      { entrantId: 'c', placement: 1, kills: 0, screenshotUrl: null, status: 'pending' },
    ])
    expect(rows.map((r) => r.entrantId)).toEqual(['a', 'b', 'c'])
  })

  it('ignores a submission from an entrant not in this lobby', () => {
    // Defensive: a stale row from a moved entrant must not add a phantom.
    const rows = buildLobbyGrid(entrants, [
      { entrantId: 'zzz', placement: 1, kills: 9, screenshotUrl: null, status: 'pending' },
    ])
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => !r.submitted)).toBe(true)
  })

  it('carries a disputed status through', () => {
    const rows = buildLobbyGrid(entrants, [
      { entrantId: 'a', placement: 1, kills: 2, screenshotUrl: null, status: 'disputed' },
    ])
    expect(rows.find((r) => r.entrantId === 'a')!.status).toBe('disputed')
  })

  it('reports no rows for an empty lobby', () => {
    expect(buildLobbyGrid([], [])).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run lib/tournaments/lobby-grid.test.ts`
Expected: FAIL — `Cannot find module './lobby-grid'`.

- [ ] **Step 3: Write the implementation**

Create `lib/tournaments/lobby-grid.ts`:

```ts
// The admin's lobby grid: every entrant on a row, their own submission
// pre-filled, blanks where nobody reported.
//
// One grid confirmed in one action, rather than one approval per player: a
// 48-entrant lobby would otherwise need 48 approvals per round, and a review
// queue nobody works is worse than no queue at all.
//
// Pure, because the rule that matters — every entrant gets a row whether or not
// they submitted — is invisible in a UI test and load-bearing: an entrant
// missing from the grid cannot be scored and the admin has no way to notice.

export interface GridEntrant {
  entrantId: string
  displayName: string
}

export interface GridSubmission {
  entrantId: string
  placement: number
  kills: number
  screenshotUrl: string | null
  status: string
}

export interface LobbyGridRow {
  entrantId: string
  displayName: string
  /** null means "nobody reported", never "reported zero". */
  placement: number | null
  kills: number | null
  screenshotUrl: string | null
  submitted: boolean
  status: string
}

export function buildLobbyGrid(
  entrants: GridEntrant[],
  submissions: GridSubmission[],
): LobbyGridRow[] {
  const byEntrant = new Map(submissions.map((s) => [s.entrantId, s]))

  // Entrant order drives the grid, not submission order — rows must not jump
  // around between renders as results arrive.
  return entrants.map((e) => {
    const s = byEntrant.get(e.entrantId)
    return {
      entrantId: e.entrantId,
      displayName: e.displayName,
      placement: s?.placement ?? null,
      kills: s?.kills ?? null,
      screenshotUrl: s?.screenshotUrl ?? null,
      submitted: s !== undefined,
      status: s?.status ?? 'pending',
    }
  })
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node node_modules/vitest/vitest.mjs run lib/tournaments/lobby-grid.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/tournaments/lobby-grid.ts lib/tournaments/lobby-grid.test.ts
git commit -m "feat(tournaments): merge lobby submissions into admin grid rows

Every entrant gets a row whether or not they submitted — an entrant missing
from the grid cannot be scored and the admin has no way to notice. An
unsubmitted row is blank, not zeroed: zeros would read as a real claim of no
kills and be confirmed silently."
```

---

### Task 3: Player submits a lobby result

**Files:**
- Create: `lib/tournaments/lobby-result-schema.ts`
- Create: `lib/tournaments/lobby-result-actions.ts`
- Test: `lib/tournaments/lobby-result-schema.test.ts`

**Interfaces:**
- Produces: `lobbyResultSchema`; server action `submitLobbyResult(prev, formData)`.

- [ ] **Step 1: Write the failing schema test**

Create `lib/tournaments/lobby-result-schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { lobbyResultSchema } from './lobby-result-schema'

const valid = { placement: '3', kills: '7' }

describe('lobbyResultSchema', () => {
  it('accepts a placement and kill count', () => {
    const r = lobbyResultSchema.safeParse(valid)
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.placement).toBe(3)
      expect(r.data.kills).toBe(7)
    }
  })

  it('accepts zero kills', () => {
    // Dying first with no kills is a real result, not a missing one.
    expect(lobbyResultSchema.safeParse({ placement: '12', kills: '0' }).success).toBe(true)
  })

  it('rejects a placement below 1', () => {
    // Placement is 1-indexed: 1 is the Booyah/WWCD. There is no 0th place.
    expect(lobbyResultSchema.safeParse({ ...valid, placement: '0' }).success).toBe(false)
  })

  it('rejects negative kills', () => {
    expect(lobbyResultSchema.safeParse({ ...valid, kills: '-1' }).success).toBe(false)
  })

  it('rejects non-integers', () => {
    expect(lobbyResultSchema.safeParse({ ...valid, placement: '2.5' }).success).toBe(false)
    expect(lobbyResultSchema.safeParse({ ...valid, kills: 'lots' }).success).toBe(false)
  })

  it('rejects absurd values that are almost certainly typos', () => {
    // 100 is the largest lobby the schema allows (stages_lobby_range), so a
    // placement above it cannot be real.
    expect(lobbyResultSchema.safeParse({ ...valid, placement: '500' }).success).toBe(false)
    expect(lobbyResultSchema.safeParse({ ...valid, kills: '500' }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails, then write the schema**

Run: `node node_modules/vitest/vitest.mjs run lib/tournaments/lobby-result-schema.test.ts` — expect FAIL.

Create `lib/tournaments/lobby-result-schema.ts`:

```ts
import { z } from 'zod'

// A player's own claim about one lobby. Bounds mirror what a lobby can
// physically produce: stages_lobby_range caps a lobby at 100 entrants, so a
// placement or kill count above that is a typo, not a result.
export const lobbyResultSchema = z.object({
  placement: z.coerce
    .number()
    .int('Placement must be a whole number')
    .min(1, 'Placement starts at 1')
    .max(100, 'Placement is too large'),
  kills: z.coerce
    .number()
    .int('Kills must be a whole number')
    .min(0, 'Kills cannot be negative')
    .max(100, 'That many kills is not possible'),
})

export type LobbyResultInput = z.infer<typeof lobbyResultSchema>
```

Run again — expect PASS, 6 tests.

- [ ] **Step 3: Write the submission action**

Create `lib/tournaments/lobby-result-actions.ts` with `'use server'`.

`submitLobbyResult(prev, formData)` reads `lobbyId` and `screenshotPath`, then:
1. `createClient()` + `getUser()`; refuse when signed out.
2. Resolve the caller's **entrant** for this lobby: join `lobby_entrants` → `tournament_entrants` on `player_id = user.id`. Refuse with "You are not in this lobby." when there is none — this is the authorisation check, and it must be a lookup rather than trusting any id from the form.
3. Refuse when the lobby's status is `confirmed` ("This lobby has been confirmed and can no longer be edited.").
4. Parse with `lobbyResultSchema`; return the first issue's message.
5. Require a screenshot: the new upload path, or an existing row's `screenshot_url`. Same rule as `submitMatchResult`.
6. Upsert `lobby_results` on `(lobby_id, entrant_id)` with `status: 'pending'`, `submitted_by: user.id`, and **`placement_points: 0, kill_points: 0`** — points are written at confirm time, not now.
7. Refuse to overwrite a row whose status is `confirmed`.
8. Move the lobby to `awaiting_results` if it is still `scheduled`.
9. Notify staff once per lobby — reuse `notifyStaff(admin, 'result_needs_review', …)` only on the lobby's **first** submission, so a 48-player lobby produces one alert rather than 48.
10. `revalidatePath` the player's lobby page and the admin lobbies page.

Screenshots upload client-side to the existing `match-evidence` bucket under `${user.id}/${lobbyId}/…`, exactly as `ResultSubmissionForm` already does.

- [ ] **Step 4: Verify and commit**

`tsc`, lint and the suite clean.

```bash
git add lib/tournaments/lobby-result-schema.ts lib/tournaments/lobby-result-schema.test.ts lib/tournaments/lobby-result-actions.ts
git commit -m "feat(tournaments): players submit their own lobby result

Authorisation is a lookup, never a form value: the caller's entrant is resolved
from lobby_entrants by their user id, so a player cannot submit as someone
else by editing a hidden input.

Points are deliberately written as zero here and filled at confirm time. A
submission is a claim, and a claim must not be able to move the standings.

Staff are alerted once per lobby, on its first submission — a 48-player lobby
must not produce 48 alerts."
```

---

### Task 4: Confirming a lobby

**Files:**
- Create: `lib/tournaments/lobby-confirm.ts`
- Test: `lib/tournaments/lobby-confirm.test.ts`
- Modify: `lib/tournaments/lobby-result-actions.ts` (add `confirmLobby`, `disputeLobbyResult`)

**Interfaces:**
- Consumes: `scoreLobbyResult`, `parsePointsConfig` (phase 2); `validateLobbyResults` (phase 2); `buildLobbyGrid` (Task 2).
- Produces:
  - `interface ConfirmRowInput { entrantId: string; placement: number; kills: number }`
  - `frozenResultRows(config, lobbyId, rows): { lobby_id; entrant_id; placement; kills; placement_points; kill_points; status: 'confirmed' }[]`
  - `stageIsComplete(roundsCount: number, lobbies: { roundNo: number; status: string }[]): boolean`

- [ ] **Step 1: Write the failing test**

Create `lib/tournaments/lobby-confirm.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { frozenResultRows, stageIsComplete } from './lobby-confirm'
import type { PointsConfig } from './points-config'

const ff: PointsConfig = { placement: [12, 9, 8, 7, 6, 5, 4, 3, 2, 1], perKill: 1 }

describe('frozenResultRows', () => {
  it('freezes points from the config at confirm time', () => {
    const rows = frozenResultRows(ff, 'lob1', [
      { entrantId: 'a', placement: 1, kills: 7 },
      { entrantId: 'b', placement: 11, kills: 2 },
    ])

    expect(rows[0]).toEqual({
      lobby_id: 'lob1',
      entrant_id: 'a',
      placement: 1,
      kills: 7,
      placement_points: 12,
      kill_points: 7,
      status: 'confirmed',
    })
    // Outside the table: no placement points, kills still count.
    expect(rows[1].placement_points).toBe(0)
    expect(rows[1].kill_points).toBe(2)
  })

  it('does not depend on the config after the fact', () => {
    // The whole reason points are stored rather than derived: editing a stage's
    // table must not rewrite rounds already played.
    const before = frozenResultRows(ff, 'lob1', [{ entrantId: 'a', placement: 1, kills: 0 }])
    const edited: PointsConfig = { placement: [99], perKill: 5 }
    const after = frozenResultRows(edited, 'lob1', [{ entrantId: 'a', placement: 1, kills: 0 }])

    expect(before[0].placement_points).toBe(12)
    expect(after[0].placement_points).toBe(99)
  })

  it('returns nothing for no rows', () => {
    expect(frozenResultRows(ff, 'lob1', [])).toEqual([])
  })
})

describe('stageIsComplete', () => {
  it('is complete when every round has been played and confirmed', () => {
    expect(
      stageIsComplete(2, [
        { roundNo: 1, status: 'confirmed' },
        { roundNo: 2, status: 'confirmed' },
      ]),
    ).toBe(true)
  })

  it('is not complete while a lobby is unconfirmed', () => {
    expect(
      stageIsComplete(2, [
        { roundNo: 1, status: 'confirmed' },
        { roundNo: 2, status: 'awaiting_results' },
      ]),
    ).toBe(false)
  })

  it('is not complete while rounds remain undrawn', () => {
    // Every drawn round is confirmed, but the stage is a 3-rounder and only 2
    // exist. Completing here would advance players a round early.
    expect(
      stageIsComplete(3, [
        { roundNo: 1, status: 'confirmed' },
        { roundNo: 2, status: 'confirmed' },
      ]),
    ).toBe(false)
  })

  it('counts distinct rounds, not lobbies', () => {
    expect(
      stageIsComplete(1, [
        { roundNo: 1, status: 'confirmed' },
        { roundNo: 1, status: 'confirmed' },
        { roundNo: 1, status: 'confirmed' },
      ]),
    ).toBe(true)
  })

  it('is not complete with no lobbies at all', () => {
    expect(stageIsComplete(1, [])).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails, then implement**

Create `lib/tournaments/lobby-confirm.ts`:

```ts
import { scoreLobbyResult, type PointsConfig } from './points-config'

export interface ConfirmRowInput {
  entrantId: string
  placement: number
  kills: number
}

export interface FrozenResultRow {
  lobby_id: string
  entrant_id: string
  placement: number
  kills: number
  placement_points: number
  kill_points: number
  status: 'confirmed'
}

// Points are written ONTO the row here and never recomputed on read. An admin
// editing a stage's points table afterwards must not silently rewrite the
// scoreboard of rounds already played.
export function frozenResultRows(
  config: PointsConfig,
  lobbyId: string,
  rows: ConfirmRowInput[],
): FrozenResultRow[] {
  return rows.map((r) => {
    const { placementPoints, killPoints } = scoreLobbyResult(config, r)
    return {
      lobby_id: lobbyId,
      entrant_id: r.entrantId,
      placement: r.placement,
      kills: r.kills,
      placement_points: placementPoints,
      kill_points: killPoints,
      status: 'confirmed' as const,
    }
  })
}

// A stage is finished only when all of its rounds have been DRAWN and all of
// their lobbies confirmed. Checking confirmations alone would complete a
// three-round stage after two, advancing players a round early.
export function stageIsComplete(
  roundsCount: number,
  lobbies: { roundNo: number; status: string }[],
): boolean {
  if (lobbies.length === 0) return false
  const rounds = new Set(lobbies.map((l) => l.roundNo))
  if (rounds.size < roundsCount) return false
  return lobbies.every((l) => l.status === 'confirmed')
}
```

Run — expect PASS, 8 tests.

- [ ] **Step 3: Add `confirmLobby` to `lobby-result-actions.ts`**

`confirmLobby(prev, formData)`:
1. `requireStaff()`; read `lobbyId`.
2. Load the lobby with its stage (`points_config`, `rounds_count`, `id`); refuse when already `confirmed`.
3. Read the grid rows out of the form: for each `entrantId`, a `placement_<id>` and `kills_<id>` field. Skip any entrant left blank and **refuse the whole confirm** if any entrant is blank — the admin must fill them, because a blank row would silently score zero.
4. Run `validateLobbyResults`; **refuse on any `error`-severity flag**, returning its message. This is the admin's own grid, so the flags they saw before pressing confirm are the ones enforced.
5. `parsePointsConfig(stage.points_config)`; fall back to the game default; refuse if neither parses.
6. Upsert `frozenResultRows(...)` on `(lobby_id, entrant_id)` with `verified_by: staff.userId`, `verified_at: now`.
7. Set the lobby to `confirmed`.
8. If `stageIsComplete(stage.rounds_count, allLobbiesOfStage)`, set the stage to `complete`.
9. `revalidatePath` the admin lobbies page, the stages page and the public tournament page.

`disputeLobbyResult(prev, formData)`: a player flags their own confirmed row — set that row's `status = 'disputed'` and `notifyStaff(admin, 'result_disputed', …)`. Refuse if the row is not theirs. The row keeps its frozen points until an admin re-confirms, so a dispute does not silently move the standings.

- [ ] **Step 4: Verify and commit**

```bash
git add lib/tournaments/lobby-confirm.ts lib/tournaments/lobby-confirm.test.ts lib/tournaments/lobby-result-actions.ts
git commit -m "feat(tournaments): confirm a lobby in one action

Points freeze onto each row from the stage config as it stands at confirm time.
Editing a stage's points table afterwards must not rewrite rounds already
played, which is why they are stored rather than derived.

A blank row refuses the whole confirm rather than scoring zero silently, and
any error-severity validation flag blocks it — the admin saw those flags before
pressing confirm.

A stage completes only when every round has been DRAWN and every lobby
confirmed; counting confirmations alone would finish a three-round stage after
two and advance players early."
```

---

### Task 5: The admin lobby grid

**Files:**
- Create: `components/admin/LobbyResultGrid.tsx`
- Create: `app/[locale]/admin/tournaments/[id]/lobbies/[lobbyId]/page.tsx`
- Modify: `components/admin/LobbyList.tsx` (link each lobby to its grid)

- [ ] **Step 1: Build the page and grid**

The page loads the lobby, its stage, its `lobby_entrants` joined to `tournament_entrants` for display names, and its `lobby_results`. It calls `buildLobbyGrid` and `validateLobbyResults`, and renders one form containing every row: display name, a placement input, a kills input, and a link to the submitted screenshot when there is one.

Flags render above the grid — errors red, warnings amber — each naming the entrants involved. The Confirm button is disabled while any error-severity flag stands, with the reason shown.

A confirmed lobby renders read-only with its frozen points per row, so an admin can see what was recorded.

- [ ] **Step 2: Link from the lobby list**

In `LobbyList.tsx`, make each lobby's header a link to `/admin/tournaments/[id]/lobbies/[lobbyId]`.

- [ ] **Step 3: Verify end to end against the live database**

With `tsc`, lint and the suite clean, run this rolled-back transaction proving the confirm path's data shape and the freeze:

```sql
do $$
declare gid uuid; tid uuid; sid uuid; lid uuid; pid uuid; eid uuid;
        pts int; outcome text;
begin
  select id into gid from public.games where slug = 'free-fire';

  insert into public.tournaments
    (game_id, title, slug, status, registration_fee, prize_pool, format,
     tournament_type, competition_format, entry_unit)
  values (gid, 'Repro Confirm', 'repro-confirm', 'registration_closed', 0, 0,
          'group_knockout', 'open', 'points_race', 'solo')
  returning id into tid;

  insert into public.tournament_stages
    (tournament_id, seq, name, rounds_count, lobby_size, advance_count, points_config, status)
  values (tid, 1, 'Finals', 1, 4, 1, '{"placement":[12,9,8,7],"per_kill":1}'::jsonb, 'live')
  returning id into sid;

  insert into public.tournament_lobbies (stage_id, round_no, label)
  values (sid, 1, 'A') returning id into lid;

  select id into pid from public.profiles where deleted_at is null limit 1;
  insert into public.tournament_entrants (tournament_id, kind, player_id, display_name)
  values (tid, 'solo', pid, 'Repro') returning id into eid;
  insert into public.lobby_entrants (lobby_id, entrant_id) values (lid, eid);

  -- What confirmLobby writes: frozen points, generated total.
  insert into public.lobby_results
    (lobby_id, entrant_id, placement, kills, placement_points, kill_points, status)
  values (lid, eid, 1, 7, 12, 7, 'confirmed');

  select total_points into pts from public.lobby_results where lobby_id = lid;
  outcome := format('total_points=%s (expected 19)', pts);

  -- One result per entrant per lobby.
  begin
    insert into public.lobby_results
      (lobby_id, entrant_id, placement, kills, placement_points, kill_points, status)
    values (lid, eid, 2, 0, 9, 0, 'confirmed');
    outcome := outcome || ' | FAIL: duplicate result accepted';
  exception when unique_violation then
    outcome := outcome || ' | duplicate result refused';
  end;

  -- Editing the stage config must NOT change a stored result.
  update public.tournament_stages
     set points_config = '{"placement":[99],"per_kill":9}'::jsonb where id = sid;
  select total_points into pts from public.lobby_results where lobby_id = lid;
  outcome := outcome || format(' | after config edit total_points=%s (must still be 19)', pts);

  raise exception 'ROLLBACK_OK >> %', outcome;
end $$;
```

Expected: `total_points=19 … | duplicate result refused | after config edit total_points=19`.

- [ ] **Step 4: Commit**

```bash
git add components/admin/LobbyResultGrid.tsx "app/[locale]/admin/tournaments/[id]/lobbies/[lobbyId]/page.tsx" components/admin/LobbyList.tsx
git commit -m "feat(admin): one grid per lobby, confirmed in one action

48 individual approvals per round is not an operation anyone performs, and a
review queue nobody works is worse than no queue. One grid, one confirm, the
same authority and the same audit trail — verified_by and verified_at are still
written per row.

Confirm is disabled with the reason shown while an error-severity flag stands,
rather than hidden."
```

---

### Task 6: Player-facing lobby page

**Files:**
- Create: `app/[locale]/lobbies/[id]/page.tsx`
- Create: `components/lobby/LobbyResultForm.tsx`
- Modify: `components/dashboard/NextMatchCard.tsx` *or* the dashboard page — surface a "Your next lobby" entry point.

- [ ] **Step 1: Build the player page**

The page shows the lobby's stage and round, the entrant's own row, the room ID and password **only to entrants of that lobby** (resolved server-side by the caller's entrant, never from a query param), the scheduled time, the stream URL when set, and the submission form.

`LobbyResultForm` mirrors `ResultSubmissionForm`: client-side upload to `match-evidence`, then the path is handed to `submitLobbyResult`. Placement and kills inputs, screenshot required, editable until the lobby is confirmed.

Once the lobby is confirmed, the form is replaced by the player's frozen result and a "Something wrong?" control bound to `disputeLobbyResult`.

- [ ] **Step 2: Surface it on the dashboard**

Add a card linking to the player's current lobby when they have one — an open lobby they are an entrant of, in a `live` stage. Without this the page is unreachable and the whole flow is dead.

- [ ] **Step 3: Verify**

`tsc`, lint, full suite clean. Then confirm manually in the app: a player in a lobby sees the room code, submits a placement and kills with a screenshot, and the admin grid shows that submission pre-filled.

- [ ] **Step 4: Commit**

```bash
git add "app/[locale]/lobbies/[id]/page.tsx" components/lobby/LobbyResultForm.tsx components/dashboard
git commit -m "feat(lobbies): player-facing lobby page with result submission

Room credentials are resolved from the caller's own entrant row, server-side —
never from a query param — so only players actually in the lobby can read them.

The dashboard card is what makes the page reachable at all; without it the
submission flow exists but nobody can find it."
```

---

## Self-Review

**Spec coverage (4b):**

| Spec section | Task |
|---|---|
| §7 player self-report | 3, 6 |
| §7 one grid per lobby, admin confirms | 2, 5 |
| §7 validation flags block confirm | 5 |
| §7 disputes reuse the existing queue | 4 |
| §5 points frozen at confirm | 4 |
| §6 standings from confirmed results only | 1, 4 |

**Placeholder scan:** Tasks 3, 5 and 6 specify behaviour, guards and ordering rather than every line — each is assembly over pure functions fully specified in Tasks 2 and 4, and the security-relevant decisions (entrant resolved by lookup, room credentials server-side only, blank rows refusing confirm) are stated explicitly. Tasks 1, 2 and 4 carry literal code.

**Type consistency:** `GridSubmission`/`LobbyGridRow` field names match `lobby_results` columns in camelCase. `frozenResultRows` returns snake_case rows matching the table exactly, minus `total_points` (generated). `stageStanding`'s `StageRef` needs only `id` and `advance_count`, so every existing stage row satisfies it.

**Known risk:** Task 4 refuses a confirm when any entrant's row is blank. For a lobby where someone genuinely never played, the admin must still enter something — a last placement and zero kills — which is the correct record of a no-show, and phase 7's `lobby_no_show` SX event will key off exactly that. If this proves annoying in practice, the fix is an explicit "mark as no-show" control, **not** silently scoring blanks as zero.
