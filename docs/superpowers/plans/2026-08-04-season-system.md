# Season System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the full three-tier Season System (Community Club / SentinelX Masters / SentinelX Champions Cup) — ranking points, no-show penalties, the Masters/Champions Cup invitation flow with 48-hour cascade, a public Season page, admin tooling, and nav entry — per `docs/superpowers/specs/2026-08-03-season-system-design.md`.

**Architecture:** Four new tables (`seasons`, `season_ranking_points`, `season_noshow_penalties`, `tournament_invitations`) plus three new columns on `tournaments`. Placement/eligibility math is written as pure, unit-tested functions (`lib/tournaments/season-placement.ts`, `lib/seasons/eligibility.ts`, `lib/seasons/points-aggregate.ts`); all Supabase I/O is a thin wrapper around those, matching this codebase's existing split (see Global Constraints). Points are awarded by hooking into the tournament-completion path already shared by `confirmResult` (verify-actions.ts) and the no-show resolution actions (noshow-actions.ts). Invitations reuse the existing tournament-registration + Paystack pipeline unchanged.

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase (Postgres + RLS), Paystack, Vitest.

## Global Constraints

- Migration file: `047_season_system.sql` (convention: `NNN_snake_case.sql`, zero-padded, no timestamp). Originally planned as 046, but `046_third_place_match.sql` landed in the repo after this plan's research and is already applied remotely — renumbered to 047 during execution.
- **No DB transactions or RPCs anywhere in this codebase.** Every multi-step write (e.g. `syncMatchEvents`, `confirmResult`) is a sequence of plain `.from().insert()/.update()` calls on the service-role admin client, best-effort, no rollback. New code must follow the same style — do not introduce `supabase.rpc()` or `BEGIN/COMMIT` for this feature.
- **No Supabase mocking in tests.** Confirmed zero `vi.mock`/`createAdminClient` usage across every `.test.ts` file in the repo. Business logic is deliberately split into plain, IO-free functions in sibling files (e.g. `verify.ts` next to `verify-actions.ts`) and only those get unit tests. `'use server'` action files and other IO wrappers are not unit tested — this plan follows that split throughout and does not fabricate tests for IO code.
- Test runner: Vitest (`npm run test` → `vitest run`), config at `vitest.config.ts`, test files colocated as `*.test.ts`.
- All admin/staff writes go through `createAdminClient()` (service-role, bypasses RLS); RLS policies grant `SELECT` only, never client-side `INSERT`/`UPDATE` — mirrors `wallet_deposits`/`buy_requests`.
- Points values (verbatim from spec): Community Club — champion 100, runner-up 70, semis 45, quarters 25, round of 16 → 10, round of 32 / non-advancer → 5. Masters — champion 300, runner-up 200, semis 150, quarters 100, round of 16 / non-advancer → 50. No-show penalty: **-15** ranking points, written alongside the existing **-10** Sentinel Score penalty. Masters slots: **16**. Response window: **48 hours**. Eligibility floor: `sentinel_score >= 40`. Masters fee: **₦500**. Champions Cup: free, no additional season points on placement.
- Season 1 seed (verbatim from spec): `('Season 1', 'season-1', '2026-08-01', '2027-07-31', 'active')`.

## Deviations From the Spec (read before implementing)

The spec was written before checking the live codebase; research surfaced several places where its literal wording doesn't match what's actually there. Each is resolved below rather than left ambiguous. Flag any of these to the user if they'd rather it done differently — otherwise proceed as written.

1. **Nav has no "Store" link.** `lib/nav/links.ts` renamed that pillar to "Exchange" a while ago, with a comment explicitly warning against reintroducing the old name. "Seasons" is added to `SECONDARY_LINKS` right after "Leaderboards" instead of "between Leaderboards and Store."
2. **Admin routes don't match the spec's assumed paths.** There is no `app/admin/tournaments/create/page.tsx` or `app/admin/tournaments/[id]/page.tsx` — the real files are `app/admin/tournaments/new/page.tsx` and `app/admin/tournaments/[id]/edit/page.tsx` (there is no shared `[id]` detail page; each admin sub-view is its own route). The Invitations panel becomes a new sibling route, `app/admin/tournaments/[id]/invitations/page.tsx`, linked from the edit page.
3. **Placement bands are generalized to survive the mandatory group stage.** The spec's points tables assume Community Club (32) and Masters (16) run as pure single-elimination brackets. They can't: `lib/tournaments/draw.ts#groupCountFor` forces a group stage above 8 registered players with no override path to 0 groups at these sizes. Placement is instead computed by *knockout round reached* (`round_of_32` → `round_of_16` → `quarter_final` → `semi_final` → `final`), and any player who never reaches a knockout match (eliminated in, or never advanced out of, groups) is bucketed into the lowest band for that tournament type. The point values are identical to the spec's table; this just makes the bucketing robust to whatever group count an admin actually picks, instead of assuming a bracket shape the engine won't produce by default. See Task 2.
4. **"Same transaction" (spec §3.3) means "same synchronous call sequence," not a Postgres transaction** — per the no-RPC constraint above. The -15 write happens immediately alongside the existing -10 Sentinel Score write, both inside `syncMatchEvents`.
5. **Fixes a real, pre-existing gap this feature depends on.** Today, when a knockout final is resolved via `declareNoShowWinner` or `markBothNoShow` (no-show paths), the tournament is never flipped to `status = 'completed'` — only `confirmResult` does that, and a comment in `advanceKnockout` says completion is "handled by the caller," but the no-show callers never handle it. This means a Masters final decided by walkover currently never pays out its prize *or* would silently skip season points. Task 6 extracts a shared `completeTournamentIfFinal` helper used by all three call sites, fixing this for prize payout too, not just season points.
6. **Leaderboard queries are JS aggregation, not raw SQL.** The spec writes parameterized SQL with `:season_id` placeholders; this codebase has no RPC/raw-SQL layer anywhere (rankings page does the same — fetch rows, aggregate in JS). `lib/seasons/data.ts` follows that convention.
7. **`invitation_only` is computed server-side from `tournament_type`, never a submitted form field.** The spec describes a UI toggle that's "auto-enabled and non-editable" for Masters/Champions Cup — a disabled HTML checkbox doesn't submit its value at all, so trusting a client-submitted boolean here would be both fragile and against the "never trust the client" rule already applied to payments. The admin form shows it as a computed, read-only label instead.
8. **No new webhook branch needed.** `acceptMastersInvitation` creates a normal `tournament_registrations` row with a `paystack_reference`; the existing `confirmRegistration` (`lib/tournaments/confirm.ts`), already wired into the Paystack webhook fan-out, looks rows up purely by reference and is tournament-type-agnostic. Zero changes to `app/api/paystack/webhook/route.ts`.
9. **The spec's `start_date` column doesn't exist.** The real column is `tournaments.tournament_start`. Used throughout instead.
10. **Season page ships a functional trim.** Per the user's explicit instruction ("build it functionally now, we'll style later"), the week-countdown widget, the per-month "top ranked player" line, and the "Community Clubs Played / Masters Qualified" leaderboard columns are deferred — each needs extra queries with no data-model impact, and can be added in a follow-up without touching this plan's work. Leaderboard is capped at top 50 with no further pagination (matches `LeaderboardTable`'s existing precedent — the site has no paginated table anywhere yet).

---

## Task 1: Migration — season tables, tournament columns, notification types, seed

**Files:**
- Create: `supabase/migrations/047_season_system.sql`

**Interfaces:**
- Produces: tables `seasons`, `season_ranking_points`, `season_noshow_penalties`, `tournament_invitations`; new columns `tournaments.tournament_type` (`'community_club'|'masters'|'champions_cup'|'open'`, default `'open'`), `tournaments.season_id` (nullable FK), `tournaments.invitation_only` (boolean, default `false`).

- [ ] **Step 1: Write the migration**

```sql
-- 046_season_system.sql
-- SentinelX Season System: seasons, ranking points, no-show penalties, and
-- tournament invitations (Masters + Champions Cup). See
-- docs/superpowers/specs/2026-08-03-season-system-design.md.

CREATE TABLE public.seasons (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  slug        text        NOT NULL UNIQUE,
  start_date  date        NOT NULL,
  end_date    date        NOT NULL,
  status      text        NOT NULL DEFAULT 'active'
                CHECK (status IN ('upcoming', 'active', 'completed')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.seasons ENABLE ROW LEVEL SECURITY;

-- Public: shown on the logged-out /seasons/[slug] page.
CREATE POLICY "seasons_select" ON public.seasons
  FOR SELECT USING (true);

CREATE TABLE public.season_ranking_points (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id     uuid        NOT NULL REFERENCES public.seasons(id),
  player_id     uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  tournament_id uuid        NOT NULL REFERENCES public.tournaments(id),
  points        integer     NOT NULL DEFAULT 0,
  placement     integer,
  awarded_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (season_id, player_id, tournament_id)
);

CREATE INDEX ON public.season_ranking_points (season_id, player_id);
CREATE INDEX ON public.season_ranking_points (tournament_id);

ALTER TABLE public.season_ranking_points ENABLE ROW LEVEL SECURITY;

-- Player reads their own; staff reads all. No client write policy — every
-- write goes through the service-role client from awardSeasonPoints.
CREATE POLICY "srp_select" ON public.season_ranking_points
  FOR SELECT USING (auth.uid() = player_id OR public.is_staff());

CREATE TABLE public.season_noshow_penalties (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id   uuid        NOT NULL REFERENCES public.seasons(id),
  player_id   uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  match_id    uuid        NOT NULL REFERENCES public.matches(id),
  points      integer     NOT NULL DEFAULT -15,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (season_id, player_id, match_id)
);

CREATE INDEX ON public.season_noshow_penalties (season_id, player_id);

ALTER TABLE public.season_noshow_penalties ENABLE ROW LEVEL SECURITY;

CREATE POLICY "snp_select" ON public.season_noshow_penalties
  FOR SELECT USING (auth.uid() = player_id OR public.is_staff());

CREATE TABLE public.tournament_invitations (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id   uuid        NOT NULL REFERENCES public.tournaments(id),
  player_id       uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  rank_at_invite  integer     NOT NULL,
  status          text        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
  invited_at      timestamptz NOT NULL DEFAULT now(),
  responded_at    timestamptz,
  expires_at      timestamptz NOT NULL,
  UNIQUE (tournament_id, player_id)
);

CREATE INDEX ON public.tournament_invitations (tournament_id, status);
CREATE INDEX ON public.tournament_invitations (player_id);

ALTER TABLE public.tournament_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ti_select" ON public.tournament_invitations
  FOR SELECT USING (auth.uid() = player_id OR public.is_staff());

-- Extend tournaments for season tiers. 'open' preserves existing behavior
-- for every tournament created before this migration.
ALTER TABLE public.tournaments
  ADD COLUMN tournament_type text NOT NULL DEFAULT 'open'
    CHECK (tournament_type IN ('community_club', 'masters', 'champions_cup', 'open')),
  ADD COLUMN season_id uuid REFERENCES public.seasons(id),
  ADD COLUMN invitation_only boolean NOT NULL DEFAULT false;

CREATE INDEX ON public.tournaments (season_id);

-- New notification types for the invitation flow. invitation_accepted is
-- in-app only (staff awareness) so it's added to player_notifications but
-- not the WhatsApp outbox (notifications).
ALTER TABLE public.player_notifications DROP CONSTRAINT player_notifications_type_check;
ALTER TABLE public.player_notifications ADD CONSTRAINT player_notifications_type_check
  CHECK (type IN (
    'listing_approved', 'listing_removed', 'listing_deleted', 'listing_sold',
    'withdrawal_paid', 'withdrawal_rejected',
    'result_confirmed', 'referral_credited',
    'friend_request', 'wallet_credited',
    'player_disqualified', 'noshow_needs_decision',
    'buy_request_in_progress', 'buy_request_fulfilled', 'buy_request_closed',
    'masters_invitation', 'champions_cup_invitation',
    'invitation_accepted', 'invitation_expired_cascade'
  ));

ALTER TABLE public.notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'registration_confirmed', 'fixture_reminder', 'result_confirmed',
    'prize_credited', 'escrow_sale', 'escrow_completed', 'escrow_refunded',
    'noshow_needs_decision',
    'masters_invitation', 'champions_cup_invitation', 'invitation_expired_cascade'
  ));

-- Seed Season 1.
INSERT INTO public.seasons (name, slug, start_date, end_date, status)
VALUES ('Season 1', 'season-1', '2026-08-01', '2027-07-31', 'active');
```

- [ ] **Step 2: Apply the migration**

Apply it the same way prior migrations in this repo were applied (Supabase MCP `apply_migration` or CLI, per project convention — check `docs/superpowers/plans/2026-08-02-buy-requests.md` for the exact command used last time if unsure). Verify with a query: `select * from public.seasons;` should return the one seeded row.

- [ ] **Step 3: Regenerate types**

```bash
npx supabase gen types typescript --project-id <project-id> > lib/supabase/types.ts
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/046_season_system.sql lib/supabase/types.ts
git commit -m "feat(seasons): add season system schema, seed Season 1"
```

---

## Task 2: Pure placement logic — `lib/tournaments/season-placement.ts`

**Files:**
- Create: `lib/tournaments/season-placement.ts`
- Test: `lib/tournaments/season-placement.test.ts`

**Interfaces:**
- Consumes: `ROUND_ORDER` from `lib/tournaments/bracket.ts` (`['round_of_32','round_of_16','quarter_final','semi_final','final']`); `matchWinnerId`, `type AdvanceMatch` from `lib/tournaments/advancement.ts`.
- Produces: `bandsForPlacements(matches, activePlayerIds): PlacementResult[]`, `pointsForBand(tournamentType, band): number`, `placementForBand(tournamentType, band): number`, types `PlacementBand`, `PlacementMatch`, `PlacementResult`, `SeasonTournamentType`. Consumed by Task 5.

- [ ] **Step 1: Write the failing tests**

```typescript
// lib/tournaments/season-placement.test.ts
import { describe, it, expect } from 'vitest'
import {
  bandsForPlacements,
  pointsForBand,
  placementForBand,
  type PlacementMatch,
} from './season-placement'

function m(overrides: Partial<PlacementMatch> & Pick<PlacementMatch, 'round'>): PlacementMatch {
  return {
    status: 'completed',
    score_a: 1,
    score_b: 0,
    player_a_id: null,
    player_b_id: null,
    ...overrides,
  }
}

describe('bandsForPlacements', () => {
  it('gives the final winner champion and the loser runner_up', () => {
    const matches = [m({ round: 'final', player_a_id: 'a', player_b_id: 'b', score_a: 2, score_b: 1 })]
    const result = bandsForPlacements(matches, ['a', 'b'])
    expect(result).toEqual(
      expect.arrayContaining([
        { playerId: 'a', band: 'champion' },
        { playerId: 'b', band: 'runner_up' },
      ]),
    )
  })

  it('bands semi-final losers as semi_final', () => {
    const matches = [
      m({ round: 'semi_final', player_a_id: 'a', player_b_id: 'x', score_a: 2, score_b: 0 }),
      m({ round: 'semi_final', player_a_id: 'b', player_b_id: 'y', score_a: 3, score_b: 1 }),
      m({ round: 'final', player_a_id: 'a', player_b_id: 'b', score_a: 1, score_b: 0 }),
    ]
    const result = bandsForPlacements(matches, ['a', 'b', 'x', 'y'])
    expect(result.find((r) => r.playerId === 'x')?.band).toBe('semi_final')
    expect(result.find((r) => r.playerId === 'y')?.band).toBe('semi_final')
  })

  it('a bye advances silently — no band assigned at the bye round', () => {
    const matches = [
      m({ round: 'round_of_16', status: 'bye', player_a_id: 'a', player_b_id: null }),
      m({ round: 'quarter_final', player_a_id: 'a', player_b_id: 'z', score_a: 0, score_b: 1 }),
    ]
    const result = bandsForPlacements(matches, ['a', 'z'])
    expect(result.find((r) => r.playerId === 'a')?.band).toBe('quarter_final')
  })

  it('a forfeited (double no-show) round eliminates both players', () => {
    const matches = [m({ round: 'quarter_final', status: 'forfeited', score_a: null, score_b: null, player_a_id: 'a', player_b_id: 'b' })]
    const result = bandsForPlacements(matches, ['a', 'b'])
    expect(result.find((r) => r.playerId === 'a')?.band).toBe('quarter_final')
    expect(result.find((r) => r.playerId === 'b')?.band).toBe('quarter_final')
  })

  it('a forfeited grand final gives both finalists runner_up, nobody champion', () => {
    const matches = [m({ round: 'final', status: 'forfeited', score_a: null, score_b: null, player_a_id: 'a', player_b_id: 'b' })]
    const result = bandsForPlacements(matches, ['a', 'b'])
    expect(result.find((r) => r.playerId === 'a')?.band).toBe('runner_up')
    expect(result.find((r) => r.playerId === 'b')?.band).toBe('runner_up')
  })

  it('a player who never appears in a knockout match is non_advancer', () => {
    const matches = [m({ round: 'final', player_a_id: 'a', player_b_id: 'b', score_a: 1, score_b: 0 })]
    const result = bandsForPlacements(matches, ['a', 'b', 'group-only-player'])
    expect(result.find((r) => r.playerId === 'group-only-player')?.band).toBe('non_advancer')
  })

  it('ignores group-round matches entirely', () => {
    const matches = [
      m({ round: 'group', player_a_id: 'a', player_b_id: 'b', score_a: 5, score_b: 5 }),
      m({ round: 'final', player_a_id: 'a', player_b_id: 'c', score_a: 1, score_b: 0 }),
    ]
    const result = bandsForPlacements(matches, ['a', 'c'])
    expect(result.find((r) => r.playerId === 'a')?.band).toBe('champion')
  })
})

describe('pointsForBand', () => {
  it('community_club matches the spec table', () => {
    expect(pointsForBand('community_club', 'champion')).toBe(100)
    expect(pointsForBand('community_club', 'runner_up')).toBe(70)
    expect(pointsForBand('community_club', 'semi_final')).toBe(45)
    expect(pointsForBand('community_club', 'quarter_final')).toBe(25)
    expect(pointsForBand('community_club', 'round_of_16')).toBe(10)
    expect(pointsForBand('community_club', 'round_of_32')).toBe(5)
    expect(pointsForBand('community_club', 'non_advancer')).toBe(5)
  })

  it('masters matches the spec table, with non_advancer == round_of_16', () => {
    expect(pointsForBand('masters', 'champion')).toBe(300)
    expect(pointsForBand('masters', 'runner_up')).toBe(200)
    expect(pointsForBand('masters', 'semi_final')).toBe(150)
    expect(pointsForBand('masters', 'quarter_final')).toBe(100)
    expect(pointsForBand('masters', 'round_of_16')).toBe(50)
    expect(pointsForBand('masters', 'non_advancer')).toBe(50)
  })
})

describe('placementForBand', () => {
  it('returns a representative numeric placement per band', () => {
    expect(placementForBand('community_club', 'champion')).toBe(1)
    expect(placementForBand('community_club', 'runner_up')).toBe(2)
    expect(placementForBand('community_club', 'round_of_32')).toBe(17)
    expect(placementForBand('masters', 'round_of_16')).toBe(9)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/tournaments/season-placement.test.ts`
Expected: FAIL — `./season-placement` module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// lib/tournaments/season-placement.ts
import { ROUND_ORDER } from './bracket'
import { matchWinnerId, type AdvanceMatch } from './advancement'

export type PlacementBand =
  | 'champion'
  | 'runner_up'
  | 'semi_final'
  | 'quarter_final'
  | 'round_of_16'
  | 'round_of_32'
  | 'non_advancer'

export interface PlacementMatch extends AdvanceMatch {
  round: string
}

export interface PlacementResult {
  playerId: string
  band: PlacementBand
}

// Buckets every actively-registered player into a placement band by walking
// the knockout rounds forward. A bye never decides anything — only a real
// loss, or a 'forfeited' double-no-show, assigns a band. Players who never
// appear in a knockout-round match (eliminated in, or never advanced out
// of, the group stage) fall into 'non_advancer'. Group-round matches are
// ignored entirely; this function is only about the knockout bracket.
export function bandsForPlacements(
  matches: PlacementMatch[],
  activePlayerIds: string[],
): PlacementResult[] {
  const byRound = new Map<string, PlacementMatch[]>()
  for (const m of matches) {
    if (m.round === 'group') continue
    const list = byRound.get(m.round)
    if (list) list.push(m)
    else byRound.set(m.round, [m])
  }

  const band = new Map<string, PlacementBand>()

  for (const round of ROUND_ORDER) {
    const roundMatches = byRound.get(round)
    if (!roundMatches) continue

    for (const match of roundMatches) {
      if (match.status === 'bye') continue

      if (round === 'final') {
        if (match.status === 'forfeited') {
          // Double no-show in the grand final: nobody proved they won, but
          // both finalists still made the final — a shared runner-up
          // placement, not a drop to 'non_advancer'.
          if (match.player_a_id) band.set(match.player_a_id, 'runner_up')
          if (match.player_b_id) band.set(match.player_b_id, 'runner_up')
          continue
        }
        const winner = matchWinnerId(match)
        if (!winner) continue // not yet decided — caller shouldn't reach here
        const loser = winner === match.player_a_id ? match.player_b_id : match.player_a_id
        band.set(winner, 'champion')
        if (loser) band.set(loser, 'runner_up')
        continue
      }

      if (match.status === 'forfeited') {
        if (match.player_a_id) band.set(match.player_a_id, round as PlacementBand)
        if (match.player_b_id) band.set(match.player_b_id, round as PlacementBand)
        continue
      }

      const winner = matchWinnerId(match)
      if (!winner) continue
      const loser = winner === match.player_a_id ? match.player_b_id : match.player_a_id
      if (loser) band.set(loser, round as PlacementBand)
    }
  }

  return activePlayerIds.map((playerId) => ({
    playerId,
    band: band.get(playerId) ?? 'non_advancer',
  }))
}

const COMMUNITY_CLUB_POINTS: Record<PlacementBand, number> = {
  champion: 100,
  runner_up: 70,
  semi_final: 45,
  quarter_final: 25,
  round_of_16: 10,
  round_of_32: 5,
  non_advancer: 5,
}

const MASTERS_POINTS: Record<PlacementBand, number> = {
  champion: 300,
  runner_up: 200,
  semi_final: 150,
  quarter_final: 100,
  round_of_16: 50,
  round_of_32: 50, // defensive fallback — Masters' bracket should never reach this round
  non_advancer: 50,
}

const COMMUNITY_CLUB_PLACEMENT: Record<PlacementBand, number> = {
  champion: 1,
  runner_up: 2,
  semi_final: 3,
  quarter_final: 5,
  round_of_16: 9,
  round_of_32: 17,
  non_advancer: 17,
}

const MASTERS_PLACEMENT: Record<PlacementBand, number> = {
  champion: 1,
  runner_up: 2,
  semi_final: 3,
  quarter_final: 5,
  round_of_16: 9,
  round_of_32: 9, // defensive fallback, see MASTERS_POINTS
  non_advancer: 9,
}

export type SeasonTournamentType = 'community_club' | 'masters'

export function pointsForBand(tournamentType: SeasonTournamentType, band: PlacementBand): number {
  return (tournamentType === 'community_club' ? COMMUNITY_CLUB_POINTS : MASTERS_POINTS)[band]
}

export function placementForBand(tournamentType: SeasonTournamentType, band: PlacementBand): number {
  return (tournamentType === 'community_club' ? COMMUNITY_CLUB_PLACEMENT : MASTERS_PLACEMENT)[band]
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/tournaments/season-placement.test.ts`
Expected: PASS, all cases green.

- [ ] **Step 5: Commit**

```bash
git add lib/tournaments/season-placement.ts lib/tournaments/season-placement.test.ts
git commit -m "feat(seasons): add pure knockout-placement banding logic"
```

---

## Task 3: Pure invitation-selection logic — `lib/seasons/eligibility.ts`

**Files:**
- Create: `lib/seasons/eligibility.ts`
- Test: `lib/seasons/eligibility.test.ts`

**Interfaces:**
- Produces: `selectInvitees(leaderboard, alreadyInvitedPlayerIds, openSlots): string[]`, `MIN_SENTINEL_SCORE_FOR_INVITATION = 40`, type `LeaderboardEntry`. Consumed by Task 11.

- [ ] **Step 1: Write the failing tests**

```typescript
// lib/seasons/eligibility.test.ts
import { describe, it, expect } from 'vitest'
import { selectInvitees, MIN_SENTINEL_SCORE_FOR_INVITATION, type LeaderboardEntry } from './eligibility'

const board: LeaderboardEntry[] = [
  { playerId: 'p1', points: 100, sentinelScore: 80 },
  { playerId: 'p2', points: 90, sentinelScore: 30 }, // below floor
  { playerId: 'p3', points: 80, sentinelScore: 60 },
  { playerId: 'p4', points: 70, sentinelScore: 50 },
]

describe('selectInvitees', () => {
  it('excludes players below the Sentinel Score floor', () => {
    const result = selectInvitees(board, new Set(), 3)
    expect(result).not.toContain('p2')
  })

  it('takes the top N eligible players by points, descending', () => {
    const result = selectInvitees(board, new Set(), 2)
    expect(result).toEqual(['p1', 'p3'])
  })

  it('skips players already invited', () => {
    const result = selectInvitees(board, new Set(['p1']), 2)
    expect(result).toEqual(['p3', 'p4'])
  })

  it('returns an empty array when there are no open slots', () => {
    expect(selectInvitees(board, new Set(), 0)).toEqual([])
  })

  it('MIN_SENTINEL_SCORE_FOR_INVITATION is 40', () => {
    expect(MIN_SENTINEL_SCORE_FOR_INVITATION).toBe(40)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/seasons/eligibility.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// lib/seasons/eligibility.ts
export interface LeaderboardEntry {
  playerId: string
  points: number
  sentinelScore: number
}

export const MIN_SENTINEL_SCORE_FOR_INVITATION = 40

// Highest points first. Skips anyone already invited (any status — pending,
// accepted, declined, or expired all count as "already tried") and anyone
// below the Sentinel Score floor; that slot is simply skipped, not
// reassigned to nobody.
export function selectInvitees(
  leaderboard: LeaderboardEntry[],
  alreadyInvitedPlayerIds: ReadonlySet<string>,
  openSlots: number,
): string[] {
  if (openSlots <= 0) return []
  return leaderboard
    .filter(
      (e) =>
        e.sentinelScore >= MIN_SENTINEL_SCORE_FOR_INVITATION && !alreadyInvitedPlayerIds.has(e.playerId),
    )
    .sort((a, b) => b.points - a.points)
    .slice(0, openSlots)
    .map((e) => e.playerId)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/seasons/eligibility.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/seasons/eligibility.ts lib/seasons/eligibility.test.ts
git commit -m "feat(seasons): add pure invitation-selection logic"
```

---

## Task 4: Pure points aggregation — `lib/seasons/points-aggregate.ts`

**Files:**
- Create: `lib/seasons/points-aggregate.ts`
- Test: `lib/seasons/points-aggregate.test.ts`

**Interfaces:**
- Produces: `sumPointsByPlayer(rows: PointsRow[]): Map<string, number>`, type `PointsRow`. Consumed by Task 10.

- [ ] **Step 1: Write the failing tests**

```typescript
// lib/seasons/points-aggregate.test.ts
import { describe, it, expect } from 'vitest'
import { sumPointsByPlayer } from './points-aggregate'

describe('sumPointsByPlayer', () => {
  it('sums multiple rows per player', () => {
    const totals = sumPointsByPlayer([
      { playerId: 'a', points: 100 },
      { playerId: 'a', points: -15 },
      { playerId: 'b', points: 70 },
    ])
    expect(totals.get('a')).toBe(85)
    expect(totals.get('b')).toBe(70)
  })

  it('returns an empty map for no rows', () => {
    expect(sumPointsByPlayer([]).size).toBe(0)
  })

  it('totals can go negative', () => {
    const totals = sumPointsByPlayer([{ playerId: 'a', points: -15 }])
    expect(totals.get('a')).toBe(-15)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/seasons/points-aggregate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// lib/seasons/points-aggregate.ts
export interface PointsRow {
  playerId: string
  points: number
}

// Sums arbitrary points rows (season_ranking_points ∪ season_noshow_penalties)
// per player. Players with no rows at all are absent from the result —
// callers merge this against whatever player list they need.
export function sumPointsByPlayer(rows: PointsRow[]): Map<string, number> {
  const totals = new Map<string, number>()
  for (const r of rows) {
    totals.set(r.playerId, (totals.get(r.playerId) ?? 0) + r.points)
  }
  return totals
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/seasons/points-aggregate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/seasons/points-aggregate.ts lib/seasons/points-aggregate.test.ts
git commit -m "feat(seasons): add pure points-aggregation helper"
```

---

## Task 5: `awardSeasonPoints` — IO wrapper

**Files:**
- Create: `lib/matches/season-points.ts`

**Interfaces:**
- Consumes: `bandsForPlacements`, `pointsForBand`, `placementForBand` (Task 2).
- Produces: `awardSeasonPoints(admin: Admin, tournamentId: string): Promise<void>`. Consumed by Task 6.

- [ ] **Step 1: Write the implementation**

No unit test — this is a pure IO wrapper around already-tested logic (Global Constraints: IO wrappers aren't unit tested in this codebase). Verified in Task 6's manual check instead.

```typescript
// lib/matches/season-points.ts
import { createAdminClient } from '@/lib/supabase/admin'
import {
  bandsForPlacements,
  pointsForBand,
  placementForBand,
  type PlacementMatch,
  type SeasonTournamentType,
} from '@/lib/tournaments/season-placement'

type Admin = ReturnType<typeof createAdminClient>

function isSeasonTournamentType(t: string): t is SeasonTournamentType {
  return t === 'community_club' || t === 'masters'
}

// No-op for 'open'/'champions_cup' tournaments or ones with no season_id
// (spec §3.4 — Champions Cup placement doesn't affect the season
// leaderboard). Idempotent via upsert on the (season_id, player_id,
// tournament_id) unique constraint, so re-running after a dispute
// resolution simply overwrites the prior points for that tournament.
export async function awardSeasonPoints(admin: Admin, tournamentId: string): Promise<void> {
  const { data: tournament } = await admin
    .from('tournaments')
    .select('id, tournament_type, season_id')
    .eq('id', tournamentId)
    .maybeSingle()
  if (!tournament || !tournament.season_id || !isSeasonTournamentType(tournament.tournament_type)) return

  const { data: registrations } = await admin
    .from('tournament_registrations')
    .select('player_id')
    .eq('tournament_id', tournamentId)
    .eq('status', 'active')
  const activePlayerIds = (registrations ?? []).map((r) => r.player_id)
  if (activePlayerIds.length === 0) return

  const { data: matches } = await admin
    .from('matches')
    .select('round, status, player_a_id, player_b_id, score_a, score_b')
    .eq('tournament_id', tournamentId)

  const placements = bandsForPlacements((matches ?? []) as PlacementMatch[], activePlayerIds)
  const tournamentType = tournament.tournament_type
  const rows = placements.map(({ playerId, band }) => ({
    season_id: tournament.season_id as string,
    player_id: playerId,
    tournament_id: tournamentId,
    points: pointsForBand(tournamentType, band),
    placement: placementForBand(tournamentType, band),
  }))

  await admin.from('season_ranking_points').upsert(rows, { onConflict: 'season_id,player_id,tournament_id' })
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/matches/season-points.ts
git commit -m "feat(seasons): add awardSeasonPoints IO wrapper"
```

---

## Task 6: Wire completion + season points into `confirmResult` (verify-actions.ts)

**Files:**
- Modify: `lib/matches/verify-actions.ts:1-23` (imports), `:296-328` (completion block)

**Interfaces:**
- Consumes: `awardSeasonPoints` (Task 5).
- Produces: exported `completeTournamentIfFinal(admin, tournamentId, round, finalMatch): Promise<void>` — consumed by Task 7.

- [ ] **Step 1: Add the import**

In `lib/matches/verify-actions.ts`, add alongside the existing imports (after the `creditWallet` import at line 21):

```typescript
import { awardSeasonPoints } from './season-points'
```

- [ ] **Step 2: Extract the shared completion helper**

Add this new exported function directly above `confirmResult` (i.e. right after `advanceKnockout` ends, before line 234):

```typescript
// Shared by confirmResult and both no-show resolution paths (noshow-actions.ts)
// — any of the three can be the call that resolves a tournament's grand
// final. Claims completion atomically so the prize is credited, and season
// points awarded, exactly once regardless of which path got there first.
export async function completeTournamentIfFinal(
  admin: Admin,
  tournamentId: string,
  round: string,
  finalMatch: AdvanceMatch,
): Promise<void> {
  if (nextRoundName(round) !== null) return

  const { data: claimed } = await admin
    .from('tournaments')
    .update({ status: 'completed' })
    .eq('id', tournamentId)
    .neq('status', 'completed')
    .select('id, prize_pool')
  if (!claimed || claimed.length === 0) return

  // Winner-take-all: the final's winner gets the full prize_pool. No
  // placement tiers — a runner-up/3rd-place prize, if ever wanted, goes
  // through the admin manual-credit path, not an automated split.
  const winnerId = matchWinnerId(finalMatch)
  const prizePool = claimed[0]?.prize_pool ?? 0
  if (winnerId && prizePool > 0) {
    await creditWallet(admin, winnerId, prizePool, 'prize', tournamentId)
  }
  await awardSeasonPoints(admin, tournamentId)
}
```

- [ ] **Step 3: Replace `confirmResult`'s inline completion block with a call to the helper**

Replace lines 296-328 (the `} else if (isKnockout) { ... }` block) with:

```typescript
  } else if (isKnockout) {
    await advanceKnockout(admin, m.tournament_id, m.round)
    await completeTournamentIfFinal(admin, m.tournament_id, m.round, {
      status: 'completed',
      score_a: scoreA,
      score_b: scoreB,
      player_a_id: m.player_a_id,
      player_b_id: m.player_b_id,
    })
  }
```

(This removes the now-redundant inline `claimed`/`winnerId`/`prizePool` block — behavior is identical, just moved into the shared helper.)

- [ ] **Step 4: Type-check and run the existing suite**

Run: `npx tsc --noEmit` then `npx vitest run lib/matches`
Expected: no new type errors; `lib/matches/verify.test.ts` (pre-existing) still passes unchanged — this task didn't touch any pure logic it covers.

- [ ] **Step 5: Commit**

```bash
git add lib/matches/verify-actions.ts
git commit -m "refactor(matches): extract completeTournamentIfFinal, wire awardSeasonPoints"
```

---

## Task 7: Wire completion + season points into no-show resolution (noshow-actions.ts)

**Files:**
- Modify: `lib/matches/noshow-actions.ts:6-7` (imports), `:218-223` (`declareNoShowWinner`), `:261-297` (`markBothNoShow`)

**Interfaces:**
- Consumes: `completeTournamentIfFinal` (Task 6).

This closes the gap described in Deviation 5: today, a no-show-resolved grand final never flips the tournament to `completed`, so neither the prize nor season points fire. Both call sites already call `advanceKnockout`; each now also calls `completeTournamentIfFinal` right after.

- [ ] **Step 1: Update the import**

In `lib/matches/noshow-actions.ts:7`, change:

```typescript
import { recomputeGroupAndMaybeAdvance, advanceKnockout } from './verify-actions'
```

to:

```typescript
import { recomputeGroupAndMaybeAdvance, advanceKnockout, completeTournamentIfFinal } from './verify-actions'
```

- [ ] **Step 2: Wire it into `declareNoShowWinner`**

At `lib/matches/noshow-actions.ts:218-222`, the walkover's score is already known (`scoreA`/`scoreB` computed at lines 198-199). Change:

```typescript
  if (m.round === 'group' && m.group_id) {
    await recomputeGroupAndMaybeAdvance(admin, m.tournament_id, m.group_id)
  } else if (m.round !== 'group') {
    await advanceKnockout(admin, m.tournament_id, m.round)
  }
```

to:

```typescript
  if (m.round === 'group' && m.group_id) {
    await recomputeGroupAndMaybeAdvance(admin, m.tournament_id, m.group_id)
  } else if (m.round !== 'group') {
    await advanceKnockout(admin, m.tournament_id, m.round)
    await completeTournamentIfFinal(admin, m.tournament_id, m.round, {
      status: 'completed',
      score_a: scoreA,
      score_b: scoreB,
      player_a_id: m.player_a_id,
      player_b_id: m.player_b_id,
    })
  }
```

- [ ] **Step 3: Add `player_a_id`/`player_b_id` to `markBothNoShow`'s select, and wire completion in**

At `lib/matches/noshow-actions.ts:262-265`, the current select is missing the player ids needed by `completeTournamentIfFinal`. Change:

```typescript
    .select('id, round, group_id, tournament_id, status, noshow_flagged_at, tournament:tournaments(slug)')
```

to:

```typescript
    .select(
      'id, round, group_id, tournament_id, status, noshow_flagged_at, player_a_id, player_b_id, tournament:tournaments(slug)',
    )
```

Then at lines 290-296, change:

```typescript
  } else {
    await admin
      .from('matches')
      .update({ status: 'forfeited', completed_at: now, admin_note: reason })
      .eq('id', id)
    await advanceKnockout(admin, m.tournament_id, m.round)
  }
```

to:

```typescript
  } else {
    await admin
      .from('matches')
      .update({ status: 'forfeited', completed_at: now, admin_note: reason })
      .eq('id', id)
    await advanceKnockout(admin, m.tournament_id, m.round)
    await completeTournamentIfFinal(admin, m.tournament_id, m.round, {
      status: 'forfeited',
      score_a: null,
      score_b: null,
      player_a_id: m.player_a_id,
      player_b_id: m.player_b_id,
    })
  }
```

(`matchWinnerId` returns `null` for `status: 'forfeited'`, so a double-no-show grand final correctly pays no prize — matching existing behavior — while still completing the tournament and awarding season points, where `bandsForPlacements`' forfeited-final handling from Task 2 gives both finalists `runner_up`.)

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/matches/noshow-actions.ts
git commit -m "fix(matches): complete tournament + award season points on no-show-resolved finals"
```

---

## Task 8: Season no-show penalty (-15) — `lib/scoring/apply.ts`

**Files:**
- Modify: `lib/scoring/apply.ts`

**Interfaces:**
- Consumes: `matchEventsFor` (existing, `lib/scoring/events.ts`).
- Produces: season no-show penalty rows written inside `syncMatchEvents`, in the same call sequence as the -10 Sentinel Score write (Deviation 4).

The -15 fires whenever `matchEventsFor` would emit a `'no_show'` event for a player (covers `forfeited`, `walkover` loser, and `no_show_draw` — the exact same condition as the existing -10), gated on the match's tournament being season-eligible (`season_id` set, `tournament_type` in `('community_club','masters')`). Like the sentinel-score events, this is regenerated (delete-then-reinsert) every time `syncMatchEvents` runs, so a dispute overturning a walkover correctly removes the penalty too.

- [ ] **Step 1: Widen `MATCH_COLS` to include the tournament's season context**

In `lib/scoring/apply.ts`, `MATCH_COLS` (line 19) currently doesn't carry `tournament_id`. Change:

```typescript
const MATCH_COLS = 'id, player_a_id, player_b_id, score_a, score_b, status, resolution'
```

to:

```typescript
const MATCH_COLS =
  'id, player_a_id, player_b_id, score_a, score_b, status, resolution, tournament_id, ' +
  'tournament:tournaments(tournament_type, season_id)'
```

And widen the `MatchRow` interface (lines 9-17):

```typescript
interface MatchRow {
  id: string
  player_a_id: string | null
  player_b_id: string | null
  score_a: number | null
  score_b: number | null
  status: string
  resolution: string | null
  tournament_id: string
  tournament: { tournament_type: string; season_id: string | null } | { tournament_type: string; season_id: string | null }[] | null
}
```

- [ ] **Step 2: Add the season no-show penalty write inside `regenerateMatchEvents`**

Replace `regenerateMatchEvents` (lines 46-57) with:

```typescript
function isSeasonNoShowEligible(t: MatchRow['tournament']): t is { tournament_type: string; season_id: string } {
  const row = Array.isArray(t) ? t[0] : t
  return !!row?.season_id && (row.tournament_type === 'community_club' || row.tournament_type === 'masters')
}

const SEASON_NO_SHOW_PENALTY = -15

// Delete this match's AUTO events (only) and reinsert from the current
// result, and do the same for its season_noshow_penalties row(s). Returns
// the ids of players whose scoring is affected. No refresh here.
async function regenerateMatchEvents(admin: Admin, match: MatchRow): Promise<string[]> {
  await admin
    .from('sentinel_score_events')
    .delete()
    .eq('match_id', match.id)
    .in('event_type', [...AUTO_MATCH_EVENT_TYPES])
  const events = matchEventsFor(match)
  if (events.length > 0) await admin.from('sentinel_score_events').insert(events)

  // Regenerate season_noshow_penalties for this match the same way — delete
  // then reinsert, so a dispute overturning a walkover clears the penalty too.
  await admin.from('season_noshow_penalties').delete().eq('match_id', match.id)
  const tournamentRow = Array.isArray(match.tournament) ? match.tournament[0] : match.tournament
  if (isSeasonNoShowEligible(match.tournament)) {
    const noShowPlayerIds = events.filter((e) => e.event_type === 'no_show').map((e) => e.player_id)
    if (noShowPlayerIds.length > 0) {
      await admin.from('season_noshow_penalties').insert(
        noShowPlayerIds.map((playerId) => ({
          season_id: tournamentRow!.season_id as string,
          player_id: playerId,
          match_id: match.id,
          points: SEASON_NO_SHOW_PENALTY,
        })),
      )
    }
  }

  return [match.player_a_id, match.player_b_id].filter((x): x is string => !!x)
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (`recomputeAllScoring`'s `matches` select at line ~121 doesn't need `tournament_id`/`tournament` since it only calls `matchEventsFor`, not `regenerateMatchEvents` — leave it as-is.)

- [ ] **Step 4: Commit**

```bash
git add lib/scoring/apply.ts
git commit -m "feat(seasons): write -15 season no-show penalty alongside Sentinel Score -10"
```

---

## Task 9: Notification templates + keys

**Files:**
- Modify: `lib/notifications/templates.ts`
- Modify: `lib/notifications/keys.ts`

**Interfaces:**
- Produces: `TemplateInput` union members `masters_invitation`, `champions_cup_invitation`, `invitation_accepted`, `invitation_expired_cascade`; `mastersInviteKey(tournamentId, playerId): string`. Consumed by Tasks 11-12.

- [ ] **Step 1: Add the four new template variants**

In `lib/notifications/templates.ts`, add to the `TemplateInput` union:

```typescript
  | { type: 'masters_invitation'; tournamentName: string; rank: number; deadline: string; entryFee: string }
  | { type: 'champions_cup_invitation'; tournamentName: string; rank: number; deadline: string; entryFee: string }
  | { type: 'invitation_accepted'; tournamentName: string; playerName: string }
  | { type: 'invitation_expired_cascade'; tournamentName: string; rank: number; deadline: string; entryFee: string }
```

Add the matching cases to `renderTemplate`'s switch:

```typescript
    case 'masters_invitation':
      return {
        templateName: 'masters_invitation',
        body: `🏆 You're invited to ${input.tournamentName}! You ranked #${input.rank}. Entry fee: ${input.entryFee}. Respond by ${input.deadline} to secure your spot.`,
      }
    case 'champions_cup_invitation':
      return {
        templateName: 'champions_cup_invitation',
        body: `🏆 You're invited to ${input.tournamentName} — the season finale! You ranked #${input.rank}. Free entry. Respond by ${input.deadline} to secure your spot.`,
      }
    case 'invitation_accepted':
      return {
        templateName: 'invitation_accepted',
        body: `${input.playerName} accepted their invitation to ${input.tournamentName}.`,
      }
    case 'invitation_expired_cascade':
      return {
        templateName: 'invitation_expired_cascade',
        body: `🏆 A spot opened up in ${input.tournamentName}! You ranked #${input.rank}. Entry fee: ${input.entryFee}. Respond by ${input.deadline} to secure your spot.`,
      }
```

(Match the exact shape/style of the existing cases in that file — indentation, quoting — rather than retyping from scratch.)

- [ ] **Step 2: Add the dedupe-key builder**

In `lib/notifications/keys.ts`, append:

```typescript
export const mastersInviteKey = (tournamentId: string, playerId: string) => `season_invite:${tournamentId}:${playerId}`
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/notifications/templates.ts lib/notifications/keys.ts
git commit -m "feat(seasons): add invitation notification templates"
```

---

## Task 10: Season leaderboard reads — `lib/seasons/data.ts`

**Files:**
- Create: `lib/seasons/data.ts`

**Interfaces:**
- Consumes: `sumPointsByPlayer` (Task 4).
- Produces: `getSeasonLeaderboard(admin, seasonId): Promise<SeasonLeaderboardRow[]>`, `getMonthlyLeaderboard(admin, seasonId, monthStart): Promise<SeasonLeaderboardRow[]>`, type `SeasonLeaderboardRow`. Consumed by Tasks 11, 18.

- [ ] **Step 1: Write the implementation**

```typescript
// lib/seasons/data.ts
import { createAdminClient } from '@/lib/supabase/admin'
import { sumPointsByPlayer, type PointsRow } from './points-aggregate'

type Admin = ReturnType<typeof createAdminClient>

export interface SeasonLeaderboardRow {
  playerId: string
  username: string | null
  displayName: string | null
  avatarUrl: string | null
  sentinelScore: number
  points: number
}

interface ProfileInfo {
  username: string | null
  displayName: string | null
  avatarUrl: string | null
  sentinelScore: number
}

async function playerProfiles(admin: Admin, playerIds: string[]): Promise<Map<string, ProfileInfo>> {
  const map = new Map<string, ProfileInfo>()
  if (playerIds.length === 0) return map
  const { data } = await admin
    .from('profiles')
    .select('id, username, display_name, avatar_url, sentinel_score')
    .in('id', playerIds)
  for (const p of data ?? []) {
    map.set(p.id, {
      username: p.username,
      displayName: p.display_name,
      avatarUrl: p.avatar_url,
      sentinelScore: p.sentinel_score ?? 0,
    })
  }
  return map
}

function toRows(totals: Map<string, number>, profiles: Map<string, ProfileInfo>): SeasonLeaderboardRow[] {
  return Array.from(totals.entries())
    .map(([playerId, points]) => {
      const p = profiles.get(playerId)
      return {
        playerId,
        username: p?.username ?? null,
        displayName: p?.displayName ?? null,
        avatarUrl: p?.avatarUrl ?? null,
        sentinelScore: p?.sentinelScore ?? 0,
        points,
      }
    })
    .sort((a, b) => b.points - a.points)
}

// Every player with at least one season_ranking_points or
// season_noshow_penalties row for this season, ranked by total points desc.
// Used for Champions Cup qualification (spec §4, "season cumulative").
export async function getSeasonLeaderboard(admin: Admin, seasonId: string): Promise<SeasonLeaderboardRow[]> {
  const [{ data: pointsRows }, { data: penaltyRows }] = await Promise.all([
    admin.from('season_ranking_points').select('player_id, points').eq('season_id', seasonId),
    admin.from('season_noshow_penalties').select('player_id, points').eq('season_id', seasonId),
  ])
  const rows: PointsRow[] = [
    ...(pointsRows ?? []).map((r) => ({ playerId: r.player_id, points: r.points })),
    ...(penaltyRows ?? []).map((r) => ({ playerId: r.player_id, points: r.points })),
  ]
  const totals = sumPointsByPlayer(rows)
  const profiles = await playerProfiles(admin, Array.from(totals.keys()))
  return toRows(totals, profiles)
}

// Points from community_club tournaments whose tournament_start falls in
// the given UTC calendar month, plus no-show penalties from matches
// belonging to those same tournaments. Used for Masters qualification
// (spec §4, "monthly").
export async function getMonthlyLeaderboard(
  admin: Admin,
  seasonId: string,
  monthStart: Date,
): Promise<SeasonLeaderboardRow[]> {
  const monthEnd = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1))
  const monthStartUtc = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), 1))

  const { data: tournaments } = await admin
    .from('tournaments')
    .select('id')
    .eq('season_id', seasonId)
    .eq('tournament_type', 'community_club')
    .gte('tournament_start', monthStartUtc.toISOString())
    .lt('tournament_start', monthEnd.toISOString())
  const tournamentIds = (tournaments ?? []).map((t) => t.id)
  if (tournamentIds.length === 0) return []

  const { data: matches } = await admin.from('matches').select('id').in('tournament_id', tournamentIds)
  const matchIds = (matches ?? []).map((m) => m.id)

  const [{ data: pointsRows }, penaltyResult] = await Promise.all([
    admin
      .from('season_ranking_points')
      .select('player_id, points')
      .eq('season_id', seasonId)
      .in('tournament_id', tournamentIds),
    matchIds.length > 0
      ? admin.from('season_noshow_penalties').select('player_id, points').eq('season_id', seasonId).in('match_id', matchIds)
      : Promise.resolve({ data: [] as { player_id: string; points: number }[] }),
  ])
  const rows: PointsRow[] = [
    ...(pointsRows ?? []).map((r) => ({ playerId: r.player_id, points: r.points })),
    ...(penaltyResult.data ?? []).map((r) => ({ playerId: r.player_id, points: r.points })),
  ]
  const totals = sumPointsByPlayer(rows)
  const profiles = await playerProfiles(admin, Array.from(totals.keys()))
  return toRows(totals, profiles)
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/seasons/data.ts
git commit -m "feat(seasons): add season/monthly leaderboard reads"
```

---

## Task 11: Admin invitation actions — `lib/seasons/invitation-actions.ts`

**Files:**
- Create: `lib/seasons/invitation-actions.ts`

**Interfaces:**
- Consumes: `getMonthlyLeaderboard`, `getSeasonLeaderboard` (Task 10); `selectInvitees` (Task 3); `mastersInviteKey` (Task 9).
- Produces: `sendInvitations`, `triggerCascadeNow`, `manuallyAddInvitee` (form actions); `cascadeNextInvitation(admin, tournamentId)`, `expireAndCascadeInvitations(admin)` (plain async functions — consumed by Tasks 12, 13, 16).

- [ ] **Step 1: Write the implementation**

```typescript
// lib/seasons/invitation-actions.ts
'use server'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaff } from '@/lib/admin/auth'
import { getMonthlyLeaderboard, getSeasonLeaderboard } from './data'
import { selectInvitees, type LeaderboardEntry } from './eligibility'
import { notify } from '@/lib/notifications/notify'
import { notifyInApp } from '@/lib/notifications/inbox'
import { mastersInviteKey } from '@/lib/notifications/keys'

type Admin = ReturnType<typeof createAdminClient>

const INVITE_SLOTS = 16
const RESPONSE_WINDOW_HOURS = 48

export type InvitationActionState = { error?: string; success?: boolean; invited?: number } | undefined

interface InvitableTournament {
  id: string
  title: string
  tournament_type: string
  season_id: string | null
  tournament_start: string | null
  registration_fee: number
}

async function tournamentForInvitations(admin: Admin, tournamentId: string): Promise<InvitableTournament | null> {
  const { data } = await admin
    .from('tournaments')
    .select('id, title, tournament_type, season_id, tournament_start, registration_fee')
    .eq('id', tournamentId)
    .maybeSingle()
  return data
}

async function leaderboardFor(admin: Admin, tournament: InvitableTournament): Promise<LeaderboardEntry[]> {
  if (!tournament.season_id) return []
  const rows =
    tournament.tournament_type === 'masters'
      ? await getMonthlyLeaderboard(admin, tournament.season_id, new Date(tournament.tournament_start ?? Date.now()))
      : await getSeasonLeaderboard(admin, tournament.season_id)
  return rows.map((r) => ({ playerId: r.playerId, points: r.points, sentinelScore: r.sentinelScore }))
}

async function acceptedCount(admin: Admin, tournamentId: string): Promise<number> {
  const { count } = await admin
    .from('tournament_invitations')
    .select('*', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)
    .eq('status', 'accepted')
  return count ?? 0
}

async function invitedPlayerIds(admin: Admin, tournamentId: string): Promise<Set<string>> {
  const { data } = await admin.from('tournament_invitations').select('player_id').eq('tournament_id', tournamentId)
  return new Set((data ?? []).map((r) => r.player_id))
}

async function sendInvitationRows(
  admin: Admin,
  tournament: InvitableTournament,
  playerIds: string[],
  rankByPlayer: Map<string, number>,
  notificationType: 'masters_invitation' | 'champions_cup_invitation' | 'invitation_expired_cascade',
): Promise<void> {
  if (playerIds.length === 0) return
  const expiresAt = new Date(Date.now() + RESPONSE_WINDOW_HOURS * 60 * 60 * 1000).toISOString()
  const rows = playerIds.map((playerId) => ({
    tournament_id: tournament.id,
    player_id: playerId,
    rank_at_invite: rankByPlayer.get(playerId) ?? 0,
    status: 'pending' as const,
    expires_at: expiresAt,
  }))
  await admin.from('tournament_invitations').insert(rows)

  const entryFee = tournament.registration_fee > 0 ? `₦${tournament.registration_fee.toLocaleString()}` : 'Free'
  for (const playerId of playerIds) {
    const rank = rankByPlayer.get(playerId) ?? 0
    await notify({
      type: notificationType,
      playerId,
      dedupeKey: mastersInviteKey(tournament.id, playerId),
      tournamentName: tournament.title,
      rank,
      deadline: expiresAt,
      entryFee,
    })
    await notifyInApp({
      playerId,
      type: notificationType,
      title: `You've been invited to ${tournament.title}!`,
      body: `You ranked #${rank}. Respond within 48 hours to secure your spot.`,
      link: '/dashboard',
    })
  }
}

// Admin "Send Invitations" button — first send only; errors if any
// invitation already exists for this tournament (use the cascade path to
// top up afterward, not a second full send).
export async function sendInvitations(_prev: InvitationActionState, formData: FormData): Promise<InvitationActionState> {
  await requireStaff()
  const tournamentId = String(formData.get('tournamentId') ?? '')
  if (!tournamentId) return { error: 'Missing tournament.' }

  const admin = createAdminClient()
  const tournament = await tournamentForInvitations(admin, tournamentId)
  if (!tournament) return { error: 'Tournament not found.' }
  if (tournament.tournament_type !== 'masters' && tournament.tournament_type !== 'champions_cup') {
    return { error: 'Invitations only apply to Masters and Champions Cup tournaments.' }
  }
  const invited = await invitedPlayerIds(admin, tournamentId)
  if (invited.size > 0) return { error: 'Invitations have already been sent for this tournament.' }

  const leaderboard = await leaderboardFor(admin, tournament)
  const selected = selectInvitees(leaderboard, invited, INVITE_SLOTS)
  const rankByPlayer = new Map(leaderboard.map((e, i) => [e.playerId, i + 1]))
  const notificationType = tournament.tournament_type === 'masters' ? 'masters_invitation' : 'champions_cup_invitation'
  await sendInvitationRows(admin, tournament, selected, rankByPlayer, notificationType)

  revalidatePath(`/admin/tournaments/${tournamentId}/invitations`)
  return { success: true, invited: selected.length }
}

// Tops one tournament back up toward 16 accepted invitees from whoever's
// next on the leaderboard and hasn't been invited yet. Shared by decline,
// the expiry cron, and the admin's manual cascade button.
export async function cascadeNextInvitation(admin: Admin, tournamentId: string): Promise<{ invited: number }> {
  const tournament = await tournamentForInvitations(admin, tournamentId)
  if (!tournament || (tournament.tournament_type !== 'masters' && tournament.tournament_type !== 'champions_cup')) {
    return { invited: 0 }
  }
  const accepted = await acceptedCount(admin, tournamentId)
  const openSlots = INVITE_SLOTS - accepted
  if (openSlots <= 0) return { invited: 0 }

  const invited = await invitedPlayerIds(admin, tournamentId)
  const leaderboard = await leaderboardFor(admin, tournament)
  const selected = selectInvitees(leaderboard, invited, openSlots)
  const rankByPlayer = new Map(leaderboard.map((e, i) => [e.playerId, i + 1]))
  await sendInvitationRows(admin, tournament, selected, rankByPlayer, 'invitation_expired_cascade')
  return { invited: selected.length }
}

// Expires everything past its deadline platform-wide, then tops up every
// affected tournament. Called by the daily cron (Task 13) and by the
// admin's "Check & Cascade Now" button (cheap to run for all tournaments,
// not just the current one — identical to the cron's behavior).
export async function expireAndCascadeInvitations(admin: Admin): Promise<{ expired: number; invited: number }> {
  const { data: expired } = await admin
    .from('tournament_invitations')
    .update({ status: 'expired', responded_at: new Date().toISOString() })
    .eq('status', 'pending')
    .lt('expires_at', new Date().toISOString())
    .select('tournament_id')
  const tournamentIds = Array.from(new Set((expired ?? []).map((r) => r.tournament_id)))

  let invited = 0
  for (const tournamentId of tournamentIds) {
    const result = await cascadeNextInvitation(admin, tournamentId)
    invited += result.invited
  }
  return { expired: (expired ?? []).length, invited }
}

export async function triggerCascadeNow(_prev: InvitationActionState, formData: FormData): Promise<InvitationActionState> {
  await requireStaff()
  const tournamentId = String(formData.get('tournamentId') ?? '')
  if (!tournamentId) return { error: 'Missing tournament.' }
  const admin = createAdminClient()
  await expireAndCascadeInvitations(admin)
  revalidatePath(`/admin/tournaments/${tournamentId}/invitations`)
  return { success: true }
}

// Bypasses the leaderboard entirely — admin picks a specific player by
// username, for edge cases the automated flow can't handle.
export async function manuallyAddInvitee(_prev: InvitationActionState, formData: FormData): Promise<InvitationActionState> {
  await requireStaff()
  const tournamentId = String(formData.get('tournamentId') ?? '')
  const username = String(formData.get('username') ?? '').trim()
  if (!tournamentId || !username) return { error: 'Missing tournament or username.' }

  const admin = createAdminClient()
  const { data: player } = await admin.from('profiles').select('id').eq('username', username).maybeSingle()
  if (!player) return { error: `No player found with username "${username}".` }

  const expiresAt = new Date(Date.now() + RESPONSE_WINDOW_HOURS * 60 * 60 * 1000).toISOString()
  const { error } = await admin.from('tournament_invitations').insert({
    tournament_id: tournamentId,
    player_id: player.id,
    rank_at_invite: 0,
    status: 'pending',
    expires_at: expiresAt,
  })
  if (error) {
    return { error: error.code === '23505' ? 'This player already has an invitation.' : 'Could not add this player.' }
  }
  revalidatePath(`/admin/tournaments/${tournamentId}/invitations`)
  return { success: true }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/seasons/invitation-actions.ts
git commit -m "feat(seasons): add admin invitation send/cascade/manual-add actions"
```

---

## Task 12: Player invitation actions — `lib/seasons/player-actions.ts`

**Files:**
- Create: `lib/seasons/player-actions.ts`

**Interfaces:**
- Consumes: `cascadeNextInvitation` (Task 11); `initializeTransaction`, `buildReference` (`lib/paystack/server.ts`, existing).
- Produces: `acceptMastersInvitation`, `declineMastersInvitation` (form actions). Consumed by Task 17.

- [ ] **Step 1: Write the implementation**

```typescript
// lib/seasons/player-actions.ts
'use server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { initializeTransaction, buildReference } from '@/lib/paystack/server'
import { cascadeNextInvitation } from './invitation-actions'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sentinelx.gg'

export type InvitationResponseState = { error?: string; success?: boolean } | undefined

// Creates a normal tournament_registrations row and, if there's a fee,
// redirects to Paystack exactly like registerForTournament — the existing
// confirmRegistration/webhook pipeline (lib/tournaments/confirm.ts) already
// looks rows up purely by paystack_reference, so no new webhook branch is
// needed for payment to be confirmed.
export async function acceptMastersInvitation(
  _prev: InvitationResponseState,
  formData: FormData,
): Promise<InvitationResponseState> {
  const invitationId = String(formData.get('invitationId') ?? '')
  if (!invitationId) return { error: 'Missing invitation.' }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }

  const admin = createAdminClient()
  const { data: invitation } = await admin
    .from('tournament_invitations')
    .select(
      'id, player_id, status, expires_at, tournament_id, ' +
        'tournament:tournaments(id, slug, title, registration_fee)',
    )
    .eq('id', invitationId)
    .maybeSingle()
  if (!invitation || invitation.player_id !== user.id) return { error: 'Invitation not found.' }
  if (invitation.status !== 'pending') return { error: 'This invitation is no longer available.' }
  if (new Date(invitation.expires_at) < new Date()) return { error: 'This invitation has expired.' }

  const t = Array.isArray(invitation.tournament) ? invitation.tournament[0] : invitation.tournament
  if (!t) return { error: 'Tournament not found.' }

  const { data: claimed } = await admin
    .from('tournament_invitations')
    .update({ status: 'accepted', responded_at: new Date().toISOString() })
    .eq('id', invitationId)
    .eq('status', 'pending')
    .select('id')
  if (!claimed || claimed.length === 0) return { error: 'This invitation is no longer available.' }

  const isFree = t.registration_fee <= 0
  const reference = isFree ? null : buildReference(t.id, user.id)

  await admin.from('tournament_registrations').insert({
    tournament_id: t.id,
    player_id: user.id,
    status: 'active',
    payment_status: isFree ? 'paid' : 'pending',
    paystack_reference: reference,
  })

  revalidatePath('/dashboard')
  if (isFree) redirect(`/tournaments/${t.slug}?paid=1`)

  let authorizationUrl: string
  try {
    authorizationUrl = await initializeTransaction({
      email: user.email!,
      amountKobo: t.registration_fee * 100,
      reference: reference!,
      callbackUrl: `${SITE_URL}/api/paystack/callback`,
      metadata: { tournament_id: t.id, player_id: user.id, slug: t.slug },
    })
  } catch (err) {
    console.error('[acceptMastersInvitation] Paystack initialize failed', {
      tournamentId: t.id,
      reference,
      message: err instanceof Error ? err.message : String(err),
    })
    return { error: 'Payment could not be started. Your spot is reserved — try again from your dashboard.' }
  }
  redirect(authorizationUrl)
}

export async function declineMastersInvitation(
  _prev: InvitationResponseState,
  formData: FormData,
): Promise<InvitationResponseState> {
  const invitationId = String(formData.get('invitationId') ?? '')
  if (!invitationId) return { error: 'Missing invitation.' }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }

  const admin = createAdminClient()
  const { data: claimed } = await admin
    .from('tournament_invitations')
    .update({ status: 'declined', responded_at: new Date().toISOString() })
    .eq('id', invitationId)
    .eq('player_id', user.id)
    .eq('status', 'pending')
    .select('id, tournament_id')
  if (!claimed || claimed.length === 0) return { error: 'This invitation is no longer available.' }

  await cascadeNextInvitation(admin, claimed[0].tournament_id)
  revalidatePath('/dashboard')
  return { success: true }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/seasons/player-actions.ts
git commit -m "feat(seasons): add acceptMastersInvitation / declineMastersInvitation"
```

---

## Task 13: Expiry cascade cron route

**Files:**
- Create: `app/api/cron/cascade-season-invitations/route.ts`

**Interfaces:**
- Consumes: `expireAndCascadeInvitations` (Task 11).

- [ ] **Step 1: Write the route**

Mirrors `app/api/cron/resolve-noshow-matches/route.ts` exactly (Bearer-token auth against `CRON_SECRET`, `POST` handler):

```typescript
// app/api/cron/cascade-season-invitations/route.ts
import { createAdminClient } from '@/lib/supabase/admin'
import { expireAndCascadeInvitations } from '@/lib/seasons/invitation-actions'

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 })
  }
  const admin = createAdminClient()
  const result = await expireAndCascadeInvitations(admin)
  return Response.json(result)
}
```

- [ ] **Step 2: Activate the schedule (manual, outside the repo)**

This codebase has no `vercel.json` — cron scheduling is `pg_cron` + `pg_net`, activated by running SQL directly against the live Supabase project (dashboard SQL editor or the `execute_sql` MCP tool), **not committed as a migration** — same convention as the existing `resolve-noshow-matches` cron (see `docs/superpowers/specs/2026-07-13-full-day-match-scheduling-design.md`). Run once, after deploy, with the real site URL and `CRON_SECRET` substituted in:

```sql
select cron.schedule(
  'cascade-season-invitations',
  '0 * * * *', -- hourly, same cadence as resolve-noshow-matches
  $$ select net.http_post(
       url := '<site-url>/api/cron/cascade-season-invitations',
       headers := jsonb_build_object('Authorization', 'Bearer ' || '<CRON_SECRET>', 'Content-Type', 'application/json')
     ) $$
);
```

- [ ] **Step 3: Manual verification**

Start the dev server (`npm run dev`), then:

```bash
curl -X POST http://localhost:3000/api/cron/cascade-season-invitations -H "Authorization: Bearer $CRON_SECRET"
```

Expected: `{"expired":0,"invited":0}` (no expired invitations exist yet at this point in the build). A request with a wrong/missing bearer token should return 401.

- [ ] **Step 4: Commit**

```bash
git add app/api/cron/cascade-season-invitations/route.ts
git commit -m "feat(seasons): add invitation expiry/cascade cron route"
```

---

## Task 14: Registration gating for invitation-only tournaments

**Files:**
- Modify: `lib/tournaments/guard.ts`
- Modify: `lib/tournaments/view.ts`
- Modify: `lib/tournaments/actions.ts` (registerForTournament)
- Modify: `components/tournament/RegistrationPanel.tsx`
- Modify: `app/(public)/tournaments/[slug]/page.tsx`

Masters and Champions Cup tournaments must only be joined via an accepted invitation (Task 12), never the public registration form. This adds an `invitation_only` gate to the existing guard/view logic rather than a parallel code path.

- [ ] **Step 1: Add the `invitation_only` case to `checkCanRegister`**

Full replacement of `lib/tournaments/guard.ts`:

```typescript
export type RegisterGuard =
  | { ok: true }
  | { ok: false; reason: 'not_open' | 'full' | 'already_registered' | 'invitation_only' }

// Precedence: a paid player is "already_registered" regardless of status;
// then invitation-only tournaments reject the public form outright; then
// status must be open; then capacity. A 'pending' row is allowed through
// so the player can retry payment.
export function checkCanRegister(args: {
  status: string
  paidCount: number
  maxPlayers: number | null
  existingStatus: string | null
  invitationOnly?: boolean
}): RegisterGuard {
  if (args.existingStatus === 'paid') return { ok: false, reason: 'already_registered' }
  if (args.invitationOnly) return { ok: false, reason: 'invitation_only' }
  if (args.status !== 'registration_open') return { ok: false, reason: 'not_open' }
  if (args.maxPlayers != null && args.paidCount >= args.maxPlayers) {
    return { ok: false, reason: 'full' }
  }
  return { ok: true }
}
```

- [ ] **Step 2: Add the `invitation_only` view state**

Full replacement of `lib/tournaments/view.ts`:

```typescript
export type RegView =
  | 'guest'
  | 'can_register'
  | 'complete_payment'
  | 'registered'
  | 'waitlisted'
  | 'full'
  | 'closed'
  | 'ended'
  | 'invitation_only'

// Precedence: a paid player always sees "registered"; a waitlisted
// registration shows next. The tournament lifecycle (ended/closed) wins
// over the open-registration sub-states, and invitation-only tournaments
// are gated before login/capacity checks — an invited-and-paid player still
// resolves to 'registered' above, so this only affects everyone else.
export function resolveRegistrationView(args: {
  status: string
  loggedIn: boolean
  paidCount: number
  maxPlayers: number | null
  existingStatus: string | null
  registrationStatus?: string | null
  invitationOnly?: boolean
}): RegView {
  if (args.existingStatus === 'paid') return 'registered'
  if (args.registrationStatus === 'waitlisted') return 'waitlisted'
  if (args.status === 'completed') return 'ended'
  if (args.status === 'registration_closed' || args.status === 'active') return 'closed'
  if (args.invitationOnly) return 'invitation_only'
  if (!args.loggedIn) return 'guest'
  if (args.existingStatus === 'pending') return 'complete_payment'
  if (args.maxPlayers != null && args.paidCount >= args.maxPlayers) return 'full'
  return 'can_register'
}
```

- [ ] **Step 3: Pass `invitation_only` through in `registerForTournament`**

In `lib/tournaments/actions.ts`, the tournament select at line 35-39 needs the new column, and the guard call + error mapping need the new reason. Change:

```typescript
  const { data: tournament } = await supabase
    .from('tournaments')
    .select('id, slug, status, max_players, rules, registration_fee')
    .eq('id', tournamentId)
    .maybeSingle()
```

to:

```typescript
  const { data: tournament } = await supabase
    .from('tournaments')
    .select('id, slug, status, max_players, rules, registration_fee, invitation_only')
    .eq('id', tournamentId)
    .maybeSingle()
```

Then update the guard call and error mapping (originally lines 61-75) to:

```typescript
  const guard = checkCanRegister({
    status: tournament.status,
    paidCount: paidCount ?? 0,
    maxPlayers: tournament.max_players,
    existingStatus: existing?.payment_status ?? null,
    invitationOnly: tournament.invitation_only,
  })
  if (!guard.ok) {
    return {
      error:
        guard.reason === 'already_registered'
          ? "You're already registered for this tournament."
          : guard.reason === 'full'
            ? 'This tournament is full.'
            : guard.reason === 'invitation_only'
              ? 'This tournament is invitation-only. Check your dashboard for an invite.'
              : 'Registration is closed for this tournament.',
    }
  }
```

- [ ] **Step 4: Add the `invitation_only` message to `RegistrationPanel`**

In `components/tournament/RegistrationPanel.tsx`, the fallback `message` ternary (originally lines 118-123) already covers every view not explicitly branched above it (`full`/`ended`/anything else) — `invitation_only` falls into this same generic branch, so only the ternary needs a new case. Change:

```typescript
  const message =
    view === 'full'
      ? 'This tournament is full.'
      : view === 'ended'
        ? 'This tournament has ended.'
        : 'Registration is closed.'
```

to:

```typescript
  const message =
    view === 'full'
      ? 'This tournament is full.'
      : view === 'ended'
        ? 'This tournament has ended.'
        : view === 'invitation_only'
          ? "This tournament is by invitation only. Check your dashboard if you've been invited."
          : 'Registration is closed.'
```

(`canOfferWaitlist = view === 'closed'` already stays `false` for `invitation_only` — no other change needed in this file.)

- [ ] **Step 5: Select and pass `invitation_only` from the tournament detail page**

In `app/(public)/tournaments/[slug]/page.tsx`, the `getTournament(slug)` select and the call to `resolveRegistrationView` both need the new column. Add `invitation_only` to whatever column list `getTournament` selects, and pass `invitationOnly: t.invitation_only` into the `resolveRegistrationView({...})` call alongside the other args.

- [ ] **Step 6: Manual verification**

Run `npm run dev`. Create a test tournament with `tournament_type = 'masters'` (via SQL or the admin form from Task 15, once done) and confirm:
- `/tournaments/<slug>` shows the "invitation only" message, not a register button, for a logged-in player with no invitation.
- Submitting the register form directly (e.g. via devtools) still gets rejected server-side with the same message.

- [ ] **Step 7: Commit**

```bash
git add lib/tournaments/guard.ts lib/tournaments/view.ts lib/tournaments/actions.ts components/tournament/RegistrationPanel.tsx "app/(public)/tournaments/[slug]/page.tsx"
git commit -m "feat(seasons): gate public registration on invitation-only tournaments"
```

---

## Task 15: Admin create/edit tournament form — type + season fields

**Files:**
- Modify: `lib/tournaments/admin-schema.ts`
- Modify: `lib/tournaments/admin-actions.ts`
- Modify: `components/admin/TournamentForm.tsx`
- Modify: `app/admin/tournaments/new/page.tsx`
- Modify: `app/admin/tournaments/[id]/edit/page.tsx`

`invitation_only` is computed server-side from `tournament_type` (Deviation 7) — there's no form field for it.

- [ ] **Step 1: Extend the Zod schema**

In `lib/tournaments/admin-schema.ts`, add to `tournamentSchema`:

```typescript
  tournamentType: z.enum(['open', 'community_club', 'masters', 'champions_cup']),
  seasonId: z.union([z.literal(''), z.string().uuid()]),
```

and add a refinement requiring a season when the type isn't `'open'`:

```typescript
export const tournamentSchema = z
  .object({
    // ...existing fields, plus tournamentType/seasonId above...
  })
  .refine((d) => d.tournamentType === 'open' || d.seasonId !== '', {
    message: 'Choose a season for this tournament type.',
    path: ['seasonId'],
  })
```

- [ ] **Step 2: Wire the new fields through `admin-actions.ts`**

In `lib/tournaments/admin-actions.ts`, add to `parseForm`'s object:

```typescript
    tournamentType: formData.get('tournamentType') ?? 'open',
    seasonId: formData.get('seasonId') ?? '',
```

and add to `toRow`'s return object:

```typescript
    tournament_type: d.tournamentType,
    season_id: d.seasonId === '' ? null : d.seasonId,
    invitation_only: d.tournamentType === 'masters' || d.tournamentType === 'champions_cup',
```

- [ ] **Step 3: Add the dropdowns to `TournamentForm`**

In `components/admin/TournamentForm.tsx`, add `tournamentType`/`seasonId` to `TournamentFormValues`:

```typescript
export interface TournamentFormValues {
  // ...existing fields...
  tournamentType: string
  seasonId: string
}
```

Add a `seasons` prop and local state to drive the conditional season dropdown + the read-only invitation-only label:

```typescript
export function TournamentForm({
  action,
  games,
  seasons,
  initial,
  slugLocked,
  submitLabel,
}: {
  action: Action
  games: { id: string; name: string }[]
  seasons: { id: string; name: string }[]
  initial: TournamentFormValues
  slugLocked: boolean
  submitLabel: string
}) {
  const [state, formAction] = useFormState<TournamentFormState, FormData>(action, undefined)
  const [tournamentType, setTournamentType] = useState(initial.tournamentType || 'open')
  const isInvitationOnly = tournamentType === 'masters' || tournamentType === 'champions_cup'
```

(Add `import { useState } from 'react'` to the top of the file alongside the existing `react-dom` import.)

Insert this block right after the "Game" select (after the closing `</div>` of the game-select block, before the "Description" block):

```tsx
      <div className="space-y-1.5">
        <label htmlFor="tournamentType" className="text-sm font-medium text-slate-300">
          Tournament Type
        </label>
        <select
          id="tournamentType"
          name="tournamentType"
          value={tournamentType}
          onChange={(e) => setTournamentType(e.target.value)}
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
        >
          <option value="open">Open</option>
          <option value="community_club">Community Club</option>
          <option value="masters">SentinelX Masters</option>
          <option value="champions_cup">SentinelX Champions Cup</option>
        </select>
      </div>

      {tournamentType !== 'open' && (
        <div className="space-y-1.5">
          <label htmlFor="seasonId" className="text-sm font-medium text-slate-300">
            Season
          </label>
          <select
            id="seasonId"
            name="seasonId"
            defaultValue={initial.seasonId}
            required
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
          >
            <option value="" disabled>
              Choose a season
            </option>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {isInvitationOnly && (
        <p className="rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-xs text-violet-300">
          Invitation-only — players can only join via an accepted invitation, not the public registration form.
        </p>
      )}
```

- [ ] **Step 4: Pass `seasons` from both pages**

In `app/admin/tournaments/new/page.tsx`, add a seasons fetch alongside the games fetch and pass it through, and extend `EMPTY`:

```typescript
const EMPTY: TournamentFormValues = {
  // ...existing fields...
  tournamentType: 'open',
  seasonId: '',
}
```

```typescript
  const supabase = createClient()
  const [{ data: games }, { data: seasons }] = await Promise.all([
    supabase.from('games').select('id, name').eq('active', true).order('name'),
    supabase.from('seasons').select('id, name').order('start_date', { ascending: false }),
  ])
```

```tsx
        <TournamentForm
          action={createTournament}
          games={games ?? []}
          seasons={seasons ?? []}
          initial={EMPTY}
          slugLocked={false}
          submitLabel="Create tournament"
        />
```

In `app/admin/tournaments/[id]/edit/page.tsx`, do the same: fetch `seasons` in the existing `Promise.all`, add `tournamentType: t.tournament_type` and `seasonId: t.season_id ?? ''` to `initial`, and pass `seasons={seasons ?? []}` to `<TournamentForm>`. Also add a link to the new Invitations panel (Task 16) when relevant, right after the `<h2>`:

```tsx
      {(t.tournament_type === 'masters' || t.tournament_type === 'champions_cup') && (
        <Link
          href={`/admin/tournaments/${t.id}/invitations`}
          className="mb-4 inline-block text-sm text-violet-400 hover:text-violet-300"
        >
          → Manage invitations
        </Link>
      )}
```

- [ ] **Step 5: Manual verification**

Run `npm run dev`, go to `/admin/tournaments/new`, confirm: selecting "SentinelX Masters" reveals the Season dropdown and the invitation-only notice; selecting "Open" hides both. Submit a Community Club tournament tied to Season 1 and confirm it saves (`tournament_type`, `season_id`, `invitation_only` all correct in the DB).

- [ ] **Step 6: Commit**

```bash
git add lib/tournaments/admin-schema.ts lib/tournaments/admin-actions.ts components/admin/TournamentForm.tsx app/admin/tournaments/new/page.tsx "app/admin/tournaments/[id]/edit/page.tsx"
git commit -m "feat(seasons): add tournament type + season fields to admin form"
```

---

## Task 16: Admin Invitations panel

**Files:**
- Create: `app/admin/tournaments/[id]/invitations/page.tsx`
- Create: `components/admin/InvitationsPanel.tsx`

**Interfaces:**
- Consumes: `sendInvitations`, `triggerCascadeNow`, `manuallyAddInvitee` (Task 11).

- [ ] **Step 1: Write the page**

```tsx
// app/admin/tournaments/[id]/invitations/page.tsx
import Link from 'next/link'
import { requireStaff } from '@/lib/admin/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { InvitationsPanel } from '@/components/admin/InvitationsPanel'

export default async function TournamentInvitationsPage({ params }: { params: { id: string } }) {
  await requireStaff()
  const admin = createAdminClient()
  const { data: tournament } = await admin
    .from('tournaments')
    .select('id, title, tournament_type')
    .eq('id', params.id)
    .maybeSingle()

  if (!tournament || (tournament.tournament_type !== 'masters' && tournament.tournament_type !== 'champions_cup')) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <p className="text-sm text-slate-400">Invitations only apply to Masters and Champions Cup tournaments.</p>
      </div>
    )
  }

  const { data: invitations } = await admin
    .from('tournament_invitations')
    .select('id, rank_at_invite, status, invited_at, expires_at, player:profiles(username, display_name)')
    .eq('tournament_id', params.id)
    .order('rank_at_invite')

  const rows = (invitations ?? []).map((row) => {
    const p = Array.isArray(row.player) ? row.player[0] : row.player
    return {
      id: row.id,
      playerName: p?.display_name ?? p?.username ?? 'Unknown',
      rank: row.rank_at_invite,
      status: row.status,
      invitedAt: row.invited_at,
      expiresAt: row.expires_at,
    }
  })

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/admin/tournaments" className="text-sm text-slate-400 hover:text-white">
        ← Tournaments
      </Link>
      <h1 className="mb-6 mt-2 text-2xl font-bold text-white">{tournament.title} — Invitations</h1>
      <InvitationsPanel tournamentId={tournament.id} invitations={rows} />
    </div>
  )
}
```

- [ ] **Step 2: Write the panel component**

```tsx
// components/admin/InvitationsPanel.tsx
'use client'
import { useFormState, useFormStatus } from 'react-dom'
import {
  sendInvitations,
  triggerCascadeNow,
  manuallyAddInvitee,
  type InvitationActionState,
} from '@/lib/seasons/invitation-actions'

interface InvitationRow {
  id: string
  playerName: string
  rank: number
  status: string
  invitedAt: string
  expiresAt: string
}

const STATUS_STYLE: Record<string, string> = {
  pending: 'text-amber-400',
  accepted: 'text-emerald-400',
  declined: 'text-slate-500',
  expired: 'text-red-400',
}

function ActionButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 hover:border-slate-500 disabled:opacity-60"
    >
      {pending ? pendingLabel : label}
    </button>
  )
}

export function InvitationsPanel({ tournamentId, invitations }: { tournamentId: string; invitations: InvitationRow[] }) {
  const [sendState, sendAction] = useFormState<InvitationActionState, FormData>(sendInvitations, undefined)
  const [cascadeState, cascadeAction] = useFormState<InvitationActionState, FormData>(triggerCascadeNow, undefined)
  const [addState, addAction] = useFormState<InvitationActionState, FormData>(manuallyAddInvitee, undefined)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3">
        <form action={sendAction}>
          <input type="hidden" name="tournamentId" value={tournamentId} />
          <ActionButton label="Send Invitations" pendingLabel="Sending…" />
        </form>
        <form action={cascadeAction}>
          <input type="hidden" name="tournamentId" value={tournamentId} />
          <ActionButton label="Check & Cascade Now" pendingLabel="Checking…" />
        </form>
      </div>
      {sendState?.error && <p className="text-sm text-red-400">{sendState.error}</p>}
      {sendState?.success && <p className="text-sm text-emerald-400">Invited {sendState.invited} players.</p>}
      {cascadeState?.error && <p className="text-sm text-red-400">{cascadeState.error}</p>}
      {cascadeState?.success && <p className="text-sm text-emerald-400">Cascade checked.</p>}

      <div className="overflow-x-auto rounded-2xl border border-slate-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-xs text-slate-500">
              <th className="px-4 py-3">Rank</th>
              <th className="px-4 py-3">Player</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Invited</th>
              <th className="px-4 py-3">Expires</th>
            </tr>
          </thead>
          <tbody>
            {invitations.map((row) => (
              <tr key={row.id} className="border-b border-slate-900 last:border-0">
                <td className="px-4 py-3 text-slate-400">#{row.rank}</td>
                <td className="px-4 py-3 font-semibold text-white">{row.playerName}</td>
                <td className={`px-4 py-3 font-semibold ${STATUS_STYLE[row.status] ?? 'text-slate-400'}`}>
                  {row.status}
                </td>
                <td className="px-4 py-3 text-slate-500">{new Date(row.invitedAt).toLocaleDateString()}</td>
                <td className="px-4 py-3 text-slate-500">{new Date(row.expiresAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {invitations.length === 0 && (
          <p className="p-4 text-sm text-slate-500">No invitations sent yet.</p>
        )}
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <h3 className="mb-3 text-sm font-bold text-white">Manually add a player</h3>
        <form action={addAction} className="flex gap-2">
          <input type="hidden" name="tournamentId" value={tournamentId} />
          <input
            name="username"
            placeholder="Username"
            required
            className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
          />
          <ActionButton label="Add" pendingLabel="Adding…" />
        </form>
        {addState?.error && <p className="mt-2 text-sm text-red-400">{addState.error}</p>}
        {addState?.success && <p className="mt-2 text-sm text-emerald-400">Player added.</p>}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Manual verification**

Run `npm run dev`, navigate to `/admin/tournaments/<a masters tournament's id>/invitations`, click "Send Invitations," confirm the table populates and each invited player has a `pending` `tournament_invitations` row with `expires_at` ~48 hours out.

- [ ] **Step 4: Commit**

```bash
git add "app/admin/tournaments/[id]/invitations/page.tsx" components/admin/InvitationsPanel.tsx
git commit -m "feat(seasons): add admin invitations panel"
```

---

## Task 17: Dashboard invitation banner

**Files:**
- Modify: `app/dashboard/page.tsx`
- Create: `components/dashboard/MastersInvitationBanner.tsx`

**Interfaces:**
- Consumes: `acceptMastersInvitation`, `declineMastersInvitation` (Task 12).

- [ ] **Step 1: Write the banner component**

```tsx
// components/dashboard/MastersInvitationBanner.tsx
'use client'
import { useFormState, useFormStatus } from 'react-dom'
import {
  acceptMastersInvitation,
  declineMastersInvitation,
  type InvitationResponseState,
} from '@/lib/seasons/player-actions'
import { formatNaira } from '@/lib/format'

function AcceptButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex-1 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-violet-500 disabled:opacity-60"
    >
      {pending ? 'Processing…' : 'Accept & Pay'}
    </button>
  )
}

export function MastersInvitationBanner({
  invitation,
}: {
  invitation: { id: string; rank: number; deadline: string; tournamentTitle: string; fee: number }
}) {
  const [acceptState, acceptAction] = useFormState<InvitationResponseState, FormData>(acceptMastersInvitation, undefined)
  const [declineState, declineAction] = useFormState<InvitationResponseState, FormData>(declineMastersInvitation, undefined)

  if (declineState?.success) return null

  return (
    <div className="mb-5 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5">
      <p className="text-sm font-bold text-amber-300">🏆 You&apos;ve been invited to {invitation.tournamentTitle}!</p>
      <p className="mt-1 text-xs text-slate-300">
        You ranked #{invitation.rank}. {invitation.fee > 0 ? `Entry fee: ${formatNaira(invitation.fee)}.` : 'Free entry.'}
      </p>
      <p className="text-xs text-slate-400">
        Deadline: {new Date(invitation.deadline).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
      </p>
      <div className="mt-3 flex gap-2">
        <form action={acceptAction} className="flex-1">
          <input type="hidden" name="invitationId" value={invitation.id} />
          <AcceptButton />
        </form>
        <form action={declineAction}>
          <input type="hidden" name="invitationId" value={invitation.id} />
          <button
            type="submit"
            className="rounded-xl border border-slate-700 px-5 py-2.5 text-sm font-bold text-slate-300 hover:border-slate-500"
          >
            Decline
          </button>
        </form>
      </div>
      {(acceptState?.error || declineState?.error) && (
        <p className="mt-2 text-xs text-red-400">{acceptState?.error ?? declineState?.error}</p>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Fetch the pending invitation and render the banner**

In `app/dashboard/page.tsx`, add the import:

```typescript
import { MastersInvitationBanner } from '@/components/dashboard/MastersInvitationBanner'
```

Add this query alongside the dashboard's other data fetches (anywhere after `user` is resolved, before the `return`):

```typescript
  const { data: pendingInvitations } = await supabase
    .from('tournament_invitations')
    .select('id, rank_at_invite, expires_at, tournament:tournaments(title, registration_fee)')
    .eq('player_id', user.id)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .order('expires_at', { ascending: true })
    .limit(1)
  const pendingInvitationRow = pendingInvitations?.[0] ?? null
  const pendingInvitationTournament = pendingInvitationRow
    ? Array.isArray(pendingInvitationRow.tournament)
      ? pendingInvitationRow.tournament[0]
      : pendingInvitationRow.tournament
    : null
```

Render it right after `<DashboardHeader ... />` (before the sign-out `<form>`):

```tsx
      {pendingInvitationRow && pendingInvitationTournament && (
        <MastersInvitationBanner
          invitation={{
            id: pendingInvitationRow.id,
            rank: pendingInvitationRow.rank_at_invite,
            deadline: pendingInvitationRow.expires_at,
            tournamentTitle: pendingInvitationTournament.title,
            fee: pendingInvitationTournament.registration_fee,
          }}
        />
      )}
```

(Dismissing without responding does nothing per spec §10 — there's no dismiss control, only Accept/Decline, so it naturally reappears on next visit until it expires or is answered.)

- [ ] **Step 3: Manual verification**

With a test invitation seeded (`pending`, `expires_at` in the future, `player_id` = your logged-in test account), load `/dashboard` and confirm the banner renders above the profile form, and Accept/Decline both work end-to-end (Accept redirects to Paystack or `?paid=1`; Decline removes the banner and triggers cascade).

- [ ] **Step 4: Commit**

```bash
git add app/dashboard/page.tsx components/dashboard/MastersInvitationBanner.tsx
git commit -m "feat(seasons): add Masters invitation banner to dashboard"
```

---

## Task 18: Season page

**Files:**
- Create: `app/seasons/[slug]/page.tsx`
- Create: `components/seasons/SeasonHero.tsx`
- Create: `components/seasons/SeasonSchedule.tsx`
- Create: `components/seasons/SeasonLeaderboardTable.tsx`
- Create: `components/seasons/ChampionsCupSpotlight.tsx`

**Interfaces:**
- Consumes: `getSeasonLeaderboard` (Task 10); `CollapsibleSection` (existing, `components/dashboard/CollapsibleSection.tsx`); `buildMetadata` (existing, `lib/seo/metadata.ts`); `buildBreadcrumbJsonLd` (existing, `lib/seo/schema/breadcrumb.ts`).

Per Deviation 10, this ships the functional core: hero with real completed-club/Masters/player counts, a per-month schedule with live status badges, a top-50 season leaderboard, and the Champions Cup spotlight. The week-countdown widget, per-month "top ranked player" line, and per-player Clubs-Played/Masters-Qualified columns are deferred (documented, no data-model impact).

- [ ] **Step 1: Write `SeasonHero`**

```tsx
// components/seasons/SeasonHero.tsx
function formatMonthYear(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

export function SeasonHero({
  season,
  tournaments,
  playersCompeting,
}: {
  season: { name: string; start_date: string; end_date: string }
  tournaments: { tournament_type: string; status: string }[]
  playersCompeting: number
}) {
  const clubsCompleted = tournaments.filter((t) => t.tournament_type === 'community_club' && t.status === 'completed').length
  const mastersCompleted = tournaments.filter((t) => t.tournament_type === 'masters' && t.status === 'completed').length

  return (
    <div className="mb-8 rounded-2xl border border-slate-800 bg-slate-900 p-6">
      <p className="text-xs font-bold uppercase tracking-wider text-violet-400">{season.name}</p>
      <h1 className="mt-1 text-2xl font-bold text-white">
        {formatMonthYear(season.start_date)} – {formatMonthYear(season.end_date)}
      </h1>
      <div className="mt-4 flex flex-wrap gap-3 text-xs font-semibold text-slate-400">
        <span className="rounded-full border border-slate-700 px-3 py-1">{clubsCompleted} Community Clubs completed</span>
        <span className="rounded-full border border-slate-700 px-3 py-1">{mastersCompleted} Masters completed</span>
        <span className="rounded-full border border-slate-700 px-3 py-1">{playersCompeting} players competing</span>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Write `SeasonSchedule`**

```tsx
// components/seasons/SeasonSchedule.tsx
import Link from 'next/link'
import { CollapsibleSection } from '@/components/dashboard/CollapsibleSection'

export interface ScheduleTournament {
  id: string
  title: string
  slug: string
  tournament_type: string
  status: string
  tournament_start: string | null
  invitation_only: boolean
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'Upcoming',
  registration_open: 'Register',
  registration_closed: 'Upcoming',
  active: 'Live',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

function monthKey(iso: string | null): string {
  return iso ? iso.slice(0, 7) : 'tbd'
}

function monthLabel(key: string): string {
  if (key === 'tbd') return 'Date TBD'
  const [y, m] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

export function SeasonSchedule({ tournaments }: { tournaments: ScheduleTournament[] }) {
  const byMonth = new Map<string, ScheduleTournament[]>()
  for (const t of tournaments) {
    const key = monthKey(t.tournament_start)
    const list = byMonth.get(key)
    if (list) list.push(t)
    else byMonth.set(key, [t])
  }
  const months = Array.from(byMonth.keys()).sort()

  return (
    <section className="mb-10">
      <h2 className="mb-4 text-base font-bold text-white">Season Schedule</h2>
      {months.length === 0 && <p className="text-sm text-slate-500">No tournaments scheduled yet.</p>}
      {months.map((key, i) => (
        <CollapsibleSection key={key} id={`month-${key}`} title={monthLabel(key)} defaultOpen={i === 0}>
          <ul className="space-y-2">
            {byMonth.get(key)!.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900 px-4 py-3"
              >
                <p className="text-sm font-semibold text-white">
                  {t.tournament_type === 'masters' ? '👑 ' : '📅 '}
                  {t.title}
                </p>
                <Link
                  href={`/tournaments/${t.slug}`}
                  className="shrink-0 rounded-full border border-slate-700 px-2.5 py-1 text-[11px] font-bold text-slate-300"
                >
                  {t.invitation_only && t.status === 'registration_open' ? 'Invite Only' : STATUS_LABEL[t.status] ?? t.status}
                </Link>
              </li>
            ))}
          </ul>
        </CollapsibleSection>
      ))}
    </section>
  )
}
```

- [ ] **Step 3: Write `SeasonLeaderboardTable`**

```tsx
// components/seasons/SeasonLeaderboardTable.tsx
import type { SeasonLeaderboardRow } from '@/lib/seasons/data'

export function SeasonLeaderboardTable({
  rows,
  currentUserId,
}: {
  rows: SeasonLeaderboardRow[]
  currentUserId: string | null
}) {
  const top = rows.slice(0, 50)
  return (
    <section className="mb-10">
      <h2 className="mb-4 text-base font-bold text-white">Season Leaderboard</h2>
      <div className="overflow-x-auto rounded-2xl border border-slate-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-xs text-slate-500">
              <th className="px-4 py-3">#</th>
              <th className="px-4 py-3">Player</th>
              <th className="px-4 py-3 text-right">Season Points</th>
            </tr>
          </thead>
          <tbody>
            {top.map((row, i) => {
              const isMe = currentUserId != null && row.playerId === currentUserId
              return (
                <tr key={row.playerId} className={`border-b border-slate-900 last:border-0 ${isMe ? 'bg-violet-500/10' : ''}`}>
                  <td className="px-4 py-3 text-slate-400">{i + 1}</td>
                  <td className="px-4 py-3 font-semibold text-white">{row.displayName ?? row.username ?? 'Player'}</td>
                  <td className="px-4 py-3 text-right font-bold text-violet-400">{row.points}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {top.length === 0 && <p className="p-4 text-sm text-slate-500">No season points awarded yet.</p>}
      </div>
      <p className="mt-3 text-xs text-slate-500">Qualify for Champions Cup — top 16 at season end earn an invitation.</p>
    </section>
  )
}
```

- [ ] **Step 4: Write `ChampionsCupSpotlight`**

```tsx
// components/seasons/ChampionsCupSpotlight.tsx
export function ChampionsCupSpotlight({ seasonEndLabel }: { seasonEndLabel: string }) {
  return (
    <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-6 text-center">
      <p className="text-xs font-bold uppercase tracking-wider text-amber-400">The Ultimate Prize</p>
      <h2 className="mt-1 text-xl font-bold text-white">SentinelX Champions Cup</h2>
      <p className="mt-1 text-sm text-slate-400">{seasonEndLabel}</p>
      <p className="mt-3 text-sm font-semibold text-white">1st ₦50,000 · 2nd ₦30,000 · 3rd ₦20,000</p>
      <p className="mt-2 text-xs text-slate-500">Top 16 of the season earn an invitation.</p>
    </section>
  )
}
```

- [ ] **Step 5: Write the page**

```tsx
// app/seasons/[slug]/page.tsx
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildMetadata } from '@/lib/seo/metadata'
import { JsonLd } from '@/components/seo/JsonLd'
import { buildBreadcrumbJsonLd } from '@/lib/seo/schema/breadcrumb'
import { getSeasonLeaderboard } from '@/lib/seasons/data'
import { SeasonHero } from '@/components/seasons/SeasonHero'
import { SeasonSchedule } from '@/components/seasons/SeasonSchedule'
import { SeasonLeaderboardTable } from '@/components/seasons/SeasonLeaderboardTable'
import { ChampionsCupSpotlight } from '@/components/seasons/ChampionsCupSpotlight'

async function getSeason(slug: string) {
  const supabase = createClient()
  const { data } = await supabase.from('seasons').select('*').eq('slug', slug).maybeSingle()
  return data
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const season = await getSeason(params.slug)
  if (!season) return { title: 'Season — Sentinel X' }
  return buildMetadata({
    title: `${season.name} — Sentinel X`,
    description: `Follow ${season.name}'s Community Clubs, SentinelX Masters, and the road to the Champions Cup.`,
    path: `/seasons/${season.slug}`,
  })
}

function formatMonthYear(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

export default async function SeasonPage({ params }: { params: { slug: string } }) {
  const season = await getSeason(params.slug)
  if (!season) notFound()

  const admin = createAdminClient()
  const supabase = createClient()
  const [{ data: tournaments }, leaderboard, {
    data: { user },
  }] = await Promise.all([
    supabase
      .from('tournaments')
      .select('id, title, slug, tournament_type, status, tournament_start, invitation_only')
      .eq('season_id', season.id)
      .neq('tournament_type', 'open')
      .order('tournament_start'),
    getSeasonLeaderboard(admin, season.id),
    supabase.auth.getUser(),
  ])

  return (
    <div className="mx-auto max-w-4xl px-4 pb-20 pt-8">
      <JsonLd
        data={buildBreadcrumbJsonLd([
          { name: 'Home', path: '/' },
          { name: season.name, path: `/seasons/${season.slug}` },
        ])}
      />
      <SeasonHero season={season} tournaments={tournaments ?? []} playersCompeting={leaderboard.length} />
      <SeasonSchedule tournaments={tournaments ?? []} />
      <SeasonLeaderboardTable rows={leaderboard} currentUserId={user?.id ?? null} />
      <ChampionsCupSpotlight seasonEndLabel={formatMonthYear(season.end_date)} />
    </div>
  )
}
```

- [ ] **Step 6: Manual verification**

Run `npm run dev`, navigate to `/seasons/season-1`. Confirm: hero renders with real counts, schedule shows the seeded/created tournaments grouped by month with correct status badges, leaderboard renders (empty state before any tournament completes), Champions Cup spotlight renders, and page source includes the breadcrumb JSON-LD script tag.

- [ ] **Step 7: Commit**

```bash
git add "app/seasons/[slug]/page.tsx" components/seasons/
git commit -m "feat(seasons): add public Season page"
```

---

## Task 19: Navigation — add "Seasons"

**Files:**
- Modify: `lib/nav/links.ts`

Per Deviation 1, "Store" doesn't exist in the current nav — "Seasons" is added to `SECONDARY_LINKS` right after "Leaderboards."

- [ ] **Step 1: Add the link**

In `lib/nav/links.ts`, change:

```typescript
export const SECONDARY_LINKS: NavLink[] = [
  { href: '/games', label: 'Games' },
  { href: '/rankings', label: 'Leaderboards' },
  { href: '/about', label: 'About' },
  { href: '/betting', label: 'Betting' },
]
```

to:

```typescript
export const SECONDARY_LINKS: NavLink[] = [
  { href: '/games', label: 'Games' },
  { href: '/rankings', label: 'Leaderboards' },
  { href: '/seasons/season-1', label: 'Seasons' },
  { href: '/about', label: 'About' },
  { href: '/betting', label: 'Betting' },
]
```

(Links directly to Season 1 rather than a nonexistent `/seasons` index route — there is no season index page in scope, matching the spec's only route, `/seasons/[slug]`.)

- [ ] **Step 2: Add it to the footer too**

In `lib/nav/links.ts`, find `FOOTER_SECTIONS` and add a "Seasons" entry to whichever section "Leaderboards" or "Tournaments" currently lives in, following that array's existing shape exactly.

- [ ] **Step 3: Manual verification**

Run `npm run dev`, confirm "Seasons" appears in the desktop header nav between "Leaderboards" and "About," links to `/seasons/season-1`, and appears in the footer.

- [ ] **Step 4: Commit**

```bash
git add lib/nav/links.ts
git commit -m "feat(seasons): add Seasons to nav"
```

---

## Task 20: Seed Community Club #1 (manual, post-deploy)

Not code — the first real tournament, created once everything above has shipped, per the user's explicit instruction. Do this through the admin UI built in Task 15, not a raw SQL insert, so it goes through the same validation/slug-generation path every other tournament does:

- [ ] Go to `/admin/tournaments/new`.
- [ ] Fill in: Title `Community Club #1`, Tournament Type `Community Club`, Season `Season 1`, Max players `32`, Registration fee `0`, Tournament start = the Monday of the week of **Aug 10, 2026** (per spec §1's schedule), registration window ending before then.
- [ ] Save as draft, review, then publish per the existing tournament-readiness flow (`missingForPublish`, already wired into the admin tournaments list — unchanged by this plan).
- [ ] Confirm on `/seasons/season-1` that it now appears under "August 2026" with a "Register" badge once registration opens.

No commit — this is a data-entry step against the live database, not a code change.
