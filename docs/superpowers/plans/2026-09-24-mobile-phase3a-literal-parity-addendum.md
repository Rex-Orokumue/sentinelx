# Phase 3a — Literal Web Parity Addendum (OVERRIDES parts of the two plans)

**Date:** 2026-09-24
**Decision (owner):** the app must reproduce the web rankings page **literally**, including its metric tabs and their
page-local re-rank. This supersedes the "global ranks, no metric tabs" assumption in spec §8 and in the two plans.

Where this addendum and a plan disagree, **this addendum wins**. Everything not mentioned here is unchanged.

Plans it amends:
- Web: `C:\Users\gorok\Videos\sentinelx\docs\superpowers\plans\2026-09-23-mobile-phase3a-web-api.md` (Tasks 9, 10, 14)
- Flutter: `C:\Users\gorok\sentinelx_mobile\docs\superpowers\plans\2026-09-23-mobile-phase3a-flutter-screens.md` (Tasks 1, 2, 4)

## 0. What "literal parity" means (verified in `components/rankings/LeaderboardTabs.tsx`, `LeaderboardTable.tsx`)

1. Server: rank all eligible players (overall board by **score**, a game board by **wins**), filter by region/game,
   slice one page (10). This is `getRankings` and is unchanged.
2. Client (web): `LeaderboardTabs` receives **only that page slice**, holds `metric` (default **`wins`**) and an optional
   category sub-`gameId`, and shows `rankPlayersBy(pageSlice, metric, gameId)`. `rankPlayersBy` assigns
   `rank = index + 1` **within the slice**, so the displayed `#` is page-local and the order is "this page's players,
   re-sorted by the selected metric".
3. Tabs: `Wins`, `SX Score`, plus one tab per **active category** that has an entry in `CATEGORY_META` (label =
   `CATEGORY_META[c].statLabel`). A category tab shows a game sub-filter (`All <statLabel>` + one chip per game) **only
   when that category has 2+ active games**. Changing the metric resets the sub-game to "All".
4. The metric column value is `gameId && category-metric ? gameStat(p.gameStats, gameId).scored : METRIC_VALUE[metric]`
   (see `LeaderboardTable.tsx:54`). The **Wins** tab rows are expandable (`expandable = metric === 'wins'`), showing
   `winsByGame`.
5. The pinned "your rank" row shows the viewer's **global** rank (`pinnedViewer.rank`, computed from `scopedRanked`),
   only when the viewer is not on the current page. This is unchanged and is what `GET /rankings/me` returns.

**Single source of truth (chosen design):** do **not** port `rankPlayersBy` to Dart. The endpoint accepts the client's
tab state and runs the *same* `rankPlayersBy` on the *same* page slice, so the app cannot drift from the web. Switching
a tab is one extra (cacheable) request for the same page.

## 1. Web changes (amends web plan Tasks 9–10, 14)

### 1a. Query parameters — `GET /rankings`

| Param | Values | Default | Notes |
|---|---|---|---|
| `game` | game slug | none | server scope, as before |
| `region` | string | none | server scope, as before |
| `page` | int ≥ 1 | 1 | server page, as before |
| `metric` | `wins` \| `score` \| `football` \| `fighting` \| `shooter` | **`wins`** | mirrors the web client's initial tab. Unknown/invalid → `wins` (`.catch('wins')`) |
| `tabGame` | game slug | none | only honored when the game's `category === metric` **and** that category has 2+ active games; otherwise ignored (web resets it on metric change) |

`metric` and `tabGame` are *presentation* of the already-sliced page; they never change which players are on the page.

### 1b. Response additions (`rankingsResponseSchema`, keep `.strict()`)

Replace `scope` and the row schema with:

```ts
scope: z.object({
  game: z.string().nullable(),            // server scope game slug
  region: z.string().nullable(),
  serverMetric: z.enum(['score', 'wins']),// how the SERVER ordered the pages (score overall, wins on a game board)
  metric: z.enum(['wins', 'score', 'football', 'fighting', 'shooter']),  // the tab being shown
  metricLabel: z.string(),                // header text for the metric column, same string the web table uses (METRIC_LABEL)
  tabGame: z.string().nullable(),         // honored sub-game slug
}).strict(),
tabs: z.array(z.object({ key: z.enum(['wins', 'score', 'football', 'fighting', 'shooter']), label: z.string() }).strict()),
subGames: z.array(z.object({ slug: z.string(), name: z.string() }).strict()),   // sub-filter chips for the current category tab; [] unless 2+ games
subGamesAllLabel: z.string().nullable(),  // "All <statLabel>" for the current category tab, null on wins/score
```

and the row:

```ts
export const rankingRowSchema = z.object({
  rank: z.number().int(),          // AS DISPLAYED on the web: page-local 1..N after the metric re-rank (web parity)
  player: playerCardSchema,
  wins: z.number(), losses: z.number(), totalMatches: z.number(), winRate: z.number(),
  goalsScored: z.number(), goalsConceded: z.number(), goalDiff: z.number(),
  totalTitles: z.number(),
  metricValue: z.number(),         // the column value for the current metric/tabGame
  winsByGame: z.array(z.object({ gameId: z.string(), gameName: z.string(), wins: z.number() }).strict()),  // [] unless metric === 'wins'
  trend: trendSchema,
  streak: z.number().int(),
}).strict()
```
`GameWinCount`'s real field names are in `lib/rankings/game-breakdown.ts:9` — copy them into the schema exactly (rename
only in the mapper, never by changing the source type).

`GET /rankings/me` returns `{ row }` where `row.rank` is the **global** scope rank (`viewerRanked.rank`) and `metricValue`
is the viewer's **score** if `serverMetric === 'score'`, else wins (the pinned row on the web shows `metricValue(pinnedViewer)`
for the *current tab* — so `/rankings/me` also accepts `metric` and `tabGame` and computes `metricValue` with the same
helper below; `winsByGame` is `[]`).

### 1c. Implementation (amends web Task 10)

1. Add to `lib/rankings/service.ts` (or a sibling `lib/rankings/tabs.ts`, exported and unit-tested) — extracted **from
   the web components, not re-invented**:
   - `metricTabsFor(activeGames)` → the tab list (`BASE_TABS` + one per active category present in `CATEGORY_META`),
     copied from `LeaderboardTabs.tsx`.
   - `metricValueFor(p, metric, gameId)` and `metricLabelFor(metric, gameId)` → copied from `LeaderboardTable.tsx`
     (`METRIC_VALUE`, `METRIC_LABEL`, `CATEGORY_METRICS`, the `gameId && CATEGORY_METRICS.includes(metric)` branch).
     **Prefer moving the constants into `lib/rankings/` and importing them from the component**, so web and API share
     them — but only if the web component's snapshot tests stay identical (they render nothing; the characterization
     snapshots of the *page* are unaffected because child components are not executed). If moving them risks a diff,
     copy instead and add a test that asserts both copies agree on every metric.
2. In the endpoint handler, after `getRankings(...)`:
   ```ts
   const tabGameRow = q.tabGame ? r.activeGames.find((g) => g.slug === q.tabGame && g.category === q.metric) : undefined
   const honoredTabGame = tabGameRow && r.activeGames.filter((g) => g.category === q.metric).length > 1 ? tabGameRow : undefined
   const shown = rankPlayersBy(r.pagePlayers, q.metric, honoredTabGame?.id)   // SAME function and SAME slice as the web client
   ```
   Map `shown` (already carrying page-local `rank`) with `metricValue = metricValueFor(p, q.metric, honoredTabGame?.id)`,
   `winsByGame = q.metric === 'wins' ? p.winsByGame.map(...) : []`, and the unchanged trend/streak lookups (keyed by
   player id, so they survive the re-rank exactly as on the web).
3. `rankPlayersBy` is imported from `@/lib/rankings/leaderboard` unmodified.
4. **`GET /rankings` still must not read the bearer** and must stay byte-identical with/without `Authorization`.
5. Cache: `s-maxage=60` as before; the cache key includes the query string, so each tab/page combination caches
   separately.

### 1d. Tests to add (web Task 10)

- Default request (`metric` omitted) returns rows ordered as `rankPlayersBy(pageSlice, 'wins')` would, with `rank`
  values `1..N` even on `page=2` (page-local — assert this explicitly; it is the parity behavior).
- `metric=score` re-sorts the same page slice by SX Score; the set of player ids on the page is identical across all
  metrics (assert set equality for `wins`/`score`/`football`).
- `metric=football&tabGame=dls` uses `gameStat(...).scored` for `metricValue`; `tabGame` for a game in another category
  or in a single-game category is ignored (`scope.tabGame === null`, `subGames` empty).
- `tabs` equals the web's tab list for the fixture's active categories; `metricLabel` matches the web table's label.
- `winsByGame` is non-empty only when `metric === 'wins'`.
- Parity guard: for a fixture, `rows.map(r => [r.player.id, r.rank])` equals
  `rankPlayersBy(pagePlayers, metric, gameId).map(p => [p.id, p.rank])` computed independently in the test.
- `/rankings/me` returns the **global** `rank` (not page-local) and a `metricValue` consistent with `metric`/`tabGame`.

### 1e. Exit check (amends web Task 14 Step 1)

The **`#` column must now match the web exactly** (page-local, per tab). For each of: overall page 1 (Wins tab, default),
overall page 2, SX Score tab, a category tab, a category tab with a sub-game, and a game board — compare rank, name,
metric value, trend arrow and streak for every row against the web page **with the same tab selected**. Also compare the
pinned "your rank" global rank for a signed-in account that is off-page.

## 2. Flutter changes (amends Flutter plan Tasks 1, 2, 4)

### 2a. Models (Task 1) — `progress_models.dart`

- `RankingRow` gains `num metricValue` and `List<WinsByGame> winsByGame` (`class WinsByGame { String gameId; String gameName; int wins; }` — field names must match the web schema you copied in 1b). `rank` is the page-local displayed rank.
- `RankingsScope` becomes `{ String? game; String? region; String serverMetric; String metric; String metricLabel; String? tabGame; }`.
- `RankingsPage` gains `List<MetricTab> tabs` (`class MetricTab { String key; String label; }`), `List<SubGame> subGames` (`class SubGame { String slug; String name; }`) and `String? subGamesAllLabel`.
- Update the model tests: assert `tabs`, `subGames`, `metricValue`, `winsByGame`, and that `RankingsMe.row.rank` parses.

### 2b. Client (Task 2)

`getRankings({String? game, String? region, int page = 1, String? metric, String? tabGame})` and
`getRankingsMe({String? game, String? region, String? metric, String? tabGame})`. Send `metric`/`tabGame` only when
non-null (the server defaults `metric` to `wins`, so the app omits it on the initial load). Update the query-param test
accordingly (`{'game': 'dls', 'page': '2', 'metric': 'score', 'tabGame': 'dls'}`).

### 2c. State and screen (Task 4)

- `RankingsQuery` adds `String? metric` (null = server default `wins`) and `String? tabGame`; `==`/`hashCode`/`copyWith`
  cover them.
- `RankingsQueryNotifier` (**tab state persistence must be verified against the live web page — see the box below**):
  - `setGame(g)` / `setRegion(r)` → new server scope, **page 1**, `metric`/`tabGame` **kept**.
  - `setPage(p)` → `state.copyWith(page: p)`; `metric`/`tabGame` **kept**.
  - `setMetric(m)` → `state.copyWith(metric: m, tabGame: null)` (page kept; the sub-game resets — web `selectMetric`).
  - `setTabGame(slug)` → `state.copyWith(tabGame: slug)` (`null` = "All …").

  > **Verify first (5 minutes, browser):** on the staging web `/rankings`, click the **SX Score** tab, then click
  > **Next page** (and separately a game tab / region filter). My reading of React/Next semantics is that
  > `LeaderboardTabs`' `useState` survives a same-route soft navigation, i.e. the selected tab **persists**; that is what
  > the bullets above implement. If the tab visibly snaps back to **Wins**, the web *resets* on navigation: change
  > `setGame`/`setRegion`/`setPage` to clear `metric` and `tabGame`, and flip the matching test in the list below. Record
  > what you observed in the PR description. The whole point of this addendum is that the app matches what you see.
- Screen (`RankingsScreen`) additions, all strings from `page.tabs[*].label`, `page.subGamesAllLabel`, `page.scope.metricLabel`
  (server-supplied copy — no new ARB keys for them):
  - A horizontally scrollable **metric tab bar** (`Key('tab-metric-${tab.key}')`), selected = `page.scope.metric`.
  - **Sub-game chips** (`Key('chip-tabgame-all')`, `Key('chip-tabgame-${slug}')`) shown only when `page.subGames.isNotEmpty`.
  - Rows show `row.rank` (medals for 1–3 exactly as the web: 🥇 🥈 🥉 else `#n`), the metric column `row.metricValue` under
    the header `page.scope.metricLabel`, trend and streak.
  - **Wins tab rows are expandable** (`page.scope.metric == 'wins'`): tap toggles a list of `winsByGame` (`Key('wins-by-game-${row.player.id}')`).
  - The **your-rank card** uses `/rankings/me` (global rank) and is shown only when that player is not in the visible rows; pass the current `metric`/`tabGame` so its metric value matches the tab.
  - Remove the "Ranked by SX Score / wins" scope line from the plan (the web hero copy is static text; the metric header replaces it).
- Update the Task 4 tests:
  - default load shows tab `wins` selected and rows in server-returned order with ranks 1..N;
  - tapping `tab-metric-score` refetches with `metric: 'score'` and the **same page**;
  - tapping a game/region chip or Next/Prev **keeps** `metric`/`tabGame` (flip to `== null` only if the browser check shows the web resets);
  - sub-game chips appear only when `subGames` is non-empty and tapping one sets `tabGame`;
  - Wins-tab row expands to show `winsByGame`; other tabs are not expandable;
  - the your-rank card shows the global rank from `/rankings/me`.

## 3. Definition of done additions

- Web PR 2: all tests in §1d green; `openapi/mobile-v1.json` regenerated with the new params/fields.
- Flutter PR 3: all tests in §2c green; the exit-check table in the PR description covers every scenario in §1e, with the
  `#` column matching the web.
