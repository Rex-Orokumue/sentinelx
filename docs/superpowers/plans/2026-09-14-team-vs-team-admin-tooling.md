# Team-Aware Group Moves & Knockout Pairing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `movePlayerToGroup` and the manual-knockout-pairing tools (`createKnockoutRound`, `swapKnockoutPairing`) work for team (`entry_unit='squad'`) tournaments, then flip the Free Fire Clash Squad 2v2/4v4 and Lone Wolf 2v2 catalogue rows to `available=true`.

**Architecture:** Both action files gain a `kind: 'solo' | 'squad'` derived from `tournaments.entry_unit`, with a local `sideCols()`/`memberCol()` helper pair that picks `team_a_id`/`team_b_id`/`team_id` vs `player_a_id`/`player_b_id`/`player_id` — the exact pattern already shipped in `bracket-admin-actions.ts` (initial generation) and `verify-actions.ts` (result confirm/advance). No new abstractions, no schema changes. The read/computation layer (`bracket-view.ts`, `knockout-pairing.ts`) is already team-aware from Phase 6a — `StandingRow.playerId` and `PairingParticipant.id` already carry squad ids for a team tournament — so this plan only touches the write path.

**Tech Stack:** Next.js 14 Server Actions, Supabase (service-role admin client), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-13-team-vs-team-matches-design.md` §11 (item 7, catalogue flip) and §4 (schema). This plan implements the two follow-ups called out in that spec's phase list, plus the Phase 7 catalogue flip it explicitly defers to "whichever admin-tooling work lands first."

## Global Constraints

- No schema changes. Every column this plan writes (`matches.team_a_id`/`team_b_id`, `group_memberships.team_id`) already exists (`supabase/migrations/20260913154729_team_matches_schema.sql`).
- Follow the existing convention: `sideCols()`/`memberCol()` helpers are defined **locally in each file that needs them**, not extracted to a shared module — `bracket-admin-actions.ts` and `verify-actions.ts` each already have their own copy. Do not unify them into `draw.ts` or elsewhere as part of this plan.
- Do not rename `playerId`/`player_a_id`-shaped field and variable names to something entrant-neutral even where they hold a squad id — the codebase's established convention (`PairingAssignment.byePlayerIds`, `verify-actions.ts`'s `GroupMatchResult.playerAId`) keeps the existing names and lets a `kind` branch decide the real DB column. `MovePlayerForm`'s `playerId` form field is unchanged for the same reason.
- Notification fan-out for a team round/group must reach **every current roster member** of the affected squad(s) via `squad-roster.ts`'s `matchRosters`/`rostersForSquads` — matching the precedent in `fixture-created.ts`, the fixture-reminder cron, and the result-confirmed notification (all Phase 6a).
- Migration filenames use a UTC timestamp prefix (`YYYYMMDDHHMMSS_name.sql`), per `CLAUDE.md`.
- Every task's tests must cover **both** `entry_unit='solo'` (regression — must not change existing behavior) and `entry_unit='squad'` (the new behavior).

---

## Task 1: `group-admin-actions.ts` — team-aware `movePlayerToGroup`

**Files:**
- Modify: `lib/tournaments/group-admin-actions.ts` (full rewrite — every function changes)
- Test: `lib/tournaments/group-admin-actions.test.ts` (new file — this action currently has zero test coverage)

**Interfaces:**
- Consumes: `roundRobinPairs`, `canMoveOutOfGroup`, `canReceiveIntoGroup` from `./draw` (unchanged signatures); `nextRoundScheduledAt` from `./round-schedule` (unchanged).
- Produces: `movePlayerToGroup(prev: MoveGroupState, formData: FormData): Promise<MoveGroupState>` — same exported signature as today, consumed by `components/admin/MovePlayerForm.tsx` (unchanged, no caller updates needed).

- [ ] **Step 1: Write the failing tests**

Create `lib/tournaments/group-admin-actions.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/admin/auth', () => ({ requireStaff: vi.fn().mockResolvedValue({ userId: 'staff' }) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('./round-schedule', () => ({ nextRoundScheduledAt: vi.fn().mockResolvedValue(null) }))

const T1 = '00000000-0000-4000-8000-000000000001'
const GA = '00000000-0000-4000-8000-0000000000a1'
const GB = '00000000-0000-4000-8000-0000000000a2'
const ENTRANT = '00000000-0000-4000-8000-0000000000e1'

function fd(obj: Record<string, string>) {
  const f = new FormData()
  for (const [k, v] of Object.entries(obj)) f.set(k, v)
  return f
}

function fakeAdmin(opts: {
  tournament?: { status: string; entry_unit: string } | null
  groupIds?: string[]
  membership?: { id: string; group_id: string } | null
  membershipEq?: (col: string, val: string) => void
  countsByGroup?: Record<string, number>
  rosterByGroup?: Record<string, Array<{ player_id: string | null; team_id: string | null }>>
  onUpdate?: (row: Record<string, unknown>, id: string) => void
  onDelete?: () => void
  onInsert?: (rows: unknown) => void
}) {
  return {
    from(table: string) {
      if (table === 'tournaments')
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: opts.tournament ?? null }) }),
          }),
        }
      if (table === 'groups')
        return { select: () => ({ eq: async () => ({ data: (opts.groupIds ?? []).map((id) => ({ id })) }) }) }
      if (table === 'group_memberships') {
        return {
          select: (cols: string, countOpts?: unknown) => {
            if (cols === 'id, group_id') {
              return {
                in: () => ({
                  eq: (col: string, val: string) => {
                    opts.membershipEq?.(col, val)
                    return { maybeSingle: async () => ({ data: opts.membership ?? null }) }
                  },
                }),
              }
            }
            if (countOpts)
              return { eq: async (_c: string, groupId: string) => ({ count: opts.countsByGroup?.[groupId] ?? 0 }) }
            return { eq: async (_c: string, groupId: string) => ({ data: opts.rosterByGroup?.[groupId] ?? [] }) }
          },
          update: (row: Record<string, unknown>) => ({
            eq: async (_c: string, id: string) => {
              opts.onUpdate?.(row, id)
              return { error: null }
            },
          }),
        }
      }
      if (table === 'matches')
        return {
          delete: () => ({
            eq: () => ({
              eq: () => ({
                in: async () => {
                  opts.onDelete?.()
                  return { error: null }
                },
              }),
            }),
          }),
          insert: async (rows: unknown) => {
            opts.onInsert?.(rows)
            return { error: null }
          },
        }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

describe('movePlayerToGroup — solo tournament', () => {
  it('moves a player and regenerates matches with player_a_id/player_b_id', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    let membershipEqCol = ''
    let updateRow: Record<string, unknown> | undefined
    let insertedRows: unknown
    vi.mocked(createAdminClient).mockReturnValue(
      fakeAdmin({
        tournament: { status: 'registration_closed', entry_unit: 'solo' },
        groupIds: [GA, GB],
        membership: { id: 'm1', group_id: GA },
        membershipEq: (col) => (membershipEqCol = col),
        countsByGroup: { [GA]: 3, [GB]: 2 },
        rosterByGroup: {
          [GA]: [{ player_id: 'p2', team_id: null }, { player_id: 'p3', team_id: null }],
          [GB]: [{ player_id: 'p4', team_id: null }, { player_id: ENTRANT, team_id: null }],
        },
        onUpdate: (row) => (updateRow = row),
        onInsert: (rows) => (insertedRows = rows),
      }) as never,
    )
    const { movePlayerToGroup } = await import('./group-admin-actions')
    const r = await movePlayerToGroup(undefined, fd({ tournamentId: T1, playerId: ENTRANT, toGroupId: GB }))
    expect(r?.success).toBe(true)
    expect(membershipEqCol).toBe('player_id')
    expect(updateRow).toMatchObject({ group_id: GB, wins: 0, points: 0 })
    const rows = insertedRows as Array<Record<string, unknown>>
    expect(rows.every((row) => 'player_a_id' in row && !('team_a_id' in row))).toBe(true)
  })

  it('rejects a move that would leave the source group below 2 players', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    vi.mocked(createAdminClient).mockReturnValue(
      fakeAdmin({
        tournament: { status: 'registration_closed', entry_unit: 'solo' },
        groupIds: [GA, GB],
        membership: { id: 'm1', group_id: GA },
        countsByGroup: { [GA]: 2, [GB]: 2 },
      }) as never,
    )
    const { movePlayerToGroup } = await import('./group-admin-actions')
    const r = await movePlayerToGroup(undefined, fd({ tournamentId: T1, playerId: ENTRANT, toGroupId: GB }))
    expect(r?.error).toMatch(/fewer than 2 players/)
  })
})

describe('movePlayerToGroup — squad tournament', () => {
  it('looks up membership by team_id and regenerates matches with team_a_id/team_b_id', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    let membershipEqCol = ''
    let insertedRows: unknown
    vi.mocked(createAdminClient).mockReturnValue(
      fakeAdmin({
        tournament: { status: 'registration_closed', entry_unit: 'squad' },
        groupIds: [GA, GB],
        membership: { id: 'm1', group_id: GA },
        membershipEq: (col) => (membershipEqCol = col),
        countsByGroup: { [GA]: 3, [GB]: 2 },
        rosterByGroup: {
          [GA]: [{ player_id: null, team_id: 'sq2' }, { player_id: null, team_id: 'sq3' }],
          [GB]: [{ player_id: null, team_id: 'sq4' }, { player_id: null, team_id: ENTRANT }],
        },
        onInsert: (rows) => (insertedRows = rows),
      }) as never,
    )
    const { movePlayerToGroup } = await import('./group-admin-actions')
    const r = await movePlayerToGroup(undefined, fd({ tournamentId: T1, playerId: ENTRANT, toGroupId: GB }))
    expect(r?.success).toBe(true)
    expect(membershipEqCol).toBe('team_id')
    const rows = insertedRows as Array<Record<string, unknown>>
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((row) => 'team_a_id' in row && !('player_a_id' in row))).toBe(true)
  })

  it('rejects with squad-worded copy when the source group would drop below 2', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    vi.mocked(createAdminClient).mockReturnValue(
      fakeAdmin({
        tournament: { status: 'registration_closed', entry_unit: 'squad' },
        groupIds: [GA, GB],
        membership: { id: 'm1', group_id: GA },
        countsByGroup: { [GA]: 2, [GB]: 2 },
      }) as never,
    )
    const { movePlayerToGroup } = await import('./group-admin-actions')
    const r = await movePlayerToGroup(undefined, fd({ tournamentId: T1, playerId: ENTRANT, toGroupId: GB }))
    expect(r?.error).toMatch(/fewer than 2 squads/)
  })

  it('fails safely (not silently) when a squad id is submitted but not found in any group', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    vi.mocked(createAdminClient).mockReturnValue(
      fakeAdmin({
        tournament: { status: 'registration_closed', entry_unit: 'squad' },
        groupIds: [GA, GB],
        membership: null,
      }) as never,
    )
    const { movePlayerToGroup } = await import('./group-admin-actions')
    const r = await movePlayerToGroup(undefined, fd({ tournamentId: T1, playerId: ENTRANT, toGroupId: GB }))
    expect(r?.error).toMatch(/squad is not in a group/)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/tournaments/group-admin-actions.test.ts`
Expected: FAIL — `Cannot find module './group-admin-actions'` is not the failure (the file exists); the squad-branch assertions (`membershipEqCol === 'team_id'`, `'team_a_id' in row`) fail because the current implementation always queries/writes `player_id`/`player_a_id`/`player_b_id`.

- [ ] **Step 3: Rewrite `lib/tournaments/group-admin-actions.ts`**

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaff } from '@/lib/admin/auth'
import type { Database } from '@/lib/supabase/types'
import { roundRobinPairs, canMoveOutOfGroup, canReceiveIntoGroup } from './draw'
import { nextRoundScheduledAt } from './round-schedule'

export type MoveGroupState = { error?: string; success?: boolean } | undefined

type Admin = ReturnType<typeof createAdminClient>
type MatchInsert = Database['public']['Tables']['matches']['Insert']
type EntrantKind = 'solo' | 'squad'

// Mirrors the sideCols/memberCol pair in bracket-admin-actions.ts's generate()
// and the isTeamGroup branch in verify-actions.ts's recomputeGroupStats — same
// "exactly one of the player/team columns is set" shape the DB enforces
// (matches_side_a_kind/matches_side_b_kind, group_memberships_kind CHECK
// constraints). Kept local to this file rather than shared, matching how
// those two already do it.
function sideCols(
  kind: EntrantKind,
  a: string,
  b: string | null,
): Pick<MatchInsert, 'player_a_id' | 'player_b_id'> | Pick<MatchInsert, 'team_a_id' | 'team_b_id'> {
  return kind === 'squad' ? { team_a_id: a, team_b_id: b } : { player_a_id: a, player_b_id: b }
}

async function regenerateGroupMatches(
  admin: Admin,
  tournamentId: string,
  groupIds: string[],
  kind: EntrantKind,
): Promise<void> {
  // Both affected groups' round-robin matches are torn down and rebuilt from
  // the post-move rosters. Safe because this only runs while the tournament
  // is registration_closed — group-stage matches have no results yet.
  const { error: delErr } = await admin
    .from('matches')
    .delete()
    .eq('tournament_id', tournamentId)
    .eq('round', 'group')
    .in('group_id', groupIds)
  if (delErr) throw new Error(`Failed to clear group matches: ${delErr.message}`)

  const roundDate = await nextRoundScheduledAt(admin, tournamentId)
  const schedule = roundDate ? { scheduled_at: roundDate, is_full_day: true } : {}

  const rows: MatchInsert[] = []
  for (const groupId of groupIds) {
    const { data: roster } = await admin
      .from('group_memberships')
      .select('player_id, team_id')
      .eq('group_id', groupId)
    const rosterIds = (roster ?? [])
      .map((r) => (kind === 'squad' ? r.team_id : r.player_id))
      .filter((id): id is string => id != null)
    const pairs = roundRobinPairs(rosterIds)
    for (const [a, b] of pairs) {
      rows.push({
        tournament_id: tournamentId,
        round: 'group',
        group_id: groupId,
        status: 'scheduled',
        ...sideCols(kind, a, b),
        ...schedule,
      })
    }
  }
  if (rows.length > 0) {
    const { error: insErr } = await admin.from('matches').insert(rows)
    if (insErr) throw new Error(`Failed to regenerate group matches: ${insErr.message}`)
  }
}

// Manually reassigns a player — or, for a team tournament, their whole squad —
// to a different group and rebuilds round-robin matches for both the group
// they left and the one they joined. Admin-only, and only while the bracket
// is generated but not yet published — the same window BracketActions already
// limits re-rolling and reopening to.
//
// group_memberships has exactly one row per squad for entry_unit='squad'
// (never one per roster player — group_memberships_kind), so "move a player"
// can only ever mean "move their squad's group placement." The `playerId`
// form field carries a squad id in that case: StandingRow.playerId already
// resolves to the squad id via bracket-view.ts's sideRef() (Phase 6a), so the
// admin bracket UI is already sending the right id — this action just needs
// to read/write the right column.
export async function movePlayerToGroup(
  _prev: MoveGroupState,
  formData: FormData,
): Promise<MoveGroupState> {
  await requireStaff()
  const tournamentId = String(formData.get('tournamentId') ?? '')
  const playerId = String(formData.get('playerId') ?? '')
  const toGroupId = String(formData.get('toGroupId') ?? '')
  if (!tournamentId || !playerId || !toGroupId) return { error: 'Missing move details.' }

  const admin = createAdminClient()
  const { data: t } = await admin
    .from('tournaments')
    .select('status, entry_unit')
    .eq('id', tournamentId)
    .maybeSingle()
  if (!t) return { error: 'Tournament not found.' }
  if (t.status !== 'registration_closed')
    return { error: 'Groups can only be edited before the bracket is published.' }
  const kind: EntrantKind = t.entry_unit === 'squad' ? 'squad' : 'solo'
  const noun = kind === 'squad' ? 'squad' : 'player'

  const { data: groups } = await admin.from('groups').select('id').eq('tournament_id', tournamentId)
  const groupIds = (groups ?? []).map((g) => g.id)
  if (!groupIds.includes(toGroupId)) return { error: 'Target group is not part of this tournament.' }

  const membershipQuery = admin.from('group_memberships').select('id, group_id').in('group_id', groupIds)
  const { data: membership } = await (kind === 'squad'
    ? membershipQuery.eq('team_id', playerId)
    : membershipQuery.eq('player_id', playerId)
  ).maybeSingle()
  if (!membership) return { error: `That ${noun} is not in a group for this tournament.` }
  const fromGroupId = membership.group_id
  if (fromGroupId === toGroupId) return { error: `That ${noun} is already in that group.` }

  const [{ count: fromCount }, { count: toCount }] = await Promise.all([
    admin.from('group_memberships').select('*', { count: 'exact', head: true }).eq('group_id', fromGroupId),
    admin.from('group_memberships').select('*', { count: 'exact', head: true }).eq('group_id', toGroupId),
  ])
  if (!canMoveOutOfGroup(fromCount ?? 0))
    return { error: `Moving this ${noun} would leave their current group with fewer than 2 ${noun}s.` }
  if (!canReceiveIntoGroup(toCount ?? 0))
    return { error: `That group already has the maximum of 8 ${noun}s.` }

  const { error: moveErr } = await admin
    .from('group_memberships')
    .update({ group_id: toGroupId, wins: 0, draws: 0, losses: 0, goals_for: 0, goals_against: 0, points: 0 })
    .eq('id', membership.id)
  if (moveErr) return { error: `Failed to move ${noun}: ${moveErr.message}` }

  try {
    await regenerateGroupMatches(admin, tournamentId, [fromGroupId, toGroupId], kind)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to regenerate group matches.' }
  }

  revalidatePath(`/admin/tournaments/${tournamentId}/bracket`)
  return { success: true }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/tournaments/group-admin-actions.test.ts`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Run the full tournaments test suite to check for regressions**

Run: `npx vitest run lib/tournaments/`
Expected: PASS, 0 failures

- [ ] **Step 6: Commit**

```bash
git add lib/tournaments/group-admin-actions.ts lib/tournaments/group-admin-actions.test.ts
git commit -m "feat(tournaments): movePlayerToGroup handles team tournaments

group_memberships has one row per squad for entry_unit='squad', so moving
a player between groups now means moving their squad. Mirrors the
sideCols/kind pattern already shipped in bracket-admin-actions.ts and
verify-actions.ts. Also closes a pre-existing test gap — this action had
no coverage before this commit.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019upoLDTHxvDVjh8AJ1gFiZ"
```

---

## Task 2: `knockout-pairing-actions.ts` — team-aware `createKnockoutRound`

**Files:**
- Modify: `lib/tournaments/knockout-pairing-actions.ts:1-142` (imports, module-scope helpers, and `createKnockoutRound` only — `swapKnockoutPairing` is Task 3)
- Test: `lib/tournaments/knockout-pairing-actions.test.ts` (extend existing file)

**Interfaces:**
- Consumes: `notifyNewFixtures` from `@/lib/notifications/fixture-created` — its `NewFixtureRow` already has optional `teamAId?: string | null` / `teamBId?: string | null` (Phase 6a), unchanged.
- Produces: module-scope `type EntrantKind = 'solo' | 'squad'` and `function sideCols(kind, a, b)`, used by both `createKnockoutRound` (this task) and `swapKnockoutPairing` (Task 3) — defined once in this file since both live here.

- [ ] **Step 1: Write the failing test**

Add to `lib/tournaments/knockout-pairing-actions.test.ts`, inside the existing `describe('createKnockoutRound', ...)` block (after the last `it(...)`, before the closing `})`):

```ts
  it('inserts team_a_id/team_b_id rows and passes teamAId/teamBId to notifyNewFixtures for a squad tournament', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const { loadBracketView } = await import('./bracket-view')
    const { notifyNewFixtures } = await import('@/lib/notifications/fixture-created')
    vi.mocked(notifyNewFixtures).mockClear()
    vi.mocked(loadBracketView).mockResolvedValue(
      view([{ round: 'quarter_final', label: 'QF', matches: RESOLVED_QF }]) as never,
    )
    let inserted: unknown = null
    vi.mocked(createAdminClient).mockReturnValue(
      fakeAdmin({ onInsert: (r) => (inserted = r), entryUnit: 'squad' }) as never,
    )
    const { createKnockoutRound } = await import('./knockout-pairing-actions')
    const r = await createKnockoutRound(
      undefined,
      fd({
        tournamentId: 't1',
        round: 'semi_final',
        assignment: JSON.stringify({ byePlayerIds: [], matchPairs: [[W1, W3], [W2, W4]] }),
      }),
    )
    expect(r?.success).toBe(true)
    const rows = inserted as Array<Record<string, unknown>>
    expect(rows.every((row) => 'team_a_id' in row && !('player_a_id' in row))).toBe(true)
    expect(notifyNewFixtures).toHaveBeenCalledTimes(1)
    const notifyRows = vi.mocked(notifyNewFixtures).mock.calls[0][1]
    expect(notifyRows.every((row) => row.teamAId != null && row.teamBId != null)).toBe(true)
  })
```

Extend `fakeAdmin` (top of the file) to accept `entryUnit` and use it in the `tournaments` mock and the `matches.insert` mock's returned columns:

```ts
function fakeAdmin(opts: {
  onInsert?: (rows: unknown) => void
  roundExistsCount?: number
  updates?: Array<{ id: string; row: Record<string, unknown> }>
  profiles?: Array<{ id: string; username: string | null; display_name: string | null }>
  squads?: Array<{ id: string; name: string }>
  entryUnit?: 'solo' | 'squad'
}) {
  const isTeam = opts.entryUnit === 'squad'
  return {
    from(table: string) {
      if (table === 'tournaments')
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { format: 'group_knockout', slug: 's', entry_unit: opts.entryUnit ?? 'solo' } }),
            }),
          }),
        }
      if (table === 'matches')
        return {
          select: (_c: unknown, countOpts?: unknown) =>
            countOpts
              ? { eq: () => ({ eq: async () => ({ count: opts.roundExistsCount ?? 0 }) }) }
              : { eq: () => ({ eq: async () => ({ data: [] }) }) },
          insert: (rows: unknown) => {
            opts.onInsert?.(rows)
            return {
              select: async () => ({
                data: (rows as Array<Record<string, unknown>>).map((row, i) => ({
                  id: `new${i}`,
                  player_a_id: isTeam ? null : 'x',
                  player_b_id: isTeam ? null : 'y',
                  team_a_id: isTeam ? (row.team_a_id ?? null) : null,
                  team_b_id: isTeam ? (row.team_b_id ?? null) : null,
                  scheduled_at: null,
                  is_full_day: true,
                })),
                error: null,
              }),
            }
          },
          update: (row: Record<string, unknown>) => ({
            eq: async (_col: string, id: string) => {
              opts.updates?.push({ id, row })
              return { error: null }
            },
          }),
        }
      if (table === 'profiles')
        return { select: () => ({ in: async () => ({ data: opts.profiles ?? [] }) }) }
      if (table === 'squads')
        return { select: () => ({ in: async () => ({ data: opts.squads ?? [] }) }) }
      throw new Error(`unexpected table ${table}`)
    },
  }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/tournaments/knockout-pairing-actions.test.ts -t "team_a_id/team_b_id rows"`
Expected: FAIL — inserted rows currently always have `player_a_id`/`player_b_id`, never `team_a_id`/`team_b_id`; `notifyRows` currently have `teamAId: undefined`.

- [ ] **Step 3: Modify `lib/tournaments/knockout-pairing-actions.ts`**

Add after the existing imports (top of file, before `export type KnockoutPairingState`):

```ts
type EntrantKind = 'solo' | 'squad'

// Mirrors the sideCols/kind pattern in bracket-admin-actions.ts's generate()
// and group-admin-actions.ts — same "exactly one of player/team columns set"
// shape the matches_side_a_kind/matches_side_b_kind CHECK constraints
// enforce. Local to this file (both createKnockoutRound and
// swapKnockoutPairing use it), not shared across files, matching the
// existing convention.
function sideCols(kind: EntrantKind, a: string, b: string | null) {
  return kind === 'squad' ? { team_a_id: a, team_b_id: b } : { player_a_id: a, player_b_id: b }
}
```

In `createKnockoutRound`, change the tournament fetch (currently `.select('format, slug')`) to:

```ts
  const { data: t } = await admin
    .from('tournaments')
    .select('format, slug, entry_unit')
    .eq('id', tournamentId)
    .maybeSingle()
  if (!t) return { error: 'Tournament not found.' }
  const kind: EntrantKind = t.entry_unit === 'squad' ? 'squad' : 'solo'
```

Change the `rows` construction from:

```ts
  const rows = [
    ...assignment.matchPairs.map(([a, b]) => ({
      tournament_id: tournamentId,
      round,
      group_id: null,
      player_a_id: a,
      player_b_id: b,
      status: 'scheduled',
      ...schedule,
    })),
    ...assignment.byePlayerIds.map((pid) => ({
      tournament_id: tournamentId,
      round,
      group_id: null,
      player_a_id: pid,
      player_b_id: null,
      status: 'bye',
      ...schedule,
    })),
  ]
```

to:

```ts
  const rows = [
    ...assignment.matchPairs.map(([a, b]) => ({
      tournament_id: tournamentId,
      round,
      group_id: null,
      status: 'scheduled',
      ...sideCols(kind, a, b),
      ...schedule,
    })),
    ...assignment.byePlayerIds.map((pid) => ({
      tournament_id: tournamentId,
      round,
      group_id: null,
      status: 'bye',
      ...sideCols(kind, pid, null),
      ...schedule,
    })),
  ]
```

Change the insert + notify block from:

```ts
  const { data: insertedRows, error } = await admin
    .from('matches')
    .insert(rows)
    .select('id, player_a_id, player_b_id, scheduled_at, is_full_day')
  if (error) return { error: 'Could not create the round. Please try again.' }

  await notifyNewFixtures(
    admin,
    (insertedRows ?? []).map((m) => ({
      id: m.id,
      tournamentId,
      playerAId: m.player_a_id as string,
      playerBId: m.player_b_id,
      scheduledAt: m.scheduled_at,
      isFullDay: m.is_full_day,
    })),
  )
```

to:

```ts
  const { data: insertedRows, error } = await admin
    .from('matches')
    .insert(rows)
    .select('id, player_a_id, player_b_id, team_a_id, team_b_id, scheduled_at, is_full_day')
  if (error) return { error: 'Could not create the round. Please try again.' }

  await notifyNewFixtures(
    admin,
    (insertedRows ?? []).map((m) => ({
      id: m.id,
      tournamentId,
      playerAId: m.player_a_id as string,
      playerBId: m.player_b_id,
      teamAId: m.team_a_id,
      teamBId: m.team_b_id,
      scheduledAt: m.scheduled_at,
      isFullDay: m.is_full_day,
    })),
  )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/tournaments/knockout-pairing-actions.test.ts`
Expected: PASS (all `createKnockoutRound` tests, including the new one; `swapKnockoutPairing` tests still pass unchanged since Task 2 doesn't touch that function)

- [ ] **Step 5: Commit**

```bash
git add lib/tournaments/knockout-pairing-actions.ts lib/tournaments/knockout-pairing-actions.test.ts
git commit -m "feat(tournaments): createKnockoutRound writes team_a_id/team_b_id for squad tournaments

Same sideCols/kind pattern as movePlayerToGroup. notifyNewFixtures
already had a team branch (Phase 6a) — this just populates teamAId/
teamBId on the rows it's handed instead of silently dropping them.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019upoLDTHxvDVjh8AJ1gFiZ"
```

---

## Task 3: `knockout-pairing-actions.ts` — team-aware `swapKnockoutPairing`

**Files:**
- Modify: `lib/tournaments/knockout-pairing-actions.ts:144-253` (`swapKnockoutPairing` only)
- Test: `lib/tournaments/knockout-pairing-actions.test.ts` (extend existing file)

**Interfaces:**
- Consumes: `EntrantKind`, `sideCols` from Task 2 (same file, module scope); `rostersForSquads` from `@/lib/tournaments/squad-roster` (new import — signature `(client: Client, squadIds: string[]) => Promise<Map<string, string[]>>`, already shipped in Phase 6a).
- Produces: no new exports — `swapKnockoutPairing`'s signature is unchanged.

- [ ] **Step 1: Write the failing test**

Add to `lib/tournaments/knockout-pairing-actions.test.ts`, inside `describe('swapKnockoutPairing', ...)`:

```ts
  it('notifies every roster member of both affected squads for a squad tournament', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const { loadBracketView } = await import('./bracket-view')
    const { notifyInAppOf } = await import('@/lib/notifications/inbox')
    vi.mocked(loadBracketView).mockResolvedValue(
      view([{ round: 'quarter_final', label: 'QF', matches: SCHEDULED_QF }]) as never,
    )
    const updates: Array<{ id: string; row: Record<string, unknown> }> = []
    const inApp: string[] = []
    vi.mocked(notifyInAppOf).mockImplementation(async (playerId) => {
      inApp.push(playerId)
    })
    const { rostersForSquads } = await import('./squad-roster')
    vi.mocked(rostersForSquads).mockResolvedValue(
      new Map([
        [P1, ['r1a', 'r1b']],
        [P2, ['r2a', 'r2b']],
        [P3, ['r3a', 'r3b']],
        [P4, ['r4a', 'r4b']],
      ]),
    )
    vi.mocked(createAdminClient).mockReturnValue(
      fakeAdmin({
        updates,
        entryUnit: 'squad',
        squads: [
          { id: P1, name: 'Squad 1' },
          { id: P2, name: 'Squad 2' },
          { id: P3, name: 'Squad 3' },
          { id: P4, name: 'Squad 4' },
        ],
      }) as never,
    )
    const { swapKnockoutPairing } = await import('./knockout-pairing-actions')
    const r = await swapKnockoutPairing(
      undefined,
      fd({
        tournamentId: 't1',
        round: 'quarter_final',
        assignment: JSON.stringify({ byePlayerIds: [], matchPairs: [[P1, P3], [P2, P4]] }),
      }),
    )
    expect(r?.success).toBe(true)
    expect(updates).toHaveLength(2)
    for (const u of updates) {
      expect(u.row).toMatchObject({ status: 'scheduled' })
      expect(u.row.team_a_id).toEqual(expect.any(String))
      expect(u.row.player_a_id).toBeUndefined()
    }
    expect(inApp.sort()).toEqual(['r1a', 'r1b', 'r2a', 'r2b', 'r3a', 'r3b', 'r4a', 'r4b'].sort())
  })
```

Add `vi.mock('./squad-roster', () => ({ rostersForSquads: vi.fn() }))` to the top of the file alongside the other `vi.mock(...)` calls.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/tournaments/knockout-pairing-actions.test.ts -t "every roster member"`
Expected: FAIL — the current implementation calls `notifyBoth` once per squad id (P1-P4), not once per roster member, and updates rows with `player_a_id`/`player_b_id`, never `team_a_id`.

- [ ] **Step 3: Modify `swapKnockoutPairing`**

Change the tournament fetch (currently `.select('format, slug')`, same as Task 2's `createKnockoutRound`) to:

```ts
  const { data: t } = await admin
    .from('tournaments')
    .select('format, slug, entry_unit')
    .eq('id', tournamentId)
    .maybeSingle()
  if (!t) return { error: 'Tournament not found.' }
  const kind: EntrantKind = t.entry_unit === 'squad' ? 'squad' : 'solo'
```

Replace everything from `// Slot -> existing match row id.` through the end of the function with:

```ts
  // Slot -> existing match row id. Pair slots first (matchIdByPairIndex), then
  // bye slots (byeMatchIdByIndex); the pooled ids let a slot flip pair<->bye.
  const rowIds = [...rearrangeable.matchIdByPairIndex, ...rearrangeable.byeMatchIdByIndex]
  type Desired = { id: string; a: string; b: string | null; status: string }
  const desired: Desired[] = [
    ...assignment.matchPairs.map((pair, i) => ({
      id: rowIds[i],
      a: pair[0],
      b: pair[1] as string | null,
      status: 'scheduled',
    })),
    ...assignment.byePlayerIds.map((pid, i) => ({
      id: rowIds[assignment.matchPairs.length + i],
      a: pid,
      b: null as string | null,
      status: 'bye',
    })),
  ]

  const before = new Map<string, { a: string; b: string | null; status: string }>([
    ...rearrangeable.currentAssignment.matchPairs.map(
      (p, i) =>
        [rearrangeable.matchIdByPairIndex[i], { a: p[0], b: p[1] as string | null, status: 'scheduled' }] as const,
    ),
    ...rearrangeable.currentAssignment.byePlayerIds.map(
      (pid, i) =>
        [rearrangeable.byeMatchIdByIndex[i], { a: pid, b: null as string | null, status: 'bye' }] as const,
    ),
  ])

  const changedIds = new Set<string>()
  for (const d of desired) {
    const prev = before.get(d.id)
    if (prev && prev.a === d.a && prev.b === d.b && prev.status === d.status) continue
    const { error } = await admin
      .from('matches')
      .update({ ...sideCols(kind, d.a, d.b), status: d.status })
      .eq('id', d.id)
    if (error) return { error: 'Could not save the new pairing. Please try again.' }
    for (const pid of [d.a, d.b, prev?.a, prev?.b]) if (pid) changedIds.add(pid)
  }

  if (changedIds.size > 0) {
    const ids = Array.from(changedIds)
    const opponentOf = (id: string): string | null => {
      for (const d of desired) {
        if (d.a === id) return d.b
        if (d.b === id) return d.a
      }
      return null
    }
    const link = `/tournaments/${t.slug}/bracket`

    if (kind === 'squad') {
      const { data: squads } = await admin.from('squads').select('id, name').in('id', ids)
      const nameBySquad = new Map((squads ?? []).map((s) => [s.id, s.name]))
      const rosterBySquad = await rostersForSquads(admin, ids)
      for (const sid of ids) {
        const opp = opponentOf(sid)
        for (const pid of rosterBySquad.get(sid) ?? []) {
          await notifyBoth(
            pid,
            { type: 'fixture_updated', round: rearrangeable.label, opponent: opp ? nameBySquad.get(opp) ?? null : null },
            'fixture_assigned',
            { link, url: `${SITE_URL}${link}` },
          )
        }
      }
    } else {
      const { data: profiles } = await admin
        .from('profiles')
        .select('id, username, display_name')
        .in('id', ids)
      const nameById = new Map((profiles ?? []).map((p) => [p.id, p.display_name ?? p.username ?? 'Player']))
      for (const pid of ids) {
        const opp = opponentOf(pid)
        await notifyBoth(
          pid,
          { type: 'fixture_updated', round: rearrangeable.label, opponent: opp ? nameById.get(opp) ?? null : null },
          'fixture_assigned',
          { link, url: `${SITE_URL}${link}` },
        )
      }
    }
  }

  revalidate(tournamentId, t.slug)
  return { success: true }
}
```

Add the import at the top of the file, alongside the existing `@/lib/tournaments/*`-relative imports:

```ts
import { rostersForSquads } from './squad-roster'
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/tournaments/knockout-pairing-actions.test.ts`
Expected: PASS — all `createKnockoutRound` and `swapKnockoutPairing` tests, including both new ones, and the pre-existing solo-tournament tests (unaffected — `fakeAdmin({})`'s default `entryUnit` is `undefined`, which the mocked `tournaments.maybeSingle()` renders as `entry_unit: 'solo'`, so `kind` resolves to `'solo'` exactly as before).

- [ ] **Step 5: Run the full test suite**

Run: `npx vitest run`
Expected: PASS, 0 failures

- [ ] **Step 6: Commit**

```bash
git add lib/tournaments/knockout-pairing-actions.ts lib/tournaments/knockout-pairing-actions.test.ts
git commit -m "feat(tournaments): swapKnockoutPairing writes team columns and notifies every roster member

Update payload switches to team_a_id/team_b_id via sideCols for a squad
tournament. Notification fan-out expands from one call per squad id to
one per current roster member via rostersForSquads, matching the
fixture-created/fixture-reminder/result-confirmed precedent from
Phase 6a.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019upoLDTHxvDVjh8AJ1gFiZ"
```

---

## Task 4: Admin bracket UI copy pass — entrant-aware labels

**Files:**
- Modify: `app/[locale]/admin/tournaments/[id]/bracket/page.tsx:23,150-163`
- Modify: `components/admin/AdminBracketView.tsx` (full file — adds a prop and two call-site updates)
- Modify: `components/bracket/GroupStage.tsx` (adds a prop, passes through)
- Modify: `components/bracket/StandingsTable.tsx` (adds a prop, one header cell)
- Modify: `components/admin/KnockoutPairingEditor.tsx` (adds a prop, four copy strings)

**Interfaces:**
- Consumes: nothing new.
- Produces: `entryUnit?: string` prop threaded through `AdminBracketView` → `GroupStage` → `StandingsTable`, and `AdminBracketView` → `KnockoutPairingEditor` directly. Optional everywhere so the public bracket page (which doesn't pass it) is unaffected and keeps today's "Player" wording.

This task is pure copy/presentation — no server actions change, no new tests (existing component behavior is unchanged for every prop value already in use; there's no existing test suite for these presentational components to extend).

- [ ] **Step 1: `app/[locale]/admin/tournaments/[id]/bracket/page.tsx`**

Change line 23 from:

```ts
    .select('id, title, status, round_start_date, round_gap_days, format, manual_knockout_pairing')
```

to:

```ts
    .select('id, title, status, round_start_date, round_gap_days, format, manual_knockout_pairing, entry_unit')
```

Change the `<AdminBracketView ... />` call (lines 150-163) to add `entryUnit={t.entry_unit}` after `status={t.status}`:

```tsx
        <AdminBracketView
          tournamentId={t.id}
          status={t.status}
          entryUnit={t.entry_unit}
          standings={view.standings}
          fixtures={view.fixtures}
          rounds={view.rounds}
          projected={view.projected}
          champion={view.champion}
          thirdPlaceMatch={view.thirdPlaceMatch}
          hasGroups={view.hasGroups}
          contacts={contacts}
          pendingRound={pendingRound}
          rearrangeableRound={rearrangeableRound}
        />
```

- [ ] **Step 2: `components/admin/AdminBracketView.tsx`**

Rewrite the whole file:

```tsx
'use client'
import { useState } from 'react'
import type { BracketView } from '@/lib/tournaments/bracket-view'
import type { FixtureContacts } from '@/lib/matches/admin-whatsapp'
import { matchesPlayerQuery } from '@/lib/admin/search'
import type {
  PendingKnockoutRound,
  RearrangeableKnockoutRound,
} from '@/lib/tournaments/knockout-pairing'
import { PlayerSearch } from './PlayerSearch'
import { KnockoutPairingEditor } from './KnockoutPairingEditor'
import { GroupStage } from '@/components/bracket/GroupStage'
import { BracketTree } from '@/components/bracket/BracketTree'

export function AdminBracketView({
  tournamentId,
  status,
  entryUnit,
  standings,
  fixtures,
  rounds,
  projected,
  champion,
  thirdPlaceMatch,
  hasGroups,
  contacts,
  pendingRound,
  rearrangeableRound,
}: Pick<
  BracketView,
  'standings' | 'fixtures' | 'rounds' | 'projected' | 'champion' | 'thirdPlaceMatch' | 'hasGroups'
> & {
  tournamentId: string
  status: string
  entryUnit: string
  contacts: FixtureContacts
  pendingRound: PendingKnockoutRound | null
  rearrangeableRound: RearrangeableKnockoutRound | null
}) {
  const [query, setQuery] = useState('')
  const isTeam = entryUnit === 'squad'
  const filteredStandings = standings.map((g) => ({
    groupId: g.groupId,
    groupName: g.groupName,
    rows: g.rows.filter((r) =>
      matchesPlayerQuery({ username: null, displayName: r.name, clubName: r.clubName ?? null }, query),
    ),
  }))
  // Groups can only be manually reassigned in the staff-only preview window,
  // same as re-rolling the draw and reopening registration — BracketActions.
  const editable = status === 'registration_closed'
  const groupOptions = standings.map((g) => ({ id: g.groupId, name: g.groupName }))

  return (
    <>
      {hasGroups && (
        <PlayerSearch
          value={query}
          onChange={setQuery}
          placeholder={isTeam ? 'Search squads by name…' : 'Search players by name or club…'}
        />
      )}
      {hasGroups && (
        <GroupStage
          standings={filteredStandings}
          fixtures={fixtures}
          contacts={contacts}
          tournamentId={tournamentId}
          groups={editable ? groupOptions : undefined}
          entryUnit={entryUnit}
        />
      )}
      {pendingRound && (
        <div className="mb-4">
          <KnockoutPairingEditor
            mode="create"
            tournamentId={tournamentId}
            round={pendingRound.round}
            label={pendingRound.label}
            participants={pendingRound.participants}
            shape={pendingRound.shape}
            defaultAssignment={pendingRound.defaultAssignment}
            entryUnit={entryUnit}
          />
        </div>
      )}

      {!pendingRound && rearrangeableRound && (
        <details className="mb-4">
          <summary className="cursor-pointer text-xs font-semibold text-slate-400 hover:text-slate-200">
            Rearrange the {rearrangeableRound.label} pairings
          </summary>
          <div className="mt-2">
            <KnockoutPairingEditor
              mode="rearrange"
              tournamentId={tournamentId}
              round={rearrangeableRound.round}
              label={rearrangeableRound.label}
              participants={rearrangeableRound.participants}
              shape={rearrangeableRound.shape}
              defaultAssignment={rearrangeableRound.currentAssignment}
              entryUnit={entryUnit}
            />
          </div>
        </details>
      )}

      <BracketTree rounds={rounds} projected={projected} champion={champion} thirdPlace={thirdPlaceMatch} />
    </>
  )
}
```

- [ ] **Step 3: `components/bracket/GroupStage.tsx`**

Add `entryUnit?: string` to the props type and destructuring, and pass it through to `StandingsTable`:

```tsx
export function GroupStage({
  standings,
  fixtures,
  contacts,
  tournamentId,
  groups,
  entryUnit,
}: {
  standings: { groupId: string; groupName: string; rows: StandingRow[] }[]
  fixtures: Buckets
  // Admin-only: matchId -> each player's wa.me link. The public bracket page
  // omits it, so no player numbers reach the public bundle.
  contacts?: FixtureContacts
  // Admin-only, and only set while the bracket is staff-preview (pre-publish):
  // presence of `groups` turns on the per-player "move to another group"
  // control in the standings table. The public bracket page passes neither.
  tournamentId?: string
  groups?: { id: string; name: string }[]
  // Admin-only, optional: 'squad' relabels the standings header "Squad"
  // instead of "Player". The public bracket page doesn't pass this yet.
  entryUnit?: string
}) {
```

And in the `tab === 'table'` branch, add `entryUnit={entryUnit}` to the `<StandingsTable>` call:

```tsx
        standings.map((g) => (
          <StandingsTable
            key={g.groupId}
            groupName={g.groupName}
            rows={g.rows}
            tournamentId={tournamentId}
            currentGroupId={g.groupId}
            groups={groups}
            entryUnit={entryUnit}
          />
        ))
```

- [ ] **Step 4: `components/bracket/StandingsTable.tsx`**

Add `entryUnit?: string` to the props type and destructuring:

```tsx
export function StandingsTable({
  groupName,
  rows,
  tournamentId,
  currentGroupId,
  groups,
  entryUnit,
}: {
  groupName: string
  rows: StandingRow[]
  tournamentId?: string
  currentGroupId?: string
  groups?: { id: string; name: string }[]
  entryUnit?: string
}) {
  const movable = Boolean(tournamentId && currentGroupId && groups && groups.length > 1)
```

Change the header cell from:

```tsx
              <th className="whitespace-nowrap px-2 py-2.5 text-left">Player</th>
```

to:

```tsx
              <th className="whitespace-nowrap px-2 py-2.5 text-left">{entryUnit === 'squad' ? 'Squad' : 'Player'}</th>
```

- [ ] **Step 5: `components/admin/KnockoutPairingEditor.tsx`**

Add `entryUnit?: string` to the props type and destructuring, and a derived `noun`:

```tsx
export function KnockoutPairingEditor({
  mode,
  tournamentId,
  round,
  label,
  participants,
  shape,
  defaultAssignment,
  entryUnit,
}: {
  mode: 'create' | 'rearrange'
  tournamentId: string
  round: string
  label: string
  participants: Participant[]
  shape: { byeCount: number; matchCount: number }
  defaultAssignment: Assignment
  entryUnit?: string
}) {
  const action = mode === 'create' ? createKnockoutRound : swapKnockoutPairing
  const [state, formAction] = useFormState<KnockoutPairingState, FormData>(action, undefined)
  const [flat, setFlat] = useState<string[]>(() => flatten(defaultAssignment))
  const noun = entryUnit === 'squad' ? 'squad' : 'player'
  const nounPlural = `${noun}s`
```

Change the description paragraph from:

```tsx
      <p className="mt-0.5 text-xs text-slate-400">
        {mode === 'create'
          ? 'Set who plays whom, then create the round. Players are notified once you create it.'
          : 'Change the pairings for this unplayed round. Affected players are re-notified.'}
      </p>
```

to:

```tsx
      <p className="mt-0.5 text-xs text-slate-400">
        {mode === 'create'
          ? `Set who plays whom, then create the round. ${nounPlural[0].toUpperCase()}${nounPlural.slice(1)} are notified once you create it.`
          : `Change the pairings for this unplayed round. Affected ${nounPlural} are re-notified.`}
      </p>
```

Change the dupe-fallback line from:

```tsx
              ? `${nameById.get(dupes[0]) ?? 'A player'} is in more than one slot.`
```

to:

```tsx
              ? `${nameById.get(dupes[0]) ?? (noun === 'squad' ? 'A squad' : 'A player')} is in more than one slot.`
```

Change the success line from:

```tsx
            {mode === 'create' ? 'Round created and players notified.' : 'Pairings updated.'}
```

to:

```tsx
            {mode === 'create' ? `Round created and ${nounPlural} notified.` : 'Pairings updated.'}
```

- [ ] **Step 6: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no new errors (the public bracket page's `<GroupStage standings={...} fixtures={...} />` call — no `entryUnit` — still typechecks since the prop is optional everywhere)

Run: `npx eslint app/\[locale\]/admin/tournaments/\[id\]/bracket/page.tsx components/admin/AdminBracketView.tsx components/bracket/GroupStage.tsx components/bracket/StandingsTable.tsx components/admin/KnockoutPairingEditor.tsx`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add app/\[locale\]/admin/tournaments/\[id\]/bracket/page.tsx components/admin/AdminBracketView.tsx components/bracket/GroupStage.tsx components/bracket/StandingsTable.tsx components/admin/KnockoutPairingEditor.tsx
git commit -m "feat(tournaments): admin bracket UI says 'Squad' not 'Player' for team tournaments

Threads entry_unit from the admin bracket page down through
AdminBracketView -> GroupStage -> StandingsTable's column header, and
AdminBracketView -> KnockoutPairingEditor's helper/status copy. Optional
prop everywhere so the public bracket page (unchanged) keeps today's
wording — known, not fixed here.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019upoLDTHxvDVjh8AJ1gFiZ"
```

---

## Task 5: Live Supabase verification

**Files:** none (no code changes — this task exercises Tasks 1-3's write paths against the real Postgres schema in the SentinelX project, `itxubrkbropttfdackmi`, the only Supabase project this repo has — there is no separate staging project or usable preview branch, per `list_branches`).

**Why this task exists, and why it's SQL-direct rather than through the running app:** the CHECK constraints this plan's writes must satisfy (`matches_side_a_kind`, `matches_side_b_kind`, `matches_sides_same_kind`, `group_memberships_kind`, `group_memberships_team_uniq`) live in Postgres, not in the mocked unit tests from Tasks 1-3 — a fake `admin.from(...)` accepts anything. Driving the actual Server Actions would additionally require a live Next.js request context (`requireStaff()` calls `cookies()` via `lib/supabase/server`), which isn't available to a standalone script — so this task executes the *exact same SQL shapes* the modified code now issues, directly, and separately confirms via a manual click-through checklist for whoever next has an authenticated admin browser session.

**Precedent:** a prior team-vs-team dry run already exists in this project — tournament `e04f3194-75f2-4c03-92c9-eadffcdd5c00`, "DRY RUN — Clash Squad 2v2 (team-vs-team phase 3-4-5)", `status='completed'`, 4 squads (`DryRun Squad A-D`), 8 real player profiles. Its bracket is fully resolved, so it can't be reused directly for a mid-tournament move/swap, but its 8 players are safe, already-designated dry-run test accounts — this task reuses them rather than minting new profiles.

- [ ] **Step 1: Create the throwaway tournament fixture**

`execute_sql` runs one raw statement at a time against Postgres directly — it does not support `psql`-style `:name` bind variables. The `:tid`/`:sqA`/`:grpA`/etc. placeholders below are plan-writing shorthand for "the literal uuid this statement's `RETURNING` clause produced" — run each `insert ... returning ...` as its own `execute_sql` call, read the id(s) back from the result, and substitute the literal uuid string into every later statement that references it (the same capture-then-substitute workflow already used above to look up the existing dry-run tournament's ids).

Run via the Supabase MCP (`execute_sql`, project `itxubrkbropttfdackmi`):

```sql
-- New throwaway tournament: same Free Fire / Clash Squad / 2v2 catalogue row
-- the existing dry run used (game_id/mode_id/format_id below), registration
-- already closed with manual pairing on, so both movePlayerToGroup and
-- swapKnockoutPairing are immediately exercisable.
insert into tournaments (
  id, game_id, title, slug, format, tournament_type, competition_format,
  entry_unit, squad_size, mode_id, format_id, status, manual_knockout_pairing
) values (
  gen_random_uuid(),
  '34b6cc26-1976-4734-b93c-5542aa497e90', -- Free Fire
  'DRY RUN — team admin tooling (movePlayerToGroup + swapKnockoutPairing)',
  'dry-run-team-admin-tooling',
  'group_knockout', 'open', 'head_to_head',
  'squad', 2,
  'f54562de-5e1a-46e4-b410-47782a79742c', -- Clash Squad
  '295c3f0f-64aa-4d73-8432-12d7c57a670c', -- 2v2
  'registration_closed', true
)
returning id;
-- Save this id as :tid for every statement below.

-- 4 new squads for this tournament, reusing the 8 real players from the
-- existing DryRun Squad A-D as members (squads are tournament-scoped —
-- squads_id_tournament_uniq — so new squad rows are required, but a player
-- can belong to squads in different tournaments freely).
insert into squads (id, tournament_id, name, captain_id, invite_code, status) values
  (gen_random_uuid(), :tid, 'QA Squad A', '16634813-4900-43bc-b8ae-797e3be6559e', 'QATEAM01', 'complete'),
  (gen_random_uuid(), :tid, 'QA Squad B', 'e108308c-735a-4549-af84-540430b02d95', 'QATEAM02', 'complete'),
  (gen_random_uuid(), :tid, 'QA Squad C', '67690a0e-dfbb-4f7e-b9ff-a004d1460368', 'QATEAM03', 'complete'),
  (gen_random_uuid(), :tid, 'QA Squad D', '1b0e3f64-9cec-44d7-b67c-9480b56cf3d7', 'QATEAM04', 'complete')
returning id, name;
-- Save these 4 ids as :sqA, :sqB, :sqC, :sqD (matching A/B/C/D above).

insert into squad_members (squad_id, tournament_id, player_id, role) values
  (:sqA, :tid, '16634813-4900-43bc-b8ae-797e3be6559e', 'captain'),
  (:sqA, :tid, 'a7d430eb-946f-4db6-834c-75e86a7b4c8f', 'member'),
  (:sqB, :tid, 'e108308c-735a-4549-af84-540430b02d95', 'captain'),
  (:sqB, :tid, 'd38b7d4d-a2c3-4d4b-ad43-5017dfbc259a', 'member'),
  (:sqC, :tid, '67690a0e-dfbb-4f7e-b9ff-a004d1460368', 'captain'),
  (:sqC, :tid, '50a274e2-4afe-4d9b-9eeb-09a41f17c93b', 'member'),
  (:sqD, :tid, '1b0e3f64-9cec-44d7-b67c-9480b56cf3d7', 'captain'),
  (:sqD, :tid, '8e959da8-c509-45e1-8368-4a4051626d8f', 'member');

-- Group A: 3 squads (so a move-out is legal — canMoveOutOfGroup requires
-- leaving 2+ behind). Group B: 1 squad, as the move destination.
insert into groups (id, tournament_id, name) values
  (gen_random_uuid(), :tid, 'Group A'), (gen_random_uuid(), :tid, 'Group B')
returning id, name;
-- Save as :grpA, :grpB.

insert into group_memberships (group_id, tournament_id, team_id) values
  (:grpA, :tid, :sqA), (:grpA, :tid, :sqB), (:grpA, :tid, :sqC),
  (:grpB, :tid, :sqD);

-- Group A's round-robin (3 pairs) — exercises the same insert shape
-- regenerateGroupMatches will use after a move.
insert into matches (tournament_id, round, group_id, status, team_a_id, team_b_id) values
  (:tid, 'group', :grpA, 'scheduled', :sqA, :sqB),
  (:tid, 'group', :grpA, 'scheduled', :sqA, :sqC),
  (:tid, 'group', :grpA, 'scheduled', :sqB, :sqC);

-- A standalone semi_final round, independent of the group stage above —
-- exercises swapKnockoutPairing's update-in-place path.
insert into matches (tournament_id, round, group_id, status, team_a_id, team_b_id) values
  (:tid, 'semi_final', null, 'scheduled', :sqA, :sqB),
  (:tid, 'semi_final', null, 'scheduled', :sqC, :sqD);
```

- [ ] **Step 2: Verify the move-a-squad write path against real constraints**

Run the exact statements `regenerateGroupMatches` now issues for moving `:sqA` from Group A to Group B (mirroring Task 1's code path):

```sql
delete from matches where tournament_id = :tid and round = 'group' and group_id in (:grpA, :grpB);

update group_memberships
set group_id = :grpB, wins = 0, draws = 0, losses = 0, goals_for = 0, goals_against = 0, points = 0
where group_id = :grpA and team_id = :sqA;

-- Post-move rosters: Group A = {sqB, sqC} (1 pair), Group B = {sqD, sqA} (1 pair)
insert into matches (tournament_id, round, group_id, status, team_a_id, team_b_id) values
  (:tid, 'group', :grpA, 'scheduled', :sqB, :sqC),
  (:tid, 'group', :grpB, 'scheduled', :sqD, :sqA);
```

Expected: every statement succeeds (no CHECK/FK violation). Confirm with:

```sql
select group_id, team_id from group_memberships where tournament_id = :tid order by group_id;
-- Group A now has sqB, sqC; Group B now has sqD, sqA.
select group_id, team_a_id, team_b_id, status from matches where tournament_id = :tid and round = 'group';
-- 2 rows, one per group, both with team_a_id/team_b_id set and player_a_id/player_b_id null.
```

- [ ] **Step 3: Verify the pairing-swap write path against real constraints**

Run the exact update `swapKnockoutPairing` now issues to swap the semi-final pairing from `{sqA-sqB, sqC-sqD}` to `{sqA-sqC, sqB-sqD}` (mirroring Task 3's code path — fetch the two `semi_final` row ids first):

```sql
select id, team_a_id, team_b_id from matches where tournament_id = :tid and round = 'semi_final' order by team_a_id;
-- Save the two ids as :m1 (currently sqA/sqB), :m2 (currently sqC/sqD).

update matches set team_a_id = :sqA, team_b_id = :sqC, status = 'scheduled' where id = :m1;
update matches set team_a_id = :sqB, team_b_id = :sqD, status = 'scheduled' where id = :m2;
```

Expected: both succeed. Confirm with a re-select showing the new pairing and `player_a_id`/`player_b_id` still null on both rows.

- [ ] **Step 4: Manual click-through (do this once an authenticated admin session is available — not automatable from this environment)**

1. `npm run dev`, sign in as staff/admin, open `/admin/tournaments/<tid>/bracket`.
2. Confirm the standings table header reads "Squad" (Task 4) and the "Move to…" control appears on each row.
3. Move a squad between groups via the UI; confirm success (not the pre-fix "Player is not in a group" error), and that the group table and fixtures re-render correctly.
4. Open "Rearrange the Semi-Final pairings" and submit a swap; confirm the success message and that both roster members of every affected squad received an in-app notification (`select player_id, type, dedupe_key from notifications where dedupe_key like 'fixture:%' order by created_at desc limit 20;` — expect 8 rows across the 4 squads' rosters, not 4).

- [ ] **Step 5: Tear down the fixture**

```sql
delete from tournaments where id = :tid;
-- squads, squad_members, group_memberships, groups, and matches all cascade
-- from tournaments via ON DELETE CASCADE. Confirm:
select
  (select count(*) from squads where tournament_id = :tid) as squads,
  (select count(*) from groups where tournament_id = :tid) as groups,
  (select count(*) from matches where tournament_id = :tid) as matches;
-- Expect 0, 0, 0.
```

No commit for this task — it produced no file changes. If Step 4 surfaces a bug, fix it as an addendum to the relevant Task (1-4) above, including a regression test, before moving to Task 6.

---

## Task 6: Phase 7 catalogue flip

**Files:**
- Create: `supabase/migrations/20260914190000_flip_ff_team_formats_available.sql`

**Interfaces:** none — data-only migration, no code touches it (`game_mode_formats.available` is read directly by the tournament-creation form's catalogue query, already live code).

- [ ] **Step 1: Write the migration**

```sql
-- Phase 7 of the team-vs-team matches spec (docs/superpowers/specs/2026-09-13-team-vs-team-matches-design.md
-- §11 item 7): flips the three Free Fire team formats from available=false to
-- true now that admins can manage a team tournament's bracket by hand
-- (movePlayerToGroup, createKnockoutRound, swapKnockoutPairing — this plan's
-- Tasks 1-3). A data change, not code, per the existing "availability is
-- data" principle — game_mode_formats rows for every other squad format
-- (Battle Royale Duo/Squad) stay unavailable; this only touches the three
-- formats the spec named.
update public.game_mode_formats f
set available = true
from public.game_modes m, public.games g
where f.mode_id = m.id
  and m.game_id = g.id
  and g.name = 'Free Fire'
  and (
    (m.name = 'Clash Squad' and f.slug in ('2v2', '4v4'))
    or (m.name = 'Lone Wolf' and f.slug = '2v2')
  );
```

- [ ] **Step 2: Apply the migration**

Run via the Supabase MCP (`apply_migration`, project `itxubrkbropttfdackmi`, name `flip_ff_team_formats_available`, using the SQL from Step 1).

Expected: success, 3 rows affected.

- [ ] **Step 3: Verify**

```sql
select g.name as game, m.name as mode, f.slug, f.available
from game_mode_formats f
join game_modes m on m.id = f.mode_id
join games g on g.id = m.game_id
where g.name = 'Free Fire' and m.name in ('Clash Squad', 'Lone Wolf')
order by m.name, f.slug;
```

Expected: `Clash Squad/2v2`, `Clash Squad/4v4`, `Lone Wolf/2v2` all show `available=true`; `Clash Squad/1v1` and `Lone Wolf/1v1` (solo, unaffected) stay `true`; Battle Royale `Duo`/`Squad` stay `false`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260914190000_flip_ff_team_formats_available.sql
git commit -m "feat(tournaments): flip Free Fire team formats to available

Clash Squad 2v2/4v4 and Lone Wolf 2v2 — Phase 7 of the team-vs-team
matches spec, tacked onto the admin-tooling work (Tasks 1-3) that makes
team brackets manageable by hand. Data-only, per 'availability is data'.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019upoLDTHxvDVjh8AJ1gFiZ"
```

---

## Explicitly out of scope (confirmed, do not build)

- **Team-side wagering** (`WagerWidget`, `lib/wagers/market.ts`) — deferred out of Phase 6 too; not touched here.
- **Public bracket page's "Player" header for team tournaments** — `components/bracket/StandingsTable.tsx` is shared with `app/[locale]/(public)/tournaments/[slug]/bracket/page.tsx`, which doesn't pass `entryUnit`. Task 4 makes the prop available there for free (it's optional) but does not wire it — that page's own `<GroupStage standings={...} fixtures={...} />` call is unchanged. A real, pre-existing, minor gap; flagged, not fixed, to keep this plan's file-touch scope to what was approved.
- **Squad roster editing** (who's on a squad) — out of scope by design. This plan's `movePlayerToGroup` changes only move a squad's *group placement* in the bracket; it never touches `squad_members`.
