# Multi-Format Tournaments — Phase 4a: Entrants & Lobbies

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a points-race tournament *playable* — closing registration creates entrants, opening a stage generates lobbies with room credentials, and finishing a round generates the next one re-seeded on live standings.

**Architecture:** `closeRegistration` forks on `competition_format`: head-to-head still generates a bracket (untouched), points-race instead creates one solo `tournament_entrants` row per paid registration. Stages are then opened one at a time; opening a stage generates round 1's lobbies via the existing `assignLobbies`, and each subsequent round is generated on an explicit admin action, seeded by that stage's running standings. Every decision about *who is in which lobby* is a pure function, tested without a database.

**Tech Stack:** Next.js 14 (App Router), TypeScript, Supabase, vitest.

**Spec:** `docs/superpowers/specs/2026-09-09-multi-format-tournaments-design.md` (§4.3, §5, §5.1)

**Builds on:** phases 1–2 (`...-foundation.md`) and phase 3 (`...-phase3-admin.md`), both shipped.

## Global Constraints

- **The `head_to_head` path must not change.** `closeRegistration` gains a fork, not a rewrite: for a football tournament every existing line runs in the same order with the same arguments. Existing tests stay green **unmodified**.
- **Existing suite: 200 files / 1411 tests.** The known flake is `lib/auth/actions.test.ts` (2 tests, full-suite concurrency only, another workstream) — re-run that file alone before investigating.
- **No migration in this phase.** Every table already exists from phases 1–2.
- **Admin final say:** nothing auto-advances a stage or auto-generates a round. Each is an explicit admin action.
- **Room credentials are not public.** `room_id` / `room_password` must never be selected on a public page — see the RLS note in migration `20260909092000`. Only admin pages read them in this phase.
- **Deferred to 4b:** result submission, the admin lobby grid, confirmation, standings recompute, disputes. This phase creates lobbies; nothing scores them yet.
- **Deferred to phase 5:** squad entrants. `createEntrantsForTournament` handles `entry_unit = 'solo'` only and refuses squad tournaments with a clear message, so a half-built squad path cannot be reached by accident.

---

### Task 1: Solo entrant rows from paid registrations

**Files:**
- Create: `lib/tournaments/entrants.ts`
- Test: `lib/tournaments/entrants.test.ts`

**Interfaces:**
- Consumes: nothing at runtime (pure).
- Produces:
  - `interface EntrantSeed { playerId: string; displayName: string }`
  - `soloEntrantRows(tournamentId: string, seeds: EntrantSeed[]): { tournament_id: string; kind: 'solo'; player_id: string; display_name: string; status: 'active' }[]`

- [ ] **Step 1: Write the failing test**

Create `lib/tournaments/entrants.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { soloEntrantRows } from './entrants'

const T = 'ffffffff-ffff-4fff-8fff-ffffffffffff'

describe('soloEntrantRows', () => {
  it('builds one active solo entrant per seed', () => {
    const rows = soloEntrantRows(T, [
      { playerId: 'p1', displayName: 'ShadowX' },
      { playerId: 'p2', displayName: 'Kelvin_G' },
    ])

    expect(rows).toEqual([
      { tournament_id: T, kind: 'solo', player_id: 'p1', display_name: 'ShadowX', status: 'active' },
      { tournament_id: T, kind: 'solo', player_id: 'p2', display_name: 'Kelvin_G', status: 'active' },
    ])
  })

  it('preserves seed order', () => {
    // The caller passes seededPaidPlayers order (strongest first). Round 1's
    // lobby draw shuffles, but later re-seeding relies on this being the order
    // the caller intended rather than whatever the DB returns.
    const rows = soloEntrantRows(T, [
      { playerId: 'c', displayName: 'C' },
      { playerId: 'a', displayName: 'A' },
      { playerId: 'b', displayName: 'B' },
    ])
    expect(rows.map((r) => r.player_id)).toEqual(['c', 'a', 'b'])
  })

  it('falls back to a neutral name when a profile has none', () => {
    // display_name is frozen at entry time and NOT NULL. A nameless profile
    // must not break registration close.
    const rows = soloEntrantRows(T, [{ playerId: 'p1', displayName: '' }])
    expect(rows[0].display_name).toBe('Player')
  })

  it('drops duplicate players rather than violating the unique index', () => {
    // tournament_entrants has UNIQUE (tournament_id, player_id). A duplicate
    // would abort the whole insert and fail registration close for everyone.
    const rows = soloEntrantRows(T, [
      { playerId: 'p1', displayName: 'ShadowX' },
      { playerId: 'p1', displayName: 'ShadowX again' },
    ])
    expect(rows).toHaveLength(1)
  })

  it('returns nothing for no seeds', () => {
    expect(soloEntrantRows(T, [])).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/tournaments/entrants.test.ts`
Expected: FAIL — `Cannot find module './entrants'`.

- [ ] **Step 3: Write the implementation**

Create `lib/tournaments/entrants.ts`:

```ts
// Turning paid registrations into the units that actually compete.
//
// A points-race tournament does not draw a bracket at registration close; it
// creates entrants. One per paid player for a solo tournament, one per
// completed squad for a squad tournament (phase 5).
//
// Pure so the de-duplication and name-fallback rules are testable without a
// database — both of which, if wrong, fail registration close for the whole
// tournament rather than for one player.

export interface EntrantSeed {
  playerId: string
  displayName: string
}

export interface SoloEntrantRow {
  tournament_id: string
  kind: 'solo'
  player_id: string
  display_name: string
  status: 'active'
}

export function soloEntrantRows(tournamentId: string, seeds: EntrantSeed[]): SoloEntrantRow[] {
  const seen = new Set<string>()
  const rows: SoloEntrantRow[] = []

  for (const s of seeds) {
    // UNIQUE (tournament_id, player_id) — one duplicate would abort the whole
    // insert, so drop it here rather than letting Postgres fail the batch.
    if (seen.has(s.playerId)) continue
    seen.add(s.playerId)
    rows.push({
      tournament_id: tournamentId,
      kind: 'solo',
      player_id: s.playerId,
      // display_name is NOT NULL and frozen at entry time; a nameless profile
      // must not break registration close.
      display_name: s.displayName.trim() || 'Player',
      status: 'active',
    })
  }

  return rows
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/tournaments/entrants.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/tournaments/entrants.ts lib/tournaments/entrants.test.ts
git commit -m "feat(tournaments): build solo entrant rows from paid registrations

De-duplication and the name fallback live here rather than at the call site
because getting either wrong fails registration close for the entire
tournament, not for one player: a duplicate aborts the whole insert against
UNIQUE (tournament_id, player_id), and display_name is NOT NULL."
```

---

### Task 2: Fork registration close on competition format

**Files:**
- Modify: `lib/tournaments/bracket-admin-actions.ts`

**Interfaces:**
- Consumes: `soloEntrantRows` (Task 1); `seededPaidPlayers` from `lib/tournaments/seeded-players.ts`.
- Produces: `closeRegistration` and `generateBracket` handle `competition_format = 'points_race'`.

- [ ] **Step 1: Add the entrant-creation helper**

In `lib/tournaments/bracket-admin-actions.ts`, add after `clearBracket`:

```ts
// Points-race equivalent of generate(): no bracket, no groups — just the
// entrants that will be drawn into lobbies when a stage opens.
//
// Replaces rather than appends, so re-closing after a reopen produces exactly
// the paid field rather than accumulating stale entrants. Safe because a
// tournament can only be reopened before any stage has run.
async function createSoloEntrants(admin: Admin, tournamentId: string, seeded: string[]): Promise<void> {
  const { data: profiles } = await admin
    .from('profiles')
    .select('id, display_name, username')
    .in('id', seeded)
  const nameById = new Map(
    (profiles ?? []).map((p) => [p.id as string, (p.display_name ?? p.username ?? '') as string]),
  )

  const { error: delErr } = await admin
    .from('tournament_entrants')
    .delete()
    .eq('tournament_id', tournamentId)
  if (delErr) throw new Error(`Failed to clear existing entrants: ${delErr.message}`)

  const rows = soloEntrantRows(
    tournamentId,
    // seededPaidPlayers order is preserved, so entrant creation order matches
    // seeding order.
    seeded.map((id) => ({ playerId: id, displayName: nameById.get(id) ?? '' })),
  )
  if (rows.length === 0) return

  const { error } = await admin.from('tournament_entrants').insert(rows)
  if (error) throw new Error(`Failed to create entrants: ${error.message}`)
}
```

Add the import at the top:

```ts
import { soloEntrantRows } from './entrants'
```

- [ ] **Step 2: Fork `closeRegistration`**

Change its tournament read to include the new columns:

```ts
  const { data: t } = await admin
    .from('tournaments')
    .select('status, format, competition_format, entry_unit')
    .eq('id', id)
    .maybeSingle()
```

Then, immediately after the `seeded.length < 2` guard and **before** the `> 64` guard, insert the fork:

```ts
  if (t.competition_format === 'points_race') {
    // Squad entrants need the squad lifecycle (phase 5). Refusing here keeps a
    // half-built path from being reachable by accident.
    if (t.entry_unit !== 'solo') {
      return { error: 'Squad tournaments cannot be closed yet — squad registration is not built.' }
    }
    await admin.from('tournaments').update({ status: 'registration_closed' }).eq('id', id)
    try {
      await createSoloEntrants(admin, id, seeded)
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'Failed to create entrants.' }
    }
    revalidateAdmin(id)
    return { success: true }
  }
```

The 64-player cap stays below the fork: it exists because a knockout bracket is power-of-two bounded, which a points race is not. A BR field of 96 across four lobbies is normal.

- [ ] **Step 3: Fork `generateBracket` the same way**

After its `status !== 'registration_closed'` guard, add:

```ts
  if (t.competition_format === 'points_race') {
    return { error: 'This is a points-race tournament — open its stages instead of generating a bracket.' }
  }
```

and widen its select to `'status, format, competition_format'`.

- [ ] **Step 4: Verify and commit**

Run: `npx tsc --noEmit`, `npx next lint`, `npx vitest run` — all clean, count unchanged.

Then verify against the live database with a rolled-back transaction proving the head-to-head path is untouched and the points-race path creates entrants — see Task 5's verification block for the pattern.

```bash
git add lib/tournaments/bracket-admin-actions.ts
git commit -m "feat(tournaments): registration close creates entrants for a points race

A fork, not a rewrite: a football tournament runs exactly the lines it ran
before, in the same order. A points race skips bracket generation entirely and
creates one solo entrant per paid registration.

The 64-player cap stays on the head-to-head side — it exists because a knockout
bracket is power-of-two bounded, which a BR field of 96 across four lobbies is
not. Squad tournaments are refused with a clear message until phase 5 rather
than half-working."
```

---

### Task 3: Deciding who plays in a stage, and in what order

**Files:**
- Create: `lib/tournaments/stage-entry.ts`
- Test: `lib/tournaments/stage-entry.test.ts`

**Interfaces:**
- Consumes: `PointsStandingRow` from `lib/tournaments/points-standings.ts` (phase 2).
- Produces:
  - `stageIntake(previousStanding: PointsStandingRow[] | null, allActiveEntrantIds: string[], advanceCountOfPrevious: number | null): string[]`
  - `seedOrderForRound(roundNo: number, intake: string[], standing: PointsStandingRow[]): string[]`

- [ ] **Step 1: Write the failing test**

Create `lib/tournaments/stage-entry.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { seedOrderForRound, stageIntake } from './stage-entry'
import type { PointsStandingRow } from './points-standings'

function row(entrantId: string, rank: number, totalPoints: number): PointsStandingRow {
  return {
    entrantId,
    displayName: entrantId,
    played: 1,
    totalPoints,
    totalKills: 0,
    bestPlacement: rank,
    lastRoundPlacement: rank,
    rank,
    advancing: false,
    unresolvedTieWith: [],
  }
}

describe('stageIntake', () => {
  it('takes the whole active field for the first stage', () => {
    expect(stageIntake(null, ['a', 'b', 'c'], null)).toEqual(['a', 'b', 'c'])
  })

  it('takes the top N of the previous stage for a later stage', () => {
    const prev = [row('b', 1, 30), row('a', 2, 20), row('c', 3, 10)]
    expect(stageIntake(prev, ['a', 'b', 'c'], 2)).toEqual(['b', 'a'])
  })

  it('returns them in finishing order, strongest first', () => {
    const prev = [row('c', 1, 30), row('a', 2, 20)]
    expect(stageIntake(prev, ['a', 'c'], 2)).toEqual(['c', 'a'])
  })

  it('takes everyone when the previous stage advances more than it had', () => {
    // Guarded against elsewhere (validateStagePlan), but this must not produce
    // undefined entries if it slips through.
    const prev = [row('a', 1, 10)]
    expect(stageIntake(prev, ['a'], 5)).toEqual(['a'])
  })

  it('returns nothing when the previous stage has no standings yet', () => {
    expect(stageIntake([], ['a', 'b'], 2)).toEqual([])
  })
})

describe('seedOrderForRound', () => {
  it('shuffles round 1, keeping every entrant exactly once', () => {
    // No standings exist yet, so any seeding would be fictional.
    const intake = ['a', 'b', 'c', 'd', 'e']
    const out = seedOrderForRound(1, intake, [])
    expect([...out].sort()).toEqual([...intake].sort())
  })

  it('seeds later rounds strongest-first on the running standings', () => {
    const standing = [row('c', 1, 30), row('a', 2, 20), row('b', 3, 10)]
    expect(seedOrderForRound(2, ['a', 'b', 'c'], standing)).toEqual(['c', 'a', 'b'])
  })

  it('appends entrants missing from the standings rather than dropping them', () => {
    // Someone who has not played a scored round yet still has to be placed in
    // a lobby — dropping them would silently remove a paying entrant.
    const standing = [row('a', 1, 10)]
    const out = seedOrderForRound(2, ['a', 'b'], standing)
    expect(out).toHaveLength(2)
    expect(out[0]).toBe('a')
    expect(out).toContain('b')
  })

  it('ignores standings rows for entrants not in this stage', () => {
    const standing = [row('zzz', 1, 99), row('a', 2, 10)]
    expect(seedOrderForRound(2, ['a'], standing)).toEqual(['a'])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/tournaments/stage-entry.test.ts`
Expected: FAIL — `Cannot find module './stage-entry'`.

- [ ] **Step 3: Write the implementation**

Create `lib/tournaments/stage-entry.ts`:

```ts
import type { PointsStandingRow } from './points-standings'

// Who plays in a stage, and in what order they are drawn into its lobbies.
//
// Split out from the server action so both decisions are testable without a
// database: getting either wrong silently removes a paying entrant from a
// tournament, which is the kind of bug nobody notices until someone complains.

// Stage 1 takes the whole active field. Every later stage takes exactly the top
// `advanceCountOfPrevious` of the stage before it, in finishing order.
export function stageIntake(
  previousStanding: PointsStandingRow[] | null,
  allActiveEntrantIds: string[],
  advanceCountOfPrevious: number | null,
): string[] {
  if (previousStanding === null) return [...allActiveEntrantIds]

  const ordered = [...previousStanding].sort((a, b) => a.rank - b.rank)
  const take = advanceCountOfPrevious ?? ordered.length
  return ordered.slice(0, take).map((r) => r.entrantId)
}

// Fisher-Yates. Round 1 has no standings, so any "seeding" would be fictional
// — a shuffle is the honest option and keeps repeat pairings from ossifying.
function shuffle(ids: string[]): string[] {
  const out = [...ids]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// The order handed to assignLobbies, which snake-drafts it so the strongest are
// spread across lobbies rather than stacked into one.
export function seedOrderForRound(
  roundNo: number,
  intake: string[],
  standing: PointsStandingRow[],
): string[] {
  if (roundNo <= 1) return shuffle(intake)

  const inStage = new Set(intake)
  const rankById = new Map(
    standing.filter((r) => inStage.has(r.entrantId)).map((r) => [r.entrantId, r.rank]),
  )

  // An entrant with no standings row has not played a scored round yet. They
  // sort last, but they are never dropped — that would remove a paying entrant
  // from the tournament.
  return [...intake].sort(
    (a, b) =>
      (rankById.get(a) ?? Number.POSITIVE_INFINITY) - (rankById.get(b) ?? Number.POSITIVE_INFINITY),
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/tournaments/stage-entry.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/tournaments/stage-entry.ts lib/tournaments/stage-entry.test.ts
git commit -m "feat(tournaments): stage intake and per-round seeding order

Both decisions are pure because getting either wrong silently removes a paying
entrant from a tournament — the kind of bug nobody notices until someone
complains.

Round 1 shuffles rather than seeds: no standings exist yet, so any seeding
would be fictional. Later rounds order by running rank, and an entrant with no
standings row sorts last rather than being dropped."
```

---

### Task 4: Open a stage, generate a round

**Files:**
- Create: `lib/tournaments/lobby-admin-actions.ts`

**Interfaces:**
- Consumes: `stageIntake`, `seedOrderForRound` (Task 3); `assignLobbies` (phase 2); `sortPointsStandings` (phase 2); `parsePointsConfig` (phase 2).
- Produces: `openStage`, `generateNextRound`, `updateLobbyDetails`, each `(prev, formData) => Promise<LobbyState>`.

- [ ] **Step 1: Write the actions**

Create `lib/tournaments/lobby-admin-actions.ts`. It needs one shared read — a stage's running standings — plus the two generators.

`stageStanding(admin, stageId)`: read the stage's confirmed `lobby_results` joined to their lobby's `round_no`, read the stage's `lobby_entrants` for display names, and return `sortPointsStandings(entrants, results, advanceCount)`.

`openStage(prev, formData)`:
1. `requireStaff()`; read `stageId`.
2. Load the stage with its tournament; refuse unless `status = 'pending'`.
3. Refuse if the tournament is not `points_race`.
4. Determine intake: if `seq = 1`, all active entrants; otherwise the previous stage's standings top-N via `stageIntake`.
5. Refuse if intake < 2 — a stage with one entrant has nothing to play.
6. `assignLobbies(seedOrderForRound(1, intake, []), stage.lobby_size)`.
7. Insert one `tournament_lobbies` row per lobby (`round_no: 1`, its label) and the matching `lobby_entrants`.
8. Set the stage `status = 'live'`.
9. `revalidatePath` the stages and lobbies pages.

`generateNextRound(prev, formData)`:
1. `requireStaff()`; read `stageId`.
2. Refuse unless the stage is `live`.
3. Find the highest existing `round_no`; refuse if it is already `rounds_count` — the stage is played out.
4. **Refuse unless every lobby in that highest round is `confirmed`.** Re-seeding on half-scored standings would produce a draw that changes when the remaining results land.
5. Intake is the same set as round 1 (a stage's field does not shrink between its own rounds), ordered by `seedOrderForRound(nextRound, intake, standing)`.
6. Generate and insert exactly as `openStage` does, with `round_no = nextRound`.

`updateLobbyDetails(prev, formData)`: `requireStaff()`, then update `room_id`, `room_password`, `scheduled_at`, `youtube_stream_url` on one lobby. Refuse if the lobby is `confirmed`.

Every action returns `{ error }` with a sentence, never a raw Postgres message.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`, `npx next lint` — clean.

- [ ] **Step 3: Commit**

```bash
git add lib/tournaments/lobby-admin-actions.ts
git commit -m "feat(tournaments): open a stage and generate its rounds

Round N+1 is refused until every lobby in round N is confirmed: re-seeding on
half-scored standings would produce a draw that changes when the remaining
results land, so an admin would see the lobbies reshuffle under them.

Nothing auto-advances. Opening a stage and generating each round are explicit
admin actions, matching the project's admin-final-say rule."
```

---

### Task 5: Admin lobbies page

**Files:**
- Create: `components/admin/LobbyList.tsx`
- Create: `app/[locale]/admin/tournaments/[id]/lobbies/page.tsx`
- Modify: `components/admin/StagesEditor.tsx` (per-stage "Open stage" button)
- Modify: `app/[locale]/admin/tournaments/[id]/edit/page.tsx` (link)

**Interfaces:**
- Consumes: `openStage`, `generateNextRound`, `updateLobbyDetails` (Task 4).
- Produces: route `/admin/tournaments/[id]/lobbies`.

- [ ] **Step 1: Build the page and component**

The page loads the tournament's stages with their lobbies and each lobby's entrant count, grouped by stage then round. For each lobby it renders its label, entrant count, status, and an inline form for room ID, room password, scheduled time and stream URL bound to `updateLobbyDetails`. Per stage it shows a "Generate round N+1" button bound to `generateNextRound`, disabled with an explanatory line when the current round is not fully confirmed.

Guard the page the same way the stages page does: a non-`points_race` tournament shows the "use the bracket page instead" notice rather than an empty list.

Add an "Open stage" button to each pending stage in `StagesEditor`, bound to `openStage`.

- [ ] **Step 2: Verify end to end against the live database**

With `tsc`, lint and the suite clean, run this rolled-back transaction to prove the whole chain works on real data:

```sql
do $$
declare gid uuid; tid uuid; sid uuid; pid uuid; n int; outcome text;
begin
  select id into gid from public.games where slug = 'free-fire';

  insert into public.tournaments
    (game_id, title, slug, status, registration_fee, prize_pool, format,
     tournament_type, competition_format, entry_unit)
  values (gid, 'Repro Lobbies', 'repro-lobbies', 'registration_closed', 0, 0,
          'group_knockout', 'open', 'points_race', 'solo')
  returning id into tid;

  -- Ten entrants.
  for pid in select id from public.profiles where deleted_at is null limit 10 loop
    insert into public.tournament_entrants (tournament_id, kind, player_id, display_name)
    values (tid, 'solo', pid, 'E-' || left(pid::text, 4));
  end loop;

  insert into public.tournament_stages
    (tournament_id, seq, name, rounds_count, lobby_size, advance_count, points_config, status)
  values (tid, 1, 'Qualifiers', 2, 4, 4,
          '{"placement":[12,9,8,7],"per_kill":1}'::jsonb, 'pending')
  returning id into sid;

  -- What openStage does: 10 entrants at 4 per lobby = 3 lobbies.
  insert into public.tournament_lobbies (stage_id, round_no, label) values
    (sid, 1, 'A'), (sid, 1, 'B'), (sid, 1, 'C');

  select count(*) into n from public.tournament_lobbies where stage_id = sid;
  outcome := format('entrants=%s lobbies=%s',
                    (select count(*) from public.tournament_entrants where tournament_id = tid), n);

  -- A duplicate label in the same round must be refused.
  begin
    insert into public.tournament_lobbies (stage_id, round_no, label) values (sid, 1, 'A');
    outcome := outcome || ' | FAIL: duplicate lobby label accepted';
  exception when unique_violation then
    outcome := outcome || ' | duplicate label refused';
  end;

  raise exception 'ROLLBACK_OK >> %', outcome;
end $$;
```

Expected: `entrants=10 lobbies=3 | duplicate label refused`.

- [ ] **Step 3: Commit**

```bash
git add components/admin/LobbyList.tsx "app/[locale]/admin/tournaments/[id]/lobbies/page.tsx" components/admin/StagesEditor.tsx "app/[locale]/admin/tournaments/[id]/edit/page.tsx"
git commit -m "feat(admin): lobbies page with room credentials

Room ID and password are edited here and never selected on a public page — they
would let anyone walk into a paid custom room.

Generate-next-round is disabled with a reason rather than hidden, so an admin
can see why it is unavailable instead of wondering where it went."
```

---

## Self-Review

**Spec coverage (4a):**

| Spec section | Task |
|---|---|
| §4.3 entrants created from registrations | 1, 2 |
| §5 lobbies per stage per round | 4, 5 |
| §5.1 snake-draft lobby assignment, re-seeded per round | 3, 4 |
| §5 room credentials, admin-only | 4, 5 |

**Placeholder scan:** Tasks 4 and 5 specify behaviour, guards and ordering precisely but do not spell out every line — both are assembly over pure functions that are fully specified and tested in Tasks 1 and 3, and the guards (which are the decisions) are enumerated. Every other step carries literal code.

**Type consistency:** `stageIntake` and `seedOrderForRound` both take/return `string[]` of entrant ids, matching `assignLobbies(orderedEntrantIds, lobbySize)` from phase 2. `PointsStandingRow` is imported, not redefined. `soloEntrantRows` returns snake_case rows matching `tournament_entrants` columns exactly.

**Known risk:** `generateNextRound` re-seeds from standings that only count *confirmed* results. Step 1's guard (refuse until the round is fully confirmed) is what makes that sound — without it the draw would change as late results arrive. Do not relax that guard for convenience.
