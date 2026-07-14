# Multi-Game Support (#21a) — Design Spec

## Goal

Generalize tournaments/rankings/profiles so non-football games (Mortal Kombat Mobile, COD Mobile 1v1 modes, and additional football-likes like EA FC Mobile/eFootball) work correctly, and give admin a way to add games without direct database access. This is the first of two independent sub-projects under roadmap #21 — the second, team/school/state leagues, is a separate future spec.

## Scope

**In scope:**
- Admin UI to create/edit/deactivate games (`games` table already exists; no UI exists today — games are currently added via direct DB access).
- Widen `games.category` beyond `'football' | 'other'` to include `'fighting'` and `'shooter'`, each with its own secondary stat, Rankings tab, and Hall of Fame award.
- Fix the player profile page and dashboard header, which currently read `profiles.goals_scored`/`goals_conceded` — a career-wide total blended across *every* game a player has played, with no per-game provenance. (`lib/rankings/game-breakdown.ts`'s `footballGoalsByPlayer()` already avoids this exact problem for Rankings/Hall of Fame by computing a live, football-scoped aggregate directly from `matches`; the profile page and dashboard header don't use that pattern yet.)
- Seed the four launch-ready games through the new admin UI: EA FC Mobile (`football`), eFootball (`football`), COD Mobile 1v1 modes (`shooter`), Mortal Kombat Mobile (`fighting`).

**Explicitly out of scope:**
- **Battle-royale games** (PUBG Mobile, Free Fire). The `matches` table is `player_a_id`/`player_b_id` throughout — every piece of the tournament system (bracket advancement, result submission, verification, Sentinel Score events, prize crediting) assumes exactly two competitors. Battle royale has no "match" in that sense (a running leaderboard across a full lobby, not a 1v1 winner), so this is a ground-up redesign of the core match model, not a feature addition. Deferred to a future v5.0 project.
- **Team/school/state leagues.** Orthogonal to how many games the platform supports; a separate future spec.
- Dropping or renaming `profiles.goals_scored`/`goals_conceded` — left in place, still written by the `lib/scoring/stats.ts` recompute engine. Flagged as a candidate for later cleanup once confirmed nothing else reads them for display, not attempted in this project.

## Architecture

No new tables. `matches.score_a`/`score_b` are already generic integers — goals for football, rounds won for fighting, kills for a first-to-N shooter duel all fit the same two columns. The only schema change is widening the `games.category` CHECK constraint. Everything else is: (1) a new admin CRUD surface for `games`, (2) generalizing an aggregation function that's already written football-only, and (3) fixing two display surfaces (profile page, dashboard header) that never adopted the live-aggregate pattern Rankings/Hall of Fame already use.

### Category taxonomy

| Category | Example games | Secondary stat | Rankings tab | Hall of Fame award |
|---|---|---|---|---|
| `football` | EA FC Mobile, eFootball, Dream League Soccer | Goals | Goals | ⚽ Golden Boot |
| `fighting` | Mortal Kombat Mobile | Rounds won | Rounds Won | 🥊 Iron Fist |
| `shooter` | COD Mobile (1v1 modes) | Kills | Kills | 🎯 Sharpshooter |
| `other` | catch-all | none | — | — |

A category's tab/award only renders once at least one **active** game in that category exists — mirroring the existing precedent where the home page's game filter "auto-shows at 2+ active games." Right after this ships (only football seeded), Rankings and Hall of Fame look identical to today; new tabs/awards appear as games are added via the admin UI.

## Data Model Changes

New migration (e.g. `027_multi_game_categories.sql`):

```sql
ALTER TABLE public.games DROP CONSTRAINT games_category_check;
ALTER TABLE public.games ADD CONSTRAINT games_category_check
  CHECK (category IN ('football', 'fighting', 'shooter', 'other'));
```

Explicit drop + re-add (confirmed live constraint name: `games_category_check`) — Postgres requires this for CHECK constraint changes, an in-place `ALTER` won't work.

No other schema changes. `games` already has everything an admin CRUD needs: `name`, `slug`, `icon_url`, `active`, `category`.

## Components

### 1. Category metadata — single source of truth

New `lib/games/categories.ts`:

```ts
export const CATEGORY_META: Record<string, {
  statLabel: string
  awardName: string
  awardEmoji: string
}> = {
  football: { statLabel: 'Goals', awardName: 'Golden Boot', awardEmoji: '⚽' },
  fighting: { statLabel: 'Rounds Won', awardName: 'Iron Fist', awardEmoji: '🥊' },
  shooter: { statLabel: 'Kills', awardName: 'Sharpshooter', awardEmoji: '🎯' },
}
```

`'other'` and any future uncategorized game are deliberately **not** in this map — `CATEGORY_META[category]` returns `undefined` for them, which is correct (no secondary stat to show). **Every consumer must use optional chaining** (`CATEGORY_META[category]?.statLabel`) — never assume the lookup is defined. This is the single source of truth consumed by Rankings, Hall of Fame, and the profile page, so the three surfaces can't drift out of label-sync with each other.

### 2. Generalized stat aggregation

`lib/rankings/game-breakdown.ts`'s `footballGoalsByPlayer()` hardcodes `match.game_category !== 'football'`. Generalize to:

```ts
export function scoreStatsByPlayerAndCategory(
  matches: GameScopedMatch[],
  category: string,
): Map<string, { scored: number; conceded: number }>
```

Same body, `category` becomes a parameter instead of a hardcoded string. `footballGoalsByPlayer` becomes a one-line wrapper (`scoreStatsByPlayerAndCategory(matches, 'football')`) so existing call sites (Rankings, Hall of Fame) and their tests don't need to change.

**TDD coverage:** primary tests target `scoreStatsByPlayerAndCategory` directly — verify correct scoping for `football`/`fighting`/`shooter` inputs, correct scored/conceded split for both `player_a`/`player_b` sides, and that matches with missing scores or non-`completed` status are excluded. `footballGoalsByPlayer` gets one thin passthrough test confirming delegation — no duplicate logic testing.

### 3. Admin game management (new)

- `app/admin/games/page.tsx` — lists all games (active + inactive), each row showing its non-terminal tournament count (small N+1 queries are fine at this scale, well under 10 games), an "Add game" form, and a per-row activate/deactivate toggle.
- `lib/games/schema.ts` — `gameSchema` (name, slug, category, iconUrl optional). Slug auto-derived from name, reusing `lib/tournaments/slug.ts`'s existing slugify logic rather than writing a new one.
- `lib/games/admin-actions.ts` — `createGame`, `toggleGameActive`, mirroring `lib/tournaments/admin-actions.ts`'s existing conventions (`requireStaff`, slug-uniqueness 23505 → friendly message).
- New "Games" entry in `ADMIN_NAV`.
- **Deactivation is soft and non-blocking, with a warning, not a hard stop.** Deactivating a game with open tournaments doesn't break anything — existing tournaments/matches continue to work, the game just stops appearing for *new* tournament creation. The admin UI must warn before the toggle takes effect, reusing the existing **two-step confirm button** pattern already established by `RecomputeButton` (click → button becomes a "Confirm" state → click again to act). The confirm-state label includes the count, e.g. "Confirm — 2 active tournaments will be unaffected." The count is computed server-side when the games list renders (not fetched on click), since the page already has to load each game's row data.

### 4. Dynamic Rankings tabs and Hall of Fame awards

Both pages already fetch `matches` with the `tournament:tournaments(game:games(name, category))` embed (confirmed exact current select: `'status, score_a, score_b, player_a_id, player_b_id, tournament:tournaments(game:games(name, category))'` on Rankings). Extend the existing per-category rendering gate (already used for Goals/Golden Boot today) to `fighting`/`shooter` using `CATEGORY_META` for labels, and the generalized `scoreStatsByPlayerAndCategory` for the underlying numbers.

### 5. Profile page fix

`components/player/ProfileStats.tsx` and its data source (`app/(public)/players/[username]/page.tsx`) currently render one "Goals for / Goals against / Goal diff" block from `profile.goalsScored`/`goalsConceded` — a blend across every game the player has ever played, not scoped to any one category.

Fix: the profile page adds its own new query for this player's completed matches, using the **same** `tournament:tournaments(game:games(name, category))` embed Rankings uses (this is a different query on a different page — Rankings' query fetches every player's matches for the leaderboard; the profile page needs just this one player's matches for their own breakdown). Group via `scoreStatsByPlayerAndCategory` and render one stat block per category the player has actually completed matches in, using `CATEGORY_META[category]?.statLabel` for the header (skip categories not in `CATEGORY_META`, i.e. `'other'`). A player who's only played football sees exactly today's block; a multi-game player sees one correctly-labeled block per category instead of a blended, meaningless number.

### 6. Dashboard header fix

`DashboardHeader` shows a compact `wins/losses/goalsScored` identity strip — same blending bug, and no room to show a per-category breakdown legibly. Fix: **drop the goals figure entirely, keep W–L only.** W–L is universal and meaningful for every player regardless of game; the detailed per-category breakdown belongs on the full profile page where there's space to show it properly. `app/dashboard/page.tsx`'s prop-pass to `DashboardHeader` drops `goalsScored`.

### 7. Result submission forms — verified, no change needed

Checked `components/match/ResultSubmissionForm.tsx` and `components/admin/ResultReviewForms.tsx` directly: neither says "Goals" anywhere today. Score fields are labeled by *player name* (`playerAName`/`playerBName`), not by stat type, and headings are already generic ("Submit your result", "Confirm official result"). A repo-wide grep for "goal" across both files and their surrounding pages returns nothing. **No fix needed here** — flagging explicitly so this isn't re-investigated during implementation.

## Testing

- `lib/rankings/game-breakdown.test.ts` — extended per the TDD plan above (§2).
- `lib/games/schema.test.ts` — new, mirroring `lib/tournaments/admin-schema.test.ts`'s existing style (valid input, missing name, invalid category, slug-collision message shape).
- No component/page tests — matches this codebase's established convention (unit tests only for pure `lib/` functions; Server Actions, pages, and components are verified via `tsc`/lint/build + manual smoke check).

## Pre-Ship Due Diligence

Before merging, grep the codebase for any remaining **display** reads of `goals_scored`/`goalsConceded` (not the `lib/scoring/stats.ts` recompute engine's writes) beyond the four surfaces already identified and fixed in this spec (Rankings, Hall of Fame, profile page, dashboard header). Not expected to find anything given the research already done, but a final check before the PR goes to main.

## Rollout

Seed the four launch games (EA FC Mobile, eFootball, COD Mobile, Mortal Kombat Mobile) through the new admin UI once it ships — no migration-time data seed. This is deliberate: the whole point of this project is that adding a game becomes an admin-operable action instead of a direct database write.
