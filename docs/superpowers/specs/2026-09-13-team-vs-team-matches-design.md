# Team-vs-team matches — design

**Date:** 2026-09-13
**Status:** approved for planning
**Builds on:** `2026-09-09-multi-format-tournaments-design.md` (`squads` / `squad_members` /
`tournament_entrants` schema shipped; squad lifecycle explicitly deferred as its own phase),
`2026-09-12-game-modes-formats-maps-design.md` (Clash Squad 2v2/4v4 and Lone Wolf 2v2 seeded
as `available = false`, blocked on exactly this work).

---

## 1. The problem

Two independent gaps, both resolved through the same tables:

- **A team doesn't exist yet.** `squads` and `squad_members` are in the schema — built
  alongside `tournament_entrants` for battle-royale Duo/Squad — but nothing writes to them.
  No create/invite/join action, no admin tooling. Squad registration is schema without a
  lifecycle.
- **A match can't hold a team.** `matches.player_a_id` / `player_b_id` are `NOT NULL` FKs
  straight to `profiles` — exactly one player per side — and referenced directly across the
  match engine: check-in, no-show resolution, result verification, SX Score generation, season
  points, opponent display, submission notices. None of it has a concept of "the other side is
  four people."

Free Fire's Clash Squad (2v2/4v4) and Lone Wolf (2v2) are seeded in the catalogue today,
greyed "Coming soon," blocked on exactly this. COD Mobile's headline mode (5v5 Multiplayer) and
Blood Strike's team modes need the same infrastructure before either game is worth seeding a
catalogue for at all.

## 2. Goals

- Run a Clash Squad 4v4 / Lone Wolf 2v2 / (future) COD 5v5 tournament end to end: squads
  formed → paid → drawn into a bracket → per-round scoreline submitted and confirmed →
  per-player check-in and no-show → SX Score cascaded to every roster member individually →
  champion recorded, prize split across the roster.
- Two ways for a squad to form, both landing in the same tables: self-serve (captain + invite
  code + individual payment, the same lifecycle the BR-squad spec deferred) and admin-arranged
  (the system auto-groups already-paid solo registrants; admin reviews and can move players
  before finalizing — the same "auto-calculate, admin can override" pattern the existing group
  draw already uses).
- Leave existing solo 1v1 behaviour **byte-for-byte identical**. Every file in the list above
  keeps hitting the same "one player per side" code path it already handles; team support is a
  new, additional path, never a rewrite of the existing one.
- Make the next team game (COD Mobile, Blood Strike) a catalogue-seeding exercise once this
  ships, the same way PUBG Mobile was for battle royale.

## 3. Non-goals

- **Persistent teams across tournaments.** Squads stay scoped to one tournament — roadmap
  #21b (clubs/schools/state leagues) is separate and unprejudiced by this.
- **Substitutes.** A squad's roster is fixed once it reaches `complete`, matching the decision
  already made for BR squads. Replacing an injured/banned member mid-tournament is out of
  scope.
- **Best-of series (Bo3/Bo5).** `tournaments.match_type` already exists and already flags Bo3/
  Bo5 as "coming soon" — that's a different gap (one match row can't express a series) and has
  its own future phase. This work only produces Bo1 team matches.
- **Automatic partial-team-walkover judgment.** Admin still declares a whole-side no-show —
  automation flags evidence (who checked in), never decides the match. This is the existing
  admin-final-say rule, unchanged.
- **Flipping catalogue availability.** Turning on Clash Squad 2v2/4v4 and Lone Wolf 2v2 (an
  `UPDATE game_mode_formats SET available = true`) and seeding COD Mobile / Blood Strike
  catalogues are follow-up data changes once this ships — not part of this build.

## 4. Core model

### 4.1 `matches` gains a team side, alongside the existing player side

```sql
ALTER TABLE public.matches
  ALTER COLUMN player_a_id DROP NOT NULL,
  ALTER COLUMN player_b_id DROP NOT NULL,  -- already nullable (byes)
  ADD COLUMN team_a_id uuid REFERENCES public.squads(id),
  ADD COLUMN team_b_id uuid REFERENCES public.squads(id);

-- Exactly one of (player, team) per populated side; side B may be wholly
-- empty (a bye). Side A and B must agree on kind — a squad never faces a
-- lone player.
ALTER TABLE public.matches
  ADD CONSTRAINT matches_side_a_kind
    CHECK ((player_a_id IS NOT NULL) <> (team_a_id IS NOT NULL)),
  ADD CONSTRAINT matches_side_b_kind
    CHECK (
      (player_b_id IS NULL AND team_b_id IS NULL)
      OR (player_b_id IS NOT NULL) <> (team_b_id IS NOT NULL)
    ),
  ADD CONSTRAINT matches_sides_same_kind
    CHECK (
      (player_b_id IS NULL AND team_b_id IS NULL)  -- bye
      OR (player_a_id IS NOT NULL) = (player_b_id IS NOT NULL)
    );
```

`score_a` / `score_b` are untouched — they already mean "this side's score, whatever unit the
mode uses" (goals for football, placement+kill points for battle royale, round wins for Clash
Squad). No schema change needed there; only the identity of "side A" changes.

### 4.2 `group_memberships` gets the same treatment

```sql
ALTER TABLE public.group_memberships
  ALTER COLUMN player_id DROP NOT NULL,
  ADD COLUMN team_id uuid REFERENCES public.squads(id),
  ADD CONSTRAINT group_memberships_kind
    CHECK ((player_id IS NOT NULL) <> (team_id IS NOT NULL));
```

`points` / `wins` / `draws` / `losses` / `goals_for` / `goals_against` keep their names and
meaning (a team's round wins land in `goals_for`, exactly as a points-race entrant's placement
points land in a differently-named column elsewhere) — this is the same "the football module
keeps saying goals" decision the multi-format spec already made; a team tournament's standings
table is not a new module.

### 4.3 `tournaments` — lift the head-to-head/squad ban

```sql
ALTER TABLE public.tournaments DROP CONSTRAINT tournaments_squads_are_points_race;
```

`entry_unit = 'squad'` now means "some registrants are organised into squads before the draw,"
true for both engines. `squad_size` continues to come from `game_mode_formats.team_size`
(already wired: selecting a Format writes it) — a team-vs-team squad's size is always exactly
the format's team size, never a range with a bench.

### 4.4 No new "team" entity

`squads` / `squad_members`, already shipped for BR Duo/Squad, are the team. Head-to-head
matches reference `squads` directly through `team_a_id` / `team_b_id`; they do **not** go
through `tournament_entrants` — that abstraction's own doc comment says it is "the unit that
competes in a points race," and head-to-head never used it. One squad lifecycle now serves two
different consumers (a points-race entrant on one side, a match side on the other) rather than
inventing a second team concept.

## 5. Squad lifecycle

Shared by battle-royale Duo/Squad and every team-vs-team format — this is the phase both of
those deferred to.

### 5.1 Self-serve

Captain creates a squad (name, 2–30 chars, unique per tournament case-insensitively — both
already enforced by the existing schema), gets an invite code, shares it (WhatsApp share
button, matching every other share surface on the platform). Anyone joining by code pays their
own entry fee through the existing Paystack registration flow. Status is `forming` until paid
membership reaches the format's `team_size`, then flips to `complete` — mirroring the BR-squad
spec's lifecycle exactly, because it's the same tables and the same money shape (every member
pays their own fee, prize splits evenly across the roster later).

### 5.2 Admin-arranged

Players register the ordinary solo way — pay individually, no squad awareness at registration.
When admin closes registration for a squad tournament that wasn't (fully) self-organised, the
system:

1. Takes every paid registrant not already in a `complete` squad.
2. Shuffles and splits them into groups of exactly `team_size`, reusing `snakeDistribute()` —
   the same function the group draw already uses when there is no prior standing to seed from.
3. Writes those groups as `complete` squads immediately (payment already happened via ordinary
   registration — there's no `forming` wait).

Admin reviews the result on a screen in the same style as the existing manual knockout-pairing
/ group-move tools: every proposed squad, every member, one "move player to a different squad"
action. Accept as-is or rearrange before finalizing.

**Leftover players.** Team squads must be exactly `team_size` — unlike BR groups (4–8), there's
no such thing as a partial 4v4 side. If the paid pool doesn't divide evenly, the leftover
players are surfaced on the review screen, unassigned, and admin resolves them explicitly (move
one into an existing squad, or refund) rather than the system guessing.

### 5.3 Shared close-time rule

Any squad still `forming` when registration closes is refunded in full and dropped — the same
rule the BR-squad spec already committed to. This applies identically regardless of which path
formed it (an admin-arranged squad is never `forming`, so this only ever fires on abandoned
self-serve squads).

## 6. Bracket generation for team tournaments

`lib/tournaments/draw.ts` (`resolveGroupCount`, `snakeDistribute`, `roundRobinPairs`,
`knockoutRound1`) and `lib/tournaments/bracket.ts` already operate on generic string IDs and
`{id, name}` shapes — nothing in them assumes the ID is a player rather than a squad.

`closeRegistration` (`lib/tournaments/bracket-admin-actions.ts`) gains a branch: for
`competition_format = 'head_to_head'` and `entry_unit = 'squad'`, seed with the tournament's
`complete` squad IDs (via a new `seededPaidSquads()`, the squad-lifecycle sibling of the
existing `seededPaidPlayers()`) instead of player IDs, and `generate()` writes `team_a_id` /
`team_b_id` (plus `group_memberships.team_id`) instead of `player_a_id` / `player_b_id`. The
solo branch is untouched — same function, same knockout/group math, dispatched on `entry_unit`
exactly the way `competition_format` already dispatches solo vs. points-race.

## 7. Match lifecycle

### 7.1 Check-in

`match_check_ins` is already keyed on `(match_id, player_id)`, not on side — no schema change.
`isParticipant` in `check-in-actions.ts` generalises from `user.id === player_a_id ||
player_b_id` to "user is in the roster of `team_a_id` or `team_b_id`" (via `squad_members`)
when a match has a team side, falling through to the existing comparison otherwise.

### 7.2 Result submission & confirmation

Unchanged in shape: one screenshot + recording, one scoreline (`score_a` / `score_b`), any
roster member (captain or otherwise) can submit, admin confirms. `matches.submitted_by` (on
`match_results`) stays a single profile ID — whoever hit submit — same as today.

### 7.3 Whole-team no-show / walkover

Unchanged mechanism, generalised to N players instead of 1. Admin's existing walkover /
mutual-no-show actions (`noshow-actions.ts`) already work off `checkInVerdict()` /
`soleAttendee()` — those generalise from two booleans to "does side A have any check-ins at
all" / "does side B" (still a 3-way verdict: both sides have someone, one side is empty, neither
side is). Declaring a walkover credits every member of the present side and penalises every
member of the absent side — the existing `resolution = 'walkover'` / `'no_show_draw'` branches
in `matchEventsFor()`, applied per roster member rather than to exactly `player_a_id` /
`player_b_id`.

### 7.4 Partial-roster no-show (the new piece)

Per your call in brainstorming: attendance is tracked **per player**, not just per side. A
Clash Squad match can complete normally (team played and won 3-vs-4) while one roster member
personally never checked in — that player should be penalised individually, not carried along
on their team's result.

Today `matchEventsFor()` never consults `match_check_ins` for a normally-completed match — it
only looks at `score_a`/`score_b`/`status`/`resolution`. That stays exactly true for solo
matches. For team matches, a new sibling pure function `teamMatchEventsFor(match, rosterA,
rosterB, checkedInPlayerIds)` adds the one new rule: for a match that is `completed` with no
special resolution, a roster member with a `match_check_ins` row gets `match_completed` (+
`win_no_dispute` if their side won and the scores differ); a roster member **without** one gets
`no_show` instead — even though their side's match proceeded. Whole-side walkovers still route
through §7.3's existing resolution-based branches, unaffected by this rule.

`lib/scoring/apply.ts`'s `regenerateMatchEvents()` branches on whether `team_a_id`/`team_b_id`
are set: team matches fetch both rosters (`squad_members`) and their check-ins, then call
`teamMatchEventsFor()`; everything else calls the existing `matchEventsFor()` completely
unchanged.

## 8. SX Score

Every event `teamMatchEventsFor()` produces still writes one row per player to
`sx_score_events` — no direct score writes, same rule as everywhere else in the system. A
squad's title (final-round win) records every current roster member as champion, the same way
the BR-squad spec already decided for a points-race squad title.

## 9. UI

- **Player dashboard:** "Create squad" / "Join by code" for self-serve tournaments; existing
  fixture/check-in/submit UI extended to show roster context ("You and 3 teammates") instead of
  a single opponent name where a match has a team side.
- **Admin:** a squad-assembly review screen (§5.2) for admin-arranged tournaments, in the same
  visual language as the existing knockout-pairing editor. Match review pages gain a
  per-roster-member attendance/result grid — the same "one grid, one confirm" pattern the
  battle-royale lobby-results UI already uses — rather than 4+4 individual approvals per match.
- **Public bracket/match pages:** wherever a `{id, name}` player object is rendered today,
  resolve to `{id: squadId, name: squadName}` for team matches. `bracket.ts` needs no change —
  it already only cares about the shape.

## 10. Compatibility

Every new column is nullable or dropped a `NOT NULL`, no CHECK constraint touches an existing
row (every current match has exactly a player on each populated side, satisfying the new "kind"
checks trivially), and the one constraint removed (`tournaments_squads_are_points_race`) only
ever *forbade* a combination — dropping it makes previously-impossible rows possible, it changes
nothing about rows that already exist. The existing test suite must stay green without
modification; a test that needs editing here is a signal solo 1v1 was disturbed.

## 11. Phasing

Each phase ends with a green suite and is independently shippable.

1. **Schema.** `matches`/`group_memberships` team columns, dropped constraint, generated types.
   No UI, no behaviour change.
2. **Squad lifecycle.** Self-serve create/invite/join/pay, admin-arranged auto-group + review
   screen, `forming`→`complete`, close-time refunds. Usable standalone — this alone unblocks BR
   Duo/Squad.
3. **Bracket generation for teams.** `seededPaidSquads()`, `closeRegistration` branch, `generate()`
   writing team columns.
4. **Match lifecycle.** Check-in generalisation, `teamMatchEventsFor()`, admin per-roster
   result/attendance grid, walkover/no-show generalisation.
5. **Economy.** Prize split across roster (reusing the BR-squad rule), SX Score cascading,
   recompute support for the new event paths.
6. **Public surfaces.** Bracket/match-page rendering for team sides, champion recording.
7. **Catalogue flip.** `UPDATE game_mode_formats SET available = true` for Clash Squad 2v2/4v4
   and Lone Wolf 2v2 — a data change, not code, per the existing "availability is data"
   principle.

## 12. Testing

- **Pure logic** — `teamMatchEventsFor()` (every combination: full roster, partial no-show,
  whole-side walkover, mutual no-show), the admin-arranged auto-grouping (leftover-player
  cases), `seededPaidSquads()` — direct unit tests, same pattern as `matchEventsFor()`,
  `draw.ts`, `points-standings.ts`.
- **Regression** — the full existing suite, unmodified, after every phase.
- **Money** — squad-refund-on-`forming`-at-close (already tested for BR squads once that phase
  lands; team-vs-team reuses it) and prize-split-across-roster.
- **Manual, before the first real team tournament** — full dry run on staging: one self-serve
  squad, one admin-arranged squad, a partial-roster no-show, a whole-team walkover, a dispute.

## 13. Open questions

1. **Which team formats launch first?** Free Fire already has Clash Squad 2v2/4v4 and Lone
   Wolf 2v2 seeded. *Proposed: flip those on first (§11 phase 7), since no new catalogue work is
   needed; COD Mobile / Blood Strike catalogues are a separate follow-up once a game owner wants
   them live.*
2. **Admin-arranged shuffle seeding.** Plain random shuffle, or seeded by something (existing
   SX Score, to spread skill across squads)? *Proposed: plain random for v1 — skill-balanced
   seeding is a real feature but not a blocker to shipping team play at all.*
3. **Can a leftover player from admin-arranging be merged into a self-serve squad that's still
   `forming`?** *Proposed: no — the two paths stay independent per tournament; a leftover is
   admin's to place into another admin-arranged squad or refund.*
