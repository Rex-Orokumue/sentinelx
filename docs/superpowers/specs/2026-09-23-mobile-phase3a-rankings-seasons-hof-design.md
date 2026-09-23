# Mobile Phase 3a — Rankings, Seasons, Hall of Fame — Design Spec

**Date:** 2026-09-23
**Status:** Approved design → ready for implementation planning
**Repos:** `sentinelx` (web, this repo) owns the service extraction + endpoints; `sentinelx_mobile` owns the screens
**Implementer:** Codex (both repos), in isolated worktrees, in parallel with the Claude-run Phase 2b session
**Part of:** master spec `2026-09-18-flutter-mobile-app-master-design.md` §8.7, §13 Phase 3 row. Phase 3 is split
like Phase 2 was: **3a (this spec)** = rankings, seasons, hall of fame (read-only); **3b (separate spec, later)** =
player profiles, follow/unfollow, achievements/XP/SX displays, coin ledger view.
**Depends on:** Phase 0B API foundation (`defineEndpoint()`, OpenAPI generation) and Phase 1 (shell, `/home`).
Does **not** depend on Phase 2a/2b endpoints.

---

## 1. Goal, scope, exit criterion

**Goal:** the app's rankings, season and hall-of-fame screens show the same numbers as the web pages.

**Exit criterion:** for a sample of 10 players (rankings) and 1 season (all its games), the values shown in the app
match the web page exactly — rank, wins, SX Score, trend, streak, season points, awards. Verified on staging data and
recorded in the PR description.

**In scope:** `/rankings`, `/seasons`, `/seasons/{slug}`, `/hall-of-fame` read endpoints; Flutter screens for each;
behavior-neutral extraction of the web pages' inline aggregation into services.

**Out of scope:** player profiles, follow, achievements, XP/SX history, coin ledger (all 3b); any change to how
rankings are computed; any query-shape optimization (see §3); the `season` query param on web `/rankings` (verified
2026-09-23: it only feeds the `LeaderboardFilters` UI and pagination links; it never filters the ranking rows, so it
is excluded from the API — reproducing a filter that does nothing would be a bug, not parity); writes of any kind.

**No new tables. No idempotency needed** (all endpoints are GET).

---

## 2. Current state (verified 2026-09-23)

- `app/[locale]/(public)/rankings/page.tsx` (497 lines) does all aggregation inline: profiles (`total_matches >=
  RANKING_MIN_MATCHES`, ordered by wins, limit 200), **all completed matches** (one shared fetch), squad rosters,
  per-game and per-category win/score stats, `player_rank_snapshots` (limit 2000) for trend, longest win streaks,
  region and game filters, `paginate()`, and a pinned viewer row. Roughly 8 queries per render.
- `app/[locale]/(public)/hall-of-fame/page.tsx` (527 lines) also inline; pure derivation helpers already exist in
  `lib/hall-of-fame/awards.ts` and `tournament-results.ts`.
- `app/[locale]/seasons/[slug]/page.tsx` (100 lines) is thin: `lib/seasons/data.ts` `getSeasonLeaderboard()` already
  holds the logic, and reads with the **admin client**. Tier labels come from `lib/games/season-tier-labels.ts`
  (code constant, not a DB table).
- `/home` (`lib/mobile-api/endpoints/home.ts`) already returns a leaderboard teaser and a hall-of-fame teaser via
  `lib/home/summary` — the pattern to follow for shared logic.

---

## 3. Web work — two PRs, in this order

### PR 1 — Behavior-neutral extraction (ships first, on its own)

1. **Characterization tests before moving anything.** Pin the current web output for a fixed fixture dataset:
   rankings (overall + one game + region filter + pagination + viewer-pinned), hall of fame (all award blocks), and a
   season leaderboard. Tests assert output values, not implementation.
2. **Record a cost baseline** in the PR description: query count and rough wall-clock per page render on staging.
   Purpose: if a later change is suspected of regressing cost, it can be *proven*, not suspected.
3. **Extract** to `lib/rankings/service.ts` (`getRankings(client, params, viewerId)`), `lib/hall-of-fame/service.ts`
   (`getHallOfFame(client)`), `lib/seasons/service.ts` (`listSeasons`, `getSeasonDetail(admin, slug, viewerId)`,
   wrapping the existing `getSeasonLeaderboard`). The three web pages become thin callers of these services.
4. **Nothing else changes.** No query is merged, dropped, reordered or cached differently. Tests green, web output
   unchanged, then merge. Any "lighter query shape" idea is a **separate later decision** — bundling it here would
   make a regression impossible to attribute (same discipline as the `registerForTournament` extraction).

### PR 2 — Mobile endpoints

All defined with `defineEndpoint()`, `auth: 'public'` (the handler receives `ctx | null`; a valid bearer, when
present, identifies the viewer), envelope/versioning per `2026-09-18-mobile-api-v1-conventions.md`. Never hand-write
a route under `app/api/mobile/v1/**`.

| Endpoint | Params | Returns | Cache |
|---|---|---|---|
| `GET /rankings` | `game` (slug), `region`, `page` | rows (rank, trend, streak, player card, wins/score/goals per scope), `viewerRow` when signed in and off-page, `games[]` + `regions[]` (filter chips, only games with a completed match), platform stats, page info | `public, s-maxage=60, stale-while-revalidate=300` (varies by bearer only for `viewerRow` — see below) |
| `GET /seasons` | — | seasons list (id, slug, name, dates) | `s-maxage=300` |
| `GET /seasons/{slug}` | — | per-game sections: tournaments, leaderboard, tier labels; viewer invitation state when signed in | `s-maxage=60` |
| `GET /hall-of-fame` | — | champions, MVP, Golden Boot, per-category and per-game awards, tournament results | `s-maxage=300` |

Rules:
- **Viewer-specific data and caching:** `viewerRow` (rankings) and invitation state (seasons) depend on the caller.
  Either return them from a separate authenticated call, or send `Vary: Authorization` / `private` when a bearer is
  present — do **not** let a shared cache serve one viewer's row to another. The plan must pick one and test it.
- **Rank semantics preserved:** region and game filters narrow who is ranked, so ranks reflect the board shown (as on
  web). Default board ranks by score; a game board ranks by wins — do not "improve" this.
- **Profiles:** select only allow-listed columns (CLAUDE.md rule 10); never `select('*')` on `profiles`. Deleted /
  anonymised accounts render as tombstones, never crash.
- **Service role** is used only where the web page already uses it (seasons), never widened. See the dedicated risk
  below — this is not a routine bullet.
- **Highest-risk item in 3a — season endpoints run on the admin client with no RLS backstop.** Every query in
  `getSeasonLeaderboard` / `getMonthlyLeaderboard` (`lib/seasons/data.ts`) uses the service role: `profiles`,
  `tournaments`, `matches`, `tournament_registrations`, `season_ranking_points`, `season_noshow_penalties`. Rankings
  and hall of fame run on the RLS-scoped client, so a sloppy select there is caught structurally; here **nothing
  catches it except the code and its tests**. Today it is safe because someone was careful (`profiles` is selected as
  `id, username, display_name, avatar_url, sx_score`; the returned row is `SeasonLeaderboardRow`). The extraction and
  the endpoint response mapper must:
  - keep every select an explicit column list (never `*`, never a wider join), and map rows into an explicit
    response object rather than spreading a query result;
  - never pass query rows straight into the JSON response — only the mapped, schema-validated shape leaves the
    handler (the `defineEndpoint()` zod `response` schema must be `.strict()` or otherwise reject extra keys);
  - not read or return anything from `tournament_registrations`/`matches` beyond what the leaderboard math needs.
- Run `npm run openapi` **last** and commit `openapi/mobile-v1.json` (the Flutter repo builds against it). Run
  `npm run lint` and `npm run build` before pushing, not only `tsc --noEmit`.
- `SITE_URL` fallback etc. unchanged; no new env vars.

---

## 4. Flutter work

New feature folders `lib/features/{rankings,seasons,hall_of_fame}/`, Riverpod providers beside each feature, generated
API client from `openapi/mobile-v1.json`. Screens are `ConsumerWidget`s and never build a repository/API client
themselves. Mobile-first at 375px.

- **Rankings:** category + game chips, region filter, paginated list, rank-trend arrows, streak flair, pinned "you"
  row when signed in and off-page. Gamey-stat styling per the design concept (tier color, oversized rank number).
- **Seasons:** season picker, per-game tabs, standings, tournament list, tier labels from the API, invitation state.
- **Hall of Fame:** champions and award cards, per-game/category awards, tournament results.
- **Copy:** never hard-coded. Add strings to web `messages/en.json` first, then run `tool/gen_l10n_from_web.dart`,
  then `flutter gen-l10n`; commit generated output.
- **Placement (decided):** a **Rankings** entry under the Compete tab (Hall of Fame and Seasons reachable from it and
  from Home's leaderboard/hall-of-fame teasers). The 5-tab shell is not changed. Routes: `/rankings`, `/seasons`,
  `/seasons/:slug`, `/hall-of-fame`; `resolveWebLink()` maps the same web paths to them. Add routes in new files with a
  minimal edit to `lib/router/app_router.dart`.
- `flutter analyze` and `flutter test` must be clean before every commit. Widget tests cover empty, loading, error,
  tombstone-player, and viewer-pinned states.

---

## 5. Parallel-work rules (Claude is building 2b concurrently)

Both repos have hotspots the 2b session also edits. Codex must:
- Work only in its own git worktree/branch per repo; never in the primary checkout.
- Prefer new files over edits to shared ones. Hotspots: `openapi/mobile-v1.json` (regenerate **last**, after rebasing
  onto current `main`), `lib/mobile-api/endpoints/index.ts`, mobile `lib/router/app_router.dart`, ARB/l10n outputs,
  `lib/supabase/types.ts` (regenerate, don't hand-merge).
- Rebase onto `main` and re-run all checks before merge; resolve `openapi/mobile-v1.json` by regenerating, not
  merging text.
- New migrations, if any become necessary, use a UTC timestamp prefix. None are expected.
- Not run `npm run build` while another session's `next dev` is running in the same checkout (irrelevant in a
  separate worktree, but do not share ports).
- Apply nothing to production data. Staging is `sentinelx-staging` (`ofxmoxpvwbemfouaowoa`); read-only endpoints are
  safe there, and 3a needs no writes.

---

## 6. Verification

1. PR 1: characterization tests green before *and* after the move; cost baseline recorded; web pages visually
   unchanged.
   **The season-leaderboard characterization test must assert the exact key set of every returned row**
   (`Object.keys(row).sort()` equals `playerId, username, displayName, avatarUrl, sxScore, points, isProvisional`),
   not just spot-check values. `expect(row.sxScore).toBe(1234)` still passes if an extra field rides along in the same
   object; on the admin client RLS won't catch that, so the test must. Add the same exact-key-set assertion at the
   endpoint layer for `/seasons/{slug}` (and for the rankings/hall-of-fame player cards, cheaply).
2. PR 2: unit tests per endpoint (params, filters, pagination, tombstones, viewer vs anonymous, cache headers);
   `npm run lint`, `npm run build`, `npm run openapi` clean.
3. Flutter: `flutter analyze` / `flutter test` clean; run on a device/emulator against staging.
4. **Exit check:** side-by-side of 10 players + 1 season + the hall-of-fame page, app vs web; mismatches are bugs.

## 7. Risks

- **Rankings cost.** Each call reads every completed match. Mobile users re-check standings more casually than web
  users load pages, so call volume may exceed web's. Mitigation now: cache headers and the recorded baseline.
  Optimization is a separate, later, provable decision.
- **Extraction regression on web.** Mitigated by characterization tests written first and a behavior-neutral PR that
  ships alone.
- **Column exposure on the admin-client season path** — §3; exact-key-set tests are the only backstop.
- **Shared-cache leakage of viewer rows** — §3 rule; must have a test.
- **Merge friction with 2b** — §5.

## 8. Open items not resolved by this spec

- Whether `viewerRow` is a separate authenticated call or `private`/`Vary` on the main one (plan decides; both are
  acceptable if tested).
- `RANKING_MIN_MATCHES` and the 200-row profile cap are inherited as-is; revisiting them is out of scope.
