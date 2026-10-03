# Mobile profile-onboarding API — final web contract

Answers `2026-10-03-mobile-profile-api-blockers.md`. Every blocker in it is resolved.

## Where it is

| | |
|---|---|
| Web branch | `worktree-game-designer-mode-catalogue-ui` (rebased onto `origin/main` `b3cae26`) |
| Contract commit | `5ae53a0` — atomic completion + the contract; `3350b43` adds the missing route file; `5f911ba` adds the route-file ratchet test |
| OpenAPI | `openapi/mobile-v1.json` is regenerated and committed in `5ae53a0`; re-running `npm run openapi` on the branch tip produces no diff |
| **Merged to `origin/main`?** | **No — not yet.** The branch also carries the web onboarding gate that every web user will hit, so the merge waits for the owner's go-ahead. |
| **Live on production?** | **No.** The endpoint does not exist on `sentinelxesports.com.ng` until the merge deploys. Production database migrations are also **not** applied yet (see below). |
| **Staging database** | **Yes.** Both migrations are applied to `sentinelx-staging` (`ofxmoxpvwbemfouaowoa`). |

Mobile can copy `openapi/mobile-v1.json` from the branch now and build against it. Anything that has to
call the real endpoint needs the merge + production migration first.

## Endpoints

### `GET /api/mobile/v1/me` — operationId `getMe` (changed)

`profile` gains three fields. All three are always present when `profile` is non-null.

| Field | Type | Meaning |
|---|---|---|
| `profileCompletedAt` | `string \| null` (ISO-8601) | **Server-owned onboarding gate input.** `null` = the player has not completed the compulsory profile step. |
| `consentWhatsappUpdates` | `boolean` | Stored value, never coerced. |
| `gameInterests` | `string[]` (UUIDs) | Game ids the player picked. Empty before onboarding. |

```json
{ "data": { "id": "…", "email": "…", "roles": [], "isStaff": false, "isAdmin": false,
  "profile": { "username": "qa2bplayer1", "displayName": "QA Player One", "avatarUrl": null,
    "whatsappNumber": "+2348012345678", "country": "Nigeria", "locale": "en", "membershipTier": "recruit",
    "kycVerified": false, "deletionRequestedAt": null,
    "profileCompletedAt": "2026-10-03T15:47:47.857216+00:00",
    "consentWhatsappUpdates": false,
    "gameInterests": ["74db07fa-e711-4e78-a982-2863a45137f1"] } } }
```

An incomplete player returns the same shape with `"profileCompletedAt": null`, `"gameInterests": []`.

### `POST /api/mobile/v1/onboarding/profile` — operationId `postOnboardingProfile` (new)

Authenticated (bearer). **No `Idempotency-Key` needed** — replaying the same body is safe (it replaces, and
the original completion time is kept).

Request — all four fields required:

```json
{ "country": "Nigeria",
  "whatsapp": "0801 234 5678",
  "consentWhatsappUpdates": false,
  "gameInterests": ["74db07fa-e711-4e78-a982-2863a45137f1"] }
```

- `consentWhatsappUpdates` must be a JSON **boolean**. `"true"`, `1`, `null` or a missing key are rejected;
  `false` is an explicit "no" and is stored as `false`.
- `gameInterests`: at least one UUID.
- `country`: the English country name (`"Nigeria"`, `"South Africa"`), an ISO-3166 alpha-2 code (`"NG"`) or a
  known alias (`"Nigerian"`). It is stored exactly as sent, so prefer the English name — that is what the web
  form stores. Anything that names no known country is rejected (it does **not** fall back to Nigeria).
- `whatsapp`: free-typed, validated against the **selected country's** numbering plan and stored as E.164.
  A number starting with `+` is self-describing and the country is ignored for parsing.

Success — `200`:

```json
{ "data": { "profileCompletedAt": "2026-10-03T15:47:47.857216+00:00" } }
```

Use that value (or re-fetch `/me`) to open the app's gate.

**Atomic:** the profile fields, the game-interest replacement and the `profileCompletedAt` stamp commit in one
database transaction (`complete_profile_onboarding()`). If anything fails, nothing is written — in particular a
completed profile can never end up with zero interests.

Errors use the standard envelope. Validation failures are `400` with `code: "validation_failed"` and
`error.fields` keyed by request field name:

| HTTP | `error.code` | `error.fields` | When |
|---|---|---|---|
| 400 | `validation_failed` | `gameInterests: "Select at least one game"` | empty list |
| 400 | `validation_failed` | `gameInterests: <zod message>` | an id that is not a UUID |
| 400 | `validation_failed` | `gameInterests: "One of the selected games does not exist."` | well-formed UUID, no such game |
| 400 | `validation_failed` | `consentWhatsappUpdates: "Invalid input"` | missing, or not a boolean |
| 400 | `validation_failed` | `country: "Select a valid country."` | unrecognised country |
| 400 | `validation_failed` | `whatsapp: "Enter a valid WhatsApp number for the selected country."` | number invalid for that country |
| 400 | `validation_failed` | `country` / `whatsapp`: `"Select your country"` / `"Enter your WhatsApp number"` | blank |
| 401 | `unauthorized` | — | no/invalid bearer |
| 426 | `app_update_required` | — | below the minimum app version |
| 500 | `save_failed` | — | the write failed; **nothing was stamped** |

```json
{ "error": { "code": "validation_failed", "message": "Some fields are invalid.",
             "fields": { "whatsapp": "Enter a valid WhatsApp number for the selected country." } } }
```

### `PATCH /api/mobile/v1/me/profile` — operationId `patchMeProfile` (changed, backward compatible)

Two **optional** fields are added to the body. A body from a shipped app version that omits them still
validates and leaves both untouched.

| New optional field | Behaviour |
|---|---|
| `consentWhatsappUpdates: boolean` | omitted = unchanged; `false` is written as `false`. |
| `gameInterests: string[]` | omitted = unchanged; when sent it must contain **at least one** UUID (`400 gameInterests: "Select at least one game"` for `[]`). |

New failure: if the interests write fails the call now returns `400` with `code: "save_failed"` (the existing
`patchMeProfile` mapping for that code) instead of reporting success. The profile fields were already saved at
that point; repeating the same request is safe.

Things Flutter should know about this endpoint, none of which are new but all of which matter for settings:

- It is a **full replace** for `whatsapp`, `country` and `bio`: a blank string clears the stored value. Send the
  player's current values for fields they did not edit.
- It does **not** stamp `profileCompletedAt` — only `POST /onboarding/profile` does.
- The OpenAPI `whatsapp` schema changed from a digits regex (`^\+?[0-9]{10,15}$`) to `maxLength: 30`. The number
  is now validated server-side against the chosen country's real numbering plan (same rule as onboarding), so a
  number the old regex accepted can now be rejected for the wrong country. The field error name is still
  `whatsapp`.

## Verification

Run on the branch tip before this note:

- `npx vitest run` — 323 files, 2341 tests passed (plus the new route-file ratchet, 72 cases).
- `npm run lint` — no warnings or errors. `npx tsc --noEmit` — clean. `npm run build` — exit 0.
- `npm run openapi` — no diff against the committed file.
- Test coverage for each case the blocker note listed:
  - incomplete and completed `/me` responses → `lib/mobile-api/endpoints/me.test.ts`
  - consent `true` / `false`, no coercion → `me.test.ts`, `onboarding.test.ts`, `update-profile-service.test.ts`
  - empty game-interest rejection → `onboarding.test.ts`, `lib/profile/schema.test.ts`
  - invalid country / WhatsApp pairing → `onboarding.test.ts`, `profile-completion-service.test.ts`
  - game-interest write failure never marks completion → `onboarding.test.ts`, `profile-completion-service.test.ts`,
    and a transactional rollback check of the SQL function on staging (below)
  - an old `PATCH /me/profile` body without the new fields → `me.test.ts`, `lib/profile/schema.test.ts`,
    `lib/profile/form-data.test.ts`

**Live against staging** (dev server on the branch, real bearer token for `qa-2b-player1@example.com`; no
production writes):

- `GET /me` before completion → `profileCompletedAt: null`, `gameInterests: []`.
- Every failure in the table above returned the stated field error, and `/me` afterwards was **still
  incomplete** (nothing stamped).
- Success with consent `false`: `/me` showed `consentWhatsappUpdates: false`, WhatsApp `+2348012345678`
  (from `0801 234 5678`), the game id, and a `profileCompletedAt`.
- Re-submitting (different country/number, consent `true`) updated the fields and **kept the original
  `profileCompletedAt`**.
- Old-shape `PATCH` → `200`; `PATCH` with `gameInterests: []` → `400`; `PATCH` with only consent → `200`.
- The SQL function in a rolled-back transaction: an unknown game id raised a foreign-key error and left
  `profile_completed_at` null with the previous interests intact; an empty array was rejected; unknown user
  rejected; `anon`/`authenticated` have no `EXECUTE`, only `service_role`.

One bug found only by that live run: the endpoint was defined and in the OpenAPI document but had no route
file, so it returned a Next.js 404. Fixed in `3350b43`, and `lib/mobile-api/route-files.test.ts` now fails if
any defined endpoint lacks its route file.

## Migrations

| Migration | Staging | Production |
|---|---|---|
| `20260929120000_add_profile_completion_fields.sql` (`consent_whatsapp_updates`, `profile_completed_at`) | applied | **not applied** |
| `20261003170000_complete_profile_onboarding_rpc.sql` (`complete_profile_onboarding()`) | applied | **not applied** |

Both must be applied to production **before** the branch deploys: the web middleware gate and `GET /me` read the
new columns.

## Not done yet (does not block mobile)

Settings UI (plan task 12) and the admin game-interest segment/export pages (tasks 14–15). The Settings
Server Action already reads the new inputs (`lib/profile/form-data.ts`); only the form controls are missing.
