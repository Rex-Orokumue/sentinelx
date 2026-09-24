# Handoff: Mobile Phase 3a (Rankings, Seasons, Hall of Fame) → Codex

**Date:** 2026-09-23
**From:** Claude (design + plans), working with the repo owner
**To:** Codex
**Reviewer of your PRs:** Claude (currently busy building Phase 2b in parallel — do not wait for it)

## What you are building

Read-only progress screens in the Flutter app, backed by five new read-only web endpoints. No writes, no new tables, no
migrations expected. The web pages `/rankings`, `/hall-of-fame`, `/seasons/[slug]` currently do their aggregation
inline inside the page components; PR 1 extracts that into shared services **without changing behavior**, PR 2 exposes
the services as `/api/mobile/v1` endpoints, and the Flutter PR renders them.

## Read these, in this order

1. `C:\Users\gorok\Videos\sentinelx\AGENTS.md` and `CLAUDE.md`; `C:\Users\gorok\sentinelx_mobile\AGENTS.md` and `CLAUDE.md`
2. **Spec (and the parity addendum listed under "Decision made" below):** `C:\Users\gorok\Videos\sentinelx\docs\superpowers\specs\2026-09-23-mobile-phase3a-rankings-seasons-hof-design.md`
   (especially §3 the two-PR structure, §5 parallel-work rules, §8 the open decision)
3. **Web plan:** `C:\Users\gorok\Videos\sentinelx\docs\superpowers\plans\2026-09-23-mobile-phase3a-web-api.md`
4. **Flutter plan:** `C:\Users\gorok\sentinelx_mobile\docs\superpowers\plans\2026-09-23-mobile-phase3a-flutter-screens.md`
5. Conventions: `docs/superpowers/specs/2026-09-18-mobile-api-v1-conventions.md` (web repo)

## Order of work (three PRs, strictly sequenced where noted)

| # | Repo | Branch | What | Depends on |
|---|---|---|---|---|
| 1 | web | `phase3a/web-extraction` | Web plan Tasks 0–8: characterization tests first, then extract `getRankings`/`getHallOfFame`/season services. **Behavior-neutral.** | nothing |
| 2 | web | `phase3a/api` | Web plan Tasks 9–14: schemas, 5 endpoints, `npm run openapi` | PR 1 **merged** |
| 3 | mobile | `phase3a/screens` | Flutter plan Tasks 1–9 | PR 2 merged (or copy `openapi/mobile-v1.json` from the PR 2 branch to develop against it) |

Flutter Tasks 1–3 (models, client, avatar/copy) can start as soon as PR 2's OpenAPI exists on a branch; you can develop
PR 3 in parallel with PR 2's review.

## Non-negotiables (why this handoff is stricter than usual)

- **PR 1 must not change any snapshot after it is first recorded.** The characterization snapshots pin the rendered
  element tree and the query log of the three web pages. If an extraction step changes a snapshot, the *service* is
  wrong — never run `vitest -u` on those files. Ship PR 1 on its own; do not fold any "lighter query" idea into it.
- **The season endpoints use the service-role client with no RLS backstop.** Explicit column lists, explicit mapper
  output, strict zod schemas, and the exact-key-set tests in web plan Tasks 4 and 11 are the only protection. Treat any
  extra field in a response as a data leak.
- `GET /rankings` and the other three public endpoints must be identical for every caller and must not read the bearer.
  Only `GET /rankings/me` is authenticated.
- Regenerate `openapi/mobile-v1.json` **last**, after rebasing; resolve conflicts by regenerating.
- Claude is building Phase 2b in the same two repos right now. Use your own worktrees; append-only edits to shared
  files (`lib/mobile-api/endpoints/index.ts`, `api_client.dart`, `app_router.dart`, ARB, `openapi` files).

## Verified facts vs. assumptions

**Verified against the code on 2026-09-23:**
- `rankings/page.tsx` 497 lines, `hall-of-fame/page.tsx` 527, `seasons/[slug]/page.tsx` 100; `lib/seasons/data.ts` reads
  everything through the admin client and selects `profiles` as `id, username, display_name, avatar_url, sx_score`.
- The `season` query param on web `/rankings` never filters rows (excluded from the API on purpose).
- The seasons web page has **no** viewer/invitation data; it only highlights the viewer's row client-side.
- Flutter's `ApiClient` is hand-written and guarded by `test/core/api_contract_test.dart`; web has no i18n namespace for
  these pages, so copy goes straight into `app_en.arb`.
- `Errors.notFound()` and `Errors.unauthorized()` exist in `lib/mobile-api/errors.ts`.

**Assumptions the plans make that you must verify on first contact (and tell the owner if false):**
- Vitest can compile the page `.tsx` files once `esbuild: { jsx: 'automatic' }` is added to `vitest.config.ts` (web Task 1
  Step 6); the full suite's test count must be unchanged afterwards.
- `fetchChampions` (`lib/tournaments/champions.ts:236`) and the hall-of-fame third-place query can be satisfied by the
  in-memory fake with the fixtures you build in web Task 3; the plan tells you to read the code and extend the fixtures
  until every section is non-empty.
- The `Placing` type in `champions.ts` matches the plan's `{ id, name }` — copy its real fields into the schema.
- Riverpod 3.3's `meProvider.overrideWith(...)` signature in the Flutter tests — mirror the existing tests
  (`account_screen_test.dart`, `home_screen_test.dart`).
- Web plan Task 7 adds `gameSlug` to the season sections; if that changes the recorded season-page snapshot, derive the
  slug in the endpoint instead (the plan says how).

## Decision made: LITERAL web parity (2026-09-24)

The owner chose literal parity with the web rankings page, including its metric tabs and their page-local re-rank.
**Read `docs/superpowers/plans/2026-09-24-mobile-phase3a-literal-parity-addendum.md` — it OVERRIDES the rankings parts
of both plans** (web Tasks 9, 10, 14; Flutter Tasks 1, 2, 4). The API takes `metric`/`tabGame` and the server runs the
same `rankPlayersBy` on the same page slice, so nothing is ported to Dart. One item needs a 5-minute browser check on
the staging web before you write the Flutter notifier: whether the selected tab persists across pagination/filters
(the addendum explains what to look for and how to flip the behavior).

## Definition of done per PR

- **PR 1:** whole suite green, `npm run lint` + `npm run build` clean, the three `.snap` files only ever *added* (not
  modified after the characterization commits), cost baseline (query log + live timings) in the PR description.
- **PR 2:** endpoint tests + exact-key-set tests green, `openapi/mobile-v1.json` regenerated, curl check that no body
  contains `whatsapp|phone|notification|referred|deletion` (web plan Task 14).
- **PR 3:** `flutter analyze` clean, `flutter test` green, run on a 375px device/emulator against staging, and the
  side-by-side exit check (spec §1) pasted into the PR description. Add a dated entry to `TESTING-NOTES.md`.

## Not in this phase (don't build)

Player profiles, follow, achievements, XP/SX history, coin ledger (all Phase 3b, own spec later);
query-shape optimization of rankings; a Compete-tab entry row (the Compete tab is the temporary tournaments slice that
2a/2b are replacing); admin screens; any write.

## Code changed by the author of this handoff

None. Only docs (spec, two plans, this handoff, two `AGENTS.md` files). No source, tests, migrations or config were
modified.
