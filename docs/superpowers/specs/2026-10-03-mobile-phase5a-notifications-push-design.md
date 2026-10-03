# Mobile Phase 5a — Notifications & push — design

**Date:** 2026-10-03 · **Repos:** this one (web API + sender) and `sentinelx_mobile` (app) ·
**Master spec:** mobile repo `docs/superpowers/specs/2026-09-18-flutter-mobile-app-master-design.md`
§6.2 (push), §6.3 (realtime), §8.11 (notifications) · **Conventions:**
`2026-09-18-mobile-api-v1-conventions.md`

Phase 5 of the master spec bundles four systems. It is split, by owner decision (2026-10-03), into
**5a Notifications & push → 5b Direct messages → 5c Guide quests & support chatbot**, each with its own
spec, plan and build. **This document is 5a only.**

## 1. Intent and success criteria

**Who it is for:** players using the Android app, most of them young and on mid-range phones with
aggressive battery management.

**Why:** fixture assignments, match reminders, result confirmations and prize credits are the
platform's retention loop. Today they reach a player only if they have the website's browser push
enabled or open the site. The app must deliver them natively, show them in an in-app bell, and let the
player control them.

**Success (what the owner can verify on a phone):**
1. A player signs in and, at the right moment, is asked once for notification permission.
2. A fixture assignment (or any test push) arrives as a real Android notification when the app is in the
   foreground (in-app banner), background, and terminated.
3. Tapping it opens the right screen — including from a cold start, before the session has restored.
4. The bell lists notifications newest-first, shows an unread badge that updates live, marks read
   individually and all at once, and lets the player mute a post thread or a notification type.
5. Settings → Notifications edits the same preferences the website edits; a change on one is visible on
   the other.
6. Signing out stops pushes to that device; signing in as someone else on the same phone moves it.

**Not in 5a:** DMs and DM push (5b); guide quests and the chatbot (5c); sending WhatsApp (server-side,
untouched); iOS delivery (see §3.3).

## 2. Ground truth (verified in this repo, 2026-10-03)

| Fact | Where |
|---|---|
| `POST /devices` and `DELETE /devices` already exist: service-role upsert keyed on token, `player_id` from the verified bearer token, so a phone that changes accounts moves cleanly. Body is `{token, platform: android\|ios, appVersion}`. | `lib/mobile-api/endpoints/devices.ts` |
| `fcm_tokens.platform` is `web` (default) \| `android` \| `ios`. | migration `20260918210000_fcm_tokens_platform` |
| The sender is **data-only on purpose**: a top-level `notification` makes a *browser* show the push itself on top of the service worker's own display. It sends one multicast per 500 tokens with `webpush` options and **no `android` or `apns` block**. `sendToTokens` takes `{id, token}` and never reads `platform`. | `lib/notifications/fcm.ts` |
| Push `data` carries `type`, `url` (used for `webpush.fcmOptions.link`), `title`, `body`. | `fcm.ts`, `push.ts` |
| Push gating: `profiles.notification_prefs.push[type] === false` suppresses; **absent means on**. Live timed mutes in `notification_mutes` suppress the push only — the bell still records it. | `lib/notifications/push.ts`, `mutes.ts` |
| 17 user-toggleable push keys; `status_removed` is always delivered (no key). WhatsApp prefs: 6 keys. Achievement-sharing prefs: 5 keys. | `push-types.ts`, `lib/settings/notification-prefs.ts` |
| Prefs are merged section-by-section with the `jsonb_merge_notification_prefs` RPC (migration 062) — atomic across concurrent saves of different sections. | `notification-prefs.ts` |
| Mutes: `notification_mutes`, exactly one scope per row (a type, or a post). A timed type mute is a row; **"always" for a type flips `push[type]=false` and deletes the row** so the checkbox and the mute menu can never disagree; "always" for a post is a far-future `muted_until`. | `082_notification_mutes.sql`, `mute-actions.ts` |
| The bell is `player_notifications` (`id, player_id, type, title, body, link, read, created_at`); title/body are stored **already rendered in the recipient's language**. It is in the `supabase_realtime` publication and has an owner-read RLS policy. | migrations 022, 066 |
| `link` values are web paths: `/matches/…`, `/tournaments/…`, `/community/<postId>`, `/messages/<threadId>`, `/players/…`, `/dashboard/…`, `/exchange/…`, `/admin/…`. Many point at screens the app does not have yet. | grep of `lib/**` |

**Mobile side already present:** `lib/core/notifications/unread_counts.dart` (realtime unread counts for
notifications and `direct_message`), and `SxTabAppBar` already renders a bell and a messages icon with
those badges, both routed to the coming-soon screen. `resolveWebLink()` already maps web paths and
absolute web URLs to in-app routes and returns `null` for ones it cannot map.

**Not in the repo yet:** any Firebase dependency, `google-services.json`, notification channels, a
notification screen, or prefs/mutes endpoints.

## 3. Decisions (Rulings — each says what it costs if wrong)

### 3.1 Reads direct, writes through the API
- **Bell rows and the unread count are read directly** from `player_notifications` under the existing
  owner-RLS policy, with the existing realtime. Unlike Phase 4's community reads, nothing here is
  computed in TypeScript: the stored row is exactly what is displayed. *Cost if wrong:* a table-shape
  change breaks installed apps; mitigated by the app treating unknown `type` values generically and
  selecting named columns only.
- **Every write goes through `/api/mobile/v1`** (project rule). **Prefs and mutes reads also go through
  the API**, because "effective preference" is a server-side interpretation (absent = on) that the
  sender and the endpoint must share, not re-derive in Dart.

### 3.2 One effective-prefs function, shared
Add `effectivePrefs(raw)` in `lib/notifications/` used by both the sender's gate and the new endpoints
(fixing the risk that the screen shows "on" while the sender treats the key as off, or the reverse).
Defaults are whatever the senders already treat absence as — **to be confirmed against `notify.ts` for
the WhatsApp keys during Stage B**, not assumed to match push.

### 3.3 Sender change: split by token platform; iOS payload shape only
`sendToTokens` must read `platform` and partition:
- **web** — unchanged: data-only, `webpush` urgency/TTL/link. No behaviour change for the website.
- **android** — add a top-level `notification {title, body}`, `android.priority = high`,
  `android.notification.channelId = <channel for the type>`, `android.ttl` 24h; keep `data` (with
  `type`, `url`, and the notification row `id` when available). A `notification` block is correct here:
  the duplicate-display bug is a browser service-worker problem and does not exist in a native app, and
  an OS-displayed notification survives Doze and a killed app, which a data-only message does not.
- **ios** — same alert content with an `apns` block (`aps.alert`, `sound`, `thread-id` = type). **iOS
  delivery is explicitly out of scope for 5a**: there is no iOS build, the bundle id is still the
  placeholder `com.example.sentinelxMobile`, and APNs credentials belong to Phase 10. The sender still
  produces a correct alert payload for `ios` tokens now so that a data-only message can never silently
  render nothing there; it is unit-tested for payload **shape only** and its delivery is **unverified**
  until Phase 10.
- `broadcastFCM` and `broadcastPush` read tokens too and get the same partition.
- Stale-token cleanup (`unregistered` / `invalid`) is unchanged and applies to all three.
*Cost if wrong:* a mis-partitioned token type would send the wrong shape; covered by payload tests per
platform and by keeping the web branch byte-for-byte as today.

### 3.4 Android channels, versioned from day one
Channel ids are `matches_v1`, `social_v1`, `messages_v1`, `money_v1`, `admin_v1` (the master spec names
the five concepts; the suffix is new). Android fixes a channel's importance and sound at creation, so a
later change needs a new id (`matches_v2`) rather than editing one players already have. The app creates
the channels at startup, before any push can reference them. Type → channel mapping lives in one table
in the sender, with a test that every `PushNotificationType` has a channel and that the id set matches
the one the app creates (a shared list in the spec, asserted on both sides).

| Channel | Types |
|---|---|
| `matches_v1` | match_reminder, match_assigned, bracket_released, result_confirmed, result_submitted, result_no_submission, wager_settled, noshow_needs_decision, tournament_announced |
| `social_v1` | post_comment, post_reaction, status_from_friend, status_viewed, status_removed, new_follower, achievement_unlocked, challenge_completed, new_announcement |
| `messages_v1` | direct_message |
| `money_v1` | prize_credited, referral_converted |
| `admin_v1` | withdrawal_pending, exchange_listing_pending, result_needs_review, result_disputed |

All 25 `PushNotificationType` values appear exactly once. The assignment is a proposal from the type
names: during Stage B each type's real recipient is checked at its call site, and any that turn out to be
staff-bound (e.g. `noshow_needs_decision`, `result_no_submission`) move to `admin_v1` — the test asserts
completeness and uniqueness, not this particular split.

### 3.5 Permission prompt: contextual, once, at the first stake
Android 13+ effectively gives one or two system prompts before it stops showing one at all, so the ask
is spent where it converts: **after the first confirmed stake in a tournament — any of register,
waitlist join, or invitation accept** — not at launch and not after only one of the three. The app also
keeps two passive entry points (the bell's empty state and Settings → Notifications). Rules:
- Only asked when the OS version actually has a runtime permission (API 33+); below that, push is
  granted by default and the prompt path is a no-op.
- Never re-asked once denied; the passive rows then switch to "Open system settings".
- Which Flutter package owns the dialog (`firebase_messaging.requestPermission()` vs
  `flutter_local_notifications` vs a permission plugin) is **verified against the exact versions pinned
  in `pubspec.yaml` during planning**, not assumed.

### 3.6 Registration lifecycle
- On sign-in (after the session is established) and on FCM token refresh: `POST /devices`.
- Before sign-out: `DELETE /devices` for this token, then clear the session (master spec §6.1). If the
  call fails the sign-out still proceeds (the stale token is cleaned by the sender when FCM rejects it).
- `locale` is **not** added to device registration (the master spec mentioned it): push copy is already
  rendered in the recipient's profile language at send time, so a per-device locale would be dead data.

### 3.7 Tap routing, including cold start
Notification `data.url` (and a future `data.link`, accepted if present) goes through `resolveWebLink`.
- **Foreground:** an in-app banner (tap = route) and the bell badge updates via realtime.
- **Background:** `onMessageOpenedApp` → route.
- **Terminated:** `getInitialMessage()` → **queue the link and route only after the session and `/me`
  have settled**, using the same loading discipline as the router's auth redirect (a tap can fire before
  Supabase's session restore finishes; routing immediately would bounce through the login/onboarding
  gate and lose the destination).
- **Unmappable links** (`resolveWebLink` returns `null`, e.g. `/dashboard/wallet` before Phase 6):
  open `/notifications` instead of doing nothing. Mappings are extended in 5a only for destinations that
  have screens; unmapped ones keep degrading to the bell as later phases land.
- A tap also marks that notification read when its row `id` is in `data`.

## 4. Web API surface (`/api/mobile/v1`)

All `auth: 'user'`. Success `{ data }`, errors `{ error: { code, message, fields? } }`, reusing existing
error codes (`validation_failed`, `not_found`, `unauthorized`). None take an Idempotency-Key: every one
is naturally idempotent and moves no coins. Handler and any Server Action doing the same work call one
service function (conventions step 5). **Deferred by the conventions doc:** rate limiting — none added.

| operationId | Method + path | Body / query | Response `data` | Notes |
|---|---|---|---|---|
| `getNotificationPrefs` | `GET /notifications/prefs` | — | `{ push: {17 keys: bool}, whatsapp: {6 keys: bool}, achievementSharing: {5 keys: bool} }` | Effective values (§3.2). |
| `patchNotificationPrefs` | `PATCH /notifications/prefs` | partial of the same shape; each present section merged via `jsonb_merge_notification_prefs` | the full effective prefs | Unknown keys or non-booleans → 400 `validation_failed` with `fields`. |
| `getNotificationMutes` | `GET /notifications/mutes` | — | `{ types: [{type, mutedUntil}], posts: [{postId, mutedUntil}] }` | Live (unexpired) rows only. |
| `postNotificationMute` | `POST /notifications/mutes` | `{scope:'type', type, duration}` or `{scope:'post', postId, duration}`; `duration ∈ 1h \| 1w \| always` | `{ ok: true }` | Same semantics as `muteType` / `mutePost` (§2). `type` must be one of the 17 pref keys — `status_removed` and unknown types → 400. |
| `deleteNotificationMute` | `DELETE /notifications/mutes` | `{scope:'type', type}` or `{scope:'post', postId}` | `{ ok: true }` | Type unmute clears the row **and** the `push[type]=false` flag, like `unmuteType`. DELETE-with-body has precedent (`deleteDevice`). |
| `postNotificationRead` | `POST /notifications/{id}/read` | — | `{ ok: true }` | Scoped to the caller (`player_id = caller`); someone else's or unknown id → 404 `not_found`; already read is a success. |
| `postNotificationsReadAll` | `POST /notifications/read-all` | — | `{ updated: number }` | Only the caller's unread rows. |
| `postTestPush` | `POST /notifications/test-push` | — | `{ ok: true }` | Sends a clearly-labelled push to **the caller's own tokens only**, through the real sender path (so it exercises the platform split). Wraps the existing `lib/notifications/test-push.ts` logic. Exists so a device pass can verify delivery without waiting for a fixture. |

`/devices` is unchanged. After the endpoints are wired: `npm run openapi` and commit
`openapi/mobile-v1.json`.

## 5. Mobile app design (detail goes in the plan)

- **Bell screen** `/notifications`: reached from the existing bell icon. Newest first, offset-paged 20 at
  a time like the web drawer; row = title, body, relative time, unread dot; tap = mark read + route
  (§3.7); overflow menu offers "Mute this thread" (post-linked types, using the post id from the link)
  and "Mute this type" with the three durations; "Mark all read". Unknown future `type` values render
  generically from title/body/link. Empty state includes the passive permission row (§3.5).
- **Badge:** the existing `unreadNotificationCountProvider`, unchanged, stays live. The messages icon
  stays on coming-soon until 5b.
- **Settings → Notifications** (Account tab entry): the 17 push toggles, 6 WhatsApp toggles and 5
  achievement-sharing toggles, plus a "send test notification" action and the system-permission row.
  Optimistic toggles with rollback on failure (the Phase 4 reaction pattern: revert only the changed key
  on the current value, never restore a stale snapshot).
- **Push service** (`lib/core/notifications/`): permission, channel creation, token registration
  lifecycle, foreground banner, tap resolver with the cold-start queue. Riverpod providers, no screen
  talks to Firebase directly.
- **Realtime:** reuse the disposable-per-screen pattern; the general channel manager is revisited in 5b
  when DMs become the third consumer.
- **Copy:** ARB en + fr, identical key sets; nothing hard-coded; plural-aware counts.
- **Packages (versions pinned in the plan):** `firebase_core`, `firebase_messaging`,
  `flutter_local_notifications`; the Android `google-services` Gradle plugin.

## 6. Testing and verification

- **Web (TDD, mirroring `lib/mobile-api/endpoints/*.test.ts`):** each endpoint (auth, validation,
  ownership scoping, effective-prefs shape, mute semantics including the type-always flip and unmute
  clearing both representations); `effectivePrefs` shared by the sender gate and the endpoint; the
  sender partition — web payload unchanged (snapshot), android payload shape and `channelId`, ios alert
  shape, every `PushNotificationType` mapped to a channel, stale-token cleanup across all three. Full
  verification (typecheck, lint, test, build). Never test writes against production.
- **Mobile (TDD, fakes):** bell list/paging/unknown types, mark read and read-all with rollback, mute
  menu, prefs toggles with rollback, permission-trigger rules (API gate, once, any of the three stakes),
  registration lifecycle (sign-in, refresh, sign-out failure), tap routing for foreground/background/
  terminated including the cold-start queue and the unmappable-link fallback.
- **Live device pass (owner, on staging, after `google-services.json` is in `android/app`):** test push
  in foreground, background and terminated; tap routing from each, including a cold start while signed
  in; account switch on one phone; a real fixture assignment. **Open item:** confirm the staging web
  deployment sends with the same Firebase project's credentials as production, or the staging device
  pass will register tokens nothing can reach.
- Honest limit: nothing about FCM delivery, Doze behaviour or iOS can be verified in unit tests.

## 7. Out of scope (and why)

- DMs, DM push, the messages inbox → 5b.
- Guide quests, chatbot → 5c.
- iOS delivery, APNs, Universal Links, the real iOS bundle id → Phase 10.
- Notification grouping/summaries, quiet hours, snooze → not in the master spec; the existing timed
  mutes cover "stop interrupting me".
- Rich notifications (images, action buttons) → not in the master spec.
- Rate limiting on the new endpoints → deferred by the conventions doc until a phase needs it.

## 8. Open items for the plan stage

1. Which package owns the Android 13+ permission dialog at the pinned versions (§3.5).
2. `effectivePrefs` defaults for the WhatsApp and achievement-sharing keys (§3.2).
3. Whether `data` should additionally carry the `player_notifications` row id so a tap can mark that row
   read without a lookup (§3.7); needs the sender call sites to pass it where the row is created first.
4. Staging web deployment's Firebase credentials (§6).
5. Exact Gradle/AGP version compatibility for the `google-services` plugin in this project.
