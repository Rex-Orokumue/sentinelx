# Mobile Phase 5a — Notifications & push (web side) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the web sender deliver native Android/iOS-shaped pushes, and expose the eight notification endpoints the app needs under `/api/mobile/v1`.

**Architecture:** One shared `effectivePrefs()` is used by the sender's gate and the endpoints. `sendToTokens` partitions tokens by `fcm_tokens.platform` and builds a per-platform multicast (web byte-for-byte unchanged). Prefs/mutes logic moves into service functions that both the existing Server Actions and the new `defineEndpoint`s call (conventions step 5).

**Tech Stack:** Next.js route handlers, `defineEndpoint` + zod, firebase-admin messaging, Supabase (service-role admin client), vitest.

**Spec:** `docs/superpowers/specs/2026-10-03-mobile-phase5a-notifications-push-design.md` (§3.2–3.4, §4, §6). Conventions: `docs/superpowers/specs/2026-09-18-mobile-api-v1-conventions.md`.

## Global Constraints

- No schema change. `notification_mutes`, `fcm_tokens.platform`, `jsonb_merge_notification_prefs`, realtime publication all exist. If one is needed: stop and ask.
- Never test writes against production (`itxubrkbropttfdackmi`). All tests here mock the Supabase client.
- All eight endpoints are `auth: 'user'`; success `{ data }`; errors reuse `validation_failed`, `not_found`, `unauthorized`. No Idempotency-Key, no rate limiting.
- Web FCM payload must remain **byte-for-byte** what `sendToTokens` sends today (data-only, `webpush.headers {Urgency:'high', TTL:'86400'}`, `fcmOptions.link = data.url`).
- Channel ids: `matches_v1`, `social_v1`, `messages_v1`, `money_v1`, `admin_v1`.
- 17 user-toggleable push keys; `status_removed` has no key and is always delivered. WhatsApp: 6 keys. Achievement sharing: 5 keys.
- Do not edit the owner's checkout at `C:\Users\gorok\Videos\sentinelx`; work only in worktree `..\sentinelx-p5a-web` on branch `phase5a/web-endpoints`. Verify branch and `git diff --cached` before every commit.
- Run vitest as `npx vitest run <path>`. Windows: use the Edit/Write tools for file edits, never bare Python read/write.

## Rulings (answers to the spec's web-side open items)

1. **Prefs defaults (open item 2).** Verified by grep: nothing in `lib/`, `app/`, or SQL reads `notification_prefs.whatsapp` or `.achievement_sharing` for sending — they are stored preferences only (the sender, `notify.ts`, does not gate on them). So there is no sender behaviour to match; the defaults are the **settings page's** and the column default (migration `20260909210032`), which agree: WhatsApp `match_reminder/result_confirmed/prize_credited/registration_confirmed = true`, `challenge_completed/achievement_unlocked = false`; sharing `tournament/milestone/streak = true`, `social/other = false`; every push key `true` when absent. *Cost if wrong:* the app shows a different default than the website. Mitigated by a test pinning each default.
2. **Staff-bound channels (spec §3.4).** Verified at call sites: `result_no_submission` (only via `notifyStaff`, link `/admin/results`) and `noshow_needs_decision` (only sent to `staffId`s in `noshow-actions.ts`) are staff-bound → `admin_v1`. `result_submitted` goes to the *opponent* player (`submission-notice.ts`) → stays `matches_v1`. `withdrawal_pending`, `exchange_listing_pending`, `result_needs_review`, `result_disputed` are `notifyStaff` types → `admin_v1`. *Cost if wrong:* an admin-only alert on a player channel (cosmetic — the channel only sets importance/sound).
3. **Row id in `data` (open item 3).** **Not added in 5a.** `notifyBoth` fires the bell insert and the push concurrently (`Promise.all`), so carrying the row id needs the insert to complete first and its id threaded through; `notifyStaff` and both broadcast paths insert rows with no id readback at all (bulk insert), and `notifyInApp` has ~30 call sites that don't also push. Smallest option instead: the **app** marks the tapped notification read by looking up the newest unread own row whose `link` equals the push `data.url` (a direct owner-RLS read, then `POST /notifications/{id}/read`). Best-effort; a miss leaves the row unread, which is harmless. *Cost if wrong:* a tap occasionally leaves the badge up until the player opens the bell. Revisit if the device pass shows it matters.
4. **`GET /notifications/mutes` content.** Returns only live `notification_mutes` rows (per spec). A type muted "always" is *not* a row — it is `push[type] === false` and shows through `GET /notifications/prefs`. The app derives "muted always" from prefs. *Cost if wrong:* none; documented in the endpoint summary.
5. **Type "always" mute** uses `jsonb_merge_notification_prefs` instead of the Server Action's current read-modify-write of the whole `notification_prefs` object (which can clobber a concurrent save of another section). Same observable result, atomic. The existing Server Actions are moved onto the same service so web and mobile cannot diverge.
6. **Test push with no usable device.** No device registered for the caller → `404 not_found`. Firebase unconfigured or FCM accepted zero messages → thrown error → generic `500 internal` (logged), because the spec says reuse existing codes and "sent" must not be reported when nothing was.
7. **`sendToTokens` returns a summary** `{ attempted, succeeded }` (was `void`). Existing callers ignore the result, so this is source-compatible.

## Review Focus

1. A token row with `platform = null` or an unknown value (rows older than the platform migration default to `web`, but be defensive): must be treated as `web`, never dropped.
2. A push `type` not in the channel table (e.g. a test caller passing an arbitrary type): android message must still send (no `channelId`), not throw.
3. `PATCH /notifications/prefs` with an empty body, an unknown key inside a section, a non-boolean, or a partial section: partial merges only what is sent; unknown/non-boolean → 400 with `fields`; empty → no-op returning current effective prefs.
4. `POST /notifications/{id}/read` with a malformed (non-uuid) id, another player's id, and an already-read id: 404, 404, 200.
5. A mixed-platform token set (web + android + ios) where one platform's batch fails entirely or contains a stale token: the other platforms' sends and the stale cleanup still happen.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/notifications/prefs.ts` (new) | Key lists, defaults, `effectivePrefs(raw)`, `isPushEnabled(raw, type)`, `PATCHABLE` zod schemas. Pure, no server-only imports. |
| `lib/notifications/channels.ts` (new) | `ANDROID_CHANNEL_IDS`, `CHANNEL_FOR_TYPE`, `channelFor(type)`. |
| `lib/notifications/fcm.ts` (modify) | Token platform partition, `buildMulticast`, summary return. |
| `lib/notifications/push.ts` (modify) | Use `isPushEnabled`; select `platform`. |
| `lib/notifications/prefs-service.ts` (new) | `getPrefs`, `patchPrefs` (service-role, RPC merge). |
| `lib/notifications/mute-service.ts` (new) | `listMutes`, `setTypeMute`, `setPostMute`, `clearTypeMute`, `clearPostMute`. |
| `lib/notifications/mute-actions.ts`, `lib/settings/notification-prefs.ts` (modify) | Call the services. |
| `lib/notifications/inbox-service.ts` (new) | `markRead`, `markAllRead`. |
| `lib/notifications/test-push-service.ts` (new) | `sendTestPushToPlayer`. `test-push.ts` (modify) keeps the web button. |
| `lib/mobile-api/endpoints/notifications.ts` (+ `.test.ts`) (new) | The eight endpoints. |
| `lib/mobile-api/endpoints/index.ts` (modify) | Append to `ALL_ENDPOINTS`. |
| `app/api/mobile/v1/notifications/{prefs,mutes,read-all,test-push}/route.ts`, `…/[id]/read/route.ts` (new) | Route files. |
| `openapi/mobile-v1.json` (regenerate) | `npm run openapi`. |

---

### Task 1: Shared `effectivePrefs`

**Files:** Create `lib/notifications/prefs.ts`, `lib/notifications/prefs.test.ts`.

**Interfaces — Produces:**
```ts
export const PUSH_PREF_KEYS: readonly [/* the 17 keys */]
export const WHATSAPP_PREF_KEYS: readonly [/* 6 */]
export const SHARING_PREF_KEYS: readonly [/* 5 */]
export type PushPrefKey = typeof PUSH_PREF_KEYS[number]
export interface EffectivePrefs { push: Record<PushPrefKey, boolean>; whatsapp: Record<WhatsappPrefKey, boolean>; achievementSharing: Record<SharingPrefKey, boolean> }
export function effectivePrefs(raw: unknown): EffectivePrefs
export function isPushEnabled(raw: unknown, type: string): boolean   // false only when push[type] === false
export const patchPrefsSchema: z.ZodObject<...>   // strict partial of the three sections
```

- [ ] **Step 1: Write the failing test** (`prefs.test.ts`)
```ts
import { describe, it, expect } from 'vitest'
import { effectivePrefs, isPushEnabled, patchPrefsSchema, PUSH_PREF_KEYS, WHATSAPP_PREF_KEYS, SHARING_PREF_KEYS } from './prefs'

describe('effectivePrefs', () => {
  it('has 17 push, 6 whatsapp and 5 sharing keys', () => {
    expect(PUSH_PREF_KEYS).toHaveLength(17)
    expect(WHATSAPP_PREF_KEYS).toHaveLength(6)
    expect(SHARING_PREF_KEYS).toHaveLength(5)
  })
  it('treats every absent push key as on', () => {
    const p = effectivePrefs(null).push
    expect(Object.values(p).every((v) => v === true)).toBe(true)
    expect(Object.keys(p)).toHaveLength(17)
  })
  it('pins the whatsapp and sharing defaults to the settings page', () => {
    const e = effectivePrefs({})
    expect(e.whatsapp).toEqual({
      match_reminder: true, result_confirmed: true, prize_credited: true,
      challenge_completed: false, achievement_unlocked: false, registration_confirmed: true,
    })
    expect(e.achievementSharing).toEqual({ tournament: true, milestone: true, streak: true, social: false, other: false })
  })
  it('only an explicit false turns a key off; junk values fall back to the default', () => {
    const e = effectivePrefs({ push: { post_reaction: false, match_reminder: 'no', new_follower: 0 }, whatsapp: { challenge_completed: true } })
    expect(e.push.post_reaction).toBe(false)
    expect(e.push.match_reminder).toBe(true)
    expect(e.push.new_follower).toBe(true)
    expect(e.whatsapp.challenge_completed).toBe(true)
  })
  it('ignores unknown stored keys', () => {
    expect(Object.keys(effectivePrefs({ push: { zzz: false } }).push)).not.toContain('zzz')
  })
  it('does not throw on non-object input', () => {
    expect(() => effectivePrefs('x')).not.toThrow()
    expect(() => effectivePrefs([])).not.toThrow()
  })
})

describe('isPushEnabled', () => {
  it('matches the sender rule: only === false suppresses; status_removed has no key and always sends', () => {
    expect(isPushEnabled({ push: { post_comment: false } }, 'post_comment')).toBe(false)
    expect(isPushEnabled({ push: {} }, 'post_comment')).toBe(true)
    expect(isPushEnabled(null, 'post_comment')).toBe(true)
    expect(isPushEnabled({ push: { status_removed: false } }, 'status_removed')).toBe(true)
  })
})

describe('patchPrefsSchema', () => {
  it('accepts partial sections and an empty object', () => {
    expect(patchPrefsSchema.safeParse({}).success).toBe(true)
    expect(patchPrefsSchema.safeParse({ push: { post_comment: false } }).success).toBe(true)
  })
  it('rejects unknown keys at any level and non-booleans', () => {
    expect(patchPrefsSchema.safeParse({ push: { nope: true } }).success).toBe(false)
    expect(patchPrefsSchema.safeParse({ extra: {} }).success).toBe(false)
    expect(patchPrefsSchema.safeParse({ push: { post_comment: 'yes' } }).success).toBe(false)
  })
  it('does not allow status_removed to be toggled', () => {
    expect(patchPrefsSchema.safeParse({ push: { status_removed: false } }).success).toBe(false)
  })
})
```
- [ ] **Step 2:** `npx vitest run lib/notifications/prefs.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** `prefs.ts`:
```ts
import { z } from 'zod'

export const PUSH_PREF_KEYS = [
  'match_reminder', 'result_confirmed', 'achievement_unlocked', 'challenge_completed', 'new_announcement',
  'tournament_announced', 'wager_settled', 'referral_converted', 'post_comment', 'post_reaction',
  'bracket_released', 'match_assigned', 'prize_credited', 'status_from_friend', 'status_viewed',
  'new_follower', 'direct_message',
] as const
export const WHATSAPP_PREF_KEYS = [
  'match_reminder', 'result_confirmed', 'prize_credited', 'challenge_completed', 'achievement_unlocked', 'registration_confirmed',
] as const
export const SHARING_PREF_KEYS = ['tournament', 'milestone', 'streak', 'social', 'other'] as const

export type PushPrefKey = (typeof PUSH_PREF_KEYS)[number]
export type WhatsappPrefKey = (typeof WHATSAPP_PREF_KEYS)[number]
export type SharingPrefKey = (typeof SHARING_PREF_KEYS)[number]

const WHATSAPP_DEFAULTS: Record<WhatsappPrefKey, boolean> = {
  match_reminder: true, result_confirmed: true, prize_credited: true,
  challenge_completed: false, achievement_unlocked: false, registration_confirmed: true,
}
const SHARING_DEFAULTS: Record<SharingPrefKey, boolean> = {
  tournament: true, milestone: true, streak: true, social: false, other: false,
}

export interface EffectivePrefs {
  push: Record<PushPrefKey, boolean>
  whatsapp: Record<WhatsappPrefKey, boolean>
  achievementSharing: Record<SharingPrefKey, boolean>
}

function section(raw: unknown, key: string): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const s = (raw as Record<string, unknown>)[key]
  return typeof s === 'object' && s !== null && !Array.isArray(s) ? (s as Record<string, unknown>) : {}
}
function resolve<K extends string>(stored: Record<string, unknown>, keys: readonly K[], defaults: (k: K) => boolean): Record<K, boolean> {
  const out = {} as Record<K, boolean>
  for (const k of keys) out[k] = typeof stored[k] === 'boolean' ? (stored[k] as boolean) : defaults(k)
  return out
}

export function effectivePrefs(raw: unknown): EffectivePrefs {
  return {
    push: resolve(section(raw, 'push'), PUSH_PREF_KEYS, () => true),
    whatsapp: resolve(section(raw, 'whatsapp'), WHATSAPP_PREF_KEYS, (k) => WHATSAPP_DEFAULTS[k]),
    achievementSharing: resolve(section(raw, 'achievement_sharing'), SHARING_PREF_KEYS, (k) => SHARING_DEFAULTS[k]),
  }
}

// The sender's gate. Deliberately NOT effectivePrefs().push[type]: status_removed (and any push-only
// type without a key) has no entry and must always send.
export function isPushEnabled(raw: unknown, type: string): boolean {
  return section(raw, 'push')[type] !== false
}

const bools = <K extends string>(keys: readonly K[]) =>
  z.object(Object.fromEntries(keys.map((k) => [k, z.boolean().optional()])) as Record<K, z.ZodOptional<z.ZodBoolean>>).strict()

export const patchPrefsSchema = z
  .object({
    push: bools(PUSH_PREF_KEYS).optional(),
    whatsapp: bools(WHATSAPP_PREF_KEYS).optional(),
    achievementSharing: bools(SHARING_PREF_KEYS).optional(),
  })
  .strict()
```
- [ ] **Step 4:** run the test → PASS.
- [ ] **Step 5: Commit** `feat(notifications): shared effectivePrefs for the sender gate and mobile endpoints`.

### Task 2: Sender gate uses the shared function

**Files:** Modify `lib/notifications/push.ts`; test `lib/notifications/push.test.ts`.

**Consumes:** `isPushEnabled(raw, type)`.

- [ ] **Step 1: Failing test** — add to `push.test.ts` a case where `notification_prefs` is a non-object junk value (`'oops'`) and assert the push is still sent (today's optional chaining would throw on a string? `('oops' as any)?.push` is undefined — so it sends; the test pins that this stays true), and a case with `push: { wager_settled: 'false' }` (string) asserting it **sends** (only a boolean false suppresses). Run: expected to PASS already for the first and FAIL-or-pass for the second — record which; the point is pinning behaviour before the refactor.
- [ ] **Step 2:** Replace the three inline `push?.[type] === false` checks (`sendPushToPlayer`, `sendBroadcastPush`, `sendPrerendered`) with `!isPushEnabled(profile?.notification_prefs, type)` / `isPushEnabled(profile?.notification_prefs, type)`. In `sendBroadcastPush` add `platform` to the token select: `.select('id, token, platform, profiles!inner(notification_prefs, locale)')` and carry it into the bucket entries `{ id, token, platform }`.
- [ ] **Step 3:** `npx vitest run lib/notifications/push.test.ts` → all PASS (existing + new).
- [ ] **Step 4: Commit** `refactor(notifications): sender gate and broadcast select use shared prefs and platform`.

### Task 3: Channel table

**Files:** Create `lib/notifications/channels.ts`, `lib/notifications/channels.test.ts`.

**Produces:**
```ts
export const ANDROID_CHANNEL_IDS: readonly ['matches_v1','social_v1','messages_v1','money_v1','admin_v1']
export type AndroidChannelId = typeof ANDROID_CHANNEL_IDS[number]
export const CHANNEL_FOR_TYPE: Record<PushNotificationType, AndroidChannelId>
export function channelFor(type: string | undefined): AndroidChannelId | undefined
```

- [ ] **Step 1: Failing test**
```ts
import { describe, it, expect } from 'vitest'
import { ANDROID_CHANNEL_IDS, CHANNEL_FOR_TYPE, channelFor } from './channels'

// Keep in sync with the app's channel list (mobile plan asserts the same five ids).
const ALL_TYPES = [
  'match_reminder','result_confirmed','result_submitted','achievement_unlocked','challenge_completed','new_announcement',
  'tournament_announced','wager_settled','referral_converted','post_comment','post_reaction','status_from_friend',
  'status_viewed','status_removed','bracket_released','match_assigned','prize_credited','new_follower','direct_message',
  'noshow_needs_decision','withdrawal_pending','exchange_listing_pending','result_needs_review','result_disputed','result_no_submission',
]
describe('CHANNEL_FOR_TYPE', () => {
  it('maps all 25 push types exactly once, to a known channel', () => {
    expect(Object.keys(CHANNEL_FOR_TYPE).sort()).toEqual([...ALL_TYPES].sort())
    for (const c of Object.values(CHANNEL_FOR_TYPE)) expect(ANDROID_CHANNEL_IDS).toContain(c)
  })
  it('uses every channel at least once', () => {
    expect(new Set(Object.values(CHANNEL_FOR_TYPE))).toEqual(new Set(ANDROID_CHANNEL_IDS))
  })
  it('staff-bound types are admin_v1; the opponent notice stays on matches', () => {
    for (const t of ['noshow_needs_decision','result_no_submission','withdrawal_pending','exchange_listing_pending','result_needs_review','result_disputed'])
      expect(CHANNEL_FOR_TYPE[t as keyof typeof CHANNEL_FOR_TYPE]).toBe('admin_v1')
    expect(CHANNEL_FOR_TYPE.result_submitted).toBe('matches_v1')
  })
  it('channelFor is undefined for an unknown type', () => {
    expect(channelFor('nope')).toBeUndefined()
    expect(channelFor(undefined)).toBeUndefined()
    expect(channelFor('direct_message')).toBe('messages_v1')
  })
})
```
- [ ] **Step 2:** run → FAIL. **Step 3: Implement** (`Record<PushNotificationType, …>` makes the compiler enforce completeness too):
```ts
import type { PushNotificationType } from './push-types'

export const ANDROID_CHANNEL_IDS = ['matches_v1', 'social_v1', 'messages_v1', 'money_v1', 'admin_v1'] as const
export type AndroidChannelId = (typeof ANDROID_CHANNEL_IDS)[number]

export const CHANNEL_FOR_TYPE: Record<PushNotificationType, AndroidChannelId> = {
  match_reminder: 'matches_v1', match_assigned: 'matches_v1', bracket_released: 'matches_v1', result_confirmed: 'matches_v1',
  result_submitted: 'matches_v1', wager_settled: 'matches_v1', tournament_announced: 'matches_v1',
  post_comment: 'social_v1', post_reaction: 'social_v1', status_from_friend: 'social_v1', status_viewed: 'social_v1',
  status_removed: 'social_v1', new_follower: 'social_v1', achievement_unlocked: 'social_v1', challenge_completed: 'social_v1',
  new_announcement: 'social_v1',
  direct_message: 'messages_v1',
  prize_credited: 'money_v1', referral_converted: 'money_v1',
  withdrawal_pending: 'admin_v1', exchange_listing_pending: 'admin_v1', result_needs_review: 'admin_v1',
  result_disputed: 'admin_v1', result_no_submission: 'admin_v1', noshow_needs_decision: 'admin_v1',
}

export function channelFor(type: string | undefined): AndroidChannelId | undefined {
  return type && Object.prototype.hasOwnProperty.call(CHANNEL_FOR_TYPE, type)
    ? CHANNEL_FOR_TYPE[type as PushNotificationType]
    : undefined
}
```
- [ ] **Step 4:** PASS; `npx tsc --noEmit` clean. **Step 5: Commit** `feat(notifications): android channel table (matches/social/messages/money/admin v1)`.

### Task 4: Sender platform partition

**Files:** Modify `lib/notifications/fcm.ts`, `lib/notifications/fcm.test.ts`.

**Consumes:** `channelFor`. **Produces:**
```ts
export interface PushToken { id: string; token: string; platform?: string | null }
export type TokenPlatform = 'web' | 'android' | 'ios'
export function platformOf(p: string | null | undefined): TokenPlatform   // android|ios, anything else → web
export function buildMulticast(platform: TokenPlatform, tokens: string[], notification: FCMNotification, data: Record<string,string>): MulticastMessage
export interface SendSummary { attempted: number; succeeded: number }
export async function sendToTokens(tokens: PushToken[], notification, data): Promise<SendSummary>
```

- [ ] **Step 1: Characterization test first** (must PASS against current code): in `fcm.test.ts` add a `toEqual` on the exact object `sendEachForMulticast` receives for one web token with `data: { url: '/x', type: 'wager_settled' }`:
```ts
{ tokens: ['tok-1'],
  data: { url: '/x', type: 'wager_settled', title: 'Hi', body: 'There' },
  webpush: { headers: { Urgency: 'high', TTL: '86400' }, fcmOptions: { link: '/x' } } }
```
Run → PASS. This is the byte-for-byte guard; it must stay green through every later step.
- [ ] **Step 2: Failing tests** (all in `fcm.test.ts`, using the existing mocks):
  - android token → message has `notification: { title, body }`, `android: { priority: 'high', ttl: 86400000, notification: { channelId: 'matches_v1' } }` for `type: 'match_assigned'`, `data` still contains `url`/`type`/`title`/`body`, and **no** `webpush` key.
  - android token with unknown `type` → sends, `android.notification` has no `channelId` key.
  - ios token → `apns.payload.aps` equals `{ alert: { title, body }, sound: 'default', 'thread-id': 'match_assigned' }`, `apns.headers['apns-priority']` is `'10'`, no `webpush`, no `android`.
  - `platform: null`, `platform: undefined`, `platform: 'weird'` → all go through the web branch (Review Focus 1).
  - mixed `[web, android, ios]` → `sendEachForMulticast` called 3 times, each with only its platform's tokens; each response's stale token is deleted using the right row ids; a rejected (throwing) android call does not stop the web and ios sends nor their cleanup (Review Focus 5).
  - >500 android tokens → chunked 500 + remainder, still per platform.
  - returns `{ attempted, succeeded }` summed across platforms; returns `{ attempted: 0, succeeded: 0 }` when unconfigured or no tokens.
- [ ] **Step 3:** run → the new tests FAIL.
- [ ] **Step 4: Implement.** In `fcm.ts`: add `platformOf`, `buildMulticast`:
```ts
export function platformOf(p: string | null | undefined): TokenPlatform {
  return p === 'android' || p === 'ios' ? p : 'web'
}

export function buildMulticast(platform: TokenPlatform, tokens: string[], notification: FCMNotification, data: Record<string, string>): MulticastMessage {
  // title/body stay inside `data` for every platform (the web service worker and the app's foreground handler read them there).
  const payloadData = { ...data, title: notification.title, body: notification.body }
  if (platform === 'android') {
    const channelId = channelFor(data.type)
    return {
      tokens, data: payloadData,
      notification: { title: notification.title, body: notification.body },
      android: { priority: 'high', ttl: 86_400_000, notification: channelId ? { channelId } : {} },
    }
  }
  if (platform === 'ios') {
    return {
      tokens, data: payloadData,
      apns: {
        headers: { 'apns-priority': '10' },
        payload: { aps: { alert: { title: notification.title, body: notification.body }, sound: 'default', 'thread-id': data.type } },
      },
    }
  }
  return { tokens, data: payloadData, webpush: { headers: { Urgency: 'high', TTL: '86400' }, fcmOptions: { link: data.url } } }
}
```
Keep the large explanatory comments from the current file, moved onto the web branch and the android branch (explain why a `notification` block is right on native). Rewrite `sendToTokens`: group by `platformOf(t.platform)`; for each group chunk by 500; wrap each `sendEachForMulticast` in try/catch that logs `[FCM] multicast threw` and continues; keep the existing stale/other-error logging and `fcm_tokens` delete; accumulate and return the summary. `sendFCMToPlayer` and `broadcastFCM` select `'id, token, platform'`.
- [ ] **Step 5:** `npx vitest run lib/notifications` → PASS (including the characterization test). `npx tsc --noEmit`.
- [ ] **Step 6: Commit** `feat(notifications): sender partitions tokens by platform (android notification+channel, ios alert shape)`.

### Task 5: Prefs and mutes services (shared with the Server Actions)

**Files:** Create `lib/notifications/prefs-service.ts`, `mute-service.ts`, `inbox-service.ts` (+ `.test.ts` each). Modify `lib/notifications/mute-actions.ts`, `lib/settings/notification-prefs.ts`.

**Interfaces — Produces** (`Admin = ReturnType<typeof createAdminClient>`):
```ts
// prefs-service.ts
export async function getPrefs(admin: Admin, userId: string): Promise<EffectivePrefs>
export async function patchPrefs(admin: Admin, userId: string, patch: z.infer<typeof patchPrefsSchema>): Promise<EffectivePrefs>
// mute-service.ts
export type MuteSetResult = { ok: true } | { ok: false; error: 'failed' }
export async function listMutes(admin: Admin, userId: string, now?: Date): Promise<{ types: {type: string; mutedUntil: string}[]; posts: {postId: string; mutedUntil: string}[] }>
export async function setTypeMute(admin: Admin, userId: string, type: string, duration: MuteDuration): Promise<MuteSetResult>
export async function setPostMute(admin: Admin, userId: string, postId: string, duration: MuteDuration): Promise<MuteSetResult>
export async function clearTypeMute(admin: Admin, userId: string): Promise<void>   // (admin, userId, type)
export async function clearPostMute(admin: Admin, userId: string, postId: string): Promise<void>
// inbox-service.ts
export async function markRead(admin: Admin, userId: string, id: string): Promise<'ok' | 'not_found'>
export async function markAllRead(admin: Admin, userId: string): Promise<number>
```
(`clearTypeMute` signature is `(admin, userId, type)`.)

- [ ] **Step 1: Failing tests** using a small chainable fake admin (copy the style of `devices.test.ts`, recording calls):
  - `getPrefs` reads `profiles.notification_prefs` for `userId` and returns `effectivePrefs` of it (absent profile → all defaults).
  - `patchPrefs` calls RPC `jsonb_merge_notification_prefs` once **per present section** with `{ p_id, p_key: 'push' | 'whatsapp' | 'achievement_sharing', p_patch }` (note `achievementSharing` → `achievement_sharing`), skips absent sections, then returns the re-read effective prefs; an RPC error throws.
  - `setTypeMute` with `1h`/`1w` upserts `notification_mutes` `{ player_id, notification_type, post_id: null, muted_until }` `onConflict: 'player_id,notification_type'`; with `always` calls the RPC with `{ p_key: 'push', p_patch: { [type]: false } }` and deletes any timed row for that type; failure → `{ ok: false }`.
  - `setPostMute` upserts `{ player_id, post_id, notification_type: null, muted_until }` `onConflict: 'player_id,post_id'`; `always` uses `ALWAYS_MUTED_UNTIL`.
  - `clearTypeMute` deletes the row **and** sets `push[type] = true` via RPC only when the effective stored value is exactly `false` (and does not call the RPC otherwise).
  - `clearPostMute` deletes by `player_id` + `post_id`.
  - `listMutes` filters `muted_until > now`, splits type/post rows, maps to camelCase.
  - `markRead` updates `read = true` `.eq('id').eq('player_id')` and returns `'not_found'` when no row came back, `'ok'` otherwise (an already-read row still matches → `'ok'`); `markAllRead` updates `.eq('player_id').eq('read', false)` and returns the count of returned ids.
- [ ] **Step 2:** run → FAIL. **Step 3: Implement** the three services using the exact table/column names above (move, don't rewrite, the expiry logic: `muteExpiryFor` from `mutes.ts`). `markRead` uses `.update({ read: true }).eq('id', id).eq('player_id', userId).select('id')`; `markAllRead` uses `.update({ read: true }).eq('player_id', userId).eq('read', false).select('id')`.
- [ ] **Step 4: Move the Server Actions onto the services** (behaviour-preserving): `mutePost/unmutePost/muteType/unmuteType` keep their FormData parsing, auth check, `revalidatePath` and messages, but call `setPostMute/clearPostMute/setTypeMute/clearTypeMute`. `updateWhatsappPrefs/updatePushPrefs/updateAchievementSharingPrefs` keep their zod forms but call `patchPrefs(admin, user.id, { whatsapp: parsed.data })` etc. (`achievementSharing` for the third). Do not change any user-visible string.
- [ ] **Step 5:** `npx vitest run lib/notifications lib/settings` → PASS; `npx tsc --noEmit`.
- [ ] **Step 6: Commit** `refactor(notifications): prefs, mutes and inbox services shared by web actions and the mobile API`.

### Task 6: Prefs endpoints

**Files:** Create `lib/mobile-api/endpoints/notifications.ts`, `notifications.test.ts`.

**Interfaces — Produces:** `getNotificationPrefsEndpoint`, `patchNotificationPrefsEndpoint`. Response schema `prefsResponse` = `z.object({ push: z.object(17 booleans), whatsapp: z.object(6), achievementSharing: z.object(5) })` built from the key lists.

- [ ] **Step 1: Failing tests** — mock `../auth` (`authenticate` → ctx) as `community-writes.test.ts` does and `@/lib/notifications/prefs-service`. Assert: GET returns `{data: prefs}` and passes `ctx.userId`; GET with no bearer → 401 (authenticate rejects with `Errors.unauthorized()`); PATCH `{ push: { post_reaction: false } }` calls `patchPrefs(admin, 'u1', that)` and returns the service result; PATCH `{}` → 200 via service; PATCH `{ push: { bogus: true } }` → 400 `validation_failed` with a `fields` entry and **no** service call; PATCH `{ push: { post_reaction: 'no' } }` → 400; PATCH `{ push: { status_removed: false } }` → 400.
- [ ] **Step 2:** FAIL. **Step 3:** implement with `defineEndpoint` (`operationId` `getNotificationPrefs` / `patchNotificationPrefs`, paths `/notifications/prefs`, `auth: 'user'`, `body: patchPrefsSchema` on PATCH). **Step 4:** PASS. **Step 5: Commit** `feat(mobile-api): notification prefs endpoints`.

### Task 7: Mute endpoints

**Files:** Modify `notifications.ts`, `notifications.test.ts`.

**Produces:** `getNotificationMutesEndpoint` (GET `/notifications/mutes`), `postNotificationMuteEndpoint` (POST), `deleteNotificationMuteEndpoint` (DELETE).
Body schemas (discriminated unions on `scope`): POST `{scope:'type', type: z.enum(PUSH_PREF_KEYS), duration: z.enum(['1h','1w','always'])}` | `{scope:'post', postId: z.string().uuid(), duration}`; DELETE `{scope:'type', type}` | `{scope:'post', postId}`.

- [ ] **Step 1: Failing tests:** GET returns the `listMutes` shape; POST type/post call the right service with `(admin, 'u1', …)`; `type: 'status_removed'` → 400; unknown type → 400; bad duration → 400; non-uuid `postId` → 400; missing `scope` → 400; service `{ok:false}` → 500 `internal` (generic); DELETE type calls `clearTypeMute`, DELETE post calls `clearPostMute`; every success returns `{ ok: true }`.
- [ ] **Step 2–5:** FAIL → implement → PASS → commit `feat(mobile-api): notification mute endpoints`.

### Task 8: Read and read-all endpoints

**Files:** Modify `notifications.ts`, `notifications.test.ts`.

**Produces:** `postNotificationReadEndpoint` (POST `/notifications/{id}/read`, `parameters: [{ name:'id', in:'path', required:true, schema:{type:'string',format:'uuid'} }]`), `postNotificationsReadAllEndpoint` (POST `/notifications/read-all`).

- [ ] **Step 1: Failing tests:** valid own id → `{ok:true}`; service `'not_found'` (other player's or unknown id) → 404 `not_found`; **malformed id** (`'abc'`) → 404 without calling the service (Review Focus 4); already-read id → 200 (service returns `'ok'`); read-all returns `{ updated: n }` and passes only `ctx.userId`; unauthenticated → 401.
- [ ] **Step 2–5:** FAIL → implement (`z.string().uuid().safeParse(params.id)` else `throw Errors.notFound()`) → PASS → commit `feat(mobile-api): mark-read and read-all endpoints`.

### Task 9: Test push

**Files:** Create `lib/notifications/test-push-service.ts` (+test); modify `lib/notifications/test-push.ts`, `notifications.ts`, `notifications.test.ts`.

**Produces:** `sendTestPushToPlayer(admin, userId): Promise<'ok' | 'no_device'>` (throws on unconfigured / zero delivered) ; `postTestPushEndpoint` (POST `/notifications/test-push`).

- [ ] **Step 1: Failing tests:** service selects `fcm_tokens` `id, token, platform` for the player (**all** the caller's tokens, and only theirs), sends through `sendToTokens` with `{ title: 'SentinelX test', body: 'Push notifications are working on this device 🎮' }` and data `{ url: '/dashboard/settings', type: 'result_confirmed' }`; no rows → `'no_device'` and `sendToTokens` not called; summary `{attempted:1, succeeded:0}` → throws; `{attempted: 0}` (unconfigured) → throws. Endpoint: `'no_device'` → 404 `not_found`; throw → 500 `internal`; success → `{ ok: true }`.
- [ ] **Step 2–4:** FAIL → implement → PASS. Make the existing web `sendTestPush` keep its own cookie-scoped single-token behaviour (do not change the web button); only share the message constants (`TEST_PUSH_NOTIFICATION`, `TEST_PUSH_DATA` exported from the service).
- [ ] **Step 5: Commit** `feat(mobile-api): test-push endpoint through the real sender path`.

### Task 10: Wire routes, regenerate OpenAPI, verify

**Files:** Create the route files; modify `lib/mobile-api/endpoints/index.ts`; regenerate `openapi/mobile-v1.json`.

- [ ] **Step 1:** Route files (each only re-exports handlers, like `devices/route.ts`):
  - `app/api/mobile/v1/notifications/prefs/route.ts` → `GET`, `PATCH`
  - `app/api/mobile/v1/notifications/mutes/route.ts` → `GET`, `POST`, `DELETE`
  - `app/api/mobile/v1/notifications/read-all/route.ts` → `POST`
  - `app/api/mobile/v1/notifications/test-push/route.ts` → `POST`
  - `app/api/mobile/v1/notifications/[id]/read/route.ts` → `POST`
- [ ] **Step 2:** Append the eight endpoints to `ALL_ENDPOINTS` (append-only).
- [ ] **Step 3:** `npm run openapi`; confirm the diff to `openapi/mobile-v1.json` is only the eight operations (`getNotificationPrefs`, `patchNotificationPrefs`, `getNotificationMutes`, `postNotificationMute`, `deleteNotificationMute`, `postNotificationRead`, `postNotificationsReadAll`, `postTestPush`).
- [ ] **Step 4: Full verification:** `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build`. All must pass; record output for the checkpoint report.
- [ ] **Step 5: Commit** `feat(mobile-api): wire notification endpoints and regenerate OpenAPI`.

### Task 11: Review and handoff

- [ ] Fresh-context review of the branch (`/code-review` style, high effort); verify each finding before acting; fix; re-run Task 10 step 4.
- [ ] Write `docs/agent-handoffs/2026-10-03-phase5a-stage-b-web-handoff.md` (verified facts vs recommendations, verification limits, Rulings above, code changed: yes).
- [ ] **Checkpoint 1: stop and report to the owner. Do not merge before confirmation.**
