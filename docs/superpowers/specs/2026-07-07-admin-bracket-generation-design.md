# Admin Bracket Generation — Design (#9 sub-project 3 of 6)

**Routes:** `/admin/tournaments/[id]/bracket` (new); modifies `/tournaments/[slug]/bracket`
**Date:** 2026-07-07
**Status:** Approved, ready for implementation plan

## Context

Third of the six Admin Dashboard sub-projects. When an admin closes registration, the system
auto-calculates the initial bracket from the **paid** registrations, the admin can re-roll it,
then publishes it (the tournament goes `active`). Builds on the shell (`requireStaff`) and
sub-project 2 (which owns everything up to opening registration). Reuses the existing public
bracket components and `sortStandings`.

**Scope boundary:** this generates only what is computable from registrations alone —

- **Group stage (9–64 players):** groups + memberships + *all* round-robin matches.
- **≤8 players:** the **first knockout round** only (with byes).

All *later* knockout rounds — the ≤8 progression **and** the post-group knockout — are generated
from verified results by a shared engine in **sub-project 5**. This sub-project owns the
`registration_open → registration_closed` and `registration_closed → active` transitions (which
sub-project 2 deferred here).

## Migration `006_knockout_support.sql`

A single-elim bracket can only ever materialize its current round (round N+1's participants are
unknown until round N is verified), and byes need a one-sided row. The current schema blocks
both: `matches.player_a_id`/`player_b_id` are `NOT NULL` and `status` has no `'bye'`. So:

```sql
ALTER TABLE public.matches ALTER COLUMN player_a_id DROP NOT NULL;
ALTER TABLE public.matches ALTER COLUMN player_b_id DROP NOT NULL;

ALTER TABLE public.matches DROP CONSTRAINT matches_status_check;
ALTER TABLE public.matches
  ADD CONSTRAINT matches_status_check
  CHECK (status IN ('scheduled', 'live', 'completed', 'disputed', 'cancelled', 'bye'));
```

**Downstream null-guard surface (must be handled in this sub-project):**
- `lib/dashboard/fixtures.ts` — add `'bye'` to the `RESOLVED` status set so a bye is never
  "awaiting my result". The `submittedMatchIds`/`player_a_id === user.id` comparisons are already
  null-safe (a null slot is compared against a non-null user id and cannot match), but this is
  pinned explicitly.
- Match Centre — the result-submission path must never accept a bye. Add `status !== 'bye'` to
  the eligibility check in `lib/matches/actions.ts` `submitMatchResult` (alongside the existing
  `cancelled`/`completed` guards) **and** the page must not render `ResultSubmissionForm` for a
  bye row.
- The bracket page and dashboard already resolve a missing player via `nameOf(...) → 'TBD'`, so a
  null slot renders safely.

After applying via Supabase MCP (project `itxubrkbropttfdackmi`), regenerate
`lib/supabase/types.ts` (player id columns become `string | null`).

## Pure draw helpers — `lib/tournaments/draw.ts` (unit-tested)

No Supabase, no randomness — the impure seed ordering happens in the action; these take an
already-seeded id list.

```ts
export function groupCountFor(n: number): 0 | 2 | 4 | 8
// n<=8 -> 0 (straight knockout); 9-16 -> 2; 17-32 -> 4; 33-64 -> 8.

export function snakeDistribute(orderedPlayerIds: string[], groups: number): string[][]
// Snake draft: index 0..g-1 forward, g..2g-1 reversed, ... for competitive balance.

export function roundRobinPairs(playerIds: string[]): [string, string][]
// Every unordered pair once (all-play-all within a group).

export function knockoutRound1(orderedPlayerIds: string[]): {
  round: 'final' | 'semi_final' | 'quarter_final'
  matches: [string, string][]
  byePlayerIds: string[]
}
// bracketSize = next power of 2 >= n (2/4/8). byes = bracketSize - n, given to the top
// `byes` seeds. The remaining players pair highest-vs-lowest. round is named from bracketSize
// (2->final, 4->semi_final, 8->quarter_final).
```

Worked cases: n=8 → 4 QF matches, 0 byes. n=6 → 2 QF matches, byes=[seed0,seed1]. n=5 → 1 QF
match, byes=[seed0,seed1,seed2]. n=3 → 1 SF match, byes=[seed0]. n=2 → 1 final, 0 byes.

## Seeding (impure, in the action)

Paid players are ordered by `sentinel_score` **descending, ties broken randomly**, then fed to
the pure helpers. At launch every score is the default 70, so the random tiebreak makes it an
effectively random draw; as scores diverge the draw becomes competitively seeded — no mode
switch. The random tiebreak is also what makes "Re-roll draw" produce a different draw.

## Server actions — `lib/tournaments/bracket-admin-actions.ts`

All `requireStaff`; all use the **service-role admin client** (`createAdminClient`) for the bulk
writes (trusted, already role-gated; avoids per-table insert-RLS gaps — same pattern as
`lib/tournaments/confirm.ts`). Each `revalidatePath`s the admin bracket page, the public bracket
page, and `/admin/tournaments`.

- `closeRegistration(tournamentId)` — require `status = 'registration_open'`. Load **paid**
  registrations; if `< 2` return an error and stay open ("Need at least 2 paid players to close
  registration."); if `> 64` return an error ("At most 64 players are supported."). Otherwise set
  `status = 'registration_closed'` and **generate** the initial bracket (below). Auto-generating
  on close matches "closing registration auto-calculates groups."
- `generateBracket(tournamentId)` (**re-roll**) — require `status = 'registration_closed'` (locked
  once `active`). Regenerate: this is the shared generation routine, also called by
  `closeRegistration`.
- `publishBracket(tournamentId)` — require `status = 'registration_closed'` and that a bracket
  exists (≥1 group or ≥1 knockout match); set `status = 'active'` (locks re-roll, makes the
  bracket public).

**Generation routine (shared):**
1. Load paid `player_id`s + each player's `sentinel_score`; order them (seeding above).
2. **Idempotent cleanup (re-roll):** delete this tournament's `groups` (CASCADE removes
   `group_memberships` + group matches) and delete its knockout matches (`group_id IS NULL`).
3. `g = groupCountFor(n)`:
   - **g = 0 (≤8):** `knockoutRound1(seeded)` → insert a `matches` row per pair
     (`round = result.round`, `group_id = null`, both players, `status = 'scheduled'`,
     `scheduled_at = null`) and, per `byePlayerId`, a **bye row** (`round = result.round`,
     `player_a_id = byePlayerId`, `player_b_id = null`, `status = 'bye'`). The bye's advancing
     player is known at creation — it is **terminal**; sub-project 5 reads it like any completed
     match. Do NOT write later rounds.
   - **g > 0:** `snakeDistribute(seeded, g)` → per group index `i`: insert a `groups` row
     (`name = 'Group ' + String.fromCharCode(65 + i)`), a zeroed `group_memberships` row per
     player, and, from `roundRobinPairs(groupPlayers)`, a `matches` row per pair
     (`round = 'group'`, `group_id`, both players, `status = 'scheduled'`, `scheduled_at = null`).

## Admin bracket page — `app/admin/tournaments/[id]/bracket/page.tsx`

A staff surface to drive and preview the bracket. Fetches the tournament, its groups +
memberships + matches (as the public bracket page does), and renders:
- A status-aware **action bar** (client component `BracketActions`):
  - `registration_open` → **Close registration & generate** button.
  - `registration_closed` → **Re-roll draw** + **Publish bracket** buttons.
  - `active`/`completed` → a "Bracket is live — locked" note (no actions).
  - Surfaces action errors (too few/many players, etc.).
- The generated structure, **reusing the existing `GroupStage` / `KnockoutBracket` components**
  (`components/bracket/`) and `sortStandings` — the same rendering the public page uses.
- Linked from `TournamentListRow` (a "Bracket" link) and the edit page.

## Public bracket preview gate — modify `app/(public)/tournaments/[slug]/bracket/page.tsx`

So generate = staff-only preview and publish = public: when `status = 'registration_closed'`,
show the bracket only to staff (`getStaffContext().isStaff`); everyone else sees a
"Bracket is being finalized" state. For `active`/`completed` it is public as today; for
`draft`/`registration_open` nothing is generated yet (unchanged). This is the only change to the
already-shipped public bracket page.

## Components — `components/admin/`

- `BracketActions.tsx` (`"use client"`, `useFormState` per action) — the status-aware action bar.

## Security

- Every action is `requireStaff`-gated; generation/publish re-check the tournament status
  server-side (never trusting the UI). Writes use the service-role client behind that gate.
- RLS still governs all reads. The public bracket page's preview gate is defence-in-depth on top
  of the (public) `matches`/`groups` read policies.

## Testing

Vitest on `lib/tournaments/draw.ts`:
- `groupCountFor` boundaries: 8→0, 9→2, 16→2, 17→4, 32→4, 33→8, 64→8.
- `snakeDistribute`: even and remainder distributions land in the right groups, snake direction
  alternates, all players placed once.
- `roundRobinPairs`: a group of `s` yields `s*(s-1)/2` unique pairs.
- `knockoutRound1`: the worked cases above (n = 2, 3, 5, 6, 7, 8) — match count, bye set, and
  round name.

Actions/pages are I/O-bound (Supabase + `redirect`/`revalidatePath`) — exercised via the build
and manual admin testing.

## Consistency notes

- Mobile-first; the admin bracket page reuses the responsive bracket components.
- Do NOT mark roadmap #9 done (sub-project 3 of 6).
- Sub-project 5's spec must state: its advancement engine handles only matches with **two**
  verified participants and reads a bye row's pre-known winner — it never resolves byes itself.
