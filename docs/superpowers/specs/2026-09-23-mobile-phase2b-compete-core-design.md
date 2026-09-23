# Mobile Phase 2b — Compete Core — Design Spec

**Date:** 2026-09-23
**Status:** Approved → ready for implementation planning
**Repos:** `sentinelx` (web, this repo) owns the new endpoints; `sentinelx_mobile` owns the screens
**Supersedes:** `docs/superpowers/specs/2026-09-22-mobile-phase2b-draft-notes-UNREVIEWED.md` — that
file was produced by a background agent before the 2a/2b split existed and never went through
review. Its technical citations were independently re-verified against current code while writing
this spec (all checked out correctly — see §3 below for the one place this spec diverges from it).
Fills in, at implementation detail, the bracket/standings, Match Centre, and dashboard-fixtures
slices of the master spec (`docs/superpowers/specs/2026-09-18-flutter-mobile-app-master-design.md`
§7.3, §8.3–8.6, §13 Phase 2 row) that 2a explicitly deferred
(`docs/superpowers/specs/2026-09-22-mobile-phase2a-tournaments-registration-design.md` §6.8).
**Depends on:** Phase 2a, merged to `main`. `resolveRegistrationView()`/`GET
/tournaments/{id}/registration-state` and the `api_idempotency_keys` claim/fill/reclaim primitive
both shipped there and are reused here, not rebuilt.

---

## 1. Goal & scope

**Exit criterion:** on `sentinelx-staging`, a full competitive loop proven end-to-end: register
(already works, from 2a) → admin publishes bracket → player checks in → plays → submits result →
admin confirms (web, unchanged) → standings/bracket update → player rates opponent. Idempotency
proven on every money/state-creating write this phase adds (result submission, wager, rating, lobby
result, squad creation) — both the sequential-replay case and the concurrent-reclaim case, matching
the rigor 2a's own exit criteria required for its writes.

**In scope:** standings/bracket/results reads, Match Centre (check-in, result submission,
wagering, no-show), squads (create/lookup/member moves), opponent rating (built net-new, §5),
a scoped-down `GET /me/summary` dashboard-fixtures endpoint.

**Out of scope:** streak/daily-login/quests/wallet dashboard tiles (later phases per the master
spec — quests Phase 5, wallet Phase 6), admin-side actions (publish bracket, confirm result — web
console only, unchanged by this phase), `ROADMAP.md` #21b persistent team/school/state leagues (a
different, larger, still-unbuilt feature — not to be confused with the per-tournament squads in
scope here).

**No new tables**, except that `opponent_ratings` (present since `001_initial_schema.sql`) gets a
real reader/writer for the first time — see §5.

---

## 2. Environment — Vercel preview scoped to staging

**Gap found while writing this spec:** every Vercel env var relevant to Supabase and Paystack
(`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `PAYSTACK_SECRET_KEY`, `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY`) is
currently set for target `[preview, production]` together — every preview deployment today
resolves to **production** Supabase and **live** Paystack keys. There is no environment scoped to
`sentinelx-staging` (`ofxmoxpvwbemfouaowoa`) yet, despite 2a creating that project.

**Fix, first task of the implementation plan:** add branch-scoped preview overrides (Vercel
supports per-branch preview env vars, layered on top of the generic `[preview, production]`
values) for the 2b implementation branch, pointing the Supabase keys at `sentinelx-staging` and
the Paystack keys at test-mode credentials (owner-supplied from the Paystack dashboard — cannot be
generated).

**Verification step, before any write-path testing:** explicitly confirm a preview deployment
built from that branch is actually hitting `ofxmoxpvwbemfouaowoa`, not production — the same class
of "cheap to get wrong, expensive to discover late" check 2a's spec required for the Flutter `dev`
flavor (§7 of that spec).

**Keeping staging in sync:** unchanged from 2a's §7 — every new migration merged to `origin/main`
must also be applied to `sentinelx-staging` before it's relied on here; no automatic sync exists
between the two projects.

---

## 3. Correction carried from the draft notes

The draft notes' §3 (citing `resolveRegistrationView()` as the source for player-facing
registration state) is **superseded, not reused** — that endpoint (`GET
/tournaments/{id}/registration-state`) already shipped in 2a. Citing it again here would be stale;
it is not part of this phase's endpoint catalogue.

All other technical citations in the draft (squads-are-shipped, the endpoint source files below,
the wager constants, the i18n coverage counts) were independently re-verified against current code
while writing this spec and checked out exactly as cited.

---

## 4. Endpoints — reads

All follow 2a's conventions: `defineEndpoint`, `{data}`/`{error}` envelope, shared `errorCode`
strings, bearer auth via `authenticate()`, extraction pattern (endpoint and existing Server
Action/page call the same plain function). New route files register in
`lib/mobile-api/endpoints/<domain>.ts` → `lib/mobile-api/endpoints/index.ts`.

| Endpoint | Tier | Source | Notes |
|---|---|---|---|
| `GET /tournaments/{id}/standings?stage=` | T2 | `sortStandings` (`lib/tournaments/standings.ts`), `sortPointsStandings`/`stageStanding` (`points-standings.ts`, `stage-standing.ts`) | format-dispatch by `tournaments.competition_format`: groups, points-race, round-robin (single-group case of the points-race path) |
| `GET /tournaments/{id}/bracket` | T2 | `loadBracketView` (`lib/tournaments/bracket-view.ts`), `bracket-tree.ts` | already squad-aware — response carries squad names where applicable, no separate client-side "team" branch needed |
| `GET /tournaments/{id}/results` | T2 | `lib/tournaments/results.ts`, `champions.ts` | `champions.ts` already squad-aware |
| `GET /squads/lookup?code=` | T2 | `lookupSquadByCode` (`lib/tournaments/squad-actions.ts`) | read only |
| `GET /matches/{id}/centre` | T2 | `isMatchParticipant` (`lib/matches/participant.ts`), `canCheckIn`/`checkInVerdict`/`soleAttendee` (`lib/matches/check-in.ts`), `wagerWindowOpen`/`estimateWagerPayout` + `WAGER_FEE_RATE`/`MIN_WAGER_STAKE`/`MAX_WAGER_STAKE`/`WAGER_WINDOW_CLOSE_MINUTES` (`lib/wagers/market.ts`), `canMarkBothNoShow` (`lib/matches/noshow-eligibility.ts`) | one composed response for the whole Match Centre screen — match, players, stream URL, check-in state, wager window/pools, no-show eligibility |

Tournament list/detail, entrants, stages, lobbies, matches, `games.active`: still T1, direct
PostgREST reads, unchanged from 2a's §5.8 pattern. `GET /payments/{reference}` already shipped in
2a and is reused as-is, not re-listed as new work here.

---

## 5. Endpoints — writes, with idempotency

| Endpoint | Tier | Source | `Idempotency-Key`? |
|---|---|---|---|
| `POST /squads` | T3 | `createSquad` (`lib/tournaments/squad-actions.ts`) | **Required** — creates a squad + invite code; a retry must not create two |
| `POST /squads/{id}/members/remove`, `/members/move` | T3 | `removeSquadMember`, `moveSquadMember` | Not required — naturally idempotent, same class as the existing admin `movePlayerToGroup` precedent (also has none) |
| `POST /matches/{id}/check-in` | T3 | `checkInToMatch` (`lib/matches/check-in-actions.ts`) | Not required — a one-time flag flip, re-tapping an already-checked-in state is a harmless no-op |
| `POST /matches/{id}/result` | T3 | `submitMatchResult` (`lib/matches/actions.ts`) | **Required** — a flaky-network double-submit must not create two competing pending results |
| `POST /matches/{id}/rating` | T3 | **New** — `lib/scoring/opponent-rating-service.ts` (§6) | **Required** — writes an `sx_score_events` row; a retry must not double-award/double-penalize |
| `POST /matches/{id}/wager` | T3 | `placeWager` (`lib/wagers/actions.ts`) | **Required** — spends coins |
| `POST /lobbies/{id}/result` | T3 | `submitLobbyResult` (`lib/tournaments/lobby-result-actions.ts`) | **Required** — same reasoning as match result |

All "Required" rows reuse 2a's `api_idempotency_keys` claim/fill/reclaim primitive as-is — no new
idempotency infrastructure this phase, purely new callers of it.

**Extraction work:** `createSquad`, `removeSquadMember`, `moveSquadMember`, `checkInToMatch`,
`submitMatchResult`, `placeWager`, and `submitLobbyResult` are all currently FormData-based Server
Actions (`(_prev, formData: FormData)` signature — confirmed by reading each file). Each needs the
same treatment `registerForTournament` got in 2a: the FormData parsing stays in the existing Server
Action, the actual logic moves into a plain function both the action and the new route call. Seven
extractions across three domains (tournaments/squads, matches, wagers) — the largest surface area
of any phase so far (2a had five, all in one domain).

**Rule carried forward unchanged (CLAUDE.md rule 5, 2a's own §6 note):** none of these writes
advance a bracket, group table, or standings themselves. `submitMatchResult`/`submitLobbyResult`
only create a *pending* result; only the existing admin confirm action (unchanged, web-only) flips
it live. The app shows "submitted — awaiting confirmation," never an optimistic win.

---

## 6. Opponent rating — new server-side logic, mobile-first UI

CLAUDE.md's SX Score system documents a rating rule (5★ → +20, 4★ → +10, 1–2★ → −20) that has
**never been implemented anywhere in the web codebase** — `opponent_ratings` is a real table with
zero live readers or writers; the one repo-wide hit outside migrations/types is a comment in
`lib/exchange/stats.ts` explicitly noting it's unused. Building this endpoint means writing new
business logic, not extracting existing logic.

**`lib/scoring/opponent-rating-service.ts`** — `submitOpponentRating(ctx, {matchId, raterId,
stars})`:
- Validates `stars` is 1–5; inserts into `opponent_ratings` (`UNIQUE(match_id, rater_id)` already
  enforces one rating per rater per match).
- Writes the matching `sx_score_events` row per CLAUDE.md's table (5★ → +20, 4★ → +10, 1–2★ → −20,
  3★ → no event) through the existing `lib/scoring/apply.ts` machinery — same discipline as every
  other SX Score mutation (CLAUDE.md rule 6: never update the score directly without logging).
- Rejects: rating yourself, rating before the match has a confirmed result, a second rating
  attempt on the same match (`23505` unique-violation → `already_rated`, same pattern signup uses
  for username collisions).

**Endpoint:** `POST /matches/{id}/rating`, body `{stars: 1-5}`, auth `user`, **idempotency
required**. Errors: `match_not_found`, `not_a_participant`, `result_not_confirmed_yet`,
`cannot_rate_self`, `already_rated`.

**Mobile is the first and primary UI for this feature, not a stand-in for a web feature that
doesn't exist yet.** A post-match rating prompt (push notification → bottom sheet right after
result confirmation) is a natural mobile-native pattern, arguably a better fit there than anything
web would build for it. What must stay single-sourced is the *scoring logic* — the math, the
validation, the eligibility rules — which is why it lives in this one server-side service
regardless of which client calls it first. That's the actual content of "mobile follows web, never
leads": no re-implementing business rules in Dart, not a ceiling on mobile's UI richness. Web
gaining its own rating UI later, if ever, is a separate, unscheduled piece of work — not a
prerequisite for mobile's.

---

## 7. Dashboard fixtures — `GET /me/summary`

| Endpoint | Tier | Source |
|---|---|---|
| `GET /me/summary` | T2 | dashboard data-fetching block in `app/[locale]/dashboard/page.tsx`, not yet extracted |

**Scoped down deliberately:** next fixture + countdown, active registrations, submit-result
prompts, qualify/eliminate banner. **Excludes** streak/daily-login, quests, wallet/coin tiles —
real dashboard content on web today but belonging to later phases (quests = Phase 5, wallet =
Phase 6 per the master spec). A second, additive field set later is cheaper than reshaping a
contract already shipped in an app binary — the same reasoning 2a used to defer squads from its
own registration contract rather than bolt them on awkwardly later.

---

## 8. Exit criteria

- Vercel preview env verified pointed at `sentinelx-staging`, not production (§2) — a config check,
  done before any write-path testing begins.
- Full loop proven on staging: register (2a) → admin publishes bracket → check-in → submit result
  → admin confirms → standings/bracket update → rate opponent. Squad create/lookup/member-move and
  wager placement each exercised at least once.
- **Idempotency proven, not just implemented,** on `result`, `rating`, `wager`, `lobby result`,
  `squad create`: the sequential-replay case (identical request twice, same key, byte-identical
  stored response both times) **and** the concurrent-reclaim case (a request held past the 30s
  staleness mark is reclaimed by a second request; the first request's late-arriving fill is
  provably discarded, not silently overwriting the reclaiming request's response) — 2a's exit
  criteria proved the underlying mechanism works; this phase proves each new caller wires it
  correctly, not re-proving the primitive itself.
- `flutter analyze && flutter test` clean; `npx tsc --noEmit` and `npm run test` clean on the web
  side; `openapi/mobile-v1.json` regenerated (including the 2b endpoints) and the mobile repo's
  pinned copy updated.

---

## 9. Risks carried into 2b specifically

| Risk | Mitigation |
|---|---|
| Seven FormData-action extractions across three domains (tournaments/squads, matches, wagers) — largest surface area of any phase so far | Same per-action extraction discipline as `registerForTournament` (2a §5.3): existing tests stay the safety net, each branch gets its own contract test |
| Opponent rating is genuinely new logic, not extracted from anything proven in production | Unit tests on `submitOpponentRating` covering all 5 star values, the 3★-no-event case, and `already_rated`, before wiring the endpoint |
| Vercel preview env pointed at staging is new infra this phase adds — 2a's spec didn't include it, so this is an undocumented gap being closed now, not a known-working setup being reused | Explicit verification step before any write-path testing, not assumed from "the branch-scoped vars were set" |
| `Match Centre` composes four separate source modules (participant, check-in, wager market, no-show) into one response — the widest single-endpoint composition this phase | Each source module already has its own tests; the composition itself gets a contract test asserting the combined shape, not just that each piece individually works |

---

## 10. Open items not resolved by this spec

- **Exact `GET /me/summary` field-by-field response shape** — the scope (§7) is fixed; the precise
  JSON contract is an implementation-plan-level detail, same granularity 2a left for some of its
  responses.
- **Paystack test-mode credentials for the Vercel preview env (§2)** — owner-supplied, not
  generated by this spec or the implementation plan.
- **Web i18n parts 3–5** — confirmed still unstarted (`dashboard/**` 0/16, `admin/**` 0/31,
  `(public)` 13/57 files referencing `useTranslations`/`getTranslations`, re-checked concretely
  during the draft-notes investigation). Not blocking for 2b — mobile ships its own ARB strings
  regardless of web's i18n state — but sizing future web i18n work should assume translating these
  screens from scratch, not porting existing keys.
