# Game Modes, Formats, Maps & Match Rules — design

**Date:** 2026-09-12
**Status:** approved for planning
**Builds on:** `2026-09-09-multi-format-tournaments-design.md` (phases 1–4b shipped)

---

## 1. What this adds

A Free Fire tournament currently says *how it is scored* (`competition_format`:
`head_to_head` or `points_race`) but not *what is actually being played*. An
admin cannot state that this is Clash Squad on Bermuda with headshots only.

Four fields, in a strict dependency chain:

```
MODE  ─┬─→ FORMAT   (team shape, depends on mode)
       └─→ MAP      (map pool, depends on mode)
MATCH RULES         (independent)
```

## 2. Mode is the parent, not the child

The design mock that prompted this work had it inverted: a top-level tab row of
`1v1 / 2v2 / 4v4 / Battle Royale` with **Mode** nested inside each tab. That is
wrong twice over.

- It mixes two different axes into one control. Battle Royale is not an
  alternative to 1v1 — it is a *mode* that itself has team sizes.
- It lets Map be chosen independently of Mode, which produces combinations that
  cannot exist. The mock literally shows **"1v1 Settings · Mode: Clash Squad ·
  Map: Bermuda"** — Bermuda is a Battle Royale map, not a Clash Squad one.

**Decision: Mode → Format → Map, as three dependent selects. The mock's tab
structure is discarded.** Changing Mode resets Format and Map to that mode's
options, so an impossible combination cannot be assembled.

## 3. Mode determines the scoring engine

Mode is not a replacement for `competition_format` — it *decides* it:

| Mode | Engine | Why |
|---|---|---|
| Battle Royale | `points_race` | many entrants per lobby, placement + kills |
| Clash Squad | `head_to_head` | two sides, first to N rounds |
| Lone Wolf | `head_to_head` | two sides, first to N rounds |

So for a game that has modes, the Mode picker **replaces** the Competition
Format picker — the admin never sets the engine directly, because Mode already
implies it. Games with no modes (Dream League Soccer, EA FC Mobile) keep the
existing behaviour untouched.

## 4. What ships, and what is deliberately disabled

Four of the nine Mode+Format combinations need **a team on each side of a
head-to-head match**. `matches` is `player_a_id` / `player_b_id` — single
players — and `tournaments_squads_are_points_race` actively forbids squads on
`head_to_head`. That is real infrastructure, not a form change.

A further two need **squad registration**, which does not exist: nothing writes
`squads` or `squad_members`, and `closeRegistration` refuses any non-solo entry
unit outright.

| Mode | Format | State | Blocked by |
|---|---|---|---|
| Battle Royale | Solo | **available** | — |
| Battle Royale | Duo | coming soon | squad registration (phase 5) |
| Battle Royale | Squad | coming soon | squad registration (phase 5) |
| Clash Squad | 1v1 | **available** | — |
| Clash Squad | 2v2 | coming soon | team-vs-team matches |
| Clash Squad | 4v4 | coming soon | team-vs-team matches |
| Lone Wolf | 1v1 | **available** | — |
| Lone Wolf | 2v2 | coming soon | team-vs-team matches |

The three "available" rows are the ones that run end to end **today**. Disabled
options are shown, greyed, labelled "Coming soon" — visible so the roadmap is
legible, unselectable so a tournament cannot be created that the platform
cannot finish.

**Availability is data, not code** (§5), so enabling 4v4 later is an `UPDATE`.

## 5. Schema — all of it data, none of it hardcoded

Garena rotates map pools every few seasons, and Clash Squad's ranked and custom
pools already differ. Hardcoding any of these lists means a deploy every time
the game changes. This follows the pattern `games.supported_formats` and
`games.default_points_config` already set.

```
game_modes
  id, game_id → games, slug, name, seq, active
  competition_format   -- 'head_to_head' | 'points_race'  (§3)

game_mode_formats
  id, mode_id → game_modes, slug, name, seq, active
  entry_unit           -- 'solo' | 'squad'
  team_size int        -- players per side
  available boolean    -- false renders as "Coming soon", unselectable (§4)

game_mode_maps
  id, mode_id → game_modes, name, seq, active
```

On `tournaments`: `mode_id`, `format_id`, `default_map_id` (all nullable FKs,
so every existing row is untouched), `match_rules text` with a CHECK of
`normal | headshot_only | spam`, and `match_type text` (§7.1).

Closed value sets are `text` + `CHECK`, not Postgres enums — the schema
currently contains **zero** enum types, and `competition_format`, `entry_unit`
and `status` are all text + CHECK. Matching that beats introducing a second
convention.

### 5.0 One source of truth for team size

`game_mode_formats.entry_unit` / `team_size` are the **catalogue** — they define
what "Clash Squad 4v4" means. `tournaments.entry_unit` / `squad_size` remain the
**authoritative stored values** on the tournament, because every existing
constraint and query already reads them (`tournaments_squad_size_present`,
`tournaments_squad_size_range`, `tournaments_squads_are_points_race`,
`closeRegistration`).

Selecting a Format **writes** those two columns from the catalogue. The admin is
never asked twice, and nothing downstream changes. The catalogue is the
definition; the tournament row is the value. They cannot disagree because only
one of them is ever typed in.

### 5.1 Map belongs on the lobby, not only the tournament

The mock has a single Map field. A real BR event rotates maps across its
rounds — six matches are rarely six Bermudas. So `tournament_lobbies.map_id`
is nullable and falls back to `tournaments.default_map_id`. The admin sets a
default once and overrides per lobby where it matters.

### 5.2 A mode with one map shows no picker

Lone Wolf has a single arena (Iron Cage). Rather than special-casing it, the UI
renders a fixed label whenever a mode has exactly one active map. No extra
column, and it self-corrects if Garena adds a second.

## 6. Seed data

**Modes (Free Fire):** Battle Royale (`points_race`), Clash Squad
(`head_to_head`), Lone Wolf (`head_to_head`).

**Formats:** per the table in §4, with `available` set accordingly.

**Maps:**

- Battle Royale — Bermuda, Purgatory, Alpine, Kalahari, NeXTerra, Solara
- Clash Squad — Bermuda, Bermuda Remastered, Alpine, Kalahari, Purgatory, NeXTerra
- Lone Wolf — Iron Cage

⚠️ Sources vary between ranked and custom/tournament Clash Squad pools (some
seasons drop Alpine or NeXTerra). These are a **seed**, not a fixed truth —
they are admin-editable precisely so a rotation does not require a deploy.

## 7. Match rules

`normal` | `headshot_only` | `spam` (unlimited ammo), tournament-wide. Pure
metadata — it affects nothing in scoring, and is shown to players on the
tournament page so they know what they are entering.

## 7.1 Match Type (Bo1 / Bo3 / Bo5)

The mock showed a **Match Type** field and this spec originally omitted it. It
is **not** an existing column — there is no `match_type`, `best_of` or series
concept anywhere in the codebase. It is new.

It only means anything for the head-to-head modes. Battle Royale already
expresses length as `tournament_stages.rounds_count`, so a BR tournament has no
Match Type at all.

And only **Bo1 is buildable today**: `matches` is one row with one scoreline, so
a best-of-three needs a *series* — several matches that roll up to one bracket
result — which does not exist. That is the same class of gap as team-vs-team.

**Decision:** add `tournaments.match_type` (`bo1 | bo3 | bo5`, default `bo1`,
NULL for BR), and render Bo3/Bo5 greyed as "Coming soon" — the identical
mechanism §4 uses for the unavailable formats. The field exists rather than
being silently dropped, the roadmap stays legible, and nobody can create a Bo3
the bracket cannot resolve.

This supersedes §11 Q1: the round-target question is answered by Match Type
rather than by a separate field.

## 8. UI

In the tournament form, for a game that has modes:

1. **Mode** — replaces the Competition Format select.
2. **Format** — repopulates on Mode change; unavailable entries greyed with
   "Coming soon".
3. **Map** — repopulates on Mode change; a fixed label when the mode has one map.
4. **Match rules** — a plain select, always shown.

Changing Mode resets Format and Map. The existing points-race controls (entry
unit, squad size) are **derived from Format** rather than entered separately —
Format already says `entry_unit` and `team_size`, so asking again would let the
two disagree.

Public tournament pages show Mode · Format · Map · Rules so a player knows what
they are registering for.

## 9. Non-goals

- **Team-vs-team head-to-head.** Clash Squad 2v2/4v4 and Lone Wolf 2v2 need
  squads on both sides of a `matches` row and a change to
  `tournaments_squads_are_points_race`. Its own phase.
- **Squad registration.** BR Duo/Squad need the phase 5 squad lifecycle.
- **Per-round map rotation UI.** The column exists (§5.1); a bulk "set maps for
  all rounds" editor is later.
- **Mode-specific scoring.** Clash Squad is round-based (first to N), which the
  existing head-to-head score fields already express as a scoreline.

## 10. Compatibility

Every new column is a nullable FK or defaulted. A football tournament has no
mode, keeps its Competition Format picker, and stores NULL in all five fields —
no existing row changes and no existing test should need editing.

**No backfill is required, as a matter of fact rather than policy.** Checked
2026-09-12: all 7 tournaments in production are football — Dream League Soccer
(5) and EA FC Mobile (2) — every one `head_to_head`. There are **zero** Free
Fire tournaments, so nothing exists that was created under the old top-level
Competition Format picker and would now read inconsistently on a public page.

Public surfaces must therefore treat Mode/Format/Map/Rules as **optional** and
render nothing when they are NULL, rather than assuming every tournament has
them. Should a Free Fire tournament be created before this ships, it gets its
mode set by hand in admin — a one-row update, not a migration.

## 11. Open questions

1. ~~Does Clash Squad 1v1 want a round target?~~ **Answered by §7.1** — Match
   Type covers series length; the scoreline covers rounds within a match.
2. **Should Mode be filterable** on `/tournaments`? *Proposed: yes, later, with
   the public surfaces phase.*
3. **Do other games get modes now?** PUBG (TPP/FPP) and COD Mobile (BR /
   Multiplayer) fit the same table. *Proposed: seed Free Fire only; the schema
   takes the others whenever they go active.*
