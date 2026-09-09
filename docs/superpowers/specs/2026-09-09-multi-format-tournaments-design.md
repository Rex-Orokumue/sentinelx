# Multi-format tournaments — design

**Date:** 2026-09-09
**Status:** approved for planning
**Roadmap:** extends #21a (multi-game support). Distinct from #21b (persistent team / school / state leagues), which this deliberately does not build.

---

## 1. The problem

SentinelX describes itself as a mobile esports platform whose tournament system is
multi-game "from day one". The *catalogue* is multi-game. The *engine* is not.

Every layer below the game picker assumes association football played one-versus-one:

| Layer | File | Assumption |
|---|---|---|
| Result submission | `lib/matches/schema.ts` | exactly two integers, `scoreA` / `scoreB`, 0–99 |
| Match row | `matches` table | exactly two participants, `player_a_id` / `player_b_id` |
| Group table | `lib/tournaments/standings.ts` | wins / draws / losses, goals for, goals against, goal difference |
| Group membership | `group_memberships` | `goals_for`, `goals_against` columns |
| Progression | `lib/tournaments/draw.ts`, `bracket.ts` | round-robin groups feeding a single-elimination bracket |
| SX Score | `lib/scoring/events.ts` | `match_completed` / `win_no_dispute` / `no_show`, all per head-to-head match |

This is not hypothetical. **Free Fire is already `active` in the `games` table**
(`category: 'shooter'`), alongside inactive rows for PUBG Mobile, COD Mobile and
Blood Strike. An admin can create a Free Fire tournament today, take ₦500 from every
entrant, and reach a state the engine cannot score: a battle royale has 12–50
participants in one lobby, ranked by placement and kills, with no head-to-head result
to submit and no bracket to advance through.

The tournament creation form is the visible symptom. The engine underneath is the
actual problem, and a form that adapts per game while the engine cannot consume what
it collects would be worse than the status quo — it would let an admin promise a
format the platform silently cannot run.

## 2. Goals

- Run a battle-royale tournament end to end: registration → lobbies → per-round
  results → cumulative standings → advancement → champion → prizes → SX Score.
- Support both **solo** and **squad** entry, chosen per tournament.
- Leave the existing 1v1 football path **behaviourally identical**. Not "mostly
  compatible" — identical, with the current tests green and unmodified.
- Make adding the next BR game (PUBG Mobile, COD Mobile) a data change, not a code
  change.

## 3. Non-goals

- **Persistent teams.** Squads here are scoped to one tournament. Clubs, schools and
  state sides are roadmap #21b and designing them here would prejudge that work.
- **Automatic result ingestion.** No OCR of scoreboard screenshots, no game-API
  integration. Admin retains the final say (see §7).
- **Live in-game telemetry.** Results arrive after a round ends, not during it.
- **Re-theming the football path.** `standings.ts` keeps saying "goals". It is a
  football module and it will stay one.

## 4. Core model

Format is a property of the **tournament**, not of the game. COD Mobile can host a 1v1
gunfight cup or a battle-royale circuit; both are legitimate and the same game row must
support each.

### 4.1 `tournaments` gains

| Column | Type | Meaning |
|---|---|---|
| `competition_format` | `text NOT NULL DEFAULT 'head_to_head'` | `head_to_head` \| `points_race` |
| `entry_unit` | `text NOT NULL DEFAULT 'solo'` | `solo` \| `squad` |
| `squad_size` | `int NULL` | required when `entry_unit = 'squad'`; CHECK 2–6 |

Constraints:

- `CHECK (entry_unit = 'solo' OR squad_size IS NOT NULL)`
- `CHECK (competition_format = 'points_race' OR entry_unit = 'solo')` — squads are a
  points-race concept only, until #21b says otherwise.

Every existing row backfills to `head_to_head` / `solo`, which is what it already is.

### 4.2 `games` gains

| Column | Type | Meaning |
|---|---|---|
| `supported_formats` | `text[] NOT NULL DEFAULT '{head_to_head}'` | which formats this game may be run in |
| `default_points_config` | `jsonb NULL` | seed values for a new points-race stage |

Seeded: football and fighting games keep `{head_to_head}`. Free Fire, PUBG Mobile, COD
Mobile and Blood Strike become `{head_to_head, points_race}` with a real
`default_points_config` (§6). Adding a new BR game later is one INSERT.

### 4.3 The entrant abstraction

`tournament_entrants` becomes the unit that competes in a points race:

```
tournament_entrants
  id            uuid pk
  tournament_id uuid not null
  kind          text not null           -- 'solo' | 'squad'
  player_id     uuid null               -- set when kind = 'solo'
  squad_id      uuid null               -- set when kind = 'squad'
  display_name  text not null           -- player name, or squad name
  status        text not null           -- 'active' | 'withdrawn' | 'disqualified'
  CHECK ((kind = 'solo') = (player_id IS NOT NULL))
  CHECK ((kind = 'squad') = (squad_id IS NOT NULL))
```

`tournament_registrations` keeps its current job — one row per paying human, carrying
payment status, waivers, coin discounts — and gains a nullable `entrant_id`. A solo
registration produces one entrant; four squad registrations point at the same one.

This is the load-bearing decision of the design. One standings engine, one lobby table
and one results table serve both modes because they only ever see entrants. Without it,
every query downstream needs `if (squad)`.

`head_to_head` tournaments do not use this table at all.

## 5. Stages, rounds, lobbies

Real BR competition — Free Fire World Series, PUBG Mobile Global Championship, and
Free Fire's own Nigerian circuits — is organised as stages of several rounds, with
points accumulating **within** a stage and the top N carried into the next.

```
tournament_stages
  id, tournament_id, seq, name
  rounds_count      int        -- matches played in this stage
  lobby_size        int        -- max entrants per lobby
  advance_count     int        -- how many carry into the next stage
  points_config     jsonb      -- see §6
  status            text       -- 'pending' | 'live' | 'complete'

tournament_lobbies
  id, stage_id, round_no, label        -- 'A', 'B', ...
  room_id, room_password               -- the custom-room credentials
  scheduled_at, youtube_stream_url
  status            text               -- 'scheduled' | 'live' | 'awaiting_results' | 'confirmed'

lobby_entrants
  lobby_id, entrant_id

lobby_results
  id, lobby_id, entrant_id
  placement         int        -- 1 = Booyah / WWCD
  kills             int
  placement_points  int        -- frozen at confirm time
  kill_points       int        -- frozen at confirm time
  total_points      int        -- generated: placement_points + kill_points
  submitted_by      uuid       -- the player who reported it
  screenshot_url    text
  status            text       -- 'pending' | 'confirmed' | 'disputed'
  verified_by, verified_at
```

Points are **frozen onto the row** at confirm time rather than recomputed from
`points_config` on read. An admin editing a stage's points table must not silently
rewrite the history of rounds already played.

Example shape:

```
Free Fire Cup
├─ Stage 1 · Qualifiers   3 rounds · lobby_size 48 · 4 lobbies · advance 24
└─ Stage 2 · Finals       4 rounds · lobby_size 24 · 1 lobby  · champion

Standing within a stage = Σ (placement_points + kill_points)
```

A one-off single-lobby scrim is just one stage, one round, `advance_count` = 1. The
same model covers both ends without a special case.

### 5.1 Lobby assignment

When a stage opens, its entrants are split into `ceil(n / lobby_size)` lobbies by snake
draft on current standings — reusing the existing `snakeDistribute()` from
`lib/tournaments/draw.ts`, which already solves "spread evenly, never differ by more
than one". Round 1 of stage 1 has no standings to seed from, so it shuffles.

Admin can move an entrant between lobbies before a round goes live, subject to
`lobby_size`, mirroring the existing group-move affordance on the bracket page.

## 6. Points configuration

Stored per stage as jsonb, seeded from `games.default_points_config`, editable by admin
before a stage goes live:

```json
{ "placement": [12, 9, 8, 7, 6, 5, 4, 3, 2, 1], "per_kill": 1 }
```

`placement[i]` is the award for finishing `i + 1`-th; anything beyond the array scores
zero.

Shipped defaults, taken from the games' own competitive rulesets rather than invented:

| Game | Placement | Per kill |
|---|---|---|
| **Free Fire** (FFWS) | 12, 9, 8, 7, 6, 5, 4, 3, 2, 1, then 0 | 1 |
| **PUBG Mobile** (PMGC) | 10, 6, 5, 4, 3, 2, 1, 1, then 0 | 1 |
| **COD Mobile BR** | 10, 6, 5, 4, 3, 2, 1, 1, then 0 | 1 |

### 6.1 Tiebreaks

Applied in order, matching official BR practice:

1. total points (desc)
2. total kills (desc)
3. best single placement achieved in the stage (asc)
4. placement in the most recent round (asc)

Still tied after all four: admin resolves explicitly. The system surfaces the tie; it
does not invent a winner.

Implemented as a pure `sortPointsStandings()` in `lib/tournaments/points-standings.ts`,
unit-tested directly — the sibling of `sortStandings()`, not a modification of it.

## 7. Result flow

Players self-report and an admin confirms — the same contract as the existing 1v1 flow,
and the same principle recorded in the project's admin-final-say rule: automation may
detect and flag, never write the result.

**Player side.** From the dashboard, a lobby the player is in shows a submission form:
placement, kills, screenshot. For a squad, the captain submits once for the squad.

**Admin side.** `/admin/tournaments/[id]/lobbies/[lobbyId]` renders **one grid** — every
entrant on a row, each player's own submission pre-filled, blanks where nobody
submitted. Admin edits any cell, then confirms the whole lobby in one action.

This matters: 48 individual approvals per round is not an operation anyone will
actually perform, and a review queue nobody works is worse than no queue. One grid,
one confirm, same authority, same audit trail — `verified_by` / `verified_at` are still
written per row.

**Validation flags** shown to the admin, never auto-resolved:

- two entrants claiming the same placement
- a placement above the lobby's entrant count
- total kills exceeding `entrants − 1`
- an entrant with no submission

Confirming the lobby writes `lobby_results.status = 'confirmed'`, freezes the points,
sets the lobby to `confirmed`, and recomputes that stage's standings.

**Disputes** reuse the existing machinery: a player who disagrees with a confirmed row
raises a dispute, which lands in the admin results queue alongside 1v1 disputes.

## 8. Squads and money

Per the product decision: **every member pays their own entry, and the prize splits
equally across the roster.**

```
squads
  id, tournament_id, name, captain_id, invite_code, status
  status: 'forming' | 'complete' | 'withdrawn'
  UNIQUE (tournament_id, lower(name))

squad_members
  squad_id, player_id, role ('captain' | 'member'), registration_id, joined_at
  tournament_id uuid not null          -- denormalised from squads, see below
  UNIQUE (squad_id, player_id)
  UNIQUE (tournament_id, player_id)    -- one squad per player per tournament
```

`tournament_id` is carried on `squad_members` rather than reached through `squads`
purely so that second constraint can exist as a real UNIQUE index. A trigger enforcing
the same rule would be racy under concurrent joins, which is exactly the case that
matters — four friends accepting an invite at once. It is kept honest by a composite FK
to `squads (id, tournament_id)`.

Lifecycle:

1. Captain creates a squad, gets an invite code, pays their own ₦500.
2. Members join by code and each pay their own ₦500.
3. When paid members reach `squad_size`, the squad flips to `complete` and a
   `tournament_entrants` row is created. **A `forming` squad never enters a lobby.**
4. Registration close: `forming` squads are refunded in full through the existing
   refund path and dropped.

Prize credit extends the current `creditWallet()` path: for a squad entrant the amount
is divided equally across roster members, each getting its own wallet transaction with
its own ledger row. Remainder naira from an uneven division goes to the captain — a
documented, deterministic rule beats silently losing kobo.

The known consequence, accepted: a squad cannot enter until all members have paid, so
there will be more abandoned registrations and more refunds than a captain-pays model.
That is the cost of the fairness the payout side buys.

## 9. SX Score

The existing events (`match_completed` +10, `win_no_dispute` +90, `no_show` −100 in
`lib/scoring/events.ts`) are head-to-head shaped. Points-race analogues, chosen to keep
a comparable amount of score in play per session:

| Event | Δ | When |
|---|---|---|
| `lobby_completed` | +10 | entrant played a confirmed lobby |
| `lobby_podium` | +90 | top-3 placement in a confirmed lobby |
| `lobby_no_show` | −100 | entrant assigned to a lobby, no result, no withdrawal |

For a squad entrant every roster member receives the event individually — SX Score is a
property of a person, not of a temporary squad.

Every change still writes a row to `sx_score_events`. No direct score updates. The
existing recompute path must handle the new event types.

## 10. UI

**Creation form** (`components/admin/TournamentForm.tsx`) becomes format-aware. Choosing
a game filters the Format select to that game's `supported_formats`. Choosing Points
Race replaces the football-specific controls (groups, manual knockout pairing) with:
entry unit, squad size, and a stages editor — each stage taking name, rounds, lobby
size, advance count and a points table pre-filled from the game's defaults.

**Public tournament page** gets a **Standings** tab where a head-to-head tournament
shows Bracket: the current stage table, plus per-round lobby results. New components
`PointsStandingsTable`, `StageTabs`, `LobbyResultCard`. The existing bracket components
are not touched.

**Rankings / Hall of Fame** need no structural change: a points-race champion is the
rank-1 entrant of the final stage, recorded through the same champion path. For a squad
champion, every roster member is recorded — a squad title is a title for each of them.

## 11. Compatibility

The single hard requirement: **`head_to_head` behaviour does not change.**

- Every new column is nullable or defaulted; no existing row is rewritten beyond the
  backfill of its already-true format.
- No existing function signature changes. `sortStandings()`, `draw.ts`, `bracket.ts`,
  `submitMatchResult()` are untouched.
- Format dispatch happens at the page and action level, not inside the football
  functions.
- The existing test suite (1310 tests as of this spec) must stay green **without
  modification**. A test that needs editing to accommodate this work is a signal the
  football path was disturbed.

## 12. Phasing

Each phase ends with a green suite and is independently shippable.

1. **Model + migrations.** Format columns, entrant/stage/lobby/result/squad tables,
   RLS, generated types. No UI. Football unaffected.
2. **Points engine.** `points-standings.ts`, points config resolution, tiebreaks, lobby
   assignment via `snakeDistribute()`. Pure functions, heavily unit-tested. No UI.
3. **Admin creation + stage management.** Format-aware form, stages editor, lobby
   generation, room credentials.
4. **Result flow.** Player submission, admin lobby grid, confirm, validation flags,
   standings recompute, disputes.
5. **Squads.** Create / invite / join, per-member payment, `forming` → `complete`,
   close-time refunds.
6. **Public surfaces.** Standings tab, stage tables, lobby cards, champion recording.
7. **Economy.** Prize splitting, SX Score events, recompute support.

## 13. Testing

- **Pure logic** (`points-standings.ts`, tiebreaks, lobby assignment, points
  resolution, prize splitting) — direct unit tests, the pattern already used by
  `standings.ts`, `draw.ts` and `mutes.ts`.
- **Regression** — the full existing suite, unmodified, after every phase.
- **Money** — prize splitting gets its own tests including the uneven-division
  remainder rule, and squad refunds on `forming` at close.
- **Manual, before the first real tournament** — a full dry run on staging: 12 solo
  entrants, 2 lobbies, 2 rounds, advancement, champion, prize credit.

## 14. Open questions

1. **Lobby size ceiling.** Free Fire customs cap at 48; PUBG at 100. Enforce a
   per-game maximum in `games`, or trust the admin? *Proposed: per-game maximum, since
   an over-sized lobby is not recoverable once tickets are sold.*
2. **Substitutes.** Can a squad replace a member between stages? *Proposed: no for v1;
   the roster is fixed at `complete`. Revisit with #21b.*
3. **Solo and squad in one tournament.** *Proposed: no. `entry_unit` is per tournament.*
4. **Partial lobby no-shows.** If only 30 of 48 turn up, does the round still count?
   *Proposed: yes, admin confirms whoever played; absentees take `lobby_no_show`.*
