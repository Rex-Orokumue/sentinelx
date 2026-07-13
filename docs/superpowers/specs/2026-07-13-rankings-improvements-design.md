# Rankings Improvements (#23) — Design Spec

**Date:** 2026-07-13
**Status:** Approved design → ready for implementation plan
**Depends on:** #6 (leaderboard — `lib/rankings/leaderboard.ts`, `rankPlayersBy`), #7 (Hall of Fame — `lib/hall-of-fame/awards.ts`). Precedes and prepares for (but does not implement) #21 (multi-game support).

---

## 1. Goal

Four fixes to `/rankings` and `/hall-of-fame`, all in service of the platform being honest about which stats apply to which games ahead of #21 (multi-game support) actually landing:

1. Wins tab rows expand to show a per-game win breakdown.
2. Confirm Sentinel Score is already all-games-combined (it is — no change).
3. Rename the Goals tab and make it genuinely football-scoped, not just relabeled.
4. Scope Golden Boot to football; confirm MVP and Champions need no change.

## 2. Schema — `games.category`

**Migration `020_game_category.sql`:**

```sql
-- Genre/category classification. 'other' is a deliberate catch-all for now —
-- #21 will split it into real values (fps, battle_royale, etc.) when those
-- games are actually added. Football-specific views (Goals tab, Golden Boot)
-- filter on category = 'football' and will simply show nothing for 'other'
-- games until #21 gives them their own stat columns and their own category.
ALTER TABLE public.games
  ADD COLUMN category text NOT NULL DEFAULT 'football'
    CHECK (category IN ('football', 'other'));
```

The `DEFAULT 'football'` means the existing Dream League Soccer row is correctly categorized with no manual data migration step.

## 3. Wins tab — expandable per-game breakdown

The rankings page adds one query alongside the existing `profiles` fetch: all `completed` matches with `player_a_id, player_b_id, score_a, score_b, tournament:tournaments(game:games(name))`.

A new pure function in `lib/rankings/game-breakdown.ts`, `winsByPlayerAndGame(matches)`, reuses `matchWinnerId` from `lib/tournaments/advancement.ts` (never reimplement "who won a match") to build `Map<playerId, Map<gameName, winCount>>`.

The Wins tab's top-level number is unchanged — still `profiles.wins`, the existing cached cumulative counter maintained by `refreshPlayer()`. The per-game map only feeds the expand view. Clicking a row reveals data already fetched at page load; no per-row network call. Since the breakdown is grouped from the exact same completed-matches set that `refreshPlayer()` sums into `profiles.wins`, the per-game counts always add up to the cached total (both derive from the same "who won" logic).

## 4. Goals tab — football-scoped, not just relabeled

`profiles.goals_scored`/`goals_conceded` are cumulative sums across a player's entire match history with no per-game provenance — there is no way to retroactively filter that single stored number by category. So the Goals tab stops reading those columns and instead uses a second pure function in the same module, `footballGoalsByPlayer(matches)`, which sums `score_a`/`score_b` from the same completed-matches dataset, filtered to `tournament.game.category === 'football'`.

This is a real behavior change scoped narrowly to the Goals tab and Golden Boot (§5) only. `profiles.goals_scored`/`goals_conceded` are **left untouched everywhere else** — the dashboard header and the player profile page keep showing the raw all-time cumulative total.

**Known future inconsistency, flagged not fixed:** once #21 adds a non-football game, a player's dashboard/profile "goals" figure will silently include any non-goal stats from that game if its match results also get written into `score_a`/`score_b` (the schema has no per-game-typed stat fields yet — that's #21's problem to solve, likely by giving each game category its own stat column instead of overloading `score_a`/`score_b`). Until #21 resolves that, the cumulative `profiles.goals_scored` figure is football-only by coincidence (only football exists), not by design. Track this; do not fix it here.

Tab label changes from **"Goals"** to **"Goals (Football)"**.

**Verification step, not a permanent feature:** during implementation, run one audit query confirming zero players currently have match history from a non-football tournament (expected result: none, since only Dream League Soccer exists today — this is a sanity check, not new logic).

## 5. Hall of Fame

- **Golden Boot**: `pickGoldenBoot` in `lib/hall-of-fame/awards.ts` switches its eligible-player goals figure to the same `footballGoalsByPlayer()` function from §4, filtering the award pool to football-category tournament goals only.
- **MVP**: no change. Already confirmed all-games-combined by design — `sentinel_score` has never filtered by game, and that's intentional (Sentinel Score measures conduct/reliability across the whole platform, not per-game skill).
- **Champions wall**: no change. `deriveChampions()` is already correctly per-tournament (and therefore per-game, since every tournament has exactly one `game_id`).
- **Full per-game Hall of Fame sectioning** (e.g. a separate Golden Boot per football-adjacent game, or entirely separate award categories per game genre) is **out of scope for this ticket** — flagged as #21's responsibility once a second game actually exists to section against.

**`category = 'other'` is intentionally inert:** until #21 gives non-football games their own category values and their own stat schema, any game left as `'other'` produces zero Goals tab entries and zero Golden Boot nominations for its players — not an error state, just nothing to show yet, exactly like a football-scoped MVP-only trophy case looks empty for a chess app.

## 6. Out of scope

- Re-scoping `profiles.goals_scored`/`goals_conceded` themselves by category — deferred to #21 (needs #21's stat-schema decisions first).
- Splitting `category` into real non-football genre values — deferred to #21, when those games exist.
- Per-game Hall of Fame sectioning — deferred to #21.
- Kills/other non-football stat tabs — deferred to #21.
