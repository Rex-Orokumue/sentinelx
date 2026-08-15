# Live Provisional Season Standings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show still-competing players a guaranteed-floor "live" standing on the Champions Cup qualification leaderboard, instead of nothing until their tournament ends.

**Architecture:** One new pure function (`guaranteedBandsForPlacements`, mirrors the existing `bandsForPlacements` but computes "furthest round reached" instead of "round eliminated in"), wired into the existing `getSeasonLeaderboard` read path with zero new tables and zero new writes. `season_ranking_points` itself, and everything that reads it for Masters/Champions Cup qualification (`lib/seasons/invitation-actions.ts`), is untouched.

**Tech Stack:** Next.js 14, Supabase, Vitest.

## Global Constraints

- Provisional points are a **guaranteed floor**, never a speculative/weighted estimate (design spec decision #1).
- Masters/Champions Cup qualification ranking reads only real, locked-in `season_ranking_points` rows — this design never touches `selectInvitees` or `leaderboardFor` (design spec decision #2).
- Nothing new is persisted to the database — computed fresh on every read (design spec decision #4).
- Full spec: `docs/superpowers/specs/2026-08-15-live-provisional-season-standings-design.md`.

---

## File Structure

```
lib/tournaments/season-placement.ts       (modify — add guaranteedBandsForPlacements)
lib/tournaments/season-placement.test.ts  (create — new test file for this function)
lib/seasons/data.ts                       (modify — extend getSeasonLeaderboard, toRows, SeasonLeaderboardRow)
lib/seasons/data.test.ts                  (modify — extend, existing file from today's earlier fix)
components/seasons/SeasonLeaderboardTable.tsx  (modify — render the provisional tag)
```

---

## Task 1: `guaranteedBandsForPlacements` — the floor calculation

**Files:**
- Modify: `lib/tournaments/season-placement.ts`
- Create: `lib/tournaments/season-placement.test.ts`

**Interfaces:**
- Consumes: `ROUND_ORDER` (`./bracket`, already imported by this file — `['round_of_32', 'round_of_16', 'quarter_final', 'semi_final', 'final'] as const`), `PlacementMatch`, `PlacementBand` (both already defined in this file).
- Produces: `guaranteedBandsForPlacements(matches: PlacementMatch[], activePlayerIds: string[]): PlacementResult[]` — same signature and return shape as the existing `bandsForPlacements`. Consumed by Task 2.

- [ ] **Step 1: Write the failing tests**

Check whether `lib/tournaments/season-placement.test.ts` already exists (it may, from the original season system work) — if so, extend it rather than replacing it; if not, create it fresh with this content:

```ts
import { describe, it, expect } from 'vitest'
import { guaranteedBandsForPlacements, type PlacementMatch } from './season-placement'

describe('guaranteedBandsForPlacements', () => {
  it('gives a still-alive player the round they are currently entered in as their floor', () => {
    const matches: PlacementMatch[] = [
      { round: 'quarter_final', status: 'completed', player_a_id: 'p1', player_b_id: 'p2', score_a: 3, score_b: 1 },
      { round: 'semi_final', status: 'scheduled', player_a_id: 'p1', player_b_id: 'p3', score_a: null, score_b: null },
    ]
    const result = guaranteedBandsForPlacements(matches, ['p1', 'p2', 'p3'])
    expect(result).toEqual(
      expect.arrayContaining([{ playerId: 'p1', band: 'semi_final' }]),
    )
  })

  it('gives an already-eliminated player their real, locked band (same as bandsForPlacements would)', () => {
    const matches: PlacementMatch[] = [
      { round: 'quarter_final', status: 'completed', player_a_id: 'p1', player_b_id: 'p2', score_a: 3, score_b: 1 },
    ]
    const result = guaranteedBandsForPlacements(matches, ['p2'])
    expect(result).toEqual([{ playerId: 'p2', band: 'quarter_final' }])
  })

  it('defaults to non_advancer for a player with no knockout-round appearance at all', () => {
    const result = guaranteedBandsForPlacements([], ['p1'])
    expect(result).toEqual([{ playerId: 'p1', band: 'non_advancer' }])
  })

  it('a bye advances its player into the next round even if that round has no match yet', () => {
    const matches: PlacementMatch[] = [
      { round: 'round_of_16', status: 'bye', player_a_id: 'p1', player_b_id: null, score_a: null, score_b: null },
    ]
    const result = guaranteedBandsForPlacements(matches, ['p1'])
    expect(result).toEqual([{ playerId: 'p1', band: 'quarter_final' }])
  })

  it('a later round appearance overrides an earlier one for the same player', () => {
    const matches: PlacementMatch[] = [
      { round: 'round_of_16', status: 'completed', player_a_id: 'p1', player_b_id: 'p4', score_a: 2, score_b: 0 },
      { round: 'quarter_final', status: 'completed', player_a_id: 'p1', player_b_id: 'p5', score_a: 2, score_b: 1 },
      { round: 'semi_final', status: 'scheduled', player_a_id: 'p1', player_b_id: 'p6', score_a: null, score_b: null },
    ]
    const result = guaranteedBandsForPlacements(matches, ['p1'])
    expect(result).toEqual([{ playerId: 'p1', band: 'semi_final' }])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/tournaments/season-placement.test.ts` — expect FAIL, `guaranteedBandsForPlacements` doesn't exist.

- [ ] **Step 3: Implement**

Read the current `lib/tournaments/season-placement.ts` in full first — this task adds a new exported function alongside the existing `bandsForPlacements`, it does not modify that function. Add the following, placed directly after `bandsForPlacements`'s closing brace:

```ts
// The guaranteed floor for a still-competing player: the furthest round
// they've already secured passage into, regardless of whether that round's
// match has been played (or even generated) yet. Unlike bandsForPlacements
// (which only assigns a band on a LOSS), this assigns a band the moment a
// player is KNOWN to be in a given round — a real match listing them as a
// participant proves they survived everything before it, so "if they lose
// this exact match" is their honest worst-case outcome right now. Rounds
// are walked in order so a later appearance always overrides an earlier
// one. For a player who has already been eliminated mid-tournament, this
// happens to return the exact same (now-locked) band bandsForPlacements
// would — there's no remaining uncertainty for them either way.
export function guaranteedBandsForPlacements(
  matches: PlacementMatch[],
  activePlayerIds: string[],
): PlacementResult[] {
  const floor = new Map<string, PlacementBand>()

  for (let i = 0; i < ROUND_ORDER.length; i++) {
    const round = ROUND_ORDER[i]
    const nextRound = ROUND_ORDER[i + 1] as PlacementBand | undefined
    const roundMatches = matches.filter((m) => m.round === round)

    for (const match of roundMatches) {
      if (match.status === 'bye') {
        // A bye auto-advances its one real participant into the next
        // round, even if that round's match row doesn't exist in the DB
        // yet (bracket generation for later rounds waits on this round
        // finishing).
        const soloPlayer = match.player_a_id ?? match.player_b_id
        if (soloPlayer && nextRound) floor.set(soloPlayer, nextRound)
        continue
      }
      if (match.player_a_id) floor.set(match.player_a_id, round as PlacementBand)
      if (match.player_b_id) floor.set(match.player_b_id, round as PlacementBand)
    }
  }

  return activePlayerIds.map((playerId) => ({
    playerId,
    band: floor.get(playerId) ?? 'non_advancer',
  }))
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/tournaments/season-placement.test.ts` — expect PASS, all 5 tests.

- [ ] **Step 5: Run the full tournaments suite**

Run: `npx vitest run lib/tournaments` — expect PASS (catches any accidental regression in the existing `bandsForPlacements` tests in the same file).

- [ ] **Step 6: Commit**

```bash
git add lib/tournaments/season-placement.ts lib/tournaments/season-placement.test.ts
git commit -m "feat(seasons): add guaranteedBandsForPlacements for live provisional standing"
```

---

## Task 2: Wire provisional standings into `getSeasonLeaderboard`

**Files:**
- Modify: `lib/seasons/data.ts`
- Modify: `lib/seasons/data.test.ts`

**Interfaces:**
- Consumes: `guaranteedBandsForPlacements`, `pointsForBand`, `type PlacementMatch`, `type SeasonTournamentType` (Task 1 + existing exports from `lib/tournaments/season-placement.ts`).
- Produces: `SeasonLeaderboardRow` gains one new field, `isProvisional: boolean`. `getSeasonLeaderboard`'s signature is unchanged. `toRows` gains a third parameter, `provisionalPlayerIds: Set<string>` — internal to this file, not exported, but `getMonthlyLeaderboard` (the other caller of `toRows` in this same file) needs updating to pass `new Set()` since provisional standings are explicitly out of scope for the Masters monthly leaderboard.

- [ ] **Step 1: Write the failing tests**

Read the current `lib/seasons/data.test.ts` in full first (it already has 3 tests from today's earlier LEFT JOIN fix — extend the file, don't replace it). The existing `fakeAdmin` helper needs two additions: a `status`/`tournament_type` field on the tournaments fixture (currently just returns `{ id }` rows), and mock handlers for the per-tournament `matches` and per-tournament `tournament_registrations` queries Task 2's implementation will issue. Replace the whole file with:

```ts
import { describe, it, expect } from 'vitest'
import { getSeasonLeaderboard } from './data'

function fakeAdmin(opts: {
  seasonTournaments: { id: string; status: string; tournament_type: string }[]
  registeredPlayerIds: string[]
  pointsRows: { player_id: string; points: number }[]
  penaltyRows: { player_id: string; points: number }[]
  profiles: { id: string; username: string | null; display_name: string | null; avatar_url: string | null; sx_score: number }[]
  // keyed by tournament id -> that tournament's active registrations + matches,
  // only consulted for tournaments with status 'active'.
  perTournament?: Record<string, { activePlayerIds: string[]; matches: unknown[] }>
}) {
  return {
    from(table: string) {
      if (table === 'tournaments') {
        return {
          select: () => ({
            eq: () => ({
              in: async () => ({ data: opts.seasonTournaments }),
            }),
          }),
        }
      }
      if (table === 'tournament_registrations') {
        return {
          select: () => ({
            in: () => ({
              eq: async () => ({ data: opts.registeredPlayerIds.map((player_id) => ({ player_id })) }),
            }),
            eq: (col: string, val: string) => ({
              eq: async () => ({
                data: (opts.perTournament?.[val]?.activePlayerIds ?? []).map((player_id) => ({ player_id })),
              }),
            }),
          }),
        }
      }
      if (table === 'matches') {
        return {
          select: () => ({
            eq: async (col: string, val: string) => ({ data: opts.perTournament?.[val]?.matches ?? [] }),
          }),
        }
      }
      if (table === 'season_ranking_points') {
        return { select: () => ({ eq: async () => ({ data: opts.pointsRows }) }) }
      }
      if (table === 'season_noshow_penalties') {
        return { select: () => ({ eq: async () => ({ data: opts.penaltyRows }) }) }
      }
      if (table === 'profiles') {
        return { select: () => ({ in: async () => ({ data: opts.profiles }) }) }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

describe('getSeasonLeaderboard', () => {
  it('includes a registered player with zero points, not just players with a points/penalty row', async () => {
    const admin = fakeAdmin({
      seasonTournaments: [{ id: 't1', status: 'completed', tournament_type: 'community_club' }],
      registeredPlayerIds: ['p1', 'p2'],
      pointsRows: [{ player_id: 'p1', points: 500 }],
      penaltyRows: [],
      profiles: [
        { id: 'p1', username: 'winner', display_name: null, avatar_url: null, sx_score: 900 },
        { id: 'p2', username: 'still-competing', display_name: null, avatar_url: null, sx_score: 700 },
      ],
    })
    const rows = await getSeasonLeaderboard(admin as never, 's1')
    const usernames = rows.map((r) => r.username).sort()
    expect(usernames).toEqual(['still-competing', 'winner'])
    const zero = rows.find((r) => r.username === 'still-competing')
    expect(zero?.points).toBe(0)
    expect(zero?.isProvisional).toBe(false)
  })

  it('still sums season_ranking_points and season_noshow_penalties together for a player who has both', async () => {
    const admin = fakeAdmin({
      seasonTournaments: [{ id: 't1', status: 'completed', tournament_type: 'community_club' }],
      registeredPlayerIds: ['p1'],
      pointsRows: [{ player_id: 'p1', points: 500 }],
      penaltyRows: [{ player_id: 'p1', points: -15 }],
      profiles: [{ id: 'p1', username: 'winner', display_name: null, avatar_url: null, sx_score: 900 }],
    })
    const rows = await getSeasonLeaderboard(admin as never, 's1')
    expect(rows).toEqual([
      { playerId: 'p1', username: 'winner', displayName: null, avatarUrl: null, sxScore: 900, points: 485, isProvisional: false },
    ])
  })

  it('returns an empty list when the season has no community_club/masters tournaments at all', async () => {
    const admin = fakeAdmin({
      seasonTournaments: [],
      registeredPlayerIds: [],
      pointsRows: [],
      penaltyRows: [],
      profiles: [],
    })
    const rows = await getSeasonLeaderboard(admin as never, 's1')
    expect(rows).toEqual([])
  })

  it('gives a still-competing player in an active tournament a provisional floor, marked isProvisional', async () => {
    const admin = fakeAdmin({
      seasonTournaments: [{ id: 't2', status: 'active', tournament_type: 'community_club' }],
      registeredPlayerIds: ['p1'],
      pointsRows: [],
      penaltyRows: [],
      profiles: [{ id: 'p1', username: 'stillin', display_name: null, avatar_url: null, sx_score: 700 }],
      perTournament: {
        t2: {
          activePlayerIds: ['p1'],
          matches: [
            { round: 'semi_final', status: 'scheduled', player_a_id: 'p1', player_b_id: 'p9', score_a: null, score_b: null },
          ],
        },
      },
    })
    const rows = await getSeasonLeaderboard(admin as never, 's1')
    // semi_final band on the community_club table = placement 3 = 45 points
    // (COMMUNITY_CLUB_POINTS.semi_final, lib/tournaments/season-placement.ts).
    expect(rows).toEqual([
      { playerId: 'p1', username: 'stillin', displayName: null, avatarUrl: null, sxScore: 700, points: 45, isProvisional: true },
    ])
  })

  it('does not let a provisional contribution overwrite or double-count a real locked-in row', async () => {
    // p1 already has a real, locked 500-point row from a COMPLETED tournament
    // (t1), and is also still competing in a second, ACTIVE tournament (t2)
    // in the same season. Both must combine into one total, and the row
    // must be marked provisional since part of it can still move.
    const admin = fakeAdmin({
      seasonTournaments: [
        { id: 't1', status: 'completed', tournament_type: 'community_club' },
        { id: 't2', status: 'active', tournament_type: 'community_club' },
      ],
      registeredPlayerIds: ['p1'],
      pointsRows: [{ player_id: 'p1', points: 500 }],
      penaltyRows: [],
      profiles: [{ id: 'p1', username: 'double', display_name: null, avatar_url: null, sx_score: 900 }],
      perTournament: {
        t2: {
          activePlayerIds: ['p1'],
          matches: [
            { round: 'quarter_final', status: 'scheduled', player_a_id: 'p1', player_b_id: 'p9', score_a: null, score_b: null },
          ],
        },
      },
    })
    const rows = await getSeasonLeaderboard(admin as never, 's1')
    // 500 real + 25 provisional (quarter_final = placement 5 = 25 points).
    expect(rows).toEqual([
      { playerId: 'p1', username: 'double', displayName: null, avatarUrl: null, sxScore: 900, points: 525, isProvisional: true },
    ])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/seasons/data.test.ts` — expect FAIL (the existing 3 tests fail too at this point, since the mock's `tournaments` fixture shape changed from `{id}` to `{id,status,tournament_type}` and the real implementation doesn't request/use those fields yet).

- [ ] **Step 3: Implement**

Read the current `lib/seasons/data.ts` in full first. Replace the file's imports, `SeasonLeaderboardRow`, `toRows`, and `getSeasonLeaderboard` as follows — `playerProfiles`, `ProfileInfo`, and `getMonthlyLeaderboard`'s internals are otherwise unchanged, but `getMonthlyLeaderboard`'s final `toRows` call needs its new third argument added (see the note after the code block):

```ts
import { createAdminClient } from '@/lib/supabase/admin'
import { sumPointsByPlayer, type PointsRow } from './points-aggregate'
import {
  guaranteedBandsForPlacements,
  pointsForBand,
  type PlacementMatch,
  type SeasonTournamentType,
} from '@/lib/tournaments/season-placement'

type Admin = ReturnType<typeof createAdminClient>

export interface SeasonLeaderboardRow {
  playerId: string
  username: string | null
  displayName: string | null
  avatarUrl: string | null
  sxScore: number
  points: number
  /** True if any part of this player's total comes from a still-active
   *  tournament's guaranteed-floor estimate rather than a locked-in
   *  season_ranking_points row — the number can still go up. */
  isProvisional: boolean
}
```

(Leave `ProfileInfo` and `playerProfiles` exactly as they are — not shown here, don't delete them.)

```ts
function toRows(
  totals: Map<string, number>,
  profiles: Map<string, ProfileInfo>,
  provisionalPlayerIds: Set<string>,
): SeasonLeaderboardRow[] {
  return Array.from(totals.entries())
    .map(([playerId, points]) => {
      const p = profiles.get(playerId)
      return {
        playerId,
        username: p?.username ?? null,
        displayName: p?.displayName ?? null,
        avatarUrl: p?.avatarUrl ?? null,
        sxScore: p?.sxScore ?? 0,
        points,
        isProvisional: provisionalPlayerIds.has(playerId),
      }
    })
    .sort((a, b) => b.points - a.points)
}

// Every player actively registered in one of this season's community_club/
// masters tournaments, ranked by total points desc. Real, locked-in points
// come from season_ranking_points (written once, at tournament completion —
// see lib/matches/season-points.ts). A player still competing in a tournament
// that hasn't completed yet additionally gets a provisional guaranteed-floor
// contribution computed live from that tournament's current match state
// (guaranteedBandsForPlacements) — never persisted, recomputed on every read,
// and clearly marked via isProvisional so a still-moving number is never
// mistaken for a final one. Used for Champions Cup qualification (spec §4,
// "season cumulative") — that qualification ranking (lib/seasons/
// invitation-actions.ts) reads real season_ranking_points rows directly and
// is completely unaffected by this provisional layer.
export async function getSeasonLeaderboard(admin: Admin, seasonId: string): Promise<SeasonLeaderboardRow[]> {
  const { data: seasonTournamentsData } = await admin
    .from('tournaments')
    .select('id, status, tournament_type')
    .eq('season_id', seasonId)
    .in('tournament_type', ['community_club', 'masters'])
  const seasonTournaments = seasonTournamentsData ?? []
  const tournamentIds = seasonTournaments.map((t) => t.id)
  const activeTournaments = seasonTournaments.filter((t) => t.status === 'active')

  const [{ data: registrations }, { data: pointsRows }, { data: penaltyRows }, provisionalByTournament] = await Promise.all([
    tournamentIds.length > 0
      ? admin.from('tournament_registrations').select('player_id').in('tournament_id', tournamentIds).eq('status', 'active')
      : Promise.resolve({ data: [] as { player_id: string }[] }),
    admin.from('season_ranking_points').select('player_id, points').eq('season_id', seasonId),
    admin.from('season_noshow_penalties').select('player_id, points').eq('season_id', seasonId),
    Promise.all(
      activeTournaments.map(async (t) => {
        const [{ data: activeRegs }, { data: matches }] = await Promise.all([
          admin.from('tournament_registrations').select('player_id').eq('tournament_id', t.id).eq('status', 'active'),
          admin.from('matches').select('round, status, player_a_id, player_b_id, score_a, score_b').eq('tournament_id', t.id),
        ])
        const activePlayerIds = (activeRegs ?? []).map((r) => r.player_id)
        const placements = guaranteedBandsForPlacements((matches ?? []) as PlacementMatch[], activePlayerIds)
        const tournamentType = t.tournament_type as SeasonTournamentType
        return placements.map(({ playerId, band }) => ({
          playerId,
          points: pointsForBand(tournamentType, band),
        }))
      }),
    ),
  ])

  const provisionalRows = provisionalByTournament.flat()
  const rows: PointsRow[] = [
    ...(pointsRows ?? []).map((r) => ({ playerId: r.player_id, points: r.points })),
    ...(penaltyRows ?? []).map((r) => ({ playerId: r.player_id, points: r.points })),
    ...provisionalRows,
  ]
  const totals = sumPointsByPlayer(rows)
  const provisionalPlayerIds = new Set(provisionalRows.map((r) => r.playerId))

  // Guarantee every actively-registered season player appears, even at 0.
  for (const reg of registrations ?? []) {
    if (!totals.has(reg.player_id)) totals.set(reg.player_id, 0)
  }

  const profiles = await playerProfiles(admin, Array.from(totals.keys()))
  return toRows(totals, profiles, provisionalPlayerIds)
}
```

In `getMonthlyLeaderboard`, find its existing final line, `return toRows(totals, profiles)`, and change it to `return toRows(totals, profiles, new Set())` — provisional standings are explicitly out of scope for the Masters monthly leaderboard per the design spec, so every row it returns is real/locked-in, never provisional.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/seasons/data.test.ts` — expect PASS, all 5 tests.

- [ ] **Step 5: Run the full seasons + tournaments suite**

Run: `npx vitest run lib/seasons lib/tournaments` — expect PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/seasons/data.ts lib/seasons/data.test.ts
git commit -m "feat(seasons): wire live provisional standings into getSeasonLeaderboard"
```

---

## Task 3: Show the provisional tag in the UI

**Files:**
- Modify: `components/seasons/SeasonLeaderboardTable.tsx`

**Interfaces:**
- Consumes: `SeasonLeaderboardRow.isProvisional` (Task 2).

- [ ] **Step 1: Read the current file in full**

Read `components/seasons/SeasonLeaderboardTable.tsx` in full — it's short (52 lines), reproduced in relevant part below for reference, but read the real file before editing since exact whitespace/structure matters for a clean diff.

- [ ] **Step 2: Add the provisional tag next to the player name**

Find the table row's player-name `<td>`:

```tsx
                  <td className="px-4 py-3 font-semibold text-white">
                    {row.displayName ?? row.username ?? 'Player'}
                    {isMe && <span className="ml-1 text-[11px] text-sx-purple-text">(you)</span>}
                  </td>
```

Change it to:

```tsx
                  <td className="px-4 py-3 font-semibold text-white">
                    {row.displayName ?? row.username ?? 'Player'}
                    {isMe && <span className="ml-1 text-[11px] text-sx-purple-text">(you)</span>}
                    {row.isProvisional && (
                      <span
                        title="Still competing — this total can still change"
                        className="ml-1.5 rounded-full bg-sx-green/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sx-green"
                      >
                        Live
                      </span>
                    )}
                  </td>
```

- [ ] **Step 3: Run tests + build**

Run: `npm run test && npm run build`.

- [ ] **Step 4: Commit**

```bash
git add components/seasons/SeasonLeaderboardTable.tsx
git commit -m "feat(seasons): show a Live tag on provisional season leaderboard rows"
```

---

## Task 4: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Run the entire test suite**

Run: `npm run test`.

- [ ] **Step 2: Run the production build**

Run: `npm run build`.

- [ ] **Step 3: Run lint**

Run: `npm run lint`.

- [ ] **Step 4: Re-verify the design spec's decisions are actually true in the shipped code**

Grep `lib/seasons/invitation-actions.ts` and `lib/seasons/eligibility.ts` to confirm neither file was touched by this plan (`git diff main -- lib/seasons/invitation-actions.ts lib/seasons/eligibility.ts` should be empty) — the whole point of this design was that Masters/Champions Cup qualification ranking never sees provisional numbers, so this must hold at the end, not just in the plan's intent.

- [ ] **Step 5: Commit any final fixups, then stop**

```bash
git status # confirm clean tree
```

---

## Self-Review Notes

- **Spec coverage:** design spec decision 1 (guaranteed floor, not projection) → Task 1's algorithm only ever returns a band a player has actually secured. Decision 2 (qualification reads locked-in only) → verified explicitly in Task 4 Step 4, and structurally true since `getSeasonLeaderboard`'s provisional layer is entirely additive/in-memory, never written back to `season_ranking_points`. Decision 3 (group-stage players get the non_advancer floor) → already true by construction: `guaranteedBandsForPlacements` defaults to `'non_advancer'` for anyone with no knockout-round appearance, same as the season leaderboard's existing zero-floor guarantee. Decision 4 (read-time only, nothing persisted) → no migration, no new table, in every task.
- **Correction from the spec's own text, caught while re-reading the real code during planning:** the spec's Architecture section says "fetch the season's still-`active`-status **community_club** tournaments" (community_club only). The plan above applies provisional standing to any active tournament of either season-eligible type (`community_club` or `masters`), using each tournament's own `tournament_type` for `pointsForBand`. This matches how the REAL locked-in points already work — `season_ranking_points` is written for both types today (Global Constraints #3 of the original Phase 2 plan), so a player's Champions-Cup-qualifying total can already legitimately include points earned from a masters tournament in the same season. Restricting the new provisional layer to community_club-only would have made it inconsistent with the real numbers it sits alongside. Task 5.2 in Task 2's tests only exercises `community_club` directly for simplicity, but the implementation is not type-restricted.
- **Type/signature consistency:** `guaranteedBandsForPlacements` (Task 1) is called with `(matches, activePlayerIds)` in Task 2 exactly matching its Task 1 signature. `toRows`'s new third parameter (`provisionalPlayerIds: Set<string>`) is added and both of its call sites in the same file (`getSeasonLeaderboard`, `getMonthlyLeaderboard`) are updated in Task 2 — no orphaned call site.
