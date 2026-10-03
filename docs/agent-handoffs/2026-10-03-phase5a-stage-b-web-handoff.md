# Phase 5a Stage B (web) — handoff

**Date:** 2026-10-03 · **Branch:** `phase5a/web-endpoints` (worktree `..\sentinelx-p5a-web`) · **Code changed:** yes
**Plan:** `docs/superpowers/plans/2026-10-03-mobile-phase5a-notifications-push-web.md` · **Spec:** `docs/superpowers/specs/2026-10-03-mobile-phase5a-notifications-push-design.md`

## What was built (verified by tests and a green build)

- `lib/notifications/prefs.ts` — key lists, defaults, `effectivePrefs`, `isPushEnabled`, `patchPrefsSchema`. The sender gate (`push.ts`, three places) now uses `isPushEnabled`.
- `lib/notifications/channels.ts` — 25 push types -> five versioned Android channels (compiler- and test-enforced complete).
- `lib/notifications/fcm.ts` — tokens partitioned by `platform`; `buildMulticast` per platform; `sendToTokens` returns `{attempted, succeeded}`; one failing platform batch no longer stops the rest. `sendFCMToPlayer`, `broadcastFCM`, `broadcastPush` read `platform`.
- Services shared by web Server Actions and the API: `prefs-service.ts`, `mute-service.ts`, `inbox-service.ts`, `test-push-service.ts`. `mute-actions.ts` and `lib/settings/notification-prefs.ts` now call them (user-visible strings unchanged).
- Eight endpoints in `lib/mobile-api/endpoints/notifications.ts`, five route files, appended to `ALL_ENDPOINTS`, `openapi/mobile-v1.json` regenerated (insert-only, eight operations).

## Verification (run in the worktree)

`npx tsc --noEmit` clean · `npm run lint` clean · `npm test` 324 files / 2358 tests pass · `npm run build` exit 0 (needed `.env.local` copied from the main checkout; the build otherwise fails at `/sitemap.xml` for lack of env — environmental, not a code defect). The web FCM payload is pinned by a `toEqual` characterization test written and passing **before** the refactor.

## Rulings (what, why, cost if wrong)

See the plan's **Rulings** section (1–7); summary:
1. WhatsApp / achievement-sharing defaults = the settings page and column default; nothing in the sender reads those sections (grep-verified).
2. `noshow_needs_decision` and `result_no_submission` are staff-bound -> `admin_v1`; `result_submitted` goes to the opponent -> `matches_v1`.
3. **Row id is NOT added to push `data`.** `notifyBoth` runs insert and push concurrently; broadcast and staff paths bulk-insert with no id readback. The app marks a tapped notification read by looking up the newest unread own row whose `link` equals the push `data.url`, then `POST /notifications/{id}/read`. Best-effort. *Cost:* a tap occasionally leaves the badge up until the bell is opened.
4. `GET /notifications/mutes` lists live rows only; "always" for a type is `push[type] === false` in the prefs.
5. Type "always" mute uses the atomic merge RPC (previously a read-modify-write of the whole prefs object).
6. Test push: no device -> 404 `not_found`; nothing delivered -> 500 `internal` (never reports sent).
7. `sendToTokens` return type `void` -> `SendSummary` (source-compatible).

## Verified facts the mobile side relies on

- `POST /devices` / `DELETE /devices` unchanged. Android tokens must be registered with `platform: 'android'` or they get the web payload (data-only) and nothing will display natively.
- Android push = top-level `notification` + `data` {`url`, `type`, `title`, `body`} + `android.notification.channelId` from the table. The app must create the five channels at startup.
- `data.url` is a web path (`/matches/...`, `/community/<uuid>`, ...) and may be **absent** (e.g. `notifyBoth` with no link) — the app's tap handler must tolerate a missing `url` (fall back to the bell).
- Mute `type` accepts only the 17 pref keys; `status_removed` and unknown -> 400.

## Not verified / limits

- Nothing was sent through real FCM. Delivery, Doze behaviour, Android channel behaviour and iOS (shape-only, no APNs creds, Phase 10) are unverified; the owner's device pass covers them.
- Staging web deployment must send with the same Firebase project (`sentinelx-f061e`) credentials as the app's `google-services.json` — **unconfirmed**.
- No write was run against any real database; services are tested against a recording fake.
- Snapshot files under `app/**/__snapshots__` show as modified in the worktree after `npm test` (line endings only, no content diff); they are not part of the branch.

## Recommendations

- After merge, confirm the staging preview deployment serves the new `/api/mobile/v1/notifications/*` routes before the mobile Stage D device pass.
- Revisit the row-id-in-`data` decision only if the device pass shows stale badges after taps.

## Review outcome (fresh-context pass)

Four findings, all verified against the code and fixed:
1. `sendToTokens` now contains a thrown multicast error, so the web "send test notification" button (`sendTestPush`) would have reported success with nothing delivered. Fixed: it now requires `summary.succeeded > 0`, else `send-failed`. (No unit test for `sendTestPush` itself: it needs the Next cookies/auth context; the behaviour is covered at the service level for the mobile path.)
2. `getPrefs` ignored a read error and returned all-default prefs; now throws (endpoint -> 500). Test added.
3. `jsonb_merge_notification_prefs` is a silent no-op if no profile row matches (deleted/anonymised account). Same behaviour as before on the website; not changed.
4. Test gap: stale-token cleanup after another platform threw is now pinned.
Re-verified: tsc, lint, `npm test` green.
