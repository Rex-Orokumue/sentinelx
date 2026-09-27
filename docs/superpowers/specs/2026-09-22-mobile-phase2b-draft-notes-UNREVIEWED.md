# Mobile Phase 2b — Compete Core — DRAFT NOTES (unreviewed, not an approved spec)

**⚠️ Provenance and status, read before using this file for anything:** this was
produced by a background agent during Phase 2a's migration-replay check, before
the 2a/2b split existed — its "Phase 2" is the master spec's original
undivided, XL-sized Phase 2, not the 2b that now exists. It has **not** been
through the brainstorming skill's review process (no clarifying questions, no
section-by-section user approval) the way
`2026-09-22-mobile-phase2a-tournaments-registration-design.md` was.

**What's verified (independently re-checked in the 2a session, high
confidence):** the squads-are-shipped correction (§2), the
`resolveRegistrationView()` source correction (§3 — though 2a's own spec is now
the authoritative version of this, since registration-state landed in 2a, not
2b), the opponent-rating implementation gap (§4), the exact i18n coverage
counts (§8 item 3), the migration-replay process gotcha (already folded into
2a's spec §2), and the staging-DB summary (§7, superseded by 2a's spec — refer
to that one, not this file, for staging details).

**What's NOT independently verified — treat as a starting draft, re-check
before relying on it:** the §5.1/§5.3/§5.4 endpoint catalogue details for
standings/bracket/Match Centre (exact function names and constants cited from
`lib/matches/participant.ts`, `lib/wagers/market.ts`, `lib/matches/
noshow-eligibility.ts`, etc.), the squad endpoint catalogue in §5.2 (real that
squads exist — per above — but this file's specific endpoint shapes for them
weren't re-verified line by line), and the `GET /me/summary` dashboard-fixtures
scope note in §5.5. None of these are known to be *wrong* — they just haven't
had the same verification pass the items above got.

**Original content follows, unmodified except this header.**

---

**Date:** 2026-09-22
**Status:** Draft → ready for review
**Repos:** `sentinelx` (web, this repo) owns the new endpoints; `sentinelx_mobile` owns the screens
**Supersedes:** nothing. Extends `docs/superpowers/specs/2026-09-18-flutter-mobile-app-master-design.md`
§7.3 (Compete, Match centre, part of Progress & discovery), §8.3–8.6, §8.19 (Phase 2 "minimal"), §8.21, §13
Phase 2 row — this spec fills those in at implementation detail, and corrects three of the master
spec's source-file citations against the real, current code (§2–§4 below).
**Depends on:** Phase 0 (0A/0B/0C) and Phase 1, all merged and verified. Staging-DB decision made
2026-09-22 — owner picked **option B**, a second free Supabase project, name `sentinelx-staging`,
id `ofxmoxpvwbemfouaowoa`, org `slknegawjebafleisdap`, region `eu-west-1` (same org as production).

**Migration replay result (2026-09-22): PASS**, with one important correction made mid-check.
The first replay pass used this working directory's `supabase/migrations/` folder (109 files)
and reported a clean apply — but the schema diff against production then showed **9 RLS
policies present on the fresh replay that don't exist on production**: `profiles.profiles_own_update`,
`match_results.mr_player_insert`/`mr_own_update_pending`, `tournament_registrations.tr_own_insert`,
`withdrawal_requests.wr_own_insert`, `friendly_matches.friendly_matches_challenger_insert`/
`friendly_matches_participant_or_staff_update`, `friendly_match_results.fmr_participant_insert_while_active`/
`fmr_own_update_while_active` — exactly the S1–S3 vulnerable policies (master spec §2.5). Root
cause: **this working directory was on a stale feature branch, 150 commits behind `origin/main`**,
so its migrations folder was missing the two newest files on trunk —
`20260918200000_lock_down_profiles_and_write_paths.sql` (the actual S1–S3 fix) and
`20260918210000_fcm_tokens_platform.sql`. A replay that only checks "did it apply without
error" would have silently produced a **false PASS that re-opens the S1–S3 holes on the
staging mirror** — the diff step is what caught it, not the replay itself. Fetched both files
from `origin/main` and applied them to staging. Final state: **84/84 tables match production
exactly (zero diff), 169/169 RLS policies match exactly (zero diff after the fix), extensions
identical (`pg_cron`, `pg_net`, `pg_stat_statements`, `pgcrypto`, `uuid-ossp`, `supabase_vault`
on both, all pre-installed — no manual extension work needed)**.
**Process lesson for the implementation plan:** always replay from `origin/main` (or `git fetch`
+ diff against it first), never from whatever a working directory happens to have checked out —
this repo has many long-lived local branches (see git worktree list) and local `main` itself was
150 commits stale at the time of this check.

---

## 1. Goal

Exit criterion (unchanged from the master spec, §13 Phase 2 row): a full loop proven on the staging
project — register + pay → published bracket → play → submit result → (admin, on web) confirm →
standings update — with idempotency proven on the money/state-creating writes.

**No new tables.** Every endpoint reuses existing tables and existing (or, in one case below,
newly-extracted-but-not-newly-invented) business logic. One genuine gap is found and resolved in §3.

---

## 2. Correction: team-vs-team / squads are **not** blocked for Phase 2 — the master spec's
dependency note is stale

The master spec (§13 "Web-parity dependencies") says mobile must wait for web's team-vs-team
**phase 6** (public rendering) and **phase 7** (catalogue flip) before rendering squads/team
matches. That was accurate on 2026-09-18. It no longer is: both shipped on `origin/main` since,
confirmed directly from git history just now —

- Phase 6 (public rendering): `46fa9a2` docs the phase 6a/6b plans; `fdcfa71` (bracket-view squad
  names/standings), `94b696f` (Match Centre renders squad sides/rosters, hides wagering for team
  matches), `6cd95a8` (community result card), `bb4f069` (OG share card), `6212e4f` (Hall of Fame),
  `081e0aa` (champions.ts squad standings), plus admin-tooling commits, are all on `origin/main`.
- Phase 7 (catalogue flip): `b2d034d` "flip Free Fire team formats to available" is on `origin/main`.

**Do not confuse this with `ROADMAP.md` item 21b** ("Team/school/state leagues"), still ⬜ — that's
a different, larger feature: *persistent* clubs/schools/state sides that exist independent of any
one tournament. What shipped is *tournament-scoped* squads (form or join a squad, per tournament,
via invite code) — already live in the current registration UI (`components/tournament/
RegistrationPanel.tsx` imports and renders `SquadEntryFlow` unconditionally; `lib/tournaments/
squad-actions.ts` — `createSquad`, `lookupSquadByCode`, `removeSquadMember`, `moveSquadMember` —
all exist exactly as the master spec's §7.3 catalogue already assumed). 21b stays out of scope for
mobile (unbuilt on web, mobile never leads); squads-per-tournament are **in scope for this phase**.

**Action:** squad endpoints (`POST /squads`, `GET /squads/lookup`, squad member management) are
back in the Phase 2 catalogue (§5.3). Recommend a housekeeping edit to the master spec's §13 table
and §8.3 note ("needed once web phase 6/7 lands" → "shipped 2026-09-14, live") — not done in this
spec since it's the mobile repo's file; flagging here so the mobile-repo session that reads this
spec doesn't re-defer squads on stale information.

---

## 3. Correction: `readiness.ts`, `entrants.ts`, `stage-entry.ts`, `season-placement.ts` are the
wrong sources for `GET /tournaments/{id}/registration-state`

The master spec's §7.3 catalogue cites these four files as the source for player-facing
registration state. Read directly, none of them are that:

- **`lib/tournaments/readiness.ts`** — `missingForPublish()` is an **admin** bracket-publish
  readiness gate (checks the tournament has enough confirmed entrants etc. before an admin can
  publish a bracket). Nothing to do with whether *this player* can register.
- **`lib/tournaments/entrants.ts`** / **`stage-entry.ts`** — bracket/lobby seeding helpers, called
  at `closeRegistration` time (building `SoloEntrantRow[]`/`SquadEntrantRow[]` for the draw), not
  read-time state for a player looking at the tournament page.
- **`lib/tournaments/season-placement.ts`** — prize/points-band math for *after* a tournament ends
  (`bandsForPlacements`, `pointsForBand`), unrelated to registration.

**The real source is `lib/tournaments/view.ts`'s `resolveRegistrationView()`** — already a pure
function, already close to T2-ready:

```ts
type RegView =
  | 'guest' | 'can_register' | 'complete_payment' | 'registered'
  | 'waitlisted' | 'full' | 'closed' | 'ended' | 'invitation_only'

function resolveRegistrationView(args: {
  status: string; loggedIn: boolean; paidCount: number; maxPlayers: number | null
  existingStatus: string | null; registrationStatus?: string | null; invitationOnly?: boolean
}): RegView
```

`components/tournament/RegistrationPanel.tsx` is the current consumer — it also reads a
`fee-waiver` check inline via `registerForTournament` (`lib/tournaments/actions.ts` lines ~144–190,
querying `tournament_fee_waivers` for the current player) and receives `coinBalance` as a prop from
its parent page (a direct `sx_coins.balance` read — **T1, no endpoint needed**, own-row RLS already
covers it per master spec §2.3).

**Consequence for the endpoint (§5.1):** this is a cheap extraction, not a refactor — wrap
`resolveRegistrationView` plus the waiver lookup plus the coin-discount config constants
(`lib/coins/value.ts`) in one route handler. No squad-specific readiness helper exists yet either;
for a squad-entry tournament the endpoint also needs `mySquad` (name, invite code, member count,
team size) — currently assembled inline in the tournament detail page, extracted alongside.

---

## 4. Finding: opponent rating has **no existing implementation anywhere in the web codebase**

CLAUDE.md's SX Score system documents "Receive 5-star opponent rating: +20" / "4-star: +10" /
"1–2 star: −20", and the master spec's §8.5 lists "rate opponent (1–5 → ±SX)" as a Phase 2 Match
Centre action, citing it as extractable ("in scoring"). It is not extractable — it doesn't exist:

- `opponent_ratings` has been a real table since the very first migration
  (`supabase/migrations/001_initial_schema.sql`, `match_id`/`rater_id`/`rated_id`/`stars 1–5`,
  `UNIQUE(match_id, rater_id)`).
- A repo-wide search for any Server Action, admin action, cron, or client component that reads or
  writes `opponent_ratings` found **exactly one hit**, `lib/exchange/stats.ts`, and it's a comment
  explaining the table is *not* used for marketplace ratings — not an implementation.
- `lib/scoring/{score,events,apply,stats}.ts` — the actual SX Score engine — has no rating-derived
  event type at all.

So this table and its documented scoring rule were apparently never shipped on web. Building
`POST /matches/{id}/rating` by "extracting" something that doesn't exist would violate the master
spec's own non-goal ("any rule that exists in TypeScript stays in TypeScript and is called, not
re-implemented in Dart") — there's nothing to call.

**Decision made here (flag for the owner if this should go the other way):** treat this as a small,
genuinely new piece of server-authoritative business logic, built once in the web repo as part of
this same Phase 2 extraction pass — **not** invented client-side in Flutter, and **not** silently
skipped. A new `lib/scoring/opponent-rating-service.ts` (`submitOpponentRating(ctx, {matchId,
stars})`) does the insert + the SX event per CLAUDE.md's table (+20 for 5★, +10 for 4★, −20 for
1–2★, no event for 3★) inside `sx_score_events`, exactly like every other score mutation. The
endpoint calls it directly; there is no existing web UI to also wire up yet (web has never shown a
rating prompt — that UI gap is real and out of scope for a web change here, matching "mobile
follows web, never leads" only for *rendering*, not for *server-side scoring correctness*, which
must exist regardless of which client calls it first).

If the owner would rather **not** ship new scoring logic inside a mobile-API-labeled PR, the
alternative is: cut `POST /matches/{id}/rating` from Phase 2 entirely, ship the rest, and open a
small web-repo spec for "opponent ratings" on its own schedule (same treatment S1 got when it was
decoupled from the mobile timeline). Either is a one-line change to this spec's §5.4 — noting the
fork here so the implementation plan doesn't have to re-derive it.

---

## 5. Endpoints (`/api/mobile/v1`)

All follow the established conventions (`defineEndpoint`, `{data}`/`{error}` envelope shared
`errorCode` strings, bearer auth via `authenticate()`, extraction pattern §7.1: a plain service
function called by both the existing Server Action/page and the new route). New service files land
beside their domain's existing `lib/<domain>/` code; new route files register in
`lib/mobile-api/endpoints/<domain>.ts` → `lib/mobile-api/endpoints/index.ts`, exactly like Phase 1.

### 5.1 Tournaments — reads

| Endpoint | Tier | Source | Notes |
|---|---|---|---|
| tournaments list/detail, entrants, stages, lobbies, matches | T1 | tables | direct PostgREST reads, already public per §2.3 |
| `GET /tournaments/{id}/standings?stage=` | T2 | `lib/tournaments/standings.ts`, `points-standings.ts`, `lib/tournaments/stage-standing.ts` | groups (`sortStandings`), points-race (`sortPointsStandings`/`stageStanding`), round-robin (single-group case of the same). Format-dispatch by `tournaments.competition_format`. |
| `GET /tournaments/{id}/bracket` | T2 | `lib/tournaments/bracket-view.ts` (`loadBracketView`), `bracket-tree.ts` | already squad-aware (`fdcfa71`, §2) — no separate "team" branch needed client-side, the response already carries squad names where applicable |
| `GET /tournaments/{id}/results` | T2 | `lib/tournaments/results.ts`, `champions.ts` | champions.ts already squad-aware |
| `GET /tournaments/{id}/registration-state` | T2 | `lib/tournaments/view.ts` (`resolveRegistrationView`) + inline waiver check from `lib/tournaments/actions.ts` + `mySquad` assembly (currently inline in the detail page) | see §3 for the correction. Response: `{ view: RegView, fee: number, feeWaived: boolean, coinDiscount: {halfEntryCoins, freeEntryCoins, nairaPerCoin}, entryUnit: 'solo'\|'squad', squadSize: number\|null, mySquad: {...}\|null }`. **Coin balance itself is not in this response** — T1 read of `sx_coins.balance`, own-row. |

### 5.2 Tournaments — writes

| Endpoint | Tier | Source | Idempotency-Key? |
|---|---|---|---|
| `POST /tournaments/{id}/register` | T3 | `lib/tournaments/actions.ts` (`registerForTournament`), schema `registrationDetailsSchema` (`displayName`, `whatsapp`, `clubName`, `ignTag`) + `coinsUsedSchema` (`'0'` / half / full, from `lib/coins/value.ts`) | **Yes** — money-creating (Paystack init) or coin-spending; a retried tap must not double-charge or double-spend coins. |
| `POST /tournaments/{id}/waitlist` | T3 | `lib/tournaments/waitlist-actions.ts` (`joinWaitlist`), same `registrationDetailsSchema` | **Yes** — state-creating (a duplicate waitlist row on retry is a real bug, not just wasted work), same reasoning as register. |
| `POST /squads` | T3 | `lib/tournaments/squad-actions.ts` (`createSquad`) | **Yes** — creates a squad + invite code; a retry must not create two. |
| `GET /squads/lookup?code=` | T2 | `lookupSquadByCode` | — (read) |
| `POST /squads/{id}/members/remove`, `POST /squads/{id}/members/move` | T3 | `removeSquadMember`, `moveSquadMember` | No — idempotent by nature (removing an already-removed member / moving to the same group is a no-op, matches the existing admin `movePlayerToGroup` precedent in the master spec which also has no key). |
| `POST /invitations/{id}/accept`, `POST /invitations/{id}/decline` | T3 | `lib/seasons/player-actions.ts` (`acceptMastersInvitation`, `declineMastersInvitation`) | No — a single invitation row transitions once; a retry after success is a no-op rejection, not a duplicate side-effect. |
| `GET /payments/{reference}` | T2 | Paystack verify (existing webhook-adjacent verify call, wrapped) | — (read; the webhook remains the source of truth per master spec §6.4 step 4, this is app-side polling only) |

### 5.3 Match Centre — reads

| Endpoint | Tier | Source |
|---|---|---|
| match, players, stream URL, check-ins, wagers | T1 | tables |
| `GET /matches/{id}/centre` | T2 | `lib/matches/participant.ts` (`isMatchParticipant`), `lib/matches/check-in.ts`, `lib/wagers/market.ts` (`wagerWindowOpen`, `WAGER_FEE_RATE`, `MIN_WAGER_STAKE=50`, `MAX_WAGER_STAKE=2000`, `WAGER_WINDOW_CLOSE_MINUTES=15`, `estimateWagerPayout`), `lib/matches/noshow-eligibility.ts` (`canMarkBothNoShow`) |

### 5.4 Match Centre — writes

| Endpoint | Tier | Source | Idempotency-Key? |
|---|---|---|---|
| `POST /matches/{id}/check-in` | T3 | `lib/matches/check-in-actions.ts` (`checkInToMatch`) | No — a check-in is a one-time flag flip; re-tapping an already-checked-in state is a harmless no-op, same class as the squad-member moves above. |
| `POST /matches/{id}/result` | T3 | `lib/matches/actions.ts` (`submitMatchResult`), schema fields `matchId`, `scoreA`, `scoreB`, `recordingUrl`, `screenshotPath` | **Yes** — the master spec's own §7.2 names "submit result" explicitly as a required-idempotency case; a flaky-network double-submit must not create two competing result rows. |
| `POST /matches/{id}/rating` | T3 | **New** — `lib/scoring/opponent-rating-service.ts` (§4) | **Yes** — writes an `sx_score_events` row; a retry must not double-award/double-penalize. |
| `POST /matches/{id}/wager` | T3 | `lib/wagers/actions.ts` (`placeWager`), schema `matchId`, `pickPlayerId`, `stakeCoins` | **Yes** — spends coins, explicitly named in §7.2. |
| `POST /lobbies/{id}/result` | T3 | `lib/tournaments/lobby-result-actions.ts` (`submitLobbyResult`), fields `lobbyId`, `screenshotPath`, `placement`, `kills` (`lobby-result-schema.ts`) | **Yes** — same reasoning as match result. |

**Rule carried forward unchanged (CLAUDE.md rule 5, master spec §5.2):** none of these writes
advance a bracket, group table, or standings themselves. `submitMatchResult`/`submitLobbyResult`
only create a *pending* result; only the existing admin confirm action (unchanged, web-only, not in
this catalogue) flips it live. The app's job is to show "submitted — awaiting confirmation," never
to optimistically render a win.

### 5.5 Dashboard fixtures (Progress & discovery, scoped down for Phase 2)

| Endpoint | Tier | Source |
|---|---|---|
| `GET /me/summary` | T2 | dashboard fixture queries (current `app/[locale]/dashboard/page.tsx` data-fetching block, not yet extracted) |

**Scope note:** the master spec's §8.6 marks the dashboard "Phase 2, extended in 6" — this endpoint
in Phase 2 returns **only** what the fixtures/registrations screen needs (next fixture + countdown,
active registrations, submit-result prompts, qualify/eliminate banner). Streak, daily-login,
quests, and wallet/coin tiles are real dashboard content on web today but belong to later phases
(§8.13 quests are Phase 5, §8.12 wallet is Phase 6) — **do not** grow this response to cover them
yet; a second, additive Phase-6 field set is cheaper than reshaping a Phase-2 contract that's
already shipped in an app binary.

---

## 6. Explicitly out of scope (and why — don't reinvent these)

- **Games list** — `GET /games` is not a new endpoint. `games` is T1 public-read (master spec
  §2.3); the Phase 2 games screen (§8.21) reads the table directly, filtering `active = true`
  client-side same as web.
- **"Minimal settings" (§8.19 Phase 2 minimal)** — no new endpoint. Per-tournament fields
  (display name, WhatsApp, club, IGN tag) are collected in the registration bottom-sheet itself
  (§8.3), not a Settings screen; language toggle and sign-out use data `GET /me` (Phase 1) already
  returns. If Phase 2 implementation finds a real gap here, it's small enough to fold into
  `PATCH /me/profile` when Phase 6 builds it properly, not worth a one-off Phase 2 endpoint.
- **Squad rendering was previously flagged out of scope — corrected in §2.** Included in §5.2.

---

## 7. Environment for Phase 2 development

Per master spec §3.2 (owner decision 2026-09-18: revisit before Phase 2) — revisited 2026-09-22.
**Owner picked option B**: a second free Supabase project as persistent staging, `sentinelx-staging`
(`ofxmoxpvwbemfouaowoa`, `eu-west-1`, same org as production `itxubrkbropttfdackmi`), $0/mo
confirmed via the org's cost-check tool before creation. The master spec's required precondition —
"a migration replay check is required before any Phase 2 write-path work" — **passed** (result
recorded at the top of this document). All 111 migrations from `origin/main` are now live on
`sentinelx-staging`, schema-identical to production (84/84 tables, 169/169 RLS policies, matching
extensions).

All write-path development and testing for the endpoints in §5 runs against `sentinelx-staging`,
never production, mirroring the Phase 1 spec's §5 testing discipline but without needing the
`zzqa_`-prefix/production-account workaround Phase 1 was forced into (Phase 1 predates this
decision). **Keeping staging in sync going forward:** every new migration merged to `origin/main`
must also be applied to `sentinelx-staging` before it's relied on for Phase 2 dev/testing — there
is no automatic sync between the two projects (master spec §3.2 option B trade-off). The
implementation plan should decide who/what applies new migrations to staging (manual step vs. a
CI job) as one of its early tasks.

Flutter `dev` flavor points at `sentinelx-staging`'s URL + anon key (not production) for the
duration of Phase 2 development; `prod` flavor is untouched. Paystack: test-mode secret key on
whatever deploys against staging (a Vercel preview env pointed at the staging project, per master
spec §3.2 option B's stated pairing) — provisioning that preview env is an implementation-plan task,
not decided here.

---

## 8. Open items carried into the implementation plan (not resolved by this spec)

1. **§4's rating decision** — build it net-new (this spec's default) vs. cut it from Phase 2. Owner
   call if the default above isn't wanted.
2. **API client generator spike** (master spec §17 Q3, `swagger_parser`+retrofit vs
   `openapi_generator`) — Flutter-side, decided in the mobile repo's implementation plan, not here.
3. **Web i18n parts 3–5** (master spec §17 Q6) — checked concretely this session, not just
   "unreverified": `app/[locale]/dashboard/**` is **0/16** files referencing `useTranslations`/
   `getTranslations`; `app/[locale]/admin/**` is **0/31**; the `(public)` route group (tournaments,
   matches, players, etc.) is **13/57**. Dashboard and admin i18n has not been started at all, not
   "needs re-verification." Size the mobile ARB work for Phase 2's dashboard/tournament/match
   screens accordingly — expect to translate from scratch, not port existing keys, for anything
   under dashboard.
4. **Vercel preview environment for staging** — needs creating and pointing at
   `sentinelx-staging` + Paystack test keys before write-path implementation tasks begin.
