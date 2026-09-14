# Team-vs-team matches — Phase 6a: public rendering + notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Everywhere a solo match today resolves a `{id, name}` player object (bracket, Match Centre, Hall of Fame champion/third-place, OG share cards, community match-result posts, fixture/reminder/result notifications), a team match resolves the same shape to `{id: squadId, name: squadName}` — and the two places that can't degrade for free (Match Centre's avatar hero, admin's per-player WhatsApp contact chips) get an explicit, deliberate treatment instead of silently breaking.

**Architecture:** One data-layer pattern applied at every read site: add a `squads!matches_team_a_id_fkey`/`team_b_id_fkey(id, name)` embed alongside the existing `profiles!matches_player_a_id_fkey`/`player_b_id_fkey` embed, and pick whichever side is populated (the DB's `matches_side_a_kind`/`matches_side_b_kind` CHECK constraints guarantee exactly one is). A squad's `avatarUrl` is always `null`, which every consumer (`HexAvatar`, the OG card renderer) already renders as initials-from-name — so "generic team badge" needs no new component. Notification fan-out (fixture created, fixture reminder, result confirmed) and the community match-result auto-post both expand a squad side into its roster via the existing `matchRosters()`/`squadRosterIds()` helpers and notify/credit every roster member individually.

**Tech Stack:** Next.js 14 (App Router) Server Components, Supabase (PostgreSQL + PostgREST embeds), TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-13-team-vs-team-matches-design.md` §9 ("UI"), §11 phase 6 ("Public surfaces"). Builds on `docs/superpowers/plans/2026-09-14-team-vs-team-matches-phase3-4-5-bracket-match-economy.md`'s "Explicit scope boundary" section, which named this phase's territory.

## Global Constraints

- **Solo 1v1 must stay byte-for-byte identical.** Every edit in this plan is additive — a `null`/absent-embed check that falls through to the existing profile-based code path, or a new `if (isTeam)` branch alongside the untouched original. The existing test suite (`npm run test`) must stay green **without modification** after every task.
- **A squad never faces a lone player, and a match/group is either all-player or all-team, never mixed** (`matches_side_a_kind`/`matches_side_b_kind`, `group_memberships_kind` CHECK constraints) — every "is this a team match" check in this plan can safely test one side's presence.
- **No new migration.** Every column this plan reads (`matches.team_a_id`/`team_b_id`, `group_memberships.team_id`) already exists.
- **No new component or asset for "team badge."** `src=null` on `HexAvatar` and a `null` `avatarUrl` on the OG card's `CardPlayer` already render initials from whatever name string is given — feed a squad name through the existing no-avatar path rather than building anything new.
- Squads have no logo/avatar/phone-number column — only `name` (2-30 chars, unique per tournament case-insensitively). Any "team badge" or "contact this side" concept is necessarily name-only.
- Financial actions require `requireAdmin()`, never just `requireStaff()` — unaffected by this plan (no financial code touched), noted because two of this plan's files (`bracket-admin-actions.ts`, the admin bracket page) live under `admin/`.

---

## Task 1: `advancement.ts`-adjacent roster helper — `rostersForSquads` batched lookup

Every later task in this plan that needs "every roster member of these squads, one query" (not "one squad's roster, N queries") uses this. `lib/tournaments/squad-roster.ts` already has `squadRosterIds`/`matchRosters` (per-squad, used by the match-lifecycle code where there's always exactly one match's two squads) but nothing batched for a list-page's many matches at once. This task also widens the module's client type so it works from a public (non-admin, RLS-bound) Server Component — `squad_members` and `squads` are both `FOR SELECT USING (true)` (fully public read), confirmed in `supabase/migrations/20260909091000_tournament_entrants.sql`, so a regular `createClient()` client works identically to `createAdminClient()` here.

**Files:**
- Modify: `lib/tournaments/squad-roster.ts`
- Test: `lib/tournaments/squad-roster.test.ts` (new)

**Interfaces:**
- Produces: `rostersForSquads(client: SupabaseClient<Database>, squadIds: string[]): Promise<Map<string, string[]>>` — squad id → every current member's player id, one query, empty map for an empty input. Every task in this plan and in the Phase 6b plan that needs "resolve several squads' rosters at once" imports this.
- Also produces: `squadRosterIds`/`matchRosters`/`squadIdByPlayerForTournament` keep their existing names and behavior, now typed to accept either an admin or a regular Supabase client (`SupabaseClient<Database>` instead of `ReturnType<typeof createAdminClient>`).

- [ ] **Step 1: Write the failing test**

```typescript
// lib/tournaments/squad-roster.test.ts
import { describe, it, expect } from 'vitest'
import { rostersForSquads } from './squad-roster'

function fakeClient(rows: { squad_id: string; player_id: string }[]) {
  return {
    from(table: string) {
      if (table !== 'squad_members') throw new Error(`unexpected table ${table}`)
      return { select: () => ({ in: async () => ({ data: rows }) }) }
    },
  }
}

describe('rostersForSquads', () => {
  it('returns an empty map for no squad ids, with no query', async () => {
    const client = { from: () => { throw new Error('should not query') } }
    const result = await rostersForSquads(client as never, [])
    expect(result.size).toBe(0)
  })

  it('groups member player ids by squad id', async () => {
    const client = fakeClient([
      { squad_id: 's1', player_id: 'p1' },
      { squad_id: 's1', player_id: 'p2' },
      { squad_id: 's2', player_id: 'p3' },
    ])
    const result = await rostersForSquads(client as never, ['s1', 's2'])
    expect(result.get('s1')).toEqual(['p1', 'p2'])
    expect(result.get('s2')).toEqual(['p3'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/tournaments/squad-roster.test.ts`
Expected: FAIL — `rostersForSquads` is not exported.

- [ ] **Step 3: Write the implementation**

Replace the top of `lib/tournaments/squad-roster.ts` (the `Admin` type alias) and add the new function:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'

// squad_members and squads are both publicly readable (members_public_read /
// the equivalent squads policy — FOR SELECT USING (true)), so every function
// here works identically from a regular request-scoped client or the
// service-role admin client. Widened from the admin-only alias this module
// started with once public pages (Phase 6) needed the same lookups.
type Client = SupabaseClient<Database>
```

Then change every `Admin` reference in the file's existing three functions to `Client` (a type-only rename — no behavior change), and append:

```typescript
// Every current member of several squads at once, batched into one query —
// for a list page (bracket, rankings, Hall of Fame) resolving many matches'
// rosters, not the single-match case matchRosters already covers.
export async function rostersForSquads(client: Client, squadIds: string[]): Promise<Map<string, string[]>> {
  if (squadIds.length === 0) return new Map()
  const { data } = await client.from('squad_members').select('squad_id, player_id').in('squad_id', squadIds)
  const map = new Map<string, string[]>()
  for (const r of data ?? []) {
    const arr = map.get(r.squad_id as string) ?? []
    arr.push(r.player_id as string)
    map.set(r.squad_id as string, arr)
  }
  return map
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/tournaments/squad-roster.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck and run the full suite**

Run: `npx tsc --noEmit && npm run test`
Expected: no new type errors; every existing test (including `knockout-pairing-actions.test.ts`, which calls `squadRosterIds`/`matchRosters` via mocks) still passes unmodified.

- [ ] **Step 6: Commit**

```bash
git add lib/tournaments/squad-roster.ts lib/tournaments/squad-roster.test.ts
git commit -m "feat(tournaments): rostersForSquads batched lookup, widen squad-roster.ts to any client"
```

---

## Task 2: `bracket-view.ts` — resolve squad name for fixtures and group standings

**Files:**
- Modify: `lib/tournaments/bracket-view.ts`
- Test: `lib/tournaments/bracket-view.test.ts`

**Interfaces:**
- Consumes: nothing new from other tasks.
- Produces: `loadBracketView`'s returned `fixtures`/`rounds`/`standings`/`champion`/`thirdPlace` unchanged in shape — `BracketMatch.playerA`/`playerB` and `StandingRow.playerId`/`name` now carry a squad's id/name for a team match, exactly the shape a solo match already produced. No consumer of `BracketView` (`MatchCard`, `GroupStage`, `BracketTree`, `bracket.ts`'s pure functions) needs any change — confirmed by reading all of them.

- [ ] **Step 1: Write the failing test**

```typescript
// Add to lib/tournaments/bracket-view.test.ts, inside describe('loadBracketView')
it('resolves a squad name for a team match and a team group standing', async () => {
  const client = {
    from(table: string) {
      if (table === 'groups') {
        return { select: () => ({ eq: () => ({ order: async () => ({ data: [{ id: 'g1', name: 'Group A' }] }) }) }) }
      }
      if (table === 'group_memberships') {
        return {
          select: () => ({
            in: async () => ({
              data: [
                {
                  group_id: 'g1', player_id: null, team_id: 'sq1',
                  wins: 2, draws: 0, losses: 0, goals_for: 6, goals_against: 1, points: 6,
                  profiles: null, squads: { name: 'Lagos Vipers' },
                },
              ],
            }),
          }),
        }
      }
      if (table === 'matches') {
        return {
          select: () => ({
            eq: async () => ({
              data: [
                {
                  id: 'm1', round: 'group', group_id: 'g1', status: 'completed', score_a: 2, score_b: 1,
                  scheduled_at: null, is_full_day: false,
                  player_a: null, player_b: null,
                  team_a: { id: 'sq1', name: 'Lagos Vipers' },
                  team_b: { id: 'sq2', name: 'Thunder Squad' },
                },
              ],
            }),
          }),
        }
      }
      if (table === 'tournament_registrations') {
        return { select: () => ({ eq: async () => ({ data: [] }) }) }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
  const view = await loadBracketView(client as never, 'tournament-id', 'round_robin')
  expect(view.fixtures.completed[0].playerA).toEqual({ id: 'sq1', name: 'Lagos Vipers' })
  expect(view.fixtures.completed[0].playerB).toEqual({ id: 'sq2', name: 'Thunder Squad' })
  expect(view.standings[0].rows[0].name).toBe('Lagos Vipers')
  expect(view.standings[0].rows[0].playerId).toBe('sq1')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/tournaments/bracket-view.test.ts`
Expected: FAIL — squad name resolves to `'TBD'` (falls through the current profile-only mapping).

- [ ] **Step 3: Implement**

In `lib/tournaments/bracket-view.ts`:

```typescript
type ProfileRef = { id?: string; username: string | null; display_name: string | null } | null
type SquadRef = { id?: string; name: string } | null
function nameOf(p: ProfileRef): string {
  return p?.display_name ?? p?.username ?? 'TBD'
}
// Exactly one of the player/squad refs is populated (matches_side_a_kind /
// matches_side_b_kind, group_memberships_kind CHECK constraints) — this
// never has to guess which.
function sideRef(player: ProfileRef, playerId: string | null, squad: SquadRef, squadId: string | null): { id: string; name: string } {
  if (squad) return { id: squad.id ?? squadId ?? '', name: squad.name }
  return { id: player?.id ?? playerId ?? '', name: nameOf(player) }
}
```

Update the `matches` query (inside `Promise.all`):

```typescript
supabase
  .from('matches')
  .select(
    'id, round, group_id, status, score_a, score_b, scheduled_at, is_full_day, ' +
      'player_a_id, player_b_id, team_a_id, team_b_id, ' +
      'player_a:profiles!matches_player_a_id_fkey(id, username, display_name), ' +
      'player_b:profiles!matches_player_b_id_fkey(id, username, display_name), ' +
      'team_a:squads!matches_team_a_id_fkey(id, name), ' +
      'team_b:squads!matches_team_b_id_fkey(id, name)',
  )
  .eq('tournament_id', tournamentId),
```

Update the `allMatches` mapping's raw type and construction:

```typescript
const m = raw as {
  id: string
  round: string
  group_id: string | null
  status: string
  score_a: number | null
  score_b: number | null
  scheduled_at: string | null
  is_full_day: boolean
  player_a_id: string | null
  player_b_id: string | null
  team_a_id: string | null
  team_b_id: string | null
  player_a: ProfileRef
  player_b: ProfileRef
  team_a: SquadRef
  team_b: SquadRef
}
return {
  id: m.id,
  round: m.round,
  group_id: m.group_id,
  groupName: m.group_id ? groupNameById.get(m.group_id) ?? null : null,
  status: m.status,
  score_a: m.score_a,
  score_b: m.score_b,
  scheduled_at: m.scheduled_at,
  is_full_day: m.is_full_day,
  playerA: sideRef(m.player_a, m.player_a_id, m.team_a, m.team_a_id),
  playerB: sideRef(m.player_b, m.player_b_id, m.team_b, m.team_b_id),
}
```

Update the `group_memberships` query and standings mapping:

```typescript
groupIds.length > 0
  ? supabase
      .from('group_memberships')
      .select(
        'group_id, player_id, team_id, wins, draws, losses, goals_for, goals_against, points, ' +
          'profiles(username, display_name), squads(name)',
      )
      .in('group_id', groupIds)
  : Promise.resolve({ data: [] as unknown[] }),
```

```typescript
.map((raw): MembershipInput => {
  const gm = raw as {
    player_id: string | null
    team_id: string | null
    wins: number
    draws: number
    losses: number
    goals_for: number
    goals_against: number
    points: number
    profiles: ProfileRef
    squads: SquadRef
  }
  const side = sideRef(gm.profiles, gm.player_id, gm.squads, gm.team_id)
  return {
    playerId: side.id,
    name: side.name,
    clubName: gm.team_id ? null : clubNameByPlayer.get(gm.player_id ?? '') ?? null,
    wins: gm.wins,
    draws: gm.draws,
    losses: gm.losses,
    goalsFor: gm.goals_for,
    goalsAgainst: gm.goals_against,
    points: gm.points,
  }
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/tournaments/bracket-view.test.ts`
Expected: PASS, including the two pre-existing tests (which pass empty `matches`/`group_memberships` data and are unaffected).

- [ ] **Step 5: Typecheck and full suite**

Run: `npx tsc --noEmit && npm run test`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add lib/tournaments/bracket-view.ts lib/tournaments/bracket-view.test.ts
git commit -m "feat(tournaments): bracket-view resolves squad name for team fixtures and standings"
```

---

## Task 3: `champions.ts` — resolve squad name/avatar-null for Hall of Fame champions

**Files:**
- Modify: `lib/tournaments/champions.ts`
- Test: `lib/tournaments/champions.test.ts`

**Interfaces:**
- Produces: `fetchChampions` output unchanged in shape; `champion.id`/`runnerUp.id` is a squad id for a team tournament, `championAvatarUrl` stays `null` (never populated for a squad — the existing Hall of Fame `HexAvatar` call already renders initials from `champion.name` when `championAvatarUrl` is `null`, confirmed by reading `hall-of-fame/page.tsx`).

- [ ] **Step 1: Write the failing test**

```typescript
// Add to lib/tournaments/champions.test.ts
import { resolveChampion } from './champions'

describe('resolveChampion with squad-shaped ids', () => {
  it('crowns a squad champion identically to a player champion — ids are opaque', () => {
    const bracketMatches = [
      {
        id: 'm1', round: 'final', group_id: null, groupName: null, status: 'completed',
        score_a: 3, score_b: 1, scheduled_at: null, is_full_day: false,
        playerA: { id: 'squad-1', name: 'Lagos Vipers' },
        playerB: { id: 'squad-2', name: 'Thunder Squad' },
      },
    ]
    const result = resolveChampion({ bracketMatches })
    expect(result).toEqual({
      champion: { id: 'squad-1', name: 'Lagos Vipers' },
      runnerUp: { id: 'squad-2', name: 'Thunder Squad' },
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/tournaments/champions.test.ts`
Expected: this actually PASSES already — `resolveChampion` is pure and shape-only, confirming no change is needed there. This step documents that confirmation rather than driving new code; proceed to the query-layer change below, which the pure function doesn't cover.

- [ ] **Step 3: Implement the query-layer change**

In `lib/tournaments/champions.ts`, update `MATCH_SELECT`:

```typescript
const MATCH_SELECT =
  'id, tournament_id, round, status, score_a, score_b, player_a_id, player_b_id, team_a_id, team_b_id, ' +
  'player_a:profiles!matches_player_a_id_fkey(id, username, display_name, avatar_url), ' +
  'player_b:profiles!matches_player_b_id_fkey(id, username, display_name, avatar_url), ' +
  'team_a:squads!matches_team_a_id_fkey(id, name), ' +
  'team_b:squads!matches_team_b_id_fkey(id, name)'
```

Update `MatchRow` and add a squad ref type:

```typescript
type SquadRef = { id: string; name: string } | SquadRef[] | null
interface MatchRow {
  id: string
  tournament_id: string
  round: string
  status: string
  score_a: number | null
  score_b: number | null
  player_a_id: string | null
  player_b_id: string | null
  team_a_id: string | null
  team_b_id: string | null
  player_a: ProfileRef | ProfileRef[] | null
  player_b: ProfileRef | ProfileRef[] | null
  team_a: SquadRef
  team_b: SquadRef
}
```

Add a side-resolution helper next to `nameOf`/`one`:

```typescript
function sideOf(player: ProfileRef | ProfileRef[] | null, playerId: string | null, team: SquadRef, teamId: string | null): { id: string; name: string; avatarUrl: string | null } {
  const t = one(team)
  if (t) return { id: t.id, name: t.name, avatarUrl: null }
  const p = one(player)
  return { id: p?.id ?? playerId ?? '', name: nameOf(p), avatarUrl: p?.avatar_url ?? null }
}
```

In `fetchChampions`, update the avatar-collecting loop and the `bracketMatches`/`h2hMatches` construction:

```typescript
for (const m of matches) {
  const list = byTournament.get(m.tournament_id) ?? []
  list.push(m)
  byTournament.set(m.tournament_id, list)
  for (const side of [sideOf(m.player_a, m.player_a_id, m.team_a, m.team_a_id), sideOf(m.player_b, m.player_b_id, m.team_b, m.team_b_id)]) {
    if (side.id) avatarById.set(side.id, side.avatarUrl)
  }
}
```

```typescript
const bracketMatches: BracketMatch[] = rows.map((m) => {
  const a = sideOf(m.player_a, m.player_a_id, m.team_a, m.team_a_id)
  const b = sideOf(m.player_b, m.player_b_id, m.team_b, m.team_b_id)
  return {
    id: m.id,
    round: m.round,
    group_id: null,
    groupName: null,
    status: m.status,
    score_a: m.score_a,
    score_b: m.score_b,
    scheduled_at: null,
    is_full_day: false,
    playerA: { id: a.id, name: a.name },
    playerB: { id: b.id, name: b.name },
  }
})

const h2hMatches: H2HMatch[] = rows.map((m) => ({
  playerAId: m.team_a_id ?? m.player_a_id ?? '',
  playerBId: m.team_b_id ?? m.player_b_id ?? '',
  scoreA: m.score_a,
  scoreB: m.score_b,
  status: m.status,
}))
```

The `needStandings`/group_memberships branch a few lines below needs the same team-aware treatment as bracket-view.ts's standings mapping. Update its query and mapping:

```typescript
const { data: memRows } = await supabase
  .from('group_memberships')
  .select('group_id, player_id, team_id, wins, draws, losses, goals_for, goals_against, points')
  .in('group_id', groups.map((g) => g.id))
const mems = (memRows ?? []) as unknown as {
  group_id: string
  player_id: string | null
  team_id: string | null
  wins: number
  draws: number
  losses: number
  goals_for: number
  goals_against: number
  points: number
}[]

// Names for players who may never appear in a match join.
const memberIds = Array.from(new Set(mems.filter((m) => m.player_id).map((m) => m.player_id as string)))
const squadIds = Array.from(new Set(mems.filter((m) => m.team_id).map((m) => m.team_id as string)))
const [{ data: profRows }, { data: squadRows }] = await Promise.all([
  memberIds.length ? supabase.from('profiles').select('id, username, display_name, avatar_url').in('id', memberIds) : Promise.resolve({ data: [] }),
  squadIds.length ? supabase.from('squads').select('id, name').in('id', squadIds) : Promise.resolve({ data: [] }),
])
const profileById = new Map<string, ProfileRef>()
for (const p of (profRows ?? []) as unknown as ProfileRef[]) {
  profileById.set(p.id, p)
  avatarById.set(p.id, p.avatar_url)
}
const squadNameById = new Map(((squadRows ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name]))

const tournamentByGroup = new Map(groups.map((g) => [g.id, g.tournament_id]))
for (const m of mems) {
  const tid = tournamentByGroup.get(m.group_id)
  if (!tid) continue
  const list = standingsByTournament.get(tid) ?? []
  const isTeam = m.team_id != null
  list.push({
    playerId: isTeam ? (m.team_id as string) : (m.player_id as string),
    name: isTeam ? squadNameById.get(m.team_id as string) ?? 'Squad' : nameOf(profileById.get(m.player_id as string) ?? null),
    wins: m.wins,
    draws: m.draws,
    losses: m.losses,
    goalsFor: m.goals_for,
    goalsAgainst: m.goals_against,
    points: m.points,
  })
  standingsByTournament.set(tid, list)
}
```

`ProfileRef` needs `avatar_url` typed correctly already (it does — `{ id: string; username: string | null; display_name: string | null; avatar_url: string | null }`, unchanged).

- [ ] **Step 4: Run tests**

Run: `npx vitest run lib/tournaments/champions.test.ts`
Expected: PASS (the new `resolveChampion` test from Step 1, plus every existing `headToHeadWinner` test unmodified).

- [ ] **Step 5: Typecheck and full suite**

Run: `npx tsc --noEmit && npm run test`

- [ ] **Step 6: Commit**

```bash
git add lib/tournaments/champions.ts lib/tournaments/champions.test.ts
git commit -m "feat(tournaments): champions.ts resolves squad champion/standings for team tournaments"
```

---

## Task 4: Hall of Fame's third-place squad resolution

The `thirdPlaceRows` query inside `app/[locale]/(public)/hall-of-fame/page.tsx` builds its own `BracketMatch` for the "Third Place" card, independently of `champions.ts` — same pattern, needs the same fix.

**Files:**
- Modify: `app/[locale]/(public)/hall-of-fame/page.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `thirdPlaceByTournament: Map<string, BracketMatch>` unchanged in shape.

- [ ] **Step 1: Implement**

Find the `thirdPlaceRows` query (selects `player_a:profiles!matches_player_a_id_fkey(id, username, display_name)` etc.) and its mapping loop. Update the select:

```typescript
const { data: thirdPlaceRows } =
  tournamentIds.length > 0
    ? await supabase
        .from('matches')
        .select(
          'id, tournament_id, round, status, score_a, score_b, ' +
            'player_a:profiles!matches_player_a_id_fkey(id, username, display_name), ' +
            'player_b:profiles!matches_player_b_id_fkey(id, username, display_name), ' +
            'team_a:squads!matches_team_a_id_fkey(id, name), ' +
            'team_b:squads!matches_team_b_id_fkey(id, name)',
        )
        .in('tournament_id', tournamentIds)
        .eq('round', 'third_place')
        .in('status', ['completed', 'bye'])
    : { data: [] as unknown[] }
```

Update the row type and mapping (add `SquadRef` type and a `sideRef` helper matching Task 2/3's pattern, scoped to this file since it's the local convention):

```typescript
type SquadRef = { id: string; name: string } | SquadRef[] | null
function firstSquad(s: SquadRef): { id: string; name: string } | null {
  return Array.isArray(s) ? s[0] ?? null : s
}
function sideRef(player: ProfileRef, team: SquadRef): { id: string; name: string } {
  const t = firstSquad(team)
  if (t) return t
  return { id: player?.id ?? '', name: player?.display_name ?? player?.username ?? 'TBD' }
}
```

```typescript
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
    team_a: SquadRef
    team_b: SquadRef
  }
  const a = sideRef(m.player_a, m.team_a)
  const b = sideRef(m.player_b, m.team_b)
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
    playerA: a,
    playerB: b,
  })
}
```

(Check the existing `ProfileRef` type in this file already has an `id` field — it does, per the earlier `championAvatarUrl`-style reads elsewhere in the file.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Manual verification**

This page has no direct test file (consistent with the codebase's convention of not unit-testing page-level DB glue). Run `npm run build` to confirm the page compiles and statically analyzes cleanly.

- [ ] **Step 4: Commit**

```bash
git add "app/[locale]/(public)/hall-of-fame/page.tsx"
git commit -m "feat(hall-of-fame): resolve squad name for a team tournament's third-place card"
```

---

## Task 5: OG share cards — squad name, no avatar

**Files:**
- Modify: `lib/og/match-card-data.ts`

**Interfaces:**
- Produces: `loadMatchCardInput`'s `CardPlayer` unchanged in shape (`{displayName, username, avatarUrl}`) — a squad side gets `{displayName: squadName, username: null, avatarUrl: null}`, which the existing renderer (`lib/og/match-card.tsx`, already read) falls back to initials for.

- [ ] **Step 1: Implement**

```typescript
type SquadRef = { name: string } | { name: string }[] | null
function firstSquad(s: SquadRef): { name: string } | null {
  return Array.isArray(s) ? s[0] ?? null : s
}
function toCardSide(player: Ref<ProfileRef>, team: SquadRef): CardPlayer {
  const t = firstSquad(team)
  if (t) return { displayName: t.name, username: null, avatarUrl: null }
  return toCardPlayer(player)
}
```

Update the query:

```typescript
const { data: raw } = await supabase
  .from('matches')
  .select(
    'status, score_a, score_b, scheduled_at, is_full_day, ' +
      'tournaments(title), ' +
      'player_a:profiles!matches_player_a_id_fkey(username, display_name, avatar_url), ' +
      'player_b:profiles!matches_player_b_id_fkey(username, display_name, avatar_url), ' +
      'team_a:squads!matches_team_a_id_fkey(name), ' +
      'team_b:squads!matches_team_b_id_fkey(name)',
  )
  .eq('id', matchId)
  .maybeSingle()
```

Update the raw-row cast to add `team_a`/`team_b: SquadRef`, and swap `toCardPlayer(m.player_a)`/`toCardPlayer(m.player_b)` for `toCardSide(m.player_a, m.team_a)`/`toCardSide(m.player_b, m.team_b)` in both call sites (`const playerA = ...` / `const playerB = ...`).

- [ ] **Step 2: Extend the existing test**

`match-card-data.test.ts` only tests the pure `selectCardVariant`/`resultWinnerSide` functions (confirmed by reading it) — `loadMatchCardInput` itself is untested DB glue, consistent with the rest of the codebase's convention for this kind of function. No new test needed; typecheck is the verification.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add lib/og/match-card-data.ts
git commit -m "feat(og): resolve squad name for a team match's share card"
```

---

## Task 6: `feed-hooks.ts` — team-match auto-post and challenge progress

**Files:**
- Modify: `lib/community/feed-hooks.ts`

**Interfaces:**
- Consumes: `matchRosters(client, teamAId, teamBId)` from `lib/tournaments/squad-roster.ts` (Task 1's widened client type lets the admin client this file already uses pass through unchanged).
- Produces: `onMatchConfirmed` unchanged signature; now creates a `community_posts` row and credits challenge progress for a team match too, instead of silently returning.

- [ ] **Step 1: Implement**

```typescript
import { matchRosters } from '@/lib/tournaments/squad-roster'

type SquadRef = { name: string } | { name: string }[] | null
function squadNameOf(x: SquadRef): string {
  const r = Array.isArray(x) ? x[0] ?? null : x
  return r?.name ?? 'Squad'
}

interface MatchRow {
  id: string
  round: string
  score_a: number | null
  score_b: number | null
  scheduled_at: string | null
  player_a_id: string | null
  player_b_id: string | null
  team_a_id: string | null
  team_b_id: string | null
  player_a: NameRef
  player_b: NameRef
  team_a: SquadRef
  team_b: SquadRef
  tournament: { title: string } | { title: string }[] | null
}

export async function onMatchConfirmed(admin: Admin, matchId: string): Promise<void> {
  const { data: mRaw } = await admin
    .from('matches')
    .select(
      'id, round, score_a, score_b, scheduled_at, player_a_id, player_b_id, team_a_id, team_b_id, ' +
        'player_a:profiles!matches_player_a_id_fkey(display_name, username), ' +
        'player_b:profiles!matches_player_b_id_fkey(display_name, username), ' +
        'team_a:squads!matches_team_a_id_fkey(name), ' +
        'team_b:squads!matches_team_b_id_fkey(name), ' +
        'tournament:tournaments(title)',
    )
    .eq('id', matchId)
    .maybeSingle()
  const m = mRaw as unknown as MatchRow | null
  if (!m || m.score_a == null || m.score_b == null) return
  const isTeam = !!(m.team_a_id || m.team_b_id)
  if (!isTeam && (!m.player_a_id || !m.player_b_id)) return
  if (isTeam && (!m.team_a_id || !m.team_b_id)) return

  type TournamentRef = { title: string } | { title: string }[] | null
  const t = m.tournament as TournamentRef
  const title = (Array.isArray(t) ? t[0]?.title : t?.title) ?? 'SentinelX'
  const aName = isTeam ? squadNameOf(m.team_a) : nameOf(m.player_a as NameRef)
  const bName = isTeam ? squadNameOf(m.team_b) : nameOf(m.player_b as NameRef)
  const roundLabel = ROUND_LABELS[m.round] ?? m.round
  const dateLabel = formatDate(m.scheduled_at) ?? ''

  const content =
    `🏆 Match Result — ${title}\n` +
    `${aName} ${m.score_a} – ${m.score_b} ${bName}\n` +
    `${roundLabel}${dateLabel ? ` · ${dateLabel}` : ''}`

  const { error } = await admin.from('community_posts').insert({
    post_type: 'match_result',
    reference_id: matchId,
    author_id: null,
    content,
  })
  if (error) {
    console.error('[onMatchConfirmed] community_posts insert failed', { matchId, code: error.code, message: error.message })
  }

  if (isTeam) {
    const { rosterA, rosterB } = await matchRosters(admin, m.team_a_id, m.team_b_id)
    const winnerRoster = m.score_a > m.score_b ? rosterA : m.score_b > m.score_a ? rosterB : []
    for (const pid of [...rosterA, ...rosterB]) await incrementChallenge(admin, pid, 'matches_played')
    for (const pid of winnerRoster) await incrementChallenge(admin, pid, 'matches_won')
    return
  }

  const winnerId = m.score_a > m.score_b ? m.player_a_id : m.score_b > m.score_a ? m.player_b_id : null
  await incrementChallenge(admin, m.player_a_id as string, 'matches_played')
  await incrementChallenge(admin, m.player_b_id as string, 'matches_played')
  if (winnerId) await incrementChallenge(admin, winnerId, 'matches_won')
}
```

Note the solo branch's `player_a_id`/`player_b_id` are cast `as string` because the `!isTeam && (!m.player_a_id || !m.player_b_id) return` guard above has already ruled out null for that branch — matches the original code's behavior exactly, just made explicit since the type is now shared with the team branch.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Full suite**

Run: `npm run test` — `verify-actions.test.ts` calls `onMatchConfirmed` indirectly via `confirmResult`; confirm it's still green (this function is called inside a non-blocking `try/catch`, so even a latent bug here wouldn't fail that test directly, but a type error would fail the build).

- [ ] **Step 4: Commit**

```bash
git add lib/community/feed-hooks.ts
git commit -m "feat(community): team-match result auto-posts and credits roster challenge progress"
```

---

## Task 7: `feed-query.ts` — render a squad side in a match-result post

**Files:**
- Modify: `lib/community/feed-query.ts`

**Interfaces:**
- Produces: `MatchResultDetail.playerA`/`playerB` unchanged shape (`PlayerRef | null`) — a squad side becomes `{id: squadId, username: null, displayName: squadName, avatarUrl: null, membershipTier: 'recruit', sentinelTier: null, frameUrl: undefined}`. `MatchResultCard.tsx` needs no change — confirmed it already guards the profile-link on `player?.username` (falsy for a squad, so it renders as plain text instead of a broken `/players/null` link) and already renders `HexAvatar` with a null-avatar initials fallback.

- [ ] **Step 1: Implement**

Add a squad-side conversion next to `toPlayerRef`:

```typescript
type SquadRef = { id: string; name: string } | { id: string; name: string }[] | null
function firstSquad(s: SquadRef): { id: string; name: string } | null {
  return Array.isArray(s) ? s[0] ?? null : s
}
function toSquadPlayerRef(s: { id: string; name: string } | null): PlayerRef | null {
  if (!s) return null
  return {
    id: s.id,
    username: null,
    displayName: s.name,
    avatarUrl: null,
    membershipTier: 'recruit',
    sentinelTier: null,
    frameUrl: undefined,
  }
}
```

Update the `matches` query and mapping:

```typescript
const { data: matches } = await supabase
  .from('matches')
  .select(
    'id, round, score_a, score_b, scheduled_at, ' +
      'player_a:profiles!matches_player_a_id_fkey(' + PROFILE_FIELDS + '), ' +
      'player_b:profiles!matches_player_b_id_fkey(' + PROFILE_FIELDS + '), ' +
      'team_a:squads!matches_team_a_id_fkey(id, name), ' +
      'team_b:squads!matches_team_b_id_fkey(id, name), ' +
      'tournament:tournaments(title)',
  )
  .in('id', matchIds)
type TournamentRef = { title: string } | { title: string }[] | null
for (const m of (matches ?? []) as unknown as {
  id: string
  round: string
  score_a: number | null
  score_b: number | null
  scheduled_at: string | null
  player_a: ProfileRef
  player_b: ProfileRef
  team_a: SquadRef
  team_b: SquadRef
  tournament: TournamentRef
}[]) {
  const t = Array.isArray(m.tournament) ? m.tournament[0] : m.tournament
  const teamA = firstSquad(m.team_a)
  const teamB = firstSquad(m.team_b)
  matchDetailById.set(m.id, {
    matchId: m.id,
    tournamentTitle: t?.title ?? 'SentinelX',
    roundLabel: ROUND_LABELS[m.round] ?? m.round,
    scoreA: m.score_a,
    scoreB: m.score_b,
    playerA: teamA ? toSquadPlayerRef(teamA) : firstProfile(m.player_a) ? toPlayerRef(firstProfile(m.player_a)) : null,
    playerB: teamB ? toSquadPlayerRef(teamB) : firstProfile(m.player_b) ? toPlayerRef(firstProfile(m.player_b)) : null,
    scheduledAt: m.scheduled_at,
  })
}
```

- [ ] **Step 2: Typecheck and full suite**

Run: `npx tsc --noEmit && npm run test`

- [ ] **Step 3: Commit**

```bash
git add lib/community/feed-query.ts
git commit -m "feat(community): render a squad side on a team match's community result card"
```

---

## Task 8: `notifications/fixture-created.ts` — roster-expanded fixture notifications

**Files:**
- Modify: `lib/notifications/fixture-created.ts`
- Test: none new (this module's DB-glue is untested directly today — confirmed no `fixture-created.test.ts` exists; verified instead via the 4 call sites' own existing tests staying green and a typecheck).

**Interfaces:**
- Consumes: `matchRosters` from `lib/tournaments/squad-roster.ts`.
- Produces: `NewFixtureRow` gains two **optional** fields (`teamAId?: string | null`, `teamBId?: string | null`) — existing callers that never set them (the solo-only knockout-pairing tool) are unaffected. `notifyNewFixtures`'s behavior for rows with `playerAId`/`playerBId` set is byte-for-byte unchanged; rows with `teamAId`/`teamBId` set now notify every roster member of both squads instead of being silently dropped.

- [ ] **Step 1: Implement**

```typescript
import { createAdminClient } from '@/lib/supabase/admin'
import { notify } from './notify'
import { notifyBoth } from './send'
import { fixtureKey } from './keys'
import { formatFixtureDate } from '@/lib/format'
import { SITE_URL } from '@/lib/seo/site'
import { matchRosters } from '@/lib/tournaments/squad-roster'

type Admin = ReturnType<typeof createAdminClient>

export interface NewFixtureRow {
  id: string
  tournamentId: string
  playerAId: string
  playerBId: string | null // null => bye, skipped — nothing for the player to prepare for
  // A team fixture's squad ids. Optional and only ever set together — a row
  // is either a player fixture (playerAId/playerBId) or a team fixture
  // (teamAId/teamBId), never both (matches_side_a_kind/matches_side_b_kind
  // guarantee this at the DB level, mirrored here for callers building rows
  // from a matches select).
  teamAId?: string | null
  teamBId?: string | null
  scheduledAt: string | null
  isFullDay: boolean
}

// Notifies every player of a newly-created (and now-visible) match: in-app
// always, WhatsApp best-effort (currently a no-op until TERMII_API_KEY is
// set, same as every other notify() call in this codebase). Solo rows notify
// the two named players; team rows notify every current member of both
// squads' rosters.
export async function notifyNewFixtures(admin: Admin, rows: NewFixtureRow[]): Promise<void> {
  const solo = rows.filter((r): r is NewFixtureRow & { playerBId: string } => r.playerAId != null && r.playerBId != null)
  const team = rows.filter((r): r is NewFixtureRow & { teamAId: string; teamBId: string } => r.teamAId != null && r.teamBId != null)
  if (solo.length === 0 && team.length === 0) return

  if (solo.length > 0) {
    const playerIds = Array.from(new Set(solo.flatMap((r) => [r.playerAId, r.playerBId])))
    const { data: profiles } = await admin
      .from('profiles')
      .select('id, username, display_name')
      .in('id', playerIds)
    const nameById = new Map((profiles ?? []).map((p) => [p.id, p.display_name ?? p.username ?? 'Player']))

    const tournamentIds = Array.from(new Set(solo.map((r) => r.tournamentId)))
    const { data: tournaments } = await admin.from('tournaments').select('id, title').in('id', tournamentIds)
    const titleByTournament = new Map((tournaments ?? []).map((t) => [t.id, t.title]))

    for (const r of solo) {
      const a = nameById.get(r.playerAId) ?? 'Player'
      const b = nameById.get(r.playerBId) ?? 'Player'
      const tournament = titleByTournament.get(r.tournamentId) ?? 'Sentinel X'
      const matchUrl = `${SITE_URL}/matches/${r.id}`
      const whenLabel = formatFixtureDate(r.scheduledAt, r.isFullDay)
      for (const pid of [r.playerAId, r.playerBId]) {
        await notify({
          type: 'fixture_assigned',
          playerId: pid,
          dedupeKey: fixtureKey(r.id, pid),
          playerA: a,
          playerB: b,
          tournament,
          matchUrl,
          whenLabel,
        })
        void notifyBoth(pid, { type: 'fixture_new', playerA: a, playerB: b, tournament }, 'fixture_assigned', {
          link: `/matches/${r.id}`,
        })
      }
    }
  }

  if (team.length > 0) {
    const squadIds = Array.from(new Set(team.flatMap((r) => [r.teamAId, r.teamBId])))
    const { data: squads } = await admin.from('squads').select('id, name').in('id', squadIds)
    const nameBySquad = new Map((squads ?? []).map((s) => [s.id, s.name]))

    const tournamentIds = Array.from(new Set(team.map((r) => r.tournamentId)))
    const { data: tournaments } = await admin.from('tournaments').select('id, title').in('id', tournamentIds)
    const titleByTournament = new Map((tournaments ?? []).map((t) => [t.id, t.title]))

    for (const r of team) {
      const { rosterA, rosterB } = await matchRosters(admin, r.teamAId, r.teamBId)
      const a = nameBySquad.get(r.teamAId) ?? 'Squad'
      const b = nameBySquad.get(r.teamBId) ?? 'Squad'
      const tournament = titleByTournament.get(r.tournamentId) ?? 'Sentinel X'
      const matchUrl = `${SITE_URL}/matches/${r.id}`
      const whenLabel = formatFixtureDate(r.scheduledAt, r.isFullDay)
      for (const pid of [...rosterA, ...rosterB]) {
        await notify({
          type: 'fixture_assigned',
          playerId: pid,
          dedupeKey: fixtureKey(r.id, pid),
          playerA: a,
          playerB: b,
          tournament,
          matchUrl,
          whenLabel,
        })
        void notifyBoth(pid, { type: 'fixture_new', playerA: a, playerB: b, tournament }, 'fixture_assigned', {
          link: `/matches/${r.id}`,
        })
      }
    }
  }
}
```

Note: `NewFixtureRow.playerAId` keeps its original required `string` type (not widened to `string | null`) — every existing caller already passes `m.player_a_id as string` for solo rows, and the new team-row callers (Task 9) will pass an empty-safe placeholder or restructure their own row-building, covered there.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: fails at the 4 existing call sites, which don't yet supply `teamAId`/`teamBId` — expected, Task 9 fixes them. If it does NOT fail here, double check `playerAId`/`playerBId` types weren't accidentally widened in a way that breaks the `solo` filter's type guard.

- [ ] **Step 3: Commit** (staged together with Task 9, since Task 8 alone doesn't typecheck in isolation — see Task 9's Step 4 for the actual commit point)

Skip committing after this step; proceed directly to Task 9.

---

## Task 9: Wire the 4 `notifyNewFixtures` call sites for team rows

**Files:**
- Modify: `lib/matches/verify-actions.ts` (3 call sites: round-1 generation, `advanceKnockout`, `createThirdPlaceMatch`)
- Modify: `lib/tournaments/bracket-admin-actions.ts` (1 call site: `publishBracket`)

**Interfaces:**
- Consumes: `NewFixtureRow` from Task 8.
- Produces: nothing new — this task only makes the 4 existing calls pass through `team_a_id`/`team_b_id` instead of silently dropping them.

- [ ] **Step 1: `lib/matches/verify-actions.ts` — round-1 generation (~line 197)**

Change the `.select(...)` after the `matches.insert(rows)` and the `notifyNewFixtures` call:

```typescript
const { data: inserted } = await admin
  .from('matches')
  .insert(rows)
  .select('id, player_a_id, player_b_id, team_a_id, team_b_id, scheduled_at, is_full_day')
await notifyNewFixtures(
  admin,
  (inserted ?? []).map((m) => ({
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

Remove the now-stale comment above it ("`// player_a_id and player_b_id null, so it is excluded the same way a bye ... deferred to Phase 6 alongside the rest of team-side notification copy.`") — replace with:

```typescript
// A player row and a team row are mutually exclusive per match (the DB's
// matches_side_a_kind/matches_side_b_kind CHECK) — notifyNewFixtures
// branches on whichever pair is populated.
```

- [ ] **Step 2: `lib/matches/verify-actions.ts` — `advanceKnockout` (~line 263)**

```typescript
const { data: inserted } = await admin
  .from('matches')
  .insert([...])
  .select('id, player_a_id, player_b_id, team_a_id, team_b_id, scheduled_at, is_full_day')
await notifyNewFixtures(
  admin,
  (inserted ?? []).map((m) => ({
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

- [ ] **Step 3: `lib/matches/verify-actions.ts` — `createThirdPlaceMatch` (~line 326)**

```typescript
const { data: inserted } = await admin
  .from('matches')
  .insert({...})
  .select('id, player_a_id, player_b_id, team_a_id, team_b_id, scheduled_at, is_full_day')
await notifyNewFixtures(
  admin,
  (inserted ?? []).map((m) => ({
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

- [ ] **Step 4: `lib/tournaments/bracket-admin-actions.ts` — `publishBracket` (~line 508)**

```typescript
const { data: publishedMatches } = await admin
  .from('matches')
  .select('id, player_a_id, player_b_id, team_a_id, team_b_id, scheduled_at, is_full_day')
  .eq('tournament_id', id)
await notifyNewFixtures(
  admin,
  (publishedMatches ?? []).map((m) => ({
    id: m.id,
    tournamentId: id,
    playerAId: m.player_a_id as string,
    playerBId: m.player_b_id,
    teamAId: m.team_a_id,
    teamBId: m.team_b_id,
    scheduledAt: m.scheduled_at,
    isFullDay: m.is_full_day,
  })),
)
```

- [ ] **Step 5: Typecheck and full suite**

Run: `npx tsc --noEmit && npm run test`
Expected: clean. `knockout-pairing-actions.ts`'s own `notifyNewFixtures` call is untouched (it never sets `teamAId`/`teamBId`, which are optional) — its test (`knockout-pairing-actions.test.ts`) stays green unmodified, confirming the solo-only tool is unaffected.

- [ ] **Step 6: Commit**

```bash
git add lib/notifications/fixture-created.ts lib/matches/verify-actions.ts lib/tournaments/bracket-admin-actions.ts
git commit -m "feat(notifications): fixture-created notifications reach every roster member on a team match"
```

---

## Task 10: Fixture-reminder cron — team roster expansion

**Files:**
- Modify: `app/api/cron/fixture-reminders/route.ts`

**Interfaces:**
- Produces: unchanged `Response.json({ reminded })` shape.

- [ ] **Step 1: Implement**

```typescript
import { createAdminClient } from '@/lib/supabase/admin'
import { notify } from '@/lib/notifications/notify'
import { notifyBoth } from '@/lib/notifications/send'
import { reminderKey } from '@/lib/notifications/keys'
import { isWithinReminderWindow } from '@/lib/notifications/window'
import { SITE_URL } from '@/lib/seo/site'
import { matchRosters } from '@/lib/tournaments/squad-roster'

type NameRef =
  | { display_name: string | null; username: string | null }
  | { display_name: string | null; username: string | null }[]
  | null
function nameOf(x: NameRef): string {
  const r = Array.isArray(x) ? x[0] ?? null : x
  return r?.display_name ?? r?.username ?? 'Player'
}
type SquadRef = { name: string } | { name: string }[] | null
function squadNameOf(x: SquadRef): string {
  const r = Array.isArray(x) ? x[0] ?? null : x
  return r?.name ?? 'Squad'
}
type TitleRef = { title: string } | { title: string }[] | null
function titleOf(x: TitleRef): string {
  const r = Array.isArray(x) ? x[0] ?? null : x
  return r?.title ?? 'the tournament'
}

type ReminderRow = {
  id: string
  scheduled_at: string | null
  player_a_id: string | null
  player_b_id: string | null
  team_a_id: string | null
  team_b_id: string | null
  player_a: NameRef
  player_b: NameRef
  team_a: SquadRef
  team_b: SquadRef
  tournament: TitleRef
}

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const admin = createAdminClient()
  const now = new Date()
  const horizon = new Date(now.getTime() + 65 * 60_000).toISOString()

  const { data } = await admin
    .from('matches')
    .select(
      'id, scheduled_at, player_a_id, player_b_id, team_a_id, team_b_id, ' +
        'player_a:profiles!matches_player_a_id_fkey(display_name, username), ' +
        'player_b:profiles!matches_player_b_id_fkey(display_name, username), ' +
        'team_a:squads!matches_team_a_id_fkey(name), ' +
        'team_b:squads!matches_team_b_id_fkey(name), ' +
        'tournament:tournaments(title)',
    )
    .eq('status', 'scheduled')
    .not('scheduled_at', 'is', null)
    .gt('scheduled_at', now.toISOString())
    .lte('scheduled_at', horizon)

  const rows = (data ?? []) as unknown as ReminderRow[]
  let reminded = 0
  for (const m of rows) {
    if (!isWithinReminderWindow(m.scheduled_at, now)) continue
    const isTeam = !!(m.team_a_id || m.team_b_id)
    if (!isTeam && (!m.player_a_id || !m.player_b_id)) continue
    if (isTeam && (!m.team_a_id || !m.team_b_id)) continue

    const a = isTeam ? squadNameOf(m.team_a) : nameOf(m.player_a)
    const b = isTeam ? squadNameOf(m.team_b) : nameOf(m.player_b)
    const tournament = titleOf(m.tournament)
    const matchUrl = `${SITE_URL}/matches/${m.id}`

    if (isTeam) {
      const { rosterA, rosterB } = await matchRosters(admin, m.team_a_id, m.team_b_id)
      const rosterASet = new Set(rosterA)
      for (const pid of [...rosterA, ...rosterB]) {
        await notify({ type: 'fixture_reminder', playerId: pid, dedupeKey: reminderKey(m.id, pid), playerA: a, playerB: b, tournament, matchUrl })
        const opponent = rosterASet.has(pid) ? b : a
        void notifyBoth(pid, { type: 'match_reminder', tournament, opponent }, 'match_reminder', { link: matchUrl })
        reminded += 1
      }
      continue
    }

    for (const pid of [m.player_a_id as string, m.player_b_id as string]) {
      await notify({ type: 'fixture_reminder', playerId: pid, dedupeKey: reminderKey(m.id, pid), playerA: a, playerB: b, tournament, matchUrl })
      const opponent = pid === m.player_a_id ? b : a
      void notifyBoth(pid, { type: 'match_reminder', tournament, opponent }, 'match_reminder', { link: matchUrl })
      reminded += 1
    }
  }

  return Response.json({ reminded })
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add app/api/cron/fixture-reminders/route.ts
git commit -m "feat(notifications): fixture-reminder cron reaches every roster member on a team match"
```

---

## Task 11: Result-confirmed notification — team roster expansion

**Files:**
- Modify: `lib/matches/verify-actions.ts` (the notify block inside `confirmResult`, ~lines 558-608)

**Interfaces:**
- Produces: no change to `confirmResult`'s return type or the rest of its behavior — only the trailing notify block.

- [ ] **Step 1: Implement**

Replace the `NameRef`/`NdRow` types and the query + notify loop at the end of `confirmResult`:

```typescript
type NameRef =
  | { display_name: string | null; username: string | null }
  | { display_name: string | null; username: string | null }[]
  | null
type SquadRef = { name: string } | { name: string }[] | null
type NdRow = {
  player_a_id: string | null
  player_b_id: string | null
  team_a_id: string | null
  team_b_id: string | null
  player_a: NameRef
  player_b: NameRef
  team_a: SquadRef
  team_b: SquadRef
  tournament: { title: string } | { title: string }[] | null
}
const { data: ndRaw } = await admin
  .from('matches')
  .select(
    'player_a_id, player_b_id, team_a_id, team_b_id, ' +
      'player_a:profiles!matches_player_a_id_fkey(display_name, username), ' +
      'player_b:profiles!matches_player_b_id_fkey(display_name, username), ' +
      'team_a:squads!matches_team_a_id_fkey(name), ' +
      'team_b:squads!matches_team_b_id_fkey(name), ' +
      'tournament:tournaments(title)',
  )
  .eq('id', id)
  .maybeSingle()
const nd = (ndRaw ?? null) as unknown as NdRow | null
if (nd) {
  const nameOf = (x: NameRef) => {
    const r = Array.isArray(x) ? x[0] ?? null : x
    return r?.display_name ?? r?.username ?? 'Player'
  }
  const squadNameOf = (x: SquadRef) => {
    const r = Array.isArray(x) ? x[0] ?? null : x
    return r?.name ?? 'Squad'
  }
  const tRef = nd.tournament
  const title = (Array.isArray(tRef) ? tRef[0]?.title : tRef?.title) ?? 'the tournament'
  const isTeam = !!(nd.team_a_id || nd.team_b_id)
  const a = isTeam ? squadNameOf(nd.team_a) : nameOf(nd.player_a)
  const b = isTeam ? squadNameOf(nd.team_b) : nameOf(nd.player_b)

  const recipients = isTeam
    ? (await (async () => {
        const { rosterA, rosterB } = await squadRosterIdsForBoth(admin, nd.team_a_id, nd.team_b_id)
        return [...rosterA, ...rosterB]
      })())
    : [nd.player_a_id, nd.player_b_id].filter((x): x is string => x != null)

  for (const pid of recipients) {
    await notify({
      type: 'result_confirmed',
      playerId: pid,
      dedupeKey: resultKey(id, pid),
      playerA: a,
      playerB: b,
      scoreA,
      scoreB,
      tournament: title,
    })
    void notifyBoth(
      pid,
      { type: 'result_confirmed', playerA: a, scoreA, scoreB, playerB: b, tournament: title },
      'result_confirmed',
      { link: `/matches/${id}` },
    )
  }
}
```

Rather than an inline IIFE, use `matchRosters` directly (it already returns exactly `{rosterA, rosterB}` for two squad ids) — simplify the block above to:

```typescript
const recipients = isTeam
  ? (await matchRosters(admin, nd.team_a_id, nd.team_b_id)).rosterA.concat((await matchRosters(admin, nd.team_a_id, nd.team_b_id)).rosterB)
  : [nd.player_a_id, nd.player_b_id].filter((x): x is string => x != null)
```

That calls `matchRosters` twice pointlessly — call it once:

```typescript
let recipients: string[]
if (isTeam) {
  const { rosterA, rosterB } = await matchRosters(admin, nd.team_a_id, nd.team_b_id)
  recipients = [...rosterA, ...rosterB]
} else {
  recipients = [nd.player_a_id, nd.player_b_id].filter((x): x is string => x != null)
}
```

Add the import at the top of the file:

```typescript
import { squadRosterIds, matchRosters } from '@/lib/tournaments/squad-roster'
```

(`squadRosterIds` is already imported in this file for the prize-split code above — just add `matchRosters` alongside it in that existing import line rather than a new one.)

- [ ] **Step 2: Typecheck and full suite**

Run: `npx tsc --noEmit && npm run test`
Expected: clean, `verify-actions.test.ts` green unmodified (its existing assertions on `notify`/`notifyBoth` call args for solo matches are unaffected — `recipients` for a solo match is exactly `[player_a_id, player_b_id]` as before).

- [ ] **Step 3: Commit**

```bash
git add lib/matches/verify-actions.ts
git commit -m "feat(notifications): result-confirmed notification reaches every roster member on a team match"
```

---

## Task 12: Admin bracket page — no misleading "no WhatsApp" chip for a team fixture

**Files:**
- Modify: `app/[locale]/admin/tournaments/[id]/bracket/page.tsx`

**Interfaces:**
- Produces: `contacts` (passed to `GroupStage`/`MatchCard` as the `contact` prop) simply has no entry for a team fixture's match id, so `MatchCard`'s `!contact` branch renders the plain card with no chip row — same as today's "admin passed nothing" case.

- [ ] **Step 1: Implement**

Find where `groupFixtures` (or whatever the fixtures array passed to `buildFixtureContactMap` is locally named) is assembled, and the `matches` table query already run on this page for the bracket's own data. Add one cheap extra query for the set of team-fixture match ids, then filter:

```typescript
const { data: teamMatchRows } = await supabase
  .from('matches')
  .select('id')
  .eq('tournament_id', id)
  .not('team_a_id', 'is', null)
const teamMatchIds = new Set((teamMatchRows ?? []).map((m) => m.id as string))

const contacts = buildFixtureContactMap({
  fixtures: groupFixtures.filter((f) => !teamMatchIds.has(f.id)),
  tournamentTitle: t.title,
  regWhatsappByPlayer: new Map(/* ...unchanged... */),
  profileWhatsappByPlayer: new Map(/* ...unchanged... */),
})
```

(Keep every other argument to `buildFixtureContactMap` exactly as it is today — only the `fixtures` array gains the `.filter(...)`.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Manual verification**

No dedicated test exists for this admin page. Run `npm run build` to confirm it compiles.

- [ ] **Step 4: Commit**

```bash
git add "app/[locale]/admin/tournaments/[id]/bracket/page.tsx"
git commit -m "fix(admin): exclude team fixtures from the per-player WhatsApp contact map"
```

---

## Task 13: Match Centre (`/matches/[id]`) — the public team-match experience

The biggest task in this plan: hero avatar/roster treatment, roster-aware participant check, and gating the two features that don't have a team-aware version yet (WagerWidget, admin WhatsApp chips — already handled at the source in Task 12).

**Files:**
- Modify: `app/[locale]/(public)/matches/[id]/page.tsx`

**Interfaces:**
- Consumes: `isMatchParticipant` from `lib/matches/participant.ts` (already built, roster-aware — confirmed by reading it). `matchRosters` from `lib/tournaments/squad-roster.ts`.
- Produces: no change to the page's route or exported functions' signatures.

- [ ] **Step 1: Implement — query and side resolution**

Add `team_a_id, team_b_id` and squad embeds to `MATCH_SELECT`:

```typescript
const MATCH_SELECT =
  'id, round, status, score_a, score_b, scheduled_at, is_full_day, youtube_stream_url, replay_url, player_a_id, player_b_id, team_a_id, team_b_id, ' +
  'tournaments(title, slug, card_image_url, games(name, icon_url, slug, category)), ' +
  'player_a:profiles!matches_player_a_id_fkey(username, display_name, avatar_url, membership_tier, equipped_avatar_border), ' +
  'player_b:profiles!matches_player_b_id_fkey(username, display_name, avatar_url, membership_tier, equipped_avatar_border), ' +
  'team_a:squads!matches_team_a_id_fkey(id, name), ' +
  'team_b:squads!matches_team_b_id_fkey(id, name)'
```

Update `MatchRow`:

```typescript
type SquadRef = { id: string; name: string } | { id: string; name: string }[] | null
type MatchRow = {
  id: string
  round: string
  status: string
  score_a: number | null
  score_b: number | null
  scheduled_at: string | null
  is_full_day: boolean
  youtube_stream_url: string | null
  replay_url: string | null
  player_a_id: string | null
  player_b_id: string | null
  team_a_id: string | null
  team_b_id: string | null
  tournaments: { title: string; slug: string; card_image_url: string | null; games: MatchGameRef | MatchGameRef[] } | null
  player_a: ProfileRef
  player_b: ProfileRef
  team_a: SquadRef
  team_b: SquadRef
}
```

Add a squad-ref helper and side-display resolver near the top, alongside `nameOf`/`opponentName`:

```typescript
function firstSquad(s: SquadRef): { id: string; name: string } | null {
  return Array.isArray(s) ? s[0] ?? null : s
}
// A team match's side, in the shape the page's per-side JSX already renders:
// a display name and (for the hero avatar) an explicit "no avatar" signal.
function sideAName(m: MatchRow): string {
  const t = firstSquad(m.team_a)
  return t ? t.name : nameOf(m.player_a)
}
function sideBDisplayName(m: MatchRow): string {
  const t = firstSquad(m.team_b)
  if (t) return t.name
  return opponentName(m)
}
```

`opponentName`'s existing signature only needs `player_b`/`status` — it's called elsewhere in the file too, so leave it as-is and use `sideBDisplayName` as the team-aware wrapper at call sites that need the team check.

Replace every occurrence of `nameOf(m.player_a)` / `opponentName(m)` with `sideAName(m)` / `sideBDisplayName(m)` at these exact lines (confirmed by grep — 16 occurrences across 9 statements), **except** the header hero block (lines ~286-304, replaced separately and more thoroughly in Step 3 below, which also swaps the avatar itself) and the `CheckInPanel opponentName` prop (line ~351, replaced separately in Step 2 below with viewer-perspective logic, not a flat side-B lookup):

- `generateMetadata`'s `title` string (~line 101)
- `shareText` (~line 208)
- `buildMatchJsonLd({ playerAName: ..., playerBName: ... })` (~lines 238-239)
- both `buildBreadcrumbJsonLd([{ name: \`${...} vs ${...}\`, ... }])` blocks (~lines 252, 258)
- `WagerWidget`'s `playerAName`/`playerBName` props (~lines 329-330)
- `ResultSubmissionForm`'s `playerAName`/`playerBName` props (~lines 360-361)
- `buildRecordingWhatsAppUrl({ playerAName: ..., playerBName: ... })` (~lines 366-367)

After Steps 2 and 3 below also land their own replacements at lines ~286-304 and ~351, re-grep the file for any remaining bare `nameOf(m.player_a)` / `opponentName(m)` call — none should remain outside the `sideAName`/`sideBDisplayName`/`firstSquad` helper definitions themselves.

- [ ] **Step 2: Implement — participant check swap**

Replace:

```typescript
const isParticipant = !!user && (user.id === m.player_a_id || user.id === m.player_b_id)
```

with:

```typescript
import { isMatchParticipant } from '@/lib/matches/participant'
// ...
const isParticipant = !!user && (await isMatchParticipant(supabase, user.id, m))
```

`isMatchParticipant`'s signature already takes exactly `{player_a_id, player_b_id, team_a_id, team_b_id}` — `m` satisfies it directly since `MATCH_SELECT` now includes all four.

The `opponentId`/`opponentCheckedIn`-adjacent block further down (`const opponentId = user?.id === m.player_a_id ? m.player_b_id : m.player_a_id`) stays player-specific — check-in is already per-individual-roster-member (Phase 4), so a team match needs a roster-aware "has at least one teammate on the other side checked in" instead of a single opponent id. `CheckInPanel`'s `opponentCheckedIn` prop is `boolean` (confirmed by reading `components/match/CheckInPanel.tsx`) — both branches below produce a boolean, so the prop itself needs no change, only how it's computed:

```typescript
const isTeamMatch = !!(m.team_a_id || m.team_b_id)
let opponentCheckedIn: boolean
// Also resolves what CheckInPanel's opponentName prop should read from this
// viewer's own perspective (whichever side they are NOT on) — solo already
// does this inline at the CheckInPanel call site; a team match needs the
// same "which side am I not on" but resolved via roster membership instead
// of a single id comparison.
let myOpponentDisplayName = sideBDisplayName(m)
if (isTeamMatch && user) {
  const { rosterA, rosterB } = await matchRosters(supabase, m.team_a_id, m.team_b_id)
  const iAmOnSideA = rosterA.includes(user.id)
  const opponentRoster = iAmOnSideA ? rosterB : rosterA
  opponentCheckedIn = opponentRoster.some((pid) => checkedInIds.has(pid))
  myOpponentDisplayName = iAmOnSideA ? sideBDisplayName(m) : sideAName(m)
} else {
  const opponentId = user?.id === m.player_a_id ? m.player_b_id : m.player_a_id
  opponentCheckedIn = !!opponentId && checkedInIds.has(opponentId)
  myOpponentDisplayName = user?.id === m.player_a_id ? opponentName(m) : nameOf(m.player_a)
}
```

This replaces the existing `const opponentId = ...` / `const opponentCheckedIn = !!opponentId && checkedInIds.has(opponentId)` pair — delete those two lines and insert the block above in their place. `const iCheckedIn = !!user && checkedInIds.has(user.id)` stays exactly as it is (already correct for a team match — check-in is per-individual regardless of side).

Update the `CheckInPanel` JSX call site's `opponentName` prop (currently `opponentName={user!.id === m.player_a_id ? opponentName(m) : nameOf(m.player_a)}`) to `opponentName={myOpponentDisplayName}`.

- [ ] **Step 3: Implement — hero avatar and roster list**

Replace the two `HexAvatar` blocks in the header:

```typescript
{firstSquad(m.team_a) ? (
  <HexAvatar src={null} username={sideAName(m)} tier="recruit" size="md" />
) : (
  <HexAvatar
    src={m.player_a?.avatar_url ?? null}
    username={nameOf(m.player_a)}
    tier={(m.player_a?.membership_tier ?? 'recruit') as MembershipTier}
    size="md"
    frameUrl={frameUrlFor(m.player_a?.equipped_avatar_border)}
  />
)}
<p className="text-lg font-bold text-white">{sideAName(m)}</p>
```

(mirrored for side B using `firstSquad(m.team_b)` / `sideBDisplayName(m)` / `m.player_b`).

Below the header card, add a roster section shown only for a team match, reusing the admin review page's roster-query pattern:

```typescript
{isTeamMatch && (
  <TeamRosters teamAId={m.team_a_id} teamBId={m.team_b_id} teamAName={sideAName(m)} teamBName={sideBDisplayName(m)} />
)}
```

Add the (server-async) roster section as a local async component in the same file, right after the imports:

```typescript
async function TeamRosters({
  teamAId,
  teamBId,
  teamAName,
  teamBName,
}: {
  teamAId: string | null
  teamBId: string | null
  teamAName: string
  teamBName: string
}) {
  const supabase = createClient()
  const squadIds = [teamAId, teamBId].filter((id): id is string => id != null)
  const { data: members } = await supabase
    .from('squad_members')
    .select('squad_id, profiles(username, display_name)')
    .in('squad_id', squadIds)
  const rosterFor = (squadId: string | null) =>
    (members ?? [])
      .filter((m) => m.squad_id === squadId)
      .map((m) => {
        const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles
        return p?.display_name ?? p?.username ?? 'Player'
      })

  return (
    <div className="mb-6 grid grid-cols-2 gap-4 rounded-2xl border border-slate-800 bg-slate-900 p-4 text-sm">
      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">{teamAName}</p>
        <ul className="space-y-1 text-slate-300">
          {rosterFor(teamAId).map((name) => <li key={name}>{name}</li>)}
        </ul>
      </div>
      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">{teamBName}</p>
        <ul className="space-y-1 text-slate-300">
          {rosterFor(teamBId).map((name) => <li key={name}>{name}</li>)}
        </ul>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Implement — hide WagerWidget for a team match**

Change:

```typescript
{!isParticipant && (
  <WagerWidget ... />
)}
```

to:

```typescript
{!isParticipant && !isTeamMatch && (
  <WagerWidget ... />
)}
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean once every `nameOf(m.player_a)`/`opponentName(m)` call site outside the solo-avatar branches has been swapped to `sideAName(m)`/`sideBDisplayName(m)` (the compiler won't catch a missed one since both return `string` — grep the file for remaining bare `nameOf(m.player_a)`/`opponentName(m)` calls after this step and confirm each remaining one is intentionally inside a solo-only branch already guarded by `!firstSquad(...)`).

- [ ] **Step 6: Manual verification**

No dedicated test file for this page (consistent with the rest of this plan's pages). Run `npm run build`, then use the `run` skill or the dev server to load a team match's `/matches/[id]` page against a squad-populated tournament (the existing DRY RUN tournament from Phase 3-4-5, whose test data is intentionally kept) and confirm: hero shows squad names with initials-badge avatars, roster list renders both sides' members, no WagerWidget, check-in/submission still work for a roster member.

- [ ] **Step 7: Commit**

```bash
git add "app/[locale]/(public)/matches/[id]/page.tsx"
git commit -m "feat(matches): Match Centre renders squad sides, rosters, and hides wagering for team matches"
```

---

## Explicitly out of scope (confirmed, do not build)

- `WagerWidget`/`lib/wagers/market.ts` gaining real team-side wagering (pick-a-squad) — hidden entirely instead (Task 13, Step 4).
- Admin per-player WhatsApp contact chips growing a team-aware version — stay solo-only; team fixtures are excluded from the contact map instead (Task 12).
- `movePlayerToGroup` (`lib/tournaments/group-admin-actions.ts`) and the manual-knockout-pairing tools (`lib/tournaments/knockout-pairing-actions.ts`) gaining team support — both already fail safely against a team tournament (per the Phase 3-4-5 plan's own note) and stay solo-only until their own follow-up plan.
- Phase 7's catalogue flip (`UPDATE game_mode_formats SET available = true` for Clash Squad 2v2/4v4, Lone Wolf 2v2) — a one-line data change, not part of this plan; tack it onto whichever of the two items above lands last.

## Self-review notes

- **Spec coverage:** §9's three UI bullets are covered — "player dashboard" fixture/check-in/submit context (Task 13), admin squad-assembly/attendance-grid screens (already shipped in Phase 4/5, unaffected here), and "wherever a `{id,name}` player object is rendered... resolve to `{id: squadId, name: squadName}`" (Tasks 2-5, 7). §11 phase 6's "public surfaces... champion recording" is Tasks 3-4.
- **Type consistency:** `NewFixtureRow.teamAId`/`teamBId` (Task 8) match exactly what Task 9's four call sites construct. `matchRosters`'s `{rosterA, rosterB}` return shape (existing, unchanged) is consumed identically in Tasks 6, 10, 11, 13. `rostersForSquads` (Task 1) is defined but not consumed within this plan — it's for Phase 6b's list-page tasks; kept here because Task 1 is also where the module's client type widens, which Task 6's `matchRosters(admin, ...)` call needs to keep compiling against the admin client it already uses (structurally compatible either way, confirmed by both `createClient()` and `createAdminClient()` returning `SupabaseClient<Database>`).
- **Placeholder scan:** none — every step has complete code, not a description.
