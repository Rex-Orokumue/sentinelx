# Mobile Phase 1 — Auth, Shell, Home, Static — Design Spec

**Date:** 2026-09-20
**Status:** Approved → ready for implementation planning
**Repos:** `sentinelx` (web, this repo) owns the new endpoints; `sentinelx_mobile` owns the screens
**Supersedes:** nothing. Extends `docs/superpowers/specs/2026-09-18-flutter-mobile-app-master-design.md` §6.1, §7.3 (Session & identity), §8.1, §8.2, §8.20, §8.22, §8.23, §13 Phase 1 row, which this spec fills in at implementation detail.
**Depends on:** Phase 0 (0A security hardening, 0B API foundation, 0C Flutter foundation) — all merged and verified 2026-09-19.

---

## 1. Goal

Exit criterion (unchanged from the master spec): a new user can sign up (email + Google),
confirm via App Link, claim a username, and land on Home; ban/retired-username checks
proven. This spec fills in the parts the master spec only catalogued: exact endpoint
shapes, the `session/start` side-effects (verified against the actual web code, not
guessed), the tab-shell/Home structure, and how static/legal page content reaches the app
without being re-typed.

**No new tables or migrations.** Every endpoint reuses existing tables (`profiles`,
`banned_identifiers`, `retired_usernames`, `player_notifications`, `homepage_banners`,
`tournaments`).

---

## 2. Finding: what `login()` and "restriction" actually do (§6.1's open task, resolved)

The master spec asked Phase 1 to "read web `login()` and confirm exactly which [side
effects] it performs." Read directly:

- **`login()`** (`lib/auth/actions.ts`) calls `supabase.auth.signInWithPassword` and
  redirects. It does **not** call `recordDailyLogin` or any restriction check.
- **`recordDailyLogin(admin, userId)`** (`lib/login/actions.ts`) is called from
  `app/[locale]/dashboard/page.tsx` — on **every dashboard render**, not at login. It is
  idempotent per WAT calendar day (`nextLoginState`): coins (+5, `daily_login`), XP (+20),
  and a login-streak bump, with bonus coins/XP at 7-day and 30-day streak milestones.
- **"Restriction/suspension checks"** is `lib/settings/restriction.ts`'s
  `assertNotPendingDeletion`, called at *write time* (e.g. registering for a tournament) to
  block an account pending deletion from taking on new obligations. It does **not** run at
  login or dashboard load. The web nav session (`lib/nav/session.ts`) merely reads
  `deletion_requested_at` so the header can show a "scheduled for deletion" banner —
  **nothing auto-cancels a pending deletion by signing in.**
- There is **no separate account-level suspend/ban boolean** anywhere in the schema. The
  only account-level restriction is deletion-pending; the only conduct enforcement is
  `admin_flags` (SX Score penalties), which doesn't block sign-in.

**Consequence for `/session/start`:** it stands in for "first screen the user sees each
session" (Home, since the app has no dashboard-on-every-visit equivalent). It runs
`recordDailyLogin`'s logic and returns what happened, plus `deletionRequestedAt` so Home
can render the same restriction banner the web header does. It is called once per app
process after a session exists (fresh login, fresh signup-confirm, or cold start with an
already-persisted session) — **not** on every foreground resume; the web equivalent is
"once per day," not "once per screen visit," and `recordDailyLogin` is already
day-idempotent so an accidental extra call is harmless, just pointless.

---

## 3. Web endpoints (`/api/mobile/v1`)

All follow the Phase 0B conventions (`defineEndpoint`, `{data}`/`{error}` envelope,
`errorCode` strings shared with web forms, service-function extraction per §7.1: the
endpoint and the existing Server Action/page call the *same* function).

### 3.1 `POST /auth/signup`
- **Body:** `{ username: string, email: string, password: string, ref?: string, locale?: 'en'|'fr'|'pcm' }`
- **Extraction:** `signup()`'s body (blocklist check, retired-username check,
  `supabase.auth.signUp` with `{username, ref?}` metadata, locale seed) moves into a service
  function `lib/auth/signup-service.ts` called by both the Server Action (which still reads
  `locale` from the `NEXT_LOCALE` cookie) and this route (which takes `locale` from the
  request body — the app has no cookie to read).
- **Auth:** `public`. Uses a bare anon-key Supabase client (like `authenticate()`'s pattern
  minus the bearer token) to call `auth.signUp` — there is no user yet.
- **Response:** `{ ok: true }`.
- **Errors:** `validation_failed` with `fields.username`/`fields.email`/`fields.password` for
  zod failures; `blocked_details` (ban-evasion, deliberately generic — no blocklist
  probing); `username_taken` (retired username); `signup_failed` (Supabase error, logged
  server-side with the real cause per the existing `console.error` pattern).
- **No `Idempotency-Key`.** `auth.signUp` is already the guard against a double signup
  (second attempt errors distinctly); nothing here is a repeatable financial/state mutation
  in the sense §7.2 requires idempotency for.

### 3.2 `POST /auth/resend-confirmation`
- **Body:** `{ email: string }`. **Auth:** `public`. Wraps `resendConfirmation()` verbatim
  (neutral response either way; rate-limit errors swallowed, others logged).
- **Response:** `{ ok: true }`.

### 3.3 `POST /auth/request-reset`
- **Body:** `{ email: string }`. **Auth:** `public`. Wraps `requestReset()` verbatim (neutral
  response regardless of whether the account exists).
- **Response:** `{ ok: true }`.

### 3.4 `POST /session/start`
- **Body:** none. **Auth:** `user`.
- **Extraction:** `recordDailyLogin` changes from `Promise<void>` to
  `Promise<DailyLoginResult>` (`{ awardedToday: boolean, coinsAwarded: number, xpAwarded:
  number, streak: number, milestone: 'week' | 'month' | null }`) — a pure extension, not a
  behavior change. The one existing call site (`dashboard/page.tsx`) ignores the return
  value (unchanged rendering); `lib/login/actions.test.ts`'s existing assertions are
  extended to check the new return shape, not rewritten.
- Also selects `deletion_requested_at` in the same profile read `recordDailyLogin` already
  does (one extra column, no extra query).
- **Response:** `{ dailyLogin: DailyLoginResult, deletionRequestedAt: string | null }`.

### 3.5 `POST /onboarding/username`
- **Body:** `{ username: string }`. **Auth:** `user`.
- **Extraction:** `claimUsername()`'s body (existing-username check, retired-username check,
  update) moves into a service function called by both the Server Action and this route.
- **Response:** `{ username: string }`.
- **Errors:** `validation_failed` (`fields.username`, reusing `usernameSchema`'s codes) or
  `username_taken`.

### 3.6 `GET /home`
- **Auth:** `public` (`optionalAuth` — the web home page is visible logged out).
- **Extraction:** the current homepage's `Promise.all` data-fetching block
  (`app/[locale]/page.tsx`) — banners, featured/upcoming tournaments, top-5-by-wins
  leaderboard preview, prize total, player/tournament counts, hall-of-fame teaser via the
  existing `fetchChampions`/`latestChampion` — moves into `lib/home/summary.ts`, a plain
  function `buildHomeSummary(supabase)`, called by both the page and this route. This is
  simple direct-query composition (not a T2 standings-engine case); the extraction is
  mechanical.
- **Response:** `{ banner: {title, imageUrl, linkUrl} | null, featuredTournament: TournamentCard | null, upcomingTournaments: TournamentCard[], leaderboardTeaser: LeaderboardRow[], hallOfFame: HallOfFameTeaserData | null, stats: {playerCount, tournamentCount, prizesPaidOut} }`.
- **Cache:** `public, s-maxage=30, stale-while-revalidate=120` (matches the pull-to-refresh
  UX; short enough that a fresh tournament/banner shows up quickly).

### Out of scope for Phase 1
`change-email`, `unlink-google` (master catalogue's Session & identity table) — both belong
to Settings, which Phase 1 doesn't build. `POST /uploads/sign`, `/devices` DELETE-on-token
edge cases — already shipped in Phase 0B, untouched here.

---

## 4. Mobile screens & flows

### 4.1 Auth & onboarding
Login, Signup wizard (username → email → password; live availability is a debounced T1
`profiles.username` lookup, not a new endpoint; `?ref=` prefills from a deep link), Check
your email + resend, Forgot password, Reset password, Google sign-in button on Login and
Signup, Onboarding username. **No onboarding-phone screen** — see §4.4.

### 4.2 Email links / App Links
`app_links` package (listed in the master spec's dependency table, not yet wired — Phase 0C
only claimed `/tournaments` in the manifest and verified `assetlinks.json`). Manifest adds
`/auth/confirm`. A dedicated handler (`lib/core/auth/email_link_handler.dart`) intercepts
`/auth/confirm?token_hash=&type=&next=` before the normal `resolveWebLink` path-only
redirect, calls `supabase.auth.verifyOtp({type, tokenHash})` directly (Tier 1 — Supabase
Auth, no endpoint), then routes: `type=recovery` → Reset Password screen; otherwise →
onboarding-gate resolution → Home. Without the app installed, the existing web
`/auth/confirm` route handles it unchanged (nothing on the web side changes).

### 4.3 Google Sign-In
Native `google_sign_in` → `supabase.auth.signInWithIdToken`. Requires an **Android OAuth
client** (package `ng.com.sentinelxesports.app` + the release/debug SHA-1) registered in
the same Google Cloud project backing Supabase's existing Google provider — an **owner
setup step**, same pattern as Phase 0C's `ANDROID_CERT_SHA256` ask. The implementation plan
calls this out explicitly rather than blocking on it; the debug-keystore SHA-1 from Phase
0C's assetlinks task can be reused for the dev build.

### 4.4 Onboarding phone — deliberately not built
`ENFORCE_PHONE_VERIFICATION` is `false` (`/config.enforcePhoneVerification`); the gate never
routes there. Building the screen now would be dead code. **Tripwire:** do not flip
`enforce_phone_verification` to `true` in any environment until a mobile app version has
shipped the onboarding-phone screen — flipping it today would strand any signed-in app user
whose gate now points at a route that doesn't exist. Recorded here and in the mobile
`CLAUDE.md` housekeeping step of the implementation plan.

### 4.5 Shell & navigation
Bottom tab bar exactly as the master spec: **Compete · Watch · Community · Trade ·
Account** (`StatefulShellRoute`, 4 branches + Account — no more, no fewer). Compete's root
reuses the existing `TournamentListScreen` unchanged. Watch/Community/Trade show the
`coming-soon` treatment driven by `/config.features`. Account: sign-in prompt when logged
out (entry point to Login/Signup); minimal profile row + sign out when logged in (full
Settings is a later phase — no language switcher yet, matching §6.8's "device locale →
`en`/`fr` fallback" default with no in-app override UI in Phase 1).

**Home is not one of the 5 tabs** — the master spec lists exactly 5 (4 pillars + Account),
and on web, Home is explicitly the funnel-in page, not a pillar. Home is a standalone route
outside the tab shell: the app's initial screen at cold start, reachable from any tab via a
tappable logo in that tab's app bar. **Phase 5 note:** when the push/bell deep-link
resolver (`resolveWebLink`, extended for notification `link` values) is built, it must map
web path `/` to this same standalone Home route, not into any tab branch — recorded here so
Phase 5's author doesn't have to re-derive the shell structure.

**Header bells:** a live unread-count badge, not the full drawer. A single disposable
Realtime subscription per screen (not the general-purpose `RealtimeManager` from master
spec §6.3 — that's Phase 5's job, once DMs/feed/bell give it three real consumers to design
against). Both counts read `player_notifications` (T1) — DM-unread already piggybacks on
that same table on web (`lib/nav/session.ts`: `type = 'direct_message', read = false`), so
no `dm_threads` read is needed. Tapping either bell routes through the existing
`coming-soon` pattern — one deferred-feature UI in the app, not a bespoke second one.

### 4.6 Static/legal pages
Phase 0C hand-wrote a minimal `app_en.arb`; the "ARB generated from
`messages/{en,fr,pcm}.json`" script (master spec §6.8) doesn't exist yet. This phase builds
it: a script that flattens the web repo's `messages/en.json`/`fr.json` namespaces (`terms`,
`privacy`, `refundPolicy`, `rules`, `communityRules`, `safety`, `escrow`,
`tournamentGuide`, `tournamentFaqs`, `about`, `contact`, `help`, `howItWorks`,
`legalCommon`, plus `auth`/`home`/`nav`/`common` for the screens in this phase) into ARB
entries. These namespaces are flat `sNHeading`/`sNP1`-style keys (confirmed: `terms` is
~6.8KB, `about` ~2.9KB as JSON — ARB-sized, not markdown files). A generic
`StaticPage` widget (mirrors web's `LegalDocShell`: sticky ToC, anchored sections) is
driven by a small per-page ordered list of section keys, rendered via `flutter_markdown`.
`pcm` stays deferred (Phase 0C's documented Material-delegate gap — Flutter's localization
delegates don't support it yet); static pages fall back to `en` for `pcm` like every other
string.

---

## 5. Testing discipline (no staging database — owner decision, standing)

The Supabase Pro upgrade (branching) is **deferred indefinitely, not cancelled** — no fixed
revisit date, and this phase must not re-raise it as a blocker. Phase 1 write-path testing
runs against production with the following discipline, since this phase — unlike Phase
0B's read-mostly endpoints — exercises the *actual* signup/confirmation/onboarding path:

- **Non-signup testing** (home, existing read screens, anything not exercising signup
  itself): reuse the already-seeded test accounts. Do not create new ones.
- **Signup/onboarding/confirmation testing** requires the real path end to end — that's the
  point of this phase. Every test account's username is prefixed **`zzqa_`**, unmistakably
  synthetic. Confirmation emails use plus-addressed emails off an inbox the owner controls
  (provided out of band), so confirmation links are real and clickable.
- **`TESTING-NOTES.md`** in the mobile repo root tracks every `zzqa_` account created during
  Phase 1 testing (username, date, what it verified) — a running list, not scattered across
  commit messages.
- Each test account is cleaned up via the existing `anonymise_account` RPC once its flow is
  verified — synthetic accounts must not accumulate in `profiles` or `retired_usernames`.

---

## 6. Exit criteria

Unchanged from the master spec: a new user can sign up (email + Google), confirm via App
Link, claim a username, and land on Home; ban/retired-username checks proven (negative-path
`zzqa_`-prefixed tests per §5). `flutter analyze && flutter test` clean; `npx tsc --noEmit`
and `npm run test` clean on the web side; `openapi/mobile-v1.json` regenerated and the
mobile repo's pinned copy updated.
