# Third Place Match Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically create a 3rd place (bronze) match between the two semifinal losers of every tournament, play it through the existing result-verification flow, and recognize the winner on the bracket page and in Hall of Fame — plus an admin escape hatch to credit a 3rd place finish with no match played, for tournaments that predate this feature.

**Architecture:** A new `third_place` value on `matches.round`, deliberately excluded from `ROUND_ORDER` (the bracket-progression source of truth) since the bronze match is a sibling of the Final, not a successor. Creation piggybacks on the existing knockout-advancement hook in `confirmResult()`. Display reuses the existing "Champion" text-block pattern on the bracket page rather than touching the bracket-tree topology code. The manual-credit path reuses the `bye` match status that already means "this slot resolved with no real opponent played."

**Tech Stack:** Next.js 14 App Router Server Actions, Supabase (Postgres + supabase-js), TypeScript, Vitest.

## Global Constraints

- `third_place` is added to the `matches.round` CHECK constraint, but **never** added to `ROUND_ORDER` (`lib/tournaments/bracket.ts`) — that array drives `nextRoundName`, `getChampion`, and prize payout, none of which the bronze match participates in.
- No automated prize payout for 3rd place — placement only (per `lib/matches/verify-actions.ts:311-313`, unchanged).
- The 3rd place match is only auto-created when both semifinal matches are `status: 'completed'` with a real decisive score — a semifinal `bye` or `forfeited` skips auto-creation (no legitimate loser to pair).
- Admin actions here use `requireStaff()` (admin or moderator), matching `confirmResult` — this isn't a financial action.
- One `third_place` match per tournament, whether it came from auto-creation or the manual-credit form — both paths check for an existing row first.

---

### Task 1: Database migration — `third_place` round value

**Files:**
- Create: `supabase/migrations/046_third_place_match.sql`
- Modify: `lib/supabase/types.ts` (regenerated, not hand-edited)

**Interfaces:**
- Produces: `matches.round` accepts `'third_place'` as a valid value, everywhere downstream.

- [ ] **Step 1: Write the migration**

```sql
-- 046_third_place_match.sql
-- Adds a 'third_place' round for the bronze match between the two semifinal
-- losers. Deliberately not part of ROUND_ORDER's progression chain (see
-- lib/tournaments/bracket.ts) — it's a sibling of the Final, not a successor.
-- See docs/superpowers/specs/2026-08-03-third-place-match-design.md.

ALTER TABLE public.matches DROP CONSTRAINT matches_round_check;
ALTER TABLE public.matches
  ADD CONSTRAINT matches_round_check
  CHECK (round IN (
    'group', 'round_of_32', 'round_of_16',
    'quarter_final', 'semi_final', 'final', 'third_place'
  ));
```

- [ ] **Step 2: Apply the migration**

Apply it via the `mcp__claude_ai_Supabase__apply_migration` MCP tool (project id `itxubrkbropttfdackmi`, name `046_third_place_match`, body = the SQL from Step 1) — this project's Supabase CLI has a known Windows connectivity gotcha (a schannel TLS check can hang indefinitely), so the MCP tool is the reliable path; only fall back to `npx supabase db push` if the MCP tool is unavailable.

- [ ] **Step 3: Regenerate Supabase types**

Use the `mcp__claude_ai_Supabase__generate_typescript_types` MCP tool (project id `itxubrkbropttfdackmi`). Its response is a JSON object with a `types` string field containing the full file contents — write that string verbatim to `lib/supabase/types.ts` (overwrite the whole file).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/046_third_place_match.sql lib/supabase/types.ts
git commit -m "feat(tournaments): add third_place round to matches schema"
```

---

### Task 2: Pure helper — `thirdPlacePair` (semifinal losers)

**Files:**
- Modify: `lib/tournaments/advancement.ts`
- Test: `lib/tournaments/advancement.test.ts`

**Interfaces:**
- Consumes: `AdvanceMatch` (existing interface in this file), `matchWinnerId` (existing function in this file).
- Produces: `thirdPlacePair(semiFinalMatches: AdvanceMatch[]): [string, string] | null` — for Task 4 (`verify-actions.ts`).

- [ ] **Step 1: Write the failing tests**

Add to `lib/tournaments/advancement.test.ts`, inside a new `describe('thirdPlacePair', ...)` block after the existing `describe('nextRoundName', ...)` block:

```ts
describe('thirdPlacePair', () => {
  it('returns the two semifinal losers', () => {
    const semis = [
      mk({ player_a_id: 'w1', player_b_id: 'l1', score_a: 3, score_b: 1 }),
      mk({ player_a_id: 'l2', player_b_id: 'w2', score_a: 0, score_b: 2 }),
    ]
    expect(thirdPlacePair(semis)).toEqual(['l1', 'l2'])
  })

  it('returns null when a semifinal was a bye (no real loser)', () => {
    const semis = [
      mk({ status: 'bye', player_a_id: 'w1', player_b_id: null, score_a: null, score_b: null }),
      mk({ player_a_id: 'l2', player_b_id: 'w2', score_a: 0, score_b: 2 }),
    ]
    expect(thirdPlacePair(semis)).toBeNull()
  })

  it('returns null when a semifinal was forfeited (double no-show)', () => {
    const semis = [
      mk({ status: 'forfeited', score_a: null, score_b: null }),
      mk({ player_a_id: 'l2', player_b_id: 'w2', score_a: 0, score_b: 2 }),
    ]
    expect(thirdPlacePair(semis)).toBeNull()
  })

  it('returns null when a semifinal is not yet decided', () => {
    const semis = [
      mk({ status: 'scheduled', score_a: null, score_b: null }),
      mk({ player_a_id: 'l2', player_b_id: 'w2', score_a: 0, score_b: 2 }),
    ]
    expect(thirdPlacePair(semis)).toBeNull()
  })

  it('returns null unless there are exactly two semifinal matches', () => {
    expect(thirdPlacePair([])).toBeNull()
    expect(thirdPlacePair([mk({})])).toBeNull()
  })
})
```

Update the import line at the top of the test file to include `thirdPlacePair`:

```ts
import {
  matchWinnerId,
  roundResolved,
  pairWinners,
  nextRoundName,
  thirdPlacePair,
  type AdvanceMatch,
} from './advancement'
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/tournaments/advancement.test.ts`
Expected: FAIL — `thirdPlacePair` is not exported.

- [ ] **Step 3: Implement `thirdPlacePair`**

Add to `lib/tournaments/advancement.ts`, after `pairWinners` and before `nextRoundName`:

```ts
// The two semifinal losers, or null if the round isn't ready for a bronze
// match. Requires exactly two matches (structurally guaranteed whenever the
// semi_final round exists) and both must be a normally decided 'completed'
// result — a bye or forfeit leaves no legitimate loser on that side, so no
// 3rd place match is created for that tournament run (an admin can still
// credit one manually — see lib/matches/verify-actions.ts).
export function thirdPlacePair(semiFinalMatches: AdvanceMatch[]): [string, string] | null {
  if (semiFinalMatches.length !== 2) return null
  const losers = semiFinalMatches.map((m) => {
    if (m.status !== 'completed') return null
    const winnerId = matchWinnerId(m)
    if (!winnerId) return null
    return winnerId === m.player_a_id ? m.player_b_id : m.player_a_id
  })
  const [a, b] = losers
  if (!a || !b) return null
  return [a, b]
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/tournaments/advancement.test.ts`
Expected: PASS, all tests including the new `thirdPlacePair` block.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/tournaments/advancement.ts lib/tournaments/advancement.test.ts
git commit -m "feat(tournaments): add thirdPlacePair helper"
```

---

### Task 3: Pure helper — `getThirdPlace` + `ROUND_LABELS` entry

**Files:**
- Modify: `lib/tournaments/bracket.ts`
- Test: `lib/tournaments/bracket.test.ts`

**Interfaces:**
- Consumes: `BracketMatch` (existing interface in this file).
- Produces: `getThirdPlace(matches: BracketMatch[]): { id: string; name: string } | null` — for Task 6 (`bracket-view.ts`) and Task 8 (`awards.ts`). `ROUND_LABELS.third_place` — for every existing `ROUND_LABELS[round] ?? round` display site (dashboard fixture cards, match centre, admin matches page), no code changes needed at those sites.

- [ ] **Step 1: Write the failing tests**

Add to `lib/tournaments/bracket.test.ts`, after the existing `describe('getChampion', ...)` block:

```ts
describe('getThirdPlace', () => {
  it('returns the winner of a completed third_place match', () => {
    const winner = getThirdPlace([
      match({
        id: 'tp',
        round: 'third_place',
        status: 'completed',
        score_a: 1,
        score_b: 3,
        playerA: { id: 'pa', name: 'Alpha' },
        playerB: { id: 'pb', name: 'Bravo' },
      }),
    ])
    expect(winner).toEqual({ id: 'pb', name: 'Bravo' })
  })

  it('returns playerA for an admin-credited bye', () => {
    const winner = getThirdPlace([
      match({
        id: 'tp',
        round: 'third_place',
        status: 'bye',
        score_a: null,
        score_b: null,
        playerA: { id: 'pa', name: 'Alpha' },
        playerB: { id: '', name: 'TBD' },
      }),
    ])
    expect(winner).toEqual({ id: 'pa', name: 'Alpha' })
  })

  it('returns null when not completed/bye, absent, or drawn', () => {
    expect(
      getThirdPlace([match({ id: 'tp', round: 'third_place', status: 'scheduled' })]),
    ).toBeNull()
    expect(
      getThirdPlace([match({ id: 'f', round: 'final', status: 'completed', score_a: 2, score_b: 0 })]),
    ).toBeNull()
    expect(
      getThirdPlace([
        match({ id: 'tp', round: 'third_place', status: 'completed', score_a: 1, score_b: 1 }),
      ]),
    ).toBeNull()
  })
})
```

Update the import line at the top of the test file:

```ts
import {
  splitFixturesByState,
  orderKnockoutRounds,
  getChampion,
  getThirdPlace,
  groupFixturesByDate,
  type BracketMatch,
} from './bracket'
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/tournaments/bracket.test.ts`
Expected: FAIL — `getThirdPlace` is not exported.

- [ ] **Step 3: Implement `getThirdPlace` and the label entry**

In `lib/tournaments/bracket.ts`, add `third_place` to `ROUND_LABELS`:

```ts
export const ROUND_LABELS: Record<string, string> = {
  group: 'Group Stage',
  round_of_32: 'Round of 32',
  round_of_16: 'Round of 16',
  quarter_final: 'Quarter-finals',
  semi_final: 'Semi-finals',
  final: 'Final',
  third_place: 'Third Place Match',
}
```

Add `getThirdPlace` after `getChampion`:

```ts
// A 3rd place result exists in two shapes: a real completed match (two
// semifinal losers played it), or an admin-credited 'bye' (no opponent, no
// match played — see lib/matches/verify-actions.ts:creditThirdPlace). Both
// are recognized identically here, so the bracket page and Hall of Fame
// don't need to care which one produced the result.
export function getThirdPlace(matches: BracketMatch[]): { id: string; name: string } | null {
  const m = matches.find(
    (m) => m.round === 'third_place' && (m.status === 'completed' || m.status === 'bye'),
  )
  if (!m) return null
  if (m.status === 'bye') return m.playerA
  if (m.score_a == null || m.score_b == null || m.score_a === m.score_b) return null
  return m.score_a > m.score_b ? m.playerA : m.playerB
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/tournaments/bracket.test.ts`
Expected: PASS, all tests including the new `getThirdPlace` block.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/tournaments/bracket.ts lib/tournaments/bracket.test.ts
git commit -m "feat(tournaments): add getThirdPlace helper and round label"
```

---

### Task 4: Auto-create the 3rd place match + fix the payout completion bug

**Files:**
- Modify: `lib/matches/verify-actions.ts`

**Interfaces:**
- Consumes: `thirdPlacePair` (Task 2, `lib/tournaments/advancement.ts`), `nextRoundScheduledAt` (existing, `lib/tournaments/round-schedule.ts`), `notifyNewFixtures` (existing, `lib/notifications/fixture-created.ts`).
- Produces: `createThirdPlaceMatch(admin: Admin, tournamentId: string): Promise<void>` (module-private, called from `confirmResult`).

This task has no dedicated unit test — `verify-actions.ts` is DB-orchestration code with no existing test file (same as `advanceKnockout`, `recomputeGroupAndMaybeAdvance`, and every other function in this file), so it's covered by manual verification instead, matching the codebase's existing convention for this file.

- [ ] **Step 1: Add the `thirdPlacePair` import**

In `lib/matches/verify-actions.ts`, change:

```ts
import {
  matchWinnerId,
  roundResolved,
  pairWinners,
  nextRoundName,
  type AdvanceMatch,
} from '@/lib/tournaments/advancement'
```

to:

```ts
import {
  matchWinnerId,
  roundResolved,
  pairWinners,
  nextRoundName,
  thirdPlacePair,
  type AdvanceMatch,
} from '@/lib/tournaments/advancement'
```

- [ ] **Step 2: Add `createThirdPlaceMatch`**

Add this function immediately after `advanceKnockout` (which ends at line 232 — right before `export async function confirmResult`):

```ts
// Create the 3rd place match from the two semifinal losers, once both semis
// are decisively completed. Idempotent — a tournament ends up with at most
// one third_place row, whether it comes from here or from the admin
// manual-credit path (creditThirdPlace, below).
async function createThirdPlaceMatch(admin: Admin, tournamentId: string): Promise<void> {
  const { data: semis } = await admin
    .from('matches')
    .select('status, score_a, score_b, player_a_id, player_b_id')
    .eq('tournament_id', tournamentId)
    .eq('round', 'semi_final')
  const pair = thirdPlacePair((semis ?? []) as AdvanceMatch[])
  if (!pair) return

  const { count: existing } = await admin
    .from('matches')
    .select('*', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)
    .eq('round', 'third_place')
  if (existing && existing > 0) return

  const roundDate = await nextRoundScheduledAt(admin, tournamentId)
  const schedule = roundDate ? { scheduled_at: roundDate, is_full_day: true } : {}
  const { data: inserted } = await admin
    .from('matches')
    .insert({
      tournament_id: tournamentId,
      round: 'third_place',
      group_id: null,
      player_a_id: pair[0],
      player_b_id: pair[1],
      status: 'scheduled',
      ...schedule,
    })
    .select('id, player_a_id, player_b_id, scheduled_at, is_full_day')
  await notifyNewFixtures(
    admin,
    (inserted ?? []).map((m) => ({
      id: m.id,
      tournamentId,
      playerAId: m.player_a_id as string,
      playerBId: m.player_b_id,
      scheduledAt: m.scheduled_at,
      isFullDay: m.is_full_day,
    })),
  )
}
```

- [ ] **Step 3: Hook it into `confirmResult`, and fix the payout completion check**

Find this block in `confirmResult` (currently around lines 296-327):

```ts
  } else if (isKnockout) {
    await advanceKnockout(admin, m.tournament_id, m.round)
    if (nextRoundName(m.round) === null) {
      // Claim the completion atomically — the prize is credited only by the
      // call that actually flipped the tournament to 'completed'. A bracket
      // that somehow lands more than one match in the 'final' round (or a
      // double-confirm) would otherwise pay the full pool out once per match.
      const { data: claimed } = await admin
        .from('tournaments')
        .update({ status: 'completed' })
        .eq('id', m.tournament_id)
        .neq('status', 'completed')
        .select('id')
```

Replace it with:

```ts
  } else if (isKnockout) {
    await advanceKnockout(admin, m.tournament_id, m.round)
    if (m.round === 'semi_final') {
      await createThirdPlaceMatch(admin, m.tournament_id)
    }
    if (m.round === 'final') {
      // Claim the completion atomically — the prize is credited only by the
      // call that actually flipped the tournament to 'completed'. A bracket
      // that somehow lands more than one match in the 'final' round (or a
      // double-confirm) would otherwise pay the full pool out once per match.
      //
      // Explicitly 'final', not "nextRoundName(round) === null" — the
      // third_place round also returns null from nextRoundName (it's
      // deliberately outside ROUND_ORDER's progression chain), so that check
      // would otherwise fire when the bronze match gets confirmed too,
      // wrongly completing the tournament and paying its winner the full pool.
      const { data: claimed } = await admin
        .from('tournaments')
        .update({ status: 'completed' })
        .eq('id', m.tournament_id)
        .neq('status', 'completed')
        .select('id')
```

The rest of that `if` block (the `if (claimed && claimed.length > 0) { ... }` body and its closing braces) is unchanged.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Run the full test suite**

Run: `npx vitest run`
Expected: all existing tests still pass (this task touches no pure/tested function signatures).

- [ ] **Step 6: Manual verification**

Since this file has no automated test coverage, verify by hand against a real tournament in a dev/staging environment (or read through the logic once more against these scenarios):
- Confirm both semifinal matches of a 4+ player knockout bracket with decisive scores → a `third_place` match row appears (`select * from matches where tournament_id = '<id>' and round = 'third_place'`), scheduled, with the two losers as `player_a_id`/`player_b_id`.
- Confirm the Final → tournament flips to `'completed'` and the prize pays out, same as before this change.
- Confirm the 3rd place match's result → tournament status and prize pool are untouched (no second payout).
- A semifinal with a `bye` → confirming the other semifinal creates no `third_place` row.

- [ ] **Step 7: Commit**

```bash
git add lib/matches/verify-actions.ts
git commit -m "feat(tournaments): auto-create third place match after both semifinals"
```

---

### Task 5: Manual credit action (no match played)

**Files:**
- Modify: `lib/matches/revalidate.ts`
- Modify: `lib/matches/verify-actions.ts`

**Interfaces:**
- Consumes: `requireStaff` (existing), `createAdminClient` (existing).
- Produces: `creditThirdPlace(_prev: CreditThirdPlaceState, formData: FormData): Promise<CreditThirdPlaceState>`, `type CreditThirdPlaceState` — for Task 7 (`ThirdPlaceCreditForm.tsx`). `revalidateThirdPlaceCredit(tournamentId: string, slug: string): void` — used internally by `creditThirdPlace`.

No automated test — same reasoning as Task 4 (DB-orchestration server action, no existing test convention for this kind of function in this codebase).

- [ ] **Step 1: Add the revalidation helper**

In `lib/matches/revalidate.ts`, add after `revalidateAll`:

```ts
// For the admin manual-credit path (creditThirdPlace, verify-actions.ts) —
// narrower than revalidateAll since no individual match confirmation UI is
// involved (no match was played).
export function revalidateThirdPlaceCredit(tournamentId: string, slug: string): void {
  revalidatePath(`/admin/tournaments/${tournamentId}/matches`)
  if (slug) revalidatePath(`/tournaments/${slug}/bracket`)
  revalidatePath('/hall-of-fame')
}
```

- [ ] **Step 2: Add `creditThirdPlace`**

In `lib/matches/verify-actions.ts`, change the import from `./revalidate`:

```ts
import { revalidateAll } from './revalidate'
```

to:

```ts
import { revalidateAll, revalidateThirdPlaceCredit } from './revalidate'
```

Then add this function at the end of the file (after `disputeResult`):

```ts
export type CreditThirdPlaceState = { error?: string; success?: boolean } | undefined

// Admin escape hatch: credit a player as 3rd place with no match played —
// for a tournament that predates this feature, or whose semifinal round hit
// a bye/forfeit so createThirdPlaceMatch had no legitimate loser pair to use.
// Recorded as a 'bye' match (single player, no opponent) — the same status
// already used elsewhere in this codebase for "this slot resolved with no
// real opponent" — so getThirdPlace (lib/tournaments/bracket.ts) reads it
// identically to a real result, and matchEventsFor (lib/scoring/events.ts)
// generates zero Sentinel Score events for a 'bye', correctly not
// fabricating match-completion or win points for a match that never happened.
export async function creditThirdPlace(
  _prev: CreditThirdPlaceState,
  formData: FormData,
): Promise<CreditThirdPlaceState> {
  await requireStaff()
  const tournamentId = String(formData.get('tournamentId') ?? '')
  const playerId = String(formData.get('playerId') ?? '')
  if (!tournamentId || !playerId) return { error: 'Missing tournament or player.' }

  const admin = createAdminClient()
  const { data: t } = await admin
    .from('tournaments')
    .select('slug')
    .eq('id', tournamentId)
    .maybeSingle()
  if (!t) return { error: 'Tournament not found.' }

  const { count: existing } = await admin
    .from('matches')
    .select('*', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)
    .eq('round', 'third_place')
  if (existing && existing > 0) {
    return { error: 'A third place result already exists for this tournament.' }
  }

  const { error } = await admin.from('matches').insert({
    tournament_id: tournamentId,
    round: 'third_place',
    group_id: null,
    player_a_id: playerId,
    player_b_id: null,
    status: 'bye',
    completed_at: new Date().toISOString(),
  })
  if (error) return { error: 'Could not save the third place credit.' }

  revalidateThirdPlaceCredit(tournamentId, t.slug)
  return { success: true }
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass (no pure logic changed).

- [ ] **Step 5: Commit**

```bash
git add lib/matches/revalidate.ts lib/matches/verify-actions.ts
git commit -m "feat(tournaments): add manual third place credit action"
```

---

### Task 6: `bracket-view.ts` + public bracket page display

**Files:**
- Modify: `lib/tournaments/bracket-view.ts`
- Modify: `app/(public)/tournaments/[slug]/bracket/page.tsx`

**Interfaces:**
- Consumes: `getThirdPlace` (Task 3, `lib/tournaments/bracket.ts`).
- Produces: `BracketView.thirdPlace: { id: string; name: string } | null` — consumed by the bracket page.

No dedicated test file exists for `bracket-view.ts` (it's a DB loader, same convention as `verify-actions.ts`) or for this page component.

- [ ] **Step 1: Add `thirdPlace` to `BracketView`**

In `lib/tournaments/bracket-view.ts`, add the import:

```ts
import {
  splitFixturesByState,
  orderKnockoutRounds,
  getChampion,
  getThirdPlace,
  type BracketMatch,
} from './bracket'
```

Add the field to the `BracketView` interface:

```ts
export interface BracketView {
  standings: { groupName: string; rows: StandingRow[] }[]
  fixtures: ReturnType<typeof splitFixturesByState>
  rounds: ReturnType<typeof orderKnockoutRounds>
  // The knockout shape this tournament will end up with, so the chart can be
  // drawn with empty slots before those rounds are generated.
  projected: ProjectedRound[]
  champion: { id: string; name: string } | null
  thirdPlace: { id: string; name: string } | null
  hasGroups: boolean
  hasKnockout: boolean
}
```

Add it to the returned object (the query already fetches every match regardless of round, so no query change is needed):

```ts
  return {
    standings,
    fixtures: splitFixturesByState(groupMatches),
    rounds,
    projected: hasGroups ? projectBracketRounds((groups ?? []).length * ADVANCE_PER_GROUP) : [],
    champion: getChampion(allMatches),
    thirdPlace: getThirdPlace(allMatches),
    hasGroups,
    hasKnockout: rounds.length > 0,
  }
```

- [ ] **Step 2: Render the Third Place block**

In `app/(public)/tournaments/[slug]/bracket/page.tsx`, find:

```tsx
      {view.champion && (
        <div className="mb-6 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-5 py-4 text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-amber-400/80">Champion</p>
          <p className="mt-1 text-xl font-black text-white">🏆 {view.champion.name}</p>
        </div>
      )}
```

Add immediately after it:

```tsx
      {view.thirdPlace && (
        <div className="mb-6 rounded-2xl border border-slate-700/40 bg-slate-800/20 px-5 py-3 text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400/80">Third Place</p>
          <p className="mt-1 text-base font-bold text-white">🥉 {view.thirdPlace.name}</p>
        </div>
      )}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 5: Manual verification**

Start the dev server (`npm run dev`), open a tournament's `/tournaments/<slug>/bracket` page for a tournament with a confirmed `third_place` match (or a credited one from Task 5's manual path), and confirm the "🥉 Third Place" block renders below the Champion block with the correct player name. Confirm it's absent when no `third_place` result exists yet.

- [ ] **Step 6: Commit**

```bash
git add lib/tournaments/bracket-view.ts "app/(public)/tournaments/[slug]/bracket/page.tsx"
git commit -m "feat(tournaments): show third place result on the bracket page"
```

---

### Task 7: Admin matches page — third place section + credit form

**Files:**
- Create: `components/admin/ThirdPlaceCreditForm.tsx`
- Modify: `components/admin/MatchRow.tsx`
- Modify: `app/admin/tournaments/[id]/matches/page.tsx`

**Interfaces:**
- Consumes: `creditThirdPlace`, `type CreditThirdPlaceState` (Task 5, `lib/matches/verify-actions.ts`).
- Produces: `ThirdPlaceCreditForm` component and `AdminMatchRow.round: string` (new required field) — both are used only within this task's own page wiring, nothing later depends on them.

- [ ] **Step 1: Create `ThirdPlaceCreditForm`**

```tsx
'use client'
import { useFormState, useFormStatus } from 'react-dom'
import { creditThirdPlace, type CreditThirdPlaceState } from '@/lib/matches/verify-actions'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-bold text-white hover:bg-violet-500 disabled:cursor-wait disabled:opacity-60"
    >
      {pending ? 'Crediting…' : 'Credit third place'}
    </button>
  )
}

export function ThirdPlaceCreditForm({
  tournamentId,
  players,
}: {
  tournamentId: string
  players: { id: string; name: string }[]
}) {
  const [state, action] = useFormState<CreditThirdPlaceState, FormData>(creditThirdPlace, undefined)

  if (players.length === 0) return null

  return (
    <form
      action={action}
      className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4"
    >
      <input type="hidden" name="tournamentId" value={tournamentId} />
      <label className="flex items-center gap-2 text-sm text-slate-300">
        Player
        <select
          name="playerId"
          defaultValue=""
          required
          className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-sm text-white"
        >
          <option value="" disabled>
            Select a player
          </option>
          {players.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <SubmitButton />
      {state?.error && <p className="w-full text-xs text-red-400">{state.error}</p>}
      {state?.success && <p className="w-full text-xs text-emerald-400">Credited.</p>}
    </form>
  )
}
```

- [ ] **Step 2: Add `round` to `AdminMatchRow` and fix the bye label**

In `components/admin/MatchRow.tsx`, add `round` to the interface:

```ts
export interface AdminMatchRow {
  id: string
  round: string
  playerAName: string
  playerBName: string | null // null => bye
  // Pre-built wa.me links (see lib/matches/admin-whatsapp.ts). Null => that
  // player has no reachable number. Built server-side so no phone number ever
  // reaches the client for a player admin can't message anyway.
  playerAWhatsAppUrl: string | null
  playerBWhatsAppUrl: string | null
  status: string
  scheduledAt: string // datetime-local value ('' if none)
  isFullDay: boolean
  streamUrl: string
  replayUrl: string
}
```

Update the bye branch to distinguish a real bye from an admin-credited 3rd place:

```tsx
  if (match.status === 'bye' || match.playerBName === null) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <p className="font-bold text-white">{match.playerAName}</p>
        <p className="mt-0.5 text-xs text-slate-500">
          {match.round === 'third_place' ? 'Credited — no match played' : 'Bye — auto-advances'}
        </p>
        <div className="mt-2.5">
          <WhatsAppChip name={match.playerAName} url={match.playerAWhatsAppUrl} />
        </div>
      </div>
    )
  }
```

- [ ] **Step 3: Pass `round` through and query third-place candidates**

In `app/admin/tournaments/[id]/matches/page.tsx`, find the `row` object inside the `all` map:

```ts
    return {
      round: m.round,
      groupName: groupNameOf(m.groups),
      row: {
        id: m.id,
        playerAName: nameOf(m.player_a) ?? 'TBD',
```

Change it to also carry `round` into `row`:

```ts
    return {
      round: m.round,
      groupName: groupNameOf(m.groups),
      row: {
        id: m.id,
        round: m.round,
        playerAName: nameOf(m.player_a) ?? 'TBD',
```

Find the section-building code:

```ts
  const knockoutSections = ROUND_ORDER.map((r) => ({
    label: ROUND_LABELS[r] ?? r,
    rows: all.filter((x) => x.round === r).map((x) => x.row),
  })).filter((s) => s.rows.length > 0)
  const sections = [...groupSections, ...knockoutSections]
```

Add, right after it:

```ts
  const thirdPlaceMatch = all.find((x) => x.round === 'third_place')?.row ?? null
```

Add the paid-registrants query (for the credit form) alongside the existing `Promise.all` at the top of the component. Find:

```ts
  const [{ data }, { data: regRows }] = await Promise.all([
    supabase
      .from('matches')
      .select(
        'id, round, group_id, status, scheduled_at, is_full_day, youtube_stream_url, replay_url, ' +
          'player_a:profiles!matches_player_a_id_fkey(id, username, display_name, whatsapp_number, country), ' +
          'player_b:profiles!matches_player_b_id_fkey(id, username, display_name, whatsapp_number, country), ' +
          'groups(name)',
      )
      .eq('tournament_id', t.id),
    supabase
      .from('tournament_registrations')
      .select('player_id, reg_whatsapp')
      .eq('tournament_id', t.id),
  ])
```

Change it to fetch names alongside, adding a third query:

```ts
  const [{ data }, { data: regRows }, { data: paidRegs }] = await Promise.all([
    supabase
      .from('matches')
      .select(
        'id, round, group_id, status, scheduled_at, is_full_day, youtube_stream_url, replay_url, ' +
          'player_a:profiles!matches_player_a_id_fkey(id, username, display_name, whatsapp_number, country), ' +
          'player_b:profiles!matches_player_b_id_fkey(id, username, display_name, whatsapp_number, country), ' +
          'groups(name)',
      )
      .eq('tournament_id', t.id),
    supabase
      .from('tournament_registrations')
      .select('player_id, reg_whatsapp')
      .eq('tournament_id', t.id),
    supabase
      .from('tournament_registrations')
      .select('player_id, profiles!tournament_registrations_player_id_fkey(username, display_name)')
      .eq('tournament_id', t.id)
      .eq('payment_status', 'paid'),
  ])
```

Below the `regWhatsappByPlayer` map, add the players list for the credit form:

```ts
  const thirdPlaceCandidates: { id: string; name: string }[] = ((paidRegs as unknown[] | null) ?? []).map(
    (raw) => {
      const r = raw as { player_id: string; profiles: ProfileRef | ProfileRef[] }
      const p = Array.isArray(r.profiles) ? r.profiles[0] ?? null : r.profiles
      return { id: r.player_id, name: nameOf(p) ?? 'Player' }
    },
  )
```

- [ ] **Step 4: Render the section**

In the same file, add the import for the form built in Step 1:

```ts
import { ThirdPlaceCreditForm } from '@/components/admin/ThirdPlaceCreditForm'
```

Find the sections rendering block:

```tsx
      {sections.length === 0 ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center text-sm text-slate-500">
          No matches yet.{' '}
          <Link href={`/admin/tournaments/${t.id}/bracket`} className="text-violet-400">
            Generate the bracket first.
          </Link>
        </p>
      ) : (
        <div className="space-y-8">
          {sections.map((s) => (
            <div key={s.label}>
              <h3 className="mb-3 text-[11px] font-bold uppercase tracking-widest text-slate-500">
                {s.label}
              </h3>
              <div className="space-y-3">
                {s.rows.map((row) => (
                  <MatchRow key={row.id} match={row} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
```

Add the third-place block right after the `{sections.map(...)}` closes, still inside `<div className="space-y-8">`:

```tsx
      {sections.length === 0 ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center text-sm text-slate-500">
          No matches yet.{' '}
          <Link href={`/admin/tournaments/${t.id}/bracket`} className="text-violet-400">
            Generate the bracket first.
          </Link>
        </p>
      ) : (
        <div className="space-y-8">
          {sections.map((s) => (
            <div key={s.label}>
              <h3 className="mb-3 text-[11px] font-bold uppercase tracking-widest text-slate-500">
                {s.label}
              </h3>
              <div className="space-y-3">
                {s.rows.map((row) => (
                  <MatchRow key={row.id} match={row} />
                ))}
              </div>
            </div>
          ))}
          {(thirdPlaceMatch || thirdPlaceCandidates.length > 0) && (
            <div>
              <h3 className="mb-3 text-[11px] font-bold uppercase tracking-widest text-slate-500">
                Third Place Match
              </h3>
              {thirdPlaceMatch ? (
                <div className="space-y-3">
                  <MatchRow match={thirdPlaceMatch} />
                </div>
              ) : (
                <ThirdPlaceCreditForm tournamentId={t.id} players={thirdPlaceCandidates} />
              )}
            </div>
          )}
        </div>
      )}
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 7: Manual verification**

Start the dev server, open `/admin/tournaments/<id>/matches` for a tournament that has reached (or finished) its semifinal stage but has no `third_place` row yet. Confirm the "Third Place Match" section shows the credit form with a player dropdown populated from paid registrants. Submit it, and confirm: the form's success message appears, the section now shows the credited player via `MatchRow`'s "Credited — no match played" state, and re-submitting (after a refresh) is rejected with "A third place result already exists for this tournament." Also confirm a tournament with a real (two-player) `third_place` match — from Task 4's auto-creation — renders normally through `MatchRow`, unaffected by the label change.

- [ ] **Step 8: Commit**

```bash
git add components/admin/ThirdPlaceCreditForm.tsx components/admin/MatchRow.tsx "app/admin/tournaments/[id]/matches/page.tsx"
git commit -m "feat(admin): add third place section and manual credit form"
```

---

### Task 8: Hall of Fame — `deriveThirdPlaces`

**Files:**
- Modify: `lib/hall-of-fame/awards.ts`
- Test: `lib/hall-of-fame/awards.test.ts`

**Interfaces:**
- Consumes: `getThirdPlace` (Task 3, `lib/tournaments/bracket.ts`), `BracketMatch` (existing).
- Produces: `deriveThirdPlaces(inputs: ThirdPlaceInput[]): ThirdPlaceEntry[]`, `type ThirdPlaceInput`, `type ThirdPlaceEntry` — for Task 9 (`app/(public)/hall-of-fame/page.tsx`).

- [ ] **Step 1: Write the failing tests**

Add to `lib/hall-of-fame/awards.test.ts`, at the end of the file:

```ts
function thirdPlaceMatch(over: Partial<BracketMatch>): BracketMatch {
  return {
    id: 'tp',
    round: 'third_place',
    group_id: null,
    groupName: null,
    status: 'completed',
    score_a: 1,
    score_b: 2,
    scheduled_at: null,
    is_full_day: false,
    playerA: { id: 'pa', name: 'Ada' },
    playerB: { id: 'pb', name: 'Bill' },
    ...over,
  }
}

function thirdPlaceInput(over: Partial<ThirdPlaceInput> & { tournamentId: string }): ThirdPlaceInput {
  return {
    slug: over.tournamentId,
    title: `Cup ${over.tournamentId}`,
    gameName: 'DLS',
    tournamentEnd: '2026-01-01',
    thirdPlaceMatch: thirdPlaceMatch({}),
    ...over,
  }
}

describe('deriveThirdPlaces', () => {
  it('returns [] for empty input', () => {
    expect(deriveThirdPlaces([])).toEqual([])
  })

  it('emits the third_place winner', () => {
    const r = deriveThirdPlaces([thirdPlaceInput({ tournamentId: 't1' })])
    expect(r).toHaveLength(1)
    expect(r[0].player).toEqual({ id: 'pb', name: 'Bill' })
    expect(r[0].slug).toBe('t1')
  })

  it('emits the credited player for an admin bye', () => {
    const r = deriveThirdPlaces([
      thirdPlaceInput({
        tournamentId: 't1',
        thirdPlaceMatch: thirdPlaceMatch({ status: 'bye', score_a: null, score_b: null }),
      }),
    ])
    expect(r[0].player).toEqual({ id: 'pa', name: 'Ada' })
  })

  it('skips a tournament with no third_place match', () => {
    const r = deriveThirdPlaces([thirdPlaceInput({ tournamentId: 't1', thirdPlaceMatch: null })])
    expect(r).toEqual([])
  })

  it('skips a drawn or in-progress third_place match', () => {
    expect(
      deriveThirdPlaces([
        thirdPlaceInput({ tournamentId: 't1', thirdPlaceMatch: thirdPlaceMatch({ score_a: 1, score_b: 1 }) }),
      ]),
    ).toEqual([])
    expect(
      deriveThirdPlaces([
        thirdPlaceInput({ tournamentId: 't2', thirdPlaceMatch: thirdPlaceMatch({ status: 'scheduled' }) }),
      ]),
    ).toEqual([])
  })

  it('orders most-recent-first with nulls last', () => {
    const r = deriveThirdPlaces([
      thirdPlaceInput({ tournamentId: 'old', tournamentEnd: '2025-01-01' }),
      thirdPlaceInput({ tournamentId: 'none', tournamentEnd: null }),
      thirdPlaceInput({ tournamentId: 'new', tournamentEnd: '2026-06-01' }),
    ])
    expect(r.map((c) => c.tournamentId)).toEqual(['new', 'old', 'none'])
  })
})
```

Update the top-of-file imports:

```ts
import {
  pickMVP,
  pickGoldenBoot,
  pickCategoryAward,
  deriveChampions,
  deriveThirdPlaces,
  type ChampionInput,
  type ThirdPlaceInput,
} from './awards'
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/hall-of-fame/awards.test.ts`
Expected: FAIL — `deriveThirdPlaces`/`ThirdPlaceInput` not exported.

- [ ] **Step 3: Implement `deriveThirdPlaces`**

In `lib/hall-of-fame/awards.ts`, update the import from `./bracket`:

```ts
import { getChampion, type BracketMatch } from '@/lib/tournaments/bracket'
```

to:

```ts
import { getChampion, getThirdPlace, type BracketMatch } from '@/lib/tournaments/bracket'
```

Add, at the end of the file, after `deriveChampions`:

```ts
export interface ThirdPlaceInput {
  tournamentId: string
  slug: string
  title: string
  gameName: string | null
  tournamentEnd: string | null
  thirdPlaceMatch: BracketMatch | null
}

export interface ThirdPlaceEntry {
  tournamentId: string
  slug: string
  title: string
  gameName: string | null
  date: string | null
  player: { id: string; name: string }
}

// One 3rd place entry per completed tournament with a decided third_place
// match — real (two semifinal losers played it) or admin-credited (a bye,
// single player). getThirdPlace enforces both shapes identically, so the
// winner rule is reused, never reimplemented. Ordered most-recent-first,
// nulls last — same ordering as deriveChampions. Kept as a separate
// function/types rather than generalizing deriveChampions itself, since
// ChampionInput/ChampionEntry are exercised by existing tests and consumers.
export function deriveThirdPlaces(inputs: ThirdPlaceInput[]): ThirdPlaceEntry[] {
  return inputs
    .flatMap((inp) => {
      if (!inp.thirdPlaceMatch) return []
      const w = getThirdPlace([inp.thirdPlaceMatch])
      if (!w) return []
      return [
        {
          tournamentId: inp.tournamentId,
          slug: inp.slug,
          title: inp.title,
          gameName: inp.gameName,
          date: inp.tournamentEnd,
          player: { id: w.id, name: w.name },
        },
      ]
    })
    .sort((a, b) => {
      if (a.date == null) return b.date == null ? 0 : 1
      if (b.date == null) return -1
      return b.date.localeCompare(a.date)
    })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/hall-of-fame/awards.test.ts`
Expected: PASS, all tests including the new `deriveThirdPlaces` block.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/hall-of-fame/awards.ts lib/hall-of-fame/awards.test.ts
git commit -m "feat(hall-of-fame): add deriveThirdPlaces"
```

---

### Task 9: Hall of Fame page — Bronze section

**Files:**
- Create: `components/hall-of-fame/PlacementCard.tsx`
- Delete: `components/hall-of-fame/ChampionCard.tsx`
- Modify: `app/(public)/hall-of-fame/page.tsx`

**Interfaces:**
- Consumes: `deriveThirdPlaces`, `type ThirdPlaceInput` (Task 8, `lib/hall-of-fame/awards.ts`).
- Produces: `PlacementCard` component, replacing `ChampionCard` as the shared card for both the Champions and new Bronze sections.

- [ ] **Step 1: Create `PlacementCard`**

```tsx
import Link from 'next/link'
import { formatMonthYear } from '@/lib/format'

export function PlacementCard({
  icon,
  playerName,
  slug,
  title,
  gameName,
  date,
  fallbackLabel,
}: {
  icon: string
  playerName: string
  slug: string
  title: string
  gameName: string | null
  date: string | null
  fallbackLabel: string
}) {
  const initial = (playerName[0] ?? '?').toUpperCase()
  const formattedDate = formatMonthYear(date)
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-lg">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-700 text-[11px] font-bold text-white">
            {initial}
          </div>
          <p className="truncate font-black text-white">{playerName}</p>
        </div>
        <Link
          href={`/tournaments/${slug}`}
          className="mt-1 block truncate text-sm text-violet-400 hover:text-violet-300"
        >
          {title}
        </Link>
        <p className="mt-0.5 text-xs text-slate-500">
          {gameName ?? fallbackLabel}
          {formattedDate ? ` · ${formattedDate}` : ''}
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Delete `ChampionCard.tsx`**

```bash
git rm components/hall-of-fame/ChampionCard.tsx
```

- [ ] **Step 3: Update the Hall of Fame page**

In `app/(public)/hall-of-fame/page.tsx`, update the imports:

```ts
import {
  pickMVP,
  pickGoldenBoot,
  pickCategoryAward,
  deriveChampions,
  deriveThirdPlaces,
  type ChampionInput,
  type ThirdPlaceInput,
} from '@/lib/hall-of-fame/awards'
import { scoreStatsByPlayerAndCategory, categoryStat, type GameScopedMatch } from '@/lib/rankings/game-breakdown'
import { CATEGORY_META } from '@/lib/games/categories'
import type { BracketMatch } from '@/lib/tournaments/bracket'
import { AwardCard } from '@/components/hall-of-fame/AwardCard'
import { PlacementCard } from '@/components/hall-of-fame/PlacementCard'
import { EmptyState } from '@/components/shared/EmptyState'
import { buildMetadata } from '@/lib/seo/metadata'
import { DEFAULT_OG_IMAGE } from '@/lib/seo/site'
```

(This replaces the `ChampionCard` import line with `PlacementCard`, and adds `deriveThirdPlaces`/`ThirdPlaceInput`.)

Add a third-place match query alongside the existing final-match query. Find:

```ts
  const { data: finalRows } =
    tournamentIds.length > 0
      ? await supabase
          .from('matches')
          .select(
            'id, tournament_id, round, status, score_a, score_b, ' +
              'player_a:profiles!matches_player_a_id_fkey(id, username, display_name), ' +
              'player_b:profiles!matches_player_b_id_fkey(id, username, display_name)',
          )
          .in('tournament_id', tournamentIds)
          .eq('round', 'final')
          .eq('status', 'completed')
      : { data: [] as unknown[] }
```

Add immediately after it:

```ts
  const { data: thirdPlaceRows } =
    tournamentIds.length > 0
      ? await supabase
          .from('matches')
          .select(
            'id, tournament_id, round, status, score_a, score_b, ' +
              'player_a:profiles!matches_player_a_id_fkey(id, username, display_name), ' +
              'player_b:profiles!matches_player_b_id_fkey(id, username, display_name)',
          )
          .in('tournament_id', tournamentIds)
          .eq('round', 'third_place')
          .in('status', ['completed', 'bye'])
      : { data: [] as unknown[] }
```

Find the `finalByTournament` map-building block:

```ts
  const finalByTournament = new Map<string, BracketMatch>()
  for (const raw of (finalRows as unknown[] | null) ?? []) {
    const m = raw as {
      id: string
      tournament_id: string
      round: string
      status: string
      score_a: number | null
      score_b: number | null
      player_a: ProfileRef
      player_b: ProfileRef
    }
    finalByTournament.set(m.tournament_id, {
      id: m.id,
      round: m.round,
      group_id: null,
      groupName: null,
      status: m.status,
      score_a: m.score_a,
      score_b: m.score_b,
      scheduled_at: null,
      is_full_day: false,
      playerA: { id: m.player_a?.id ?? '', name: nameOf(m.player_a) },
      playerB: { id: m.player_b?.id ?? '', name: nameOf(m.player_b) },
    })
  }
```

Add the equivalent for third place immediately after it:

```ts
  const thirdPlaceByTournament = new Map<string, BracketMatch>()
  for (const raw of (thirdPlaceRows as unknown[] | null) ?? []) {
    const m = raw as {
      id: string
      tournament_id: string
      round: string
      status: string
      score_a: number | null
      score_b: number | null
      player_a: ProfileRef
      player_b: ProfileRef
    }
    thirdPlaceByTournament.set(m.tournament_id, {
      id: m.id,
      round: m.round,
      group_id: null,
      groupName: null,
      status: m.status,
      score_a: m.score_a,
      score_b: m.score_b,
      scheduled_at: null,
      is_full_day: false,
      playerA: { id: m.player_a?.id ?? '', name: nameOf(m.player_a) },
      playerB: { id: m.player_b?.id ?? '', name: nameOf(m.player_b) },
    })
  }
```

Find the `championInputs`/`champions` block:

```ts
  const championInputs: ChampionInput[] = tournaments.map((t) => ({
    tournamentId: t.id,
    slug: t.slug,
    title: t.title,
    gameName: firstGameName(t.games),
    tournamentEnd: t.tournament_end,
    finalMatch: finalByTournament.get(t.id) ?? null,
  }))
  const champions = deriveChampions(championInputs)
```

Add immediately after it:

```ts
  const thirdPlaceInputs: ThirdPlaceInput[] = tournaments.map((t) => ({
    tournamentId: t.id,
    slug: t.slug,
    title: t.title,
    gameName: firstGameName(t.games),
    tournamentEnd: t.tournament_end,
    thirdPlaceMatch: thirdPlaceByTournament.get(t.id) ?? null,
  }))
  const thirdPlaces = deriveThirdPlaces(thirdPlaceInputs)
```

Find:

```ts
  const hasAwards = mvp != null || goldenBoot != null || categoryAwards.length > 0
  const hasChampions = champions.length > 0
```

Change to:

```ts
  const hasAwards = mvp != null || goldenBoot != null || categoryAwards.length > 0
  const hasChampions = champions.length > 0
  const hasBronze = thirdPlaces.length > 0
```

Find the top-level empty-state gate:

```tsx
      {!hasAwards && !hasChampions ? (
```

Change to:

```tsx
      {!hasAwards && !hasChampions && !hasBronze ? (
```

Find the Champions section's card rendering:

```tsx
              <div className="grid gap-4 sm:grid-cols-2">
                {champions.map((c) => (
                  <ChampionCard key={c.tournamentId} entry={c} />
                ))}
              </div>
```

Change to:

```tsx
              <div className="grid gap-4 sm:grid-cols-2">
                {champions.map((c) => (
                  <PlacementCard
                    key={c.tournamentId}
                    icon="🏆"
                    playerName={c.champion.name}
                    slug={c.slug}
                    title={c.title}
                    gameName={c.gameName}
                    date={c.date}
                    fallbackLabel="Champion"
                  />
                ))}
              </div>
```

Find the end of the Champions `</section>` (right before the closing `</>` / `)}`):

```tsx
          <section className="mb-10">
            <h2 className="mb-4 text-base font-bold text-white">🏆 Champions</h2>
            {hasChampions ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {champions.map((c) => (
                  <PlacementCard
                    key={c.tournamentId}
                    icon="🏆"
                    playerName={c.champion.name}
                    slug={c.slug}
                    title={c.title}
                    gameName={c.gameName}
                    date={c.date}
                    fallbackLabel="Champion"
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                icon="🏆"
                title="No champions crowned yet"
                body="Winners appear here when tournaments finish and finals are confirmed."
              />
            )}
          </section>
        </>
      )}
```

Add the Bronze section right after the Champions `</section>`, still inside the `<>`:

```tsx
          <section className="mb-10">
            <h2 className="mb-4 text-base font-bold text-white">🏆 Champions</h2>
            {hasChampions ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {champions.map((c) => (
                  <PlacementCard
                    key={c.tournamentId}
                    icon="🏆"
                    playerName={c.champion.name}
                    slug={c.slug}
                    title={c.title}
                    gameName={c.gameName}
                    date={c.date}
                    fallbackLabel="Champion"
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                icon="🏆"
                title="No champions crowned yet"
                body="Winners appear here when tournaments finish and finals are confirmed."
              />
            )}
          </section>

          <section className="mb-10">
            <h2 className="mb-4 text-base font-bold text-white">🥉 Bronze</h2>
            {hasBronze ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {thirdPlaces.map((tp) => (
                  <PlacementCard
                    key={tp.tournamentId}
                    icon="🥉"
                    playerName={tp.player.name}
                    slug={tp.slug}
                    title={tp.title}
                    gameName={tp.gameName}
                    date={tp.date}
                    fallbackLabel="Third Place"
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                icon="🥉"
                title="No third place finishes yet"
                body="3rd place winners appear here once a bronze match is confirmed."
              />
            )}
          </section>
        </>
      )}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 6: Manual verification**

Start the dev server, open `/hall-of-fame`. Confirm the Champions section still renders correctly (visually unchanged, now via `PlacementCard`), and the new "🥉 Bronze" section appears right after it — showing the credited/confirmed 3rd place entries from earlier tasks' manual verification, or its empty state if none exist yet.

- [ ] **Step 7: Commit**

```bash
git add components/hall-of-fame/PlacementCard.tsx "app/(public)/hall-of-fame/page.tsx"
git commit -m "feat(hall-of-fame): add Bronze section"
```

---

### Task 10: Full suite, build, and DB sanity check

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass (existing + every test added in Tasks 2, 3, 8).

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: builds successfully with no errors.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 4: Read-only DB sanity check**

Using the Supabase MCP `execute_sql` tool (read-only) against project id `itxubrkbropttfdackmi`: confirm the `matches_round_check` constraint includes `third_place` —

```sql
select pg_get_constraintdef(oid) from pg_constraint where conname = 'matches_round_check';
```

Expected: the definition string includes `'third_place'`.

- [ ] **Step 5: End-to-end manual walkthrough**

Using a dev/staging tournament (or the current in-flight one, carefully):
1. As admin, confirm both semifinal matches of a knockout bracket with decisive scores. Confirm a `third_place` match appears in `/admin/results` (the score-confirmation queue) and in `/admin/tournaments/<id>/matches` under "Third Place Match".
2. Confirm its score there. Confirm the bracket page's "🥉 Third Place" block and the Hall of Fame "🥉 Bronze" section both show the winner.
3. Confirm the Final's confirmation still completes the tournament and pays the champion the full prize pool exactly once (unaffected by the bronze match).
4. Use the manual credit form on a different tournament (or the one referenced in this feature's original request) to credit a player as 3rd place with no match played. Confirm it shows correctly everywhere the real-match case does, and that a second credit/match attempt for the same tournament is rejected.
