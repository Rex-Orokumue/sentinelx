# FC Mobile Competition Structure — Design Spec

**Date:** 2026-08-27
**Status:** Approved → ready for implementation planning
**Priority:** Opens FC Mobile as the platform's second active game

---

## 1. Overview

Sentinel X opens competitive play for **EA FC Mobile**, its first game alongside
Dream League Soccer. The competition shape mirrors the existing DLS Season
System (`docs/superpowers/specs/2026-08-03-season-system-design.md`) but with
FC Mobile's own cadence, naming, and a round-robin format the existing system
doesn't have yet:

| Tier | Cadence | Format | Entry | Prize |
|------|---------|--------|-------|-------|
| **SentinelX FC Mobile Circuit Cup** | 3× a month | Round-robin table | Free | None (ranking points only) |
| **SentinelX FC Mobile Elite Cup** | Monthly | 16-player single-elimination knockout | ₦500 | ₦8,000 / ₦4,000 / ₦3,000 (1st/2nd/3rd) |

Players accumulate points across the month's three Circuit Cups. Monthly
cumulative points, filtered to `sx_score >= 400` (the existing eligibility
floor), determine the top 16 invited to that month's Elite Cup — same
invitation/accept/decline/cascade mechanics DLS's Masters tier already uses.

This is additive to the existing Season System, not a replacement: DLS's
Community Club/Masters/Champions Cup are unaffected. `tournament_type`
stays the game-agnostic tier concept it already is — `community_club` for
Circuit Cup, `masters` for Elite Cup — distinguished from DLS's tournaments
only by `game_id` and (newly) `format`.

---

## 2. Activation & a required correctness fix

`games` already has an `EA FC Mobile` row (`active: false`, `category:
'football'`) — flip it to `active: true`.

**Game-scoping fix (required before any second game can safely share the
season system):** `getSeasonLeaderboard` and `getMonthlyLeaderboard`
(`lib/seasons/data.ts`) currently scope only by `season_id` +
`tournament_type`, with no `game_id` filter. The moment FC Mobile's Circuit
Cup and DLS's Community Club both exist in one season, their points would
merge into a single leaderboard and a single Top-16 cut. Both functions gain
a `gameId` parameter, joining through `tournaments.game_id`. Every caller
(`lib/seasons/invitation-actions.ts`'s `leaderboardFor`, the `/seasons` page,
any admin leaderboard view) is updated to pass the tournament's/page's game.

This fix is a pure scoping addition — behavior for a season with only one
active game (DLS today) is unchanged.

---

## 3. Circuit Cup — new `round_robin` tournament format

### 3.1 Schema

```sql
ALTER TABLE public.tournaments DROP CONSTRAINT tournaments_format_check;
ALTER TABLE public.tournaments ADD CONSTRAINT tournaments_format_check
  CHECK (format IN ('group_knockout', 'round_robin'));
```

No other schema change — `groups`/`group_memberships` already carry
everything a round-robin table needs (points/wins/draws/losses/GF/GA), and
`matches.round` already accepts `'group'`.

### 3.2 Registration & field size

Unchanged from every existing tournament: admin sets `max_players` at
creation, registration closes when the cap is reached or admin closes it
early. `registration_fee = 0` for Circuit Cup (the existing free-tournament
path — Community Club already works this way, no new code).

### 3.3 Fixture generation

Today, closing registration runs a group-count calculation
(`groupCountFor`/`resolveGroupCount`/`snakeDistribute`) and then a knockout
draw. For `format = 'round_robin'`, that whole path is replaced: create
**one** `groups` row containing every `active` registrant, and generate its
fixtures with the already-existing `roundRobinPairs()` (all-play-all, one
match per pair). No knockout stage is ever generated — the tournament's
entire competitive life is this one table.

### 3.4 Completion

Today a tournament completes when its grand final resolves
(`completeTournamentIfFinal`, gated on `round === 'final'`). Round-robin
tournaments have no final match, so they get their own completion check:
once every generated round-robin match reaches a terminal state
(`completed`, `bye`, or `forfeited`) — i.e. confirmed-count equals the
group's total pair count, `n(n-1)/2` — the tournament is atomically claimed
into `completed`, the same claim-once pattern `completeTournamentIfFinal`
already uses to guard against double-firing from concurrent match
confirmations.

### 3.5 Placement & points

`bandsForPlacements`/`guaranteedBandsForPlacements`
(`lib/tournaments/season-placement.ts`) only understand knockout rounds and
would call every round-robin player `non_advancer`. A parallel path is
added for `format = 'round_robin'`: final placement is the player's rank in
the completed group's standings, sorted by the same tie-break the table
already displays (points desc, then goal difference desc, then goals-for
desc).

New points-by-rank table (`CIRCUIT_CUP_POINTS`, same shape as the existing
`COMMUNITY_CLUB_POINTS`/`MASTERS_POINTS` band tables):

| Rank | Points |
|------|--------|
| 1st | 100 |
| 2nd | 70 |
| 3rd–4th | 45 |
| 5th–8th | 25 |
| Rest | 5 |

These are starting values, tunable the same way the existing band tables
are — not load-bearing architecture.

`awardSeasonPoints` (`lib/matches/season-points.ts`) gains a format branch:
`group_knockout` keeps using `bandsForPlacements`/`pointsForBand` exactly as
today; `round_robin` uses the new rank-based placement and
`CIRCUIT_CUP_POINTS`. Coin/XP rewards on placement reuse the existing
`PLACEMENT_COINS`/`PLACEMENT_XP` tables keyed off the same numeric rank.

### 3.6 UI

Admin creation form gains a **Format** picker (today hardcoded to
`'group_knockout'` at creation — never actually surfaced as a choice). The
public tournament/bracket page renders the existing group-table component
for a `round_robin` tournament with no bracket beneath it — that component
already exists and is already used for group-stage display in
`group_knockout` tournaments.

---

## 4. Elite Cup — reuses Masters wholesale

Elite Cup is a `tournament_type = 'masters'`, `format = 'group_knockout'`
tournament with FC Mobile's `game_id`. **No new invitation code is
needed** — verified against the existing implementation
(`lib/seasons/invitation-actions.ts`,
`app/[locale]/admin/tournaments/[id]/invitations/page.tsx`):

- Admin clicks **Send Invitations** → `leaderboardFor()` reads the
  (now game-scoped) monthly leaderboard → `selectInvitees()` picks the top
  16 eligible (`sx_score >= 400`, not already invited) → invitation rows
  created, players notified (WhatsApp + in-app).
- Players accept (pay the ₦500 if applicable) or decline from their own
  dashboard.
- Decline/expiry auto-cascades to the next-ranked eligible player (daily
  cron `expireAndCascadeInvitations` + admin's manual "Check & Cascade Now").
- `manuallyAddInvitee` remains the admin escape hatch for edge cases.

This flow is entirely generic over `tournament_type`/`season_id` already —
the game-scoping fix in §2 is the only change needed for it to work
correctly for FC Mobile.

Bracket format, third-place match, and result verification are all
identical to any other 16-player knockout tournament today — no new code.

---

## 5. Generalized prize-split (not Elite-Cup-specific)

Today, prize crediting is winner-take-all: the tournament's `prize_pool`
auto-credits to the final's winner (`completeTournamentIfFinal`
→ `creditWallet`); any other placement prize is a manual admin wallet
credit — a deliberate existing simplification, not a gap.

Elite Cup needs an automated 1st/2nd/3rd split (₦8,000/₦4,000/₦3,000) that
repeats every month. Rather than a one-off Elite-Cup path, this becomes a
general tournament capability:

```sql
ALTER TABLE public.tournaments
  ADD COLUMN prize_second integer CHECK (prize_second IS NULL OR prize_second >= 0),
  ADD COLUMN prize_third  integer CHECK (prize_third  IS NULL OR prize_third  >= 0),
  ADD CONSTRAINT prize_splits_within_pool
    CHECK (COALESCE(prize_second, 0) + COALESCE(prize_third, 0) <= prize_pool);
```

Deliberately two new columns, not three — `prize_pool` keeps meaning
exactly what it means today (the total, shown everywhere it's shown today),
and 1st place's actual credit is derived as `prize_pool - prize_second -
prize_third`, never stored separately. A `prize_first` column would be a
second source of truth that can drift from `prize_pool` (admin edits the
pool total without updating it) and would need a backfill migration for
every existing tournament; deriving it avoids both problems and needs no
migration at all.

- **`prize_second`/`prize_third` both NULL** (every tournament today,
  unchanged): behavior is byte-for-byte what exists — the final's winner
  gets the full `prize_pool`.
- **Both set** (Elite Cup: `prize_pool = 15000`, `prize_second = 4000`,
  `prize_third = 3000`, implying 1st = ₦8,000): on the final's resolution,
  the winner gets `prize_pool - prize_second - prize_third` and the loser
  gets `prize_second` (extending `completeTournamentIfFinal`). On the
  third-place match's resolution (already reliably produced — see below),
  its winner gets `prize_third`. These are two independent credit events
  since the final and the third-place match can resolve in either order.
- Admin edits `prize_pool` (as today) plus the two new split fields per
  tournament instance in the existing edit form, defaulting to
  `prize_second = 4000`/`prize_third = 3000` for Elite Cup but overridable —
  this was an explicit requirement, not a hardcoded constant.

**Third place is not a new problem to solve.** Verified against
`lib/matches/verify-actions.ts`: `createThirdPlaceMatch` already
auto-generates the bronze match from the two semifinal losers the moment
both semifinals decisively complete, for every knockout tournament,
unconditionally. For the edge case where that's not possible (a semi
resolved via bye/forfeit), `creditThirdPlace` is an existing admin
manual-credit action that assigns 3rd without a played match. `getThirdPlace()`
(`lib/tournaments/bracket.ts`) already reads both shapes identically and
already feeds Hall of Fame's third-place display. The only new work is
hooking a wallet credit to whichever of those two paths resolves 3rd place,
guarded the same idempotent way the final's prize credit already is.

---

## 6. `/seasons` page — multi-game

The page becomes game-grouped (tabs or sections, one per active game). Each
game's section shows its own schedule and leaderboard, reading through the
now game-scoped `getSeasonLeaderboard`/`getMonthlyLeaderboard`. DLS keeps
its existing Community Club/Masters/Champions Cup narrative; FC Mobile gets
its own Circuit Cup/Elite Cup section using the same page structure with its
own tournament type labels sourced from `tournament.title` (already
free-text, no new display-name mapping needed — admin titles FC Mobile
tournaments "SentinelX FC Mobile Circuit Cup #1" etc. exactly as DLS
tournaments are titled today).

---

## 7. Rankings & Hall of Fame — per-game sub-filter

Verified against the current implementation
(`lib/rankings/game-breakdown.ts`, `app/[locale]/(public)/rankings/page.tsx`,
`app/[locale]/(public)/hall-of-fame/page.tsx`): both pages already group
strictly by `games.category` (football/fighting/shooter/racing/other) — a
category tab is one shared bucket for every active game in it. Since EA FC
Mobile and Dream League Soccer are both `category = 'football'`, activating
FC Mobile as-is would silently merge its goals/wins into DLS's existing
football numbers with no visual distinction anywhere.

Decision: keep category tabs as the primary view, and add a **per-game
sub-filter** inside each category:

- Rankings: `[ Overall ] [ Football ▾ ] [ Shooter ] [ Racing ]` — the
  Football tab gets a sub-filter (`All Football | Dream League Soccer | EA
  FC Mobile`) that narrows the wins/goals table to one game.
- Hall of Fame: the Golden Boot / category-award section gets the same
  per-game filter chip.

`lib/rankings/game-breakdown.ts`'s `scoreStatsByPlayerAndCategory` groups by
`game_category` today; it gains a sibling grouping by `game_id` (the
underlying match data already carries `tournament.game.name`/`category`, so
this is an aggregation change, not a new query shape). "All Football"
continues to use the existing category-level aggregation unchanged.

---

## 8. Testing

- `season-placement`-equivalent unit tests for the new rank-based placement
  function: standings → expected `CIRCUIT_CUP_POINTS`, tie-break ordering
  (points, then GD, then GF).
- `awardSeasonPoints`: format branch test — `round_robin` uses rank-based
  points, `group_knockout` is provably unchanged.
- Prize-split crediting: unit tests for all three credit paths
  (`prize_first`-only unchanged-behavior case; all-three-set case firing
  independently off the final and the third-place match; idempotency on
  each).
- Game-scoping regression test: two games' season points in the same
  season/month never merge in `getSeasonLeaderboard`/`getMonthlyLeaderboard`.
- Round-robin fixture generation: `n` players → `n(n-1)/2` matches; the
  completion trigger fires exactly once when the last one confirms.
- Existing Rankings/Hall of Fame tests extended to cover the per-game
  filter alongside the existing category-level cases.

---

## 9. Out of scope

- WhatsApp/notification template copy changes beyond the new tournament
  names (existing templates are already tournament-name-driven, no new
  types needed).
- New per-game stat columns — Golden Boot etc. stay goals-based, same shape
  DLS already uses; nothing FC-Mobile-specific to model.
- Historical backfill — FC Mobile has no prior tournament history.
- Team/school/state leagues (roadmap #21b) — unrelated to this feature.
- Automated Paystack reminder for an unpaid Elite Cup acceptance (already
  deferred for Masters in the original Season System spec; same deferral
  applies here).
