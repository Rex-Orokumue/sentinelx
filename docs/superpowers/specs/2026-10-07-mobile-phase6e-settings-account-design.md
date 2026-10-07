# Mobile Phase 6e — Settings and account completion (design)

Status: **draft for owner review (2026-10-07)**. No plan and no code yet.
Mobile master spec §8.19 is the product source; §14 (Apple 5.1.1(v) account deletion) and the Phase 1
`enforce_phone_verification` tripwire are the deadlines it serves. Ground truth below was read from the web
repo `main` on 2026-10-07. This spec is the web-side contract and the mobile design (same convention as 5c).

Phase 6 is decomposed (owner approved the order 2026-10-07): **6e Settings → 6d Referrals → 6a Wallet →
6b Coins/store/XP → 6c Friends and friendlies.** This file is 6e only.

## 1. Goal and scope

Complete the Flutter Settings surface to web parity:

- Language (en / fr / pcm).
- Security: change email (current password required), set or reset password.
- Sign-in methods: link and unlink Google.
- Phone verification, both as a Settings screen and as the `/onboarding/phone` gate screen.
- Account and data: delete account (15-day grace, cancel, delete now).
- A Settings hub on the Account tab that also links the existing profile edit and notification screens.

Owner decisions (2026-10-07): (a) whole of §8.19 in one phase, not a compliance-only first cut;
(b) Google **link** from the app through a browser OAuth round-trip (not unlink-only); (c) `pcm` is
shipped in the app (new `app_pcm.arb`), not deferred.

Out of scope: KYC/payout (§8.12, Phase 6a), changing the phone number without re-verifying, admin tooling,
iOS URL scheme and usage strings (Phase 10), flipping `enforce_phone_verification` (owner decision, §7).

## 2. Ground truth (web, `main`)

| Fact | Where |
|---|---|
| Profile edit (display name, bio, country, avatar, one-time username change) is already served by `PATCH /me/profile` through `performUpdateProfile`. **It has no locale field.** | `lib/profile/update-profile-service.ts` |
| Locale on web is saved by `POST /api/locale`: validates against `LOCALES`, writes `profiles.locale` with the service role, sets a `NEXT_LOCALE` cookie. A cookie is meaningless to the app. Mobile-API has no locale route. `/me` already returns `locale`. | `app/api/locale/route.ts`, `endpoints/me.ts` |
| Deletion: `requestAccountDeletion` (confirm `DELETE`, guards, sets `deletion_requested_at`, emails), `cancelAccountDeletion` (nulls it where `deleted_at is null`, emails), `deleteAccountNow` (typed username, `executeDeletion`). 15-day grace; a cron (`/api/cron/execute-account-deletions`) executes due requests. | `lib/settings/account.ts`, `grace.ts`, `deletion-service.ts` |
| Deletion blockers (all returned at once): `wallet_balance`, `pending_withdrawal`, `open_escrow_order`, `active_listing`, `active_tournament`, `unfinished_match`, `unfinished_friendly`. Coins never block (forfeited). | `lib/settings/deletion-guards.ts` |
| Phone: `requestPhoneCode` parses the number against the player's own country, 60 s resend cooldown (row `created_at`), code 6 digits, hash stored, 10 min expiry, 5 attempts. `confirmPhoneCode` writes `phone` and `phone_verified_at` together, unlocks achievements, deletes the pending row. | `lib/phone/actions.ts` |
| **`sendWhatsAppOtp` returns `{ ok:false, skipped:true }` when the WhatsApp token or phone-number id is unset, and `requestPhoneCode` treats that as success.** With no keys the player is told a code was sent and never gets one. | `lib/notifications/whatsapp-cloud-api.ts:17`, `phone/actions.ts:64` |
| Email change: password is verified first through a throwaway client (`verifyPassword`), then ban blocklist (`isIdentifierBanned`), then `auth.updateUser({ email })`; nothing changes until the link in the new inbox is clicked. Error codes: `password_required`, `invalid_email`, `not_logged_in`, `same_email`, `wrong_password`, `google_only`, `email_banned`, `email_in_use`, `failed`. A rate-limit error means a link is already in flight and is reported as sent. | `lib/auth/actions.ts` `changeEmail` |
| `hasPasswordIdentity` is a hint, not truth: setting a password through the reset flow does **not** create an `email` identity (4 live accounts are in that state). `verifyPassword` is the real gate. | `lib/auth/reauth.ts` |
| Unlink Google: **requires the current password** (`password_required`, `wrong_password`), refuses if fewer than 2 identities (`last_identity`), `not_linked`, `unavailable` when the project's Manual Linking toggle is off (`manual_linking_disabled`), then `signOut({ scope: 'others' })` so the other party's sessions die. | `lib/auth/identities.ts` |
| Mobile already signs in with native Google (`signInWithIdToken`, `google_sign_in`). | mobile `auth_repository.dart` |
| Mobile locales: `app_en.arb` (1372 lines) and `app_fr.arb` (1168). No `pcm`. Web has `messages/pcm.json` at the same size as `en.json`. | `lib/core/l10n/`, `messages/` |
| Mobile `/me` returns `deletion_requested_at` and `kyc_verified`, but not a phone state or sign-in methods. | `endpoints/me.ts:98` |

## 3. Design

### 3.1 Service layer

Each web server action's logic moves into a service taking `{ admin, supabase, userId }` (conventions §7.1);
the server action and the new endpoint both call it. Characterization tests are written **before** moving
code. Web behaviour does not change except where 3.3 and 3.5 say so.

- `lib/settings/deletion-service.ts` gains `requestDeletion`, `cancelDeletion` (alongside the existing
  `executeDeletion`).
- `lib/phone/service.ts` (new): `requestCode`, `confirmCode`.
- `lib/auth/email-change-service.ts`, `lib/auth/unlink-google-service.ts` (new): bodies of `changeEmail` and
  `unlinkGoogle` with the cookie client replaced by the caller's user-scoped client.
- `lib/profile/locale-service.ts` (new): validate against `LOCALES`, write `profiles.locale`.

The user-scoped client matters: `updateUser`, `getUserIdentities`, `unlinkIdentity` and `signOut` act on a
session, so the endpoint passes `ctx.supabase` (the bearer-bound client the profile PATCH already uses).
Writes that the web does with the service role stay on `ctx.admin`, with the id from `ctx.userId`, never the body.

### 3.2 Endpoints (`lib/mobile-api/endpoints/account.ts`)

All `auth: 'user'`. Errors use the existing envelope with a stable `code`; the app maps codes to ARB, never
shows server prose.

| Operation | Method and path | Request | Response |
|---|---|---|---|
| `getMyAccount` | `GET /me/account` | none | `{ deletion: { requestedAt, dueAt, daysRemaining } \| null, signIn: { email, pendingEmail, passwordIdentity, google }, phone: { masked, verifiedAt } \| null, locale }` |
| `requestAccountDeletion` | `POST /me/deletion` | `{ confirm: 'DELETE' }` | `{ requestedAt, dueAt }`; 409 `deletion_blocked` with `blockers[]` |
| `cancelAccountDeletion` | `DELETE /me/deletion` | none | `{ ok: true }` |
| `deleteAccountNow` | `POST /me/deletion/execute` | `{ username }` | `{ ok: true }`; 400 `username_mismatch`; 409 `deletion_blocked` |
| `requestPhoneCode` | `POST /me/phone/code` | `{ phone }` | `{ expiresAt, resendAt }` |
| `confirmPhoneCode` | `POST /me/phone/confirm` | `{ code }` | `{ verifiedAt }` |
| `changeMyEmail` | `POST /me/email` | `{ email, password }` | `{ sentTo }` |
| `unlinkGoogle` | `DELETE /me/identities/google` | `{ password }` | `{ ok: true }` |
| `setMyLocale` | `PUT /me/locale` | `{ locale: 'en' \| 'fr' \| 'pcm' }` | `{ locale }` |

Notes:

- **`GET /me/account` is the only new read.** `phone.masked` never returns the number (last 2 to 4 digits
  only). `signIn.passwordIdentity` is the `hasPasswordIdentity` hint and is documented as such: `false` does
  not prove there is no password, so the app words that state as "set or reset a password" rather than
  "you have no password".
- **Idempotency.** `POST /me/deletion` and the phone code endpoint are naturally idempotent (overwrite the same
  row / same timestamp pattern); no `Idempotency-Key` required. `deleteAccountNow` is terminal; a retry after
  success returns 401 because the user no longer exists, which the app treats as success once it has seen the
  request go out.
- **Set password** adds no endpoint: the app calls the existing `POST /auth/request-reset` (`postAuthRequestReset`).
  The link lands in the current inbox, which is what proves ownership.
- **Link Google** adds no endpoint: it is a Supabase client `linkIdentity` browser round-trip (auth operation,
  not a PostgREST write). Prerequisite: **Manual Linking enabled** in the Supabase project and the app's
  redirect URL allowlisted, on staging and production (§7).
- **Profile edit** needs no change.

### 3.3 Corrections to earlier assumptions (deliberate)

1. **Locale needs its own endpoint** (`PUT /me/locale`). The master spec (§8.19 and the `PATCH /me/profile` row) implies `PATCH /me/profile`
   carries it, but the code says it does not (`update-profile-service.ts` comment), so extending that schema
   would also change the web profile action's contract. A small dedicated route is cheaper and safer.
2. **Unlink needs the current password**, which my first sketch of the endpoints left out. The endpoint mirrors the web.
3. **OTP delivery must not report false success.** The API differs from the web action on purpose: if
   `sendWhatsAppOtp` returns `skipped`, `POST /me/phone/code` writes **no** verification row and answers
   503 `phone_unavailable`. The web action keeps its current behaviour (changing it is out of scope here) but
   gets a test pinning the difference. Without this, turning on `enforce_phone_verification` while WhatsApp is
   unconfigured silently strands every player at a code that never arrives.

### 3.4 Errors (stable codes)

`deletion_blocked` (409, with `blockers: [{ code, amount? | count? }]`), `username_mismatch`, `confirm_required`,
`phone_invalid`, `phone_cooldown` (429, with `retryAfterSeconds`), `phone_code_missing`, `phone_code_expired`,
`phone_code_wrong`, `phone_attempts_exceeded`, `phone_unavailable` (503), plus the email-change codes in §2,
plus `not_linked`, `last_identity`, `linking_unavailable`, `wrong_password`, `password_required`,
`locale_invalid`. Messages are English fallbacks only.

### 3.5 Abuse and cost (flagged, not silently fixed)

- **OTP pumping.** The web caps only by a 60 s resend cooldown and 5 wrong attempts per code; there is no daily
  cap, and each send costs a WhatsApp template message. Proposal: a per-user cap (10 codes / 24 h, count then
  insert as the existing chat limiter does) inside the shared service, which also covers the web. Owner call
  because it changes web behaviour.
- **Password probing.** `POST /me/email` and `DELETE /me/identities/google` accept a password, so each is a
  password-guess oracle for a stolen session. Proposal: reuse the same sliding-window limiter as the chat route,
  keyed `reauth:<userId>`, 5 attempts / 15 min, on both endpoints and not on the web actions (they already sit
  behind Supabase's own sign-in rate limit through `signInWithPassword`).
- Deletion endpoints are low-frequency and self-limiting (state flip, guards).

### 3.6 Mobile structure

Routes (Account tab is the hub; sub-screens push over the shell):

| Path | Screen |
|---|---|
| `/account` | Hub: Profile, Notifications, Language, Security, Sign-in methods, Phone, Delete account |
| `/account/profile` | Existing edit-profile screen, re-linked |
| `/account/notifications` | Existing, unchanged |
| `/account/language` | en / fr / pcm picker |
| `/account/security` | Change email, set or reset password, pending-address row |
| `/account/sign-in-methods` | Password hint row, Google link and unlink |
| `/account/phone` | Number, then 6-digit code with resend countdown, then verified |
| `/account/delete` | Pending state with countdown and Cancel; otherwise DELETE confirm and delete-now |
| `/onboarding/phone` | Gate version of the phone screen on the same widgets |

Providers beside the feature (`lib/features/account/…`), reading through `ApiClient`; screens never construct
repositories. A `MyAccountRepository` seam over `ApiClient` carries the new operations; the five new operation
ids go in `ApiClient.pendingContractOperations` until `api/openapi.json` is re-pinned, then into `usedOperations`.

- **Pending-deletion banner:** app-wide, driven by `/me` (`deletion_requested_at`) with days left and a Cancel
  action. Cancel refetches `/me` and `/me/account`.
- **After delete-now:** the app clears local state, signs out and routes to `/login` (the server has already
  deleted the auth user, so the sign-out call is best effort). After a scheduled deletion the session continues.
- **Language:** `localeProvider` seeded from `/me.locale` and cached in `LocalKv` so the first frame is right.
  Changing it calls `PUT /me/locale` and updates the cache optimistically with rollback on failure. `pcm` is
  registered as a supported locale with a custom `LocalizationsDelegate` that falls back to `en` for Flutter's own
  widgets (Material and Cupertino ship no `pcm`); app strings come from `app_pcm.arb` generated by
  `tool/gen_l10n_from_web.dart`. A missing key in `pcm` or `fr` falls back to `en`, never to a blank.
- **Google link:** `linkIdentity` opens a custom tab with a custom-scheme redirect (Android intent filter now,
  iOS in Phase 10). A cancelled round-trip shows no error. A completed link refetches `/me/account`.
  `linking_unavailable` renders a plain "not available right now" row, not a retry.
- **Unlink and change-email:** a password sheet; wrong password stays on the sheet with an inline message.
  After unlink, the other sessions are already revoked server-side; the app only refreshes `/me/account`.
- **Phone:** the screen shows the masked number once verified. The resend button is driven by `resendAt` from
  the server, not a client timer alone. `phone_unavailable` shows "Verification is unavailable right now. Try
  again later." and offers no retry loop. The gate version has no skip.
- **Copy:** all strings from ARB. New strings are added to the web `messages/en.json` (and fr, pcm) first and
  regenerated, per CLAUDE.md. Server codes map to ARB keys; unknown codes map to a generic failure.
- **Tripwire:** `/onboarding/phone` ships here. `enforce_phone_verification` stays off until an app version
  containing it is released and the owner flips it (§7).

## 4. Rulings (cost if wrong)

| Ruling | Cost if wrong |
|---|---|
| One new read (`/me/account`) rather than extending `/me` | Low. `/me` is on every cold start; a settings-only read keeps it light. |
| Locale gets `PUT /me/locale`, not a `PATCH /me/profile` field | Low. Merging later is a compatible change. |
| `phone_unavailable` instead of false success | Low on the web (unchanged); fixes the strand risk on mobile. |
| Password on unlink, matching the web | Low. Weaker would let a borrowed session lock out a real owner. |
| Custom locale `pcm` with `en` framework fallback | Medium. Date pickers show English; revisit if Flutter ships `pcm`. |
| Re-auth limiter on mobile endpoints only | Low. Easy to extend to the web actions. |

## 5. Stages (each stops at a checkpoint, as in 5a/5b/5c)

1. **Web A — services and characterization tests**, no endpoint changes.
2. **Web B — endpoints, OpenAPI, tests**; migrations only if the OTP daily cap needs one (no new table: it can
   count `phone_verifications` history only if rows are kept, otherwise a small `phone_code_events` table is
   needed; decided in the plan). Staging first.
3. **Mobile C — ARB/pcm, locale provider, hub, language, security, sign-in methods.**
4. **Mobile D — phone screens and gate route, deletion screens and banner.**
5. **Verification:** staging passes with `zzqa_` accounts, then the owner's device pass.

## 6. Tests

- Web: characterization tests for each extracted action; endpoint tests for success and each error code;
  OpenAPI parity test; `phone_unavailable` pinned against the web action; limiter tests; locale rejects unknown
  values; `GET /me/account` never returns an unmasked number.
- Mobile: repository fakes and widget tests per screen; error-code to copy mapping test; locale fallback test
  (`pcm`, missing key); banner shows only for pending deletion; delete-now signs out; OpenAPI drift check.

## 7. Not verifiable in this phase, and owner actions

- **Phone OTP end to end** needs the WhatsApp Cloud API token and phone-number id on the environment under test.
  If staging has none, the OTP path is only provable against production with the owner's own number (a write to
  a real account; owner to approve).
- **Google link** needs Manual Linking on, the redirect URL allowlisted, and a staging test with a Google account
  that is not already used.
- **`enforce_phone_verification`** stays off until a shipped app has `/onboarding/phone`.
- **Account deletion** must only be exercised against staging with `zzqa_` accounts; never production.
- **Apple 5.1.1(v)** is met by the in-app deletion screen, but needs the real iOS build (Phase 10) to confirm.

## 8. Owner decisions (resolved 2026-10-07)

All three scope decisions in §1 were made by the owner during brainstorming. Open for review: the OTP daily cap
and the re-auth limiter in §3.5 (both change or add behaviour).
