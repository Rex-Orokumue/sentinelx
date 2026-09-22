# Mobile Phase 2a — Tournaments & Registration — Design Spec

**Date:** 2026-09-22
**Status:** Approved → ready for implementation planning
**Repos:** `sentinelx` (web, this repo) owns the new endpoints and the idempotency
infrastructure; `sentinelx_mobile` owns the screens
**Supersedes:** nothing. Fills in, at implementation detail, the "Tournaments — list,
detail, registration" and "Settings & account (minimal)" slices of the master spec's
Phase 2 row (`docs/superpowers/specs/2026-09-18-flutter-mobile-app-master-design.md`
§7.3 Compete/Session tables, §8.3, §8.19, §8.21, §13).
**Depends on:** Phase 0 (0A/0B/0C) and Phase 1 (auth, shell, home, static) — merged to
`main` as of `5dcbda6e9a60a2860517f572f9f7eb755e51a750`. Depends on the staging
database (§2) and the API-client-generator decision (§3), both resolved in this spec.
**Splits Phase 2:** the master spec calls Phase 2 XL, the biggest phase yet. Owner
decision 2026-09-22: split it the way Phase 0 was split — **2a** (this spec:
tournaments list/detail/registration, coin discount, waitlist, waivers, invitations,
Paystack WebView, games list, minimal settings) ships a working "browse and pay" app on
its own. **2b** (bracket/standings, Match Centre, check-in, result submission, dashboard
fixtures) is a separate spec + plan, sequenced after 2a so it can build on real
registration data.

---

## 1. Goal

Exit criterion: on the staging project, a signed-in player can browse tournaments,
register (Paystack test-mode, coin discount, or a waiver) or join a waitlist or accept a
season invitation, have the payment confirm via poll, and see the registration reflected
as paid. Idempotent retries of a registration attempt are proven not to create a second
payment. Minimal profile editing works. Squads, brackets, standings, and match flows are
explicitly out of scope (§6).

---

## 2. Environment — staging database (master spec §3.2, §17 Q0)

**Owner decision 2026-09-22: Option B — a second, persistent free Supabase project.**
Created via the Supabase MCP: `sentinelx-staging`, ref `ofxmoxpvwbemfouaowoa`, org
`slknegawjebafleisdap` (same org as production), region `eu-west-1`, $0/mo (confirmed
via `get_cost` before creation). Production stays `itxubrkbropttfdackmi`.

**Migration replay check — PASS, verified 2026-09-22.** All 109 migration files from
`supabase/migrations/*.sql` replayed cleanly against the empty staging project. Verified
directly against both projects (not inferred):

| Check | Production | Staging | Result |
|---|---|---|---|
| `public` base tables | 84 | 84 | ✅ identical set (name-for-name diff empty) |
| `public` columns | 685 | 685 | ✅ match |
| `public` RLS policies | 169 | 169 | ✅ match |
| `profiles` policies | `profiles_admin_delete`, `profiles_public_read` only | same | ✅ S1/S2 lockdown (`20260918200000_lock_down_profiles_and_write_paths`) replayed correctly |
| `authenticated` UPDATE grants on `profiles` | none | none | ✅ matches the fixed state |
| Extensions the migrations need | `pgcrypto`, `pg_cron`, `uuid-ossp` present | same | ✅ |

No re-baseline needed. Staging is fit to develop Phase 2 write-path work against as-is.

**Flavor wiring (new exit-criteria item, §7):** the mobile repo's `dev` flavor must
resolve to `ofxmoxpvwbemfouaowoa`, not the hard-coded production URL left over from the
original vertical slice (master spec §11). This is a one-line config check, not a code
review, but it is cheap to silently get wrong and expensive to discover late — a
misconfigured `dev` flavor pointed at prod defeats the entire reason staging exists, and
nothing else in this spec would catch it. Verify explicitly before any write-path testing
begins.

**Discipline:** all 2a write-path testing (registration, waitlist, invitations, coin
discount, waivers, Paystack) runs against staging with Paystack **test-mode** keys. This
is a change from Phase 1, which had no staging and tested against production with
`zzqa_`-prefixed accounts — that discipline is no longer needed for 2a's flows.

---

## 3. API client generator (master spec §17 Q3) — resolved by spike, not docs

**Decision: `swagger_parser` + `retrofit`, freezed mode.**

Resolved empirically (owner-requested real spike, not a docs comparison), against the
three stated criteria, using a 3-endpoint slice of the real `openapi/mobile-v1.json`
(`/home`, `/session/start`, `/me` — chosen to exercise a nullable nested object, a
nested object with a nullable enum, several nullable strings, and the shared
`{data}`/`{error}` envelope):

- **Freezed output (the deciding criterion):** `openapi_generator`'s `dart-dio` target
  does not use `freezed` at all — it emits `built_value`/`Serializer` boilerplate,
  structurally incompatible with the master spec's §4.1 model-layer choice.
  `swagger_parser`'s `json_serializer: freezed` mode produces exactly the intended shape.
- **Null-safety fidelity:** tie. Both tools mapped every nullable schema field (5
  nullable strings + 1 non-null bool on `me.profile`) to the correct Dart
  nullable/non-null type, with no lossy default-everything-nullable behavior observed.
- **Error envelope support:** tie, both incomplete the same way. Neither tool generates
  a discriminated `Result<T, ApiError>` — both produce a bare `Future<T>` relying on Dio
  throwing `DioException` on non-2xx. A hand-written interceptor is required either way.
  This was already the plan (§4.3 of the master spec), not new scope.

**Real prerequisite, not optional:** `swagger_parser`'s officially matched version set
(`retrofit ^4.10.0` + `retrofit_generator ^10.2.10` + `freezed ^4.0.1`) requires **Dart
SDK ≥3.12**. This machine's Flutter (stable) pins Dart at 3.11.5; `dart pub get` failed
to resolve until that's addressed. **`flutter upgrade` to a release carrying Dart ≥3.12
is a Phase 2a prerequisite task**, done once, before any codegen work starts — it is not
a per-developer inconvenience, it's a blocking version floor for the whole client.

A secondary, now-resolved compatibility gap: `retrofit_generator` releases 9.6.0–10.2.2
fail to compile against `retrofit` ≥4.8-ish (an upstream `Parser` enum exhaustiveness
gap); pin `retrofit_generator ^10.2.10`, which handles it. The OpenAPI 3.1
`anyOf: [T, {type:'null'}]` nullable pattern (present throughout the real spec) caused no
failures in either tool — not the blocker expected going in.

All spike work happened in a throwaway scratch directory; neither `sentinelx` nor
`sentinelx_mobile` was touched by it.

---

## 4. New infrastructure — `api_idempotency_keys`

Master spec §7.2 requires an `Idempotency-Key` header on money/score/state-creating
POSTs. **2a is the first phase to need this — nothing in Phase 0/1 built it.** It becomes
the reusable primitive every later money-creating write (deposit, withdraw, escrow,
wager, stake, submit result) inherits, so its recovery behavior is worth getting right
now rather than patched per-callsite later.

### 4.1 Schema

```sql
create table api_idempotency_keys (
  key text not null,
  user_id uuid not null references auth.users(id),
  route text not null,
  response jsonb,
  status_code int,
  created_at timestamptz not null default now(),  -- claim time; reset on reclaim
  completed_at timestamptz,                       -- set only when response is written
  primary key (key, user_id, route)
);
```

No RLS needed — only ever touched by route handlers via the service-role client, never
read/written directly by a client.

### 4.2 Claim → fill → reclaim helper

A shared helper (alongside Phase 0B's `defineEndpoint` scaffolding), used by any T3 POST
that declares itself idempotency-required:

1. **Claim:** `INSERT ... ON CONFLICT (key, user_id, route) DO NOTHING RETURNING
   created_at`. The returned (or observed) `created_at` is this request's **generation
   token** — carried through to the fill step below, which is what makes the fill safe
   against a concurrent reclaim.
   - Row returned → this request holds the claim, generation = the `created_at` it was
     just given → run the service function → **generation-gated fill**: `UPDATE
     api_idempotency_keys SET response = $1, status_code = $2, completed_at = now()
     WHERE key = $3 AND user_id = $4 AND route = $5 AND created_at = $ownedGeneration`.
     If this returns a row, return the response normally. **If it returns zero rows,
     this request has been superseded by a reclaim (§ below) — do not return this
     response to the caller; log it loudly instead** (the side-effecting work already
     happened for nothing — concretely, a live Paystack transaction now exists that
     nothing points at — and a rising rate of this log is the signal that the staleness
     threshold is too tight, see below).
   - No row returned → the key already exists → re-`SELECT` it and branch:
     - `completed_at IS NOT NULL` → **replay**: return the stored `response`/
       `status_code` verbatim, do not re-run the service function.
     - `completed_at IS NULL` and `now() - created_at < 30s` → a genuinely concurrent
       duplicate (double-tap, not a crash) → poll every ~500ms until either
       `completed_at` fills in (return that response) or the 30s mark is reached without
       it (fall through to the next case).
     - `completed_at IS NULL` and `now() - created_at >= 30s` → **abandoned claim**
       (the process that held it died — deploy restart, crash mid-request) →
       **reclaim** via compare-and-swap: `UPDATE api_idempotency_keys SET created_at =
       now(), response = null, completed_at = null WHERE key = $1 AND user_id = $2 AND
       route = $3 AND completed_at IS NULL AND created_at = $4 (the stale value just
       read) RETURNING created_at`. A returned row means this request now owns the
       claim — its generation token is the **new** `created_at` just written — run the
       service function and fill exactly as in the first branch, gated on that new
       generation. Zero rows means another request reclaimed it first (a rare
       double-reclaim race) — re-`SELECT` once more and either replay a completed
       response or return `409 idempotency_in_progress` (client retries shortly, **with
       the same key**, not a new one).

**Why the generation gate matters:** without it, a slow original holder (A) can finish
*after* a reclaiming request (B) has already completed and returned its own response to
the caller — A's unconditional `UPDATE ... WHERE key/user_id/route` would then silently
overwrite B's already-delivered response with A's own, stale one. Traced against the
actual `registerForTournament` code: the write to `tournament_registrations
.paystack_reference` happens *before* the call to `initializeTransaction`, and a reclaim
can only occur ≥30s after the original claim — so A's registration-row write always
lands chronologically before B's, and the live registration row itself never ends up
pointing at a dead reference. The exposure is narrower than a double payment: it's a
**stale cache entry** in `api_idempotency_keys` that would mislead a *future* replay of
the same key (or a reconciliation job) into returning A's abandoned reference instead of
the one the client actually holds and is paying through. Narrower blast radius still
means real inconsistency — hence the gate, not a shrug.

Two independent clocks, not to be conflated: the **24h TTL** (§7.2, cleanup only —
bounds table growth and the replay window) and the **30s staleness threshold** (bounds
how long a request can sit "in progress" before another attempt is allowed to take over).
TTL cleanup reuses whatever periodic-cleanup pattern the existing
`refund-abandoned-coin-discounts` cron already uses — an implementation-plan detail, not
a spec-level design fork.

**The 30s threshold is a provisional default, not a measured number.** No latency
instrumentation exists around `initializeTransaction` today (checked — no
`console.time`/timing logs in `lib/paystack/server.ts` or its callers), so there's no
real p99 to set this against yet. Before this ships: pull `initializeTransaction`'s
actual latency distribution from production (Paystack's own dashboard, or add timing to
the existing `console.error` failure-path logging so success-path timing starts
accumulating too), and **log any completion that lands within 5s of the 30s mark** —
that log firing is the early warning that the threshold is cutting it too close, visible
well before it starts manifesting as the generation-mismatch case above.

### 4.3 Where it's required in 2a

- **Required** (missing header → `400 idempotency_key_required`): `POST
  /tournaments/{id}/register`, `POST /invitations/{id}/accept` — both money-creating,
  matching §7.2's stated category, and both mint a **fresh Paystack reference on every
  call** (`buildReference()` — deliberate, so a retry isn't blocked by Paystack's
  duplicate-reference rejection), which is exactly the kind of non-idempotent-by-default
  operation this mechanism exists to protect.
- **Not required**: `POST /tournaments/{id}/waitlist`, `POST /invitations/{id}/decline`.
  Neither creates a payment obligation, and both are already naturally replay-safe in the
  existing server code — `joinWaitlist` returns a friendly "already on the waitlist"
  error on a duplicate call (checked via the `existing` row lookup); `declineMastersInvitation`'s
  `status = 'pending'` guard makes a second decline a no-op. Adding the header there
  would be ceremony without a corresponding risk.

---

## 5. Web endpoints (`/api/mobile/v1`)

All follow Phase 0B conventions (`defineEndpoint`, `{data}`/`{error}` envelope, shared
`errorCode` strings, service-function extraction per §7.1 of the master spec: the
endpoint and the existing Server Action call the *same* function). Source files below are
as of `main@5dcbda6e`.

### 5.1 `PATCH /me/profile`
- **Body:** `{displayName, username?, whatsapp?, country?, bio?, avatarUrl?}`. **Auth:** `user`.
- **Extraction:** `updateProfile()` (`lib/profile/actions.ts`) — one-time username change
  gated by `username_changed_at`, `23505` → `username_taken`, achievement unlock
  side-effect (`checkAndUnlockAchievements`) preserved.
- **Correction to the master catalogue:** §7.3 lists this endpoint as covering "country,
  locale" — the real action has **no `locale` field**. Locale isn't part of profile
  editing on web today; dropped from this endpoint's body.
- **Response:** `{ profile: ProfileSummary }`.
- **No `Idempotency-Key`** — a plain field update, not a repeatable financial/state
  mutation in §7.2's sense.

### 5.2 `GET /tournaments/{id}/registration-state`
- **Auth:** optional. Logged out: `{ feeNaira, agreementRequired, canRegister: {ok:
  false, reason: 'not_authenticated'} }` — a sentinel not produced by `checkCanRegister()`
  itself (that function assumes a known player), added at the route level since the web
  equivalent (logged-out visitors see a "log in to register" CTA, not a guard-reason
  message) has no single existing function to extract from.
- **Auth present:** composes `checkCanRegister()` (`lib/tournaments/guard.ts` — status,
  paid count vs `max_players`, existing registration status, `invitation_only`) with a
  waiver lookup (`tournament_fee_waivers`, unredeemed, this player) and coin-discount
  eligibility (`registration_fee >= 500`, no active waiver — the discount UI is dead if a
  waiver already zeroes the fee). This is a **new composition**, not an extraction of one
  existing function — documented as such.
- **Response:** `{ canRegister: {ok: true} | {ok: false, reason: 'not_open'|'full'|
  'already_registered'|'invitation_only'|'not_authenticated'}, feeNaira, hasWaiver:
  boolean, coinDiscountEligible: boolean, agreementRequired: boolean, waitlistOpen:
  boolean (status is 'registration_closed' or 'active') }`.
- No `Idempotency-Key` (GET).

### 5.3 `POST /tournaments/{id}/register`
- **Body:** `{displayName, whatsapp, clubName, ignTag?, agreedToRules: boolean,
  coinsUsed?: 0 | COINS_HALF_ENTRY | COINS_PER_ENTRY, squadId?: string}`.
- **Extraction:** `registerForTournament()` (`lib/tournaments/actions.ts`, the largest
  single extraction in this phase — 311 lines, four distinct completion branches). The
  service function preserves every branch: username-claimed gate, rules-agreement check,
  `checkCanRegister()` guard, waiver redemption (conditional `UPDATE ... WHERE
  redeemed_at IS NULL`, never check-then-update, so a raced double submit can't redeem
  the same waiver twice), zero-fee tournaments, coin discount (`NAIRA_PER_COIN`,
  `recordCoinTransaction`), and the Paystack path (`initializeTransaction`,
  `buildReference`).
- **`squadId` is accepted in the contract but rejected server-side in 2a** (`400
  squads_not_available`) — no squad tournament is offered for registration in the app
  yet; squads stay blocked until web team-vs-team phases 6/7 land (confirmed unbuilt:
  `ROADMAP.md` #21b is ⬜). The field exists now so 2b/later phases don't need a breaking
  contract change.
- **Response replaces `redirect()`:** waiver / zero-fee / coin-discount-to-zero paths →
  `{ status: 'confirmed' }`. Fee remaining after any discount → `{ status: 'pending',
  authorizationUrl, reference }` (§6.4 of the master spec: app opens this in a WebView,
  intercepts the callback, then polls `GET /payments/{reference}`).
- **Errors:** `validation_failed` (per-field, reusing `registrationDetailsSchema`'s
  messages); `username_required` (mirrors the existing `needsUsername` flag on the
  Server Action's return type — route the app to onboarding-username, then retry the
  same request); `tournament_not_found`; `rules_agreement_required`;
  `already_registered` / `tournament_full` / `invitation_only` / `registration_closed`
  (from `checkCanRegister()`'s guard reasons); `insufficient_coins`; `squads_not_available`;
  `payment_init_failed` (Paystack error, generic to the client, real cause logged
  server-side exactly as the existing `console.error` pattern does).
- **`Idempotency-Key`: required.** See §4.3.

### 5.4 `POST /tournaments/{id}/waitlist`
- **Body:** `{displayName, whatsapp, clubName, ignTag?, agreedToRules: boolean}`.
- **Extraction:** `joinWaitlist()` (`lib/tournaments/waitlist-actions.ts`) — same
  username-claimed gate and rules check as register, no payment step,
  `registration_closed`/`active` status gate.
- **Response:** `{ status: 'waitlisted' }`.
- **Errors:** same shape as register minus the payment-related codes; plus
  `waitlist_not_open`, `already_on_waitlist`.
- No `Idempotency-Key` — see §4.3.

### 5.5 `POST /invitations/{id}/accept`
- **Body:** none. **Auth:** `user`.
- **Extraction:** `acceptMastersInvitation()` (`lib/seasons/player-actions.ts`) —
  ownership check (`invitation.player_id !== user.id`), `status = 'pending'` +
  expiry check, conditional claim (`UPDATE ... WHERE status = 'pending'`, so a raced
  double-accept can't double-claim), then the same free-vs-Paystack branch as register
  (using the invitation's tournament's `registration_fee`, no coin discount — the web
  action has none for invitations).
- **Response:** same shape as register's: `{status: 'confirmed'}` or `{status:
  'pending', authorizationUrl, reference}`.
- **Errors:** `invitation_not_found`, `invitation_no_longer_available`,
  `invitation_expired`, `payment_init_failed`.
- **`Idempotency-Key`: required.** See §4.3.

### 5.6 `POST /invitations/{id}/decline`
- **Body:** none. **Auth:** `user`.
- **Extraction:** `declineMastersInvitation()` — conditional claim (`status = 'pending'`),
  then `cascadeNextInvitation()` to advance the next invitee.
- **Response:** `{ status: 'declined' }`.
- No `Idempotency-Key` — see §4.3.

### 5.7 `GET /payments/{reference}`
- **Auth:** `user`. **Not an extraction — a thin wrap.** `confirmRegistration()`
  (`lib/tournaments/confirm.ts`) is already a plain, idempotent function called by both
  the Paystack webhook and the browser-redirect callback today — no service-function
  split needed. The route calls it and returns the result.
- **Response:** `{ status: 'confirmed' | 'already_paid' | 'not_found' | 'not_successful'
  }`. The webhook remains the actual source of truth (master spec §6.4 step 4); this is
  strictly a poll for UI state, matching existing production behavior exactly.
- No `Idempotency-Key` (GET, and `confirmRegistration` is already safe to call
  repeatedly by design — every caller of this endpoint gets the same benefit the webhook
  already relies on).

### 5.8 T1 — no endpoint needed
Tournament list/detail, entrants, `games.active` list: confirmed nothing in these reads
is computed server-side. Direct Supabase reads, explicit columns, never `*`.

---

## 6. Mobile screens & flows

### 6.1 Tournament List (`/tournaments`)
Current/upcoming/past tabs, game filter, status chips, live registration countdown. T1.

### 6.2 Tournament Detail (`/tournaments/[slug]`)
Banner, prize pool + split, format/game/mode/map/rules, entrants list — T1. Registration
CTA state driven entirely by `GET /registration-state`. WhatsApp share via `wa.me`
client-side URL build (§6.6 of the master spec) — no endpoint.

### 6.3 Registration wizard (bottom sheet)
1. Per-tournament fields (display name, WhatsApp, club, IGN tag) with client-side
   validation mirroring `registrationDetailsSchema` (display name 1–60 chars, WhatsApp
   `^\+?[0-9]{10,15}$`, club 1–60, IGN optional ≤60) — purely to avoid an obvious
   round-trip; the server re-validates regardless, never trusting the client.
2. Rules agreement checkbox — shown only when `tournament.rules` is non-empty, matching
   the server's own conditional.
3. Coin-discount picker — shown only when `registration-state.coinDiscountEligible` is
   true (fee ≥ ₦500, no active waiver). Exactly three positions: `0`, `COINS_HALF_ENTRY`,
   `COINS_PER_ENTRY` — not a free-form amount, matching `coinsUsedSchema`'s three literal
   values.
4. Submit → `POST /register` with a client-generated UUID `Idempotency-Key`, generated
   once per wizard attempt and reused across retries of that same attempt (regenerated
   only if the user backs all the way out and restarts the wizard).
5. `{status: 'confirmed'}` → confirmation screen. `{status: 'pending', authorizationUrl,
   reference}` → Paystack WebView, then poll `GET /payments/{reference}` with backoff up
   to ~60s (§6.4).
6. `username_required` → route to onboarding-username, then resubmit the same wizard
   state (same idempotency key — the original attempt never reached the payment step).

### 6.4 States surfaced on the detail page
Full → waitlist CTA (`POST /waitlist`, same field wizard minus the payment step);
already registered (`already_registered`); registration closed (`not_open`);
invitation-only (`invitation_only` — directs to the dashboard invitations list, not this
form, matching the server's own rejection); fee-waived (auto-detected by
`registration-state.hasWaiver`, skips both the coin-discount step and Paystack, shown as
"Free entry — waiver applied").

### 6.5 Invitations (dashboard, not tournament-detail — matches web placement)
List of pending invitations with expiry. Accept → same confirm-or-Paystack branch as
register, using the invitation's own fee, with an `Idempotency-Key`. Decline → cascades
server-side, no client follow-up beyond showing success.

### 6.6 Games list (`/games`)
T1 read of `games.active`, category taxonomy chips (football/fighting/shooter). **Display-
only in 2a** — "notify me" (`game_interest`) is deliberately deferred: nothing in the
master spec's §8 domain list or phase table puts it in Compete Core, and a game with no
tournaments yet is a catalogue entry with no available action, not a registration flow
missing a step. Add a `POST /games/{id}/interest` endpoint later, against an actual
consumer (e.g. an admin wanting interest counts before greenlighting a game) — not
preemptively here.

### 6.7 Settings (minimal)
`PATCH /me/profile` wired to a bare-bones edit screen: display name, bio, country,
avatar upload (compressed per §6.5), one-time username change. No language switcher, no
notification prefs, no security section — those are Phase 5/6.

### 6.8 Explicitly out of scope for 2a
Bracket/standings, Match Centre, check-in, result submission, dashboard fixtures → 2b.
Squad creation/join-by-code UI → blocked on web phase 6/7 (§5.3 above). Full Settings →
Phase 6.

---

## 7. Exit criteria

- Migration replay: **done** (§2) — no longer a gate, recorded here as evidence.
- `dev` Flutter flavor confirmed pointed at `ofxmoxpvwbemfouaowoa`, not production (§2)
  — a config check, verified before any write-path testing begins.
- On staging, Paystack test mode: register (full price, coin-discounted, and
  waiver-comped paths each once) → payment confirms via poll → registration shows paid.
  Waitlist join and invitation accept/decline each exercised once.
- **Idempotency proven, not just implemented:** firing an identical `POST /register`
  request twice with the same `Idempotency-Key` returns the byte-identical stored
  response the second time — verified by asserting the returned `reference` is the same
  string both times, not merely that no error occurred. Additionally: a request held past
  the 30s staleness mark is reclaimed by a second request, and the *first* request's
  late-arriving fill is provably discarded (its generation-gated `UPDATE` affects zero
  rows) rather than silently overwriting the reclaiming request's already-delivered
  response — this is the concurrency case §4.2's design fix addresses, and it needs its
  own test, not just the sequential-replay case above.
- `flutter analyze && flutter test` clean; `npx tsc --noEmit` and `npm run test` clean on
  the web side; `openapi/mobile-v1.json` regenerated (now including the 2a endpoints) and
  the mobile repo's pinned copy updated.
- `swagger_parser`/`retrofit` Dart client generation actually runs in CI against the
  regenerated spec (not just proven in the throwaway spike).

---

## 8. Risks carried into 2a specifically

| Risk | Mitigation |
|---|---|
| `registerForTournament` extraction is the largest single service-function split so far (four completion branches, waiver/zero-fee/coin-discount/Paystack) | Existing unit tests (`actions.test.ts` if present, else added) stay the safety net per §7.1's extraction discipline; each branch gets its own contract test |
| Idempotency claim/reclaim logic is new, shared infrastructure with a financial blast radius | Generation-gated fill (§4.2) closes the found race where a slow original holder overwrites a reclaiming request's already-delivered response; concurrency-tested explicitly in the implementation plan (two simultaneous requests, same key; one request past the 30s staleness mark, asserting the superseded one's write is discarded, not just that no error occurs) before any other 2a endpoint depends on it |
| 30s staleness threshold is a provisional default, not measured against real `initializeTransaction` latency (§4.2 — no existing instrumentation to pull a p99 from) | Near-threshold completions (within 5s of 30s) logged from day one; threshold revisited against real production latency data before this infrastructure gets a second caller (deposit, withdraw, etc. in later phases) |
| Dart SDK bump (§3) is a one-time but blocking prerequisite | Sequenced as the first implementation-plan task, before any codegen work |
| `dev` flavor misconfiguration pointing at prod | Explicit exit-criteria check (§7), not assumed from "we created a staging project" |
