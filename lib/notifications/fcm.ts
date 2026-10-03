import { createAdminClient } from '@/lib/supabase/admin'
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app'
import { getMessaging, type Messaging, type MulticastMessage } from 'firebase-admin/messaging'
import { channelFor } from './channels'

export interface FCMNotification {
  title: string
  body: string
}

let cachedMessaging: Messaging | null | undefined // undefined = not attempted, null = unavailable

// Dormant until FIREBASE_SERVICE_ACCOUNT_JSON is set — same contract as
// sendWhatsApp() in termii.ts for TERMII_API_KEY. NOTE: this deliberately
// does NOT use the legacy fcm.googleapis.com/fcm/send + "server key"
// endpoint the original design doc specified — Google decommissioned that
// endpoint in June 2024. firebase-admin + a service account is the current
// supported path. The full downloaded service-account JSON is passed as a
// single env var (rather than splitting project_id/client_email/private_key
// into three vars) — one blob avoids the private_key newline-escaping
// footgun that comes with putting a PEM block in a single-line env var UI.
function getFirebaseMessaging(): Messaging | null {
  if (cachedMessaging !== undefined) return cachedMessaging
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  if (!serviceAccountJson) {
    console.warn('[FCM] FIREBASE_SERVICE_ACCOUNT_JSON not set — push skipped')
    cachedMessaging = null
    return null
  }
  let serviceAccount: object
  try {
    serviceAccount = JSON.parse(serviceAccountJson)
  } catch {
    console.error('[FCM] FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON — push skipped')
    cachedMessaging = null
    return null
  }
  const app: App = getApps()[0] ?? initializeApp({ credential: cert(serviceAccount) })
  cachedMessaging = getMessaging(app)
  return cachedMessaging
}

export interface PushToken {
  id: string
  token: string
  // fcm_tokens.platform. Anything other than 'android'/'ios' (null, missing, unknown) is treated as web: the
  // column defaults to 'web' and a row must never be dropped for want of a recognised value.
  platform?: string | null
}
export type TokenPlatform = 'web' | 'android' | 'ios'
export interface SendSummary {
  attempted: number
  succeeded: number
}

export function platformOf(p: string | null | undefined): TokenPlatform {
  return p === 'android' || p === 'ios' ? p : 'web'
}

// One multicast message per platform. title/body travel inside `data` on every platform (the web service
// worker and the app's foreground handler both read them there).
export function buildMulticast(
  platform: TokenPlatform,
  tokens: string[],
  notification: FCMNotification,
  data: Record<string, string>,
): MulticastMessage {
  const payloadData = { ...data, title: notification.title, body: notification.body }

  if (platform === 'android') {
    // A top-level `notification` is correct HERE, unlike web (see below): the duplicate-display bug is a
    // browser service-worker problem and does not exist in a native app, and an OS-displayed notification
    // survives Doze and a killed app, which a data-only message does not. The channel id comes from
    // channels.ts; an unknown type sends without one (Android then uses its default channel) rather than
    // failing.
    const channelId = channelFor(data.type)
    return {
      tokens,
      data: payloadData,
      notification: { title: notification.title, body: notification.body },
      android: { priority: 'high', ttl: 86_400_000, notification: channelId ? { channelId } : {} },
    }
  }

  if (platform === 'ios') {
    // Shape only: there is no iOS build or APNs credential yet (Phase 10), so delivery is unverified. Without
    // an alert block a data-only message would silently render nothing on iOS.
    return {
      tokens,
      data: payloadData,
      apns: {
        headers: { 'apns-priority': '10' },
        payload: {
          aps: { alert: { title: notification.title, body: notification.body }, sound: 'default', 'thread-id': data.type },
        },
      },
    }
  }

  // title/body travel inside `data`, never as a top-level `notification`
  // field — a `notification` payload makes the browser auto-display the
  // push itself, on top of the display our own onBackgroundMessage/
  // onMessage handlers (sw.js, useFCM.ts) already trigger, producing a
  // duplicate notification. Data-only leaves exactly one code path in
  // control of showNotification().
  return {
    tokens,
    data: payloadData,
    webpush: {
      // Data-only messages default to normal urgency, which Android Doze
      // batches and defers — a Galaxy S22 received test pushes minutes to
      // hours late while a laptop got them instantly, and OS-level Chrome
      // notification permission was already granted. Normal urgency is
      // right for background sync; it is wrong for a fixture assignment or
      // a result the player is waiting on, so every push here is high.
      //
      // Samsung's own battery management can still defer beyond this; a
      // player seeing persistent delay may also need Chrome excluded from
      // "Put app to sleep".
      //
      // TTL keeps a push queued for 24h rather than dropping it when the
      // device is unreachable at that instant.
      headers: { Urgency: 'high', TTL: '86400' },
      fcmOptions: { link: data.url },
    },
  }
}

// Shared by sendFCMToPlayer, broadcastFCM and broadcastPush (push.ts) so
// stale-token cleanup (FCM reporting a token as unregistered/invalid) lives
// in exactly one place. Tokens are partitioned by platform, then batched in
// groups of 500 — the FCM multicast limit. A failing batch never stops the
// others.
export async function sendToTokens(
  tokens: PushToken[],
  notification: FCMNotification,
  data: Record<string, string>,
): Promise<SendSummary> {
  const summary: SendSummary = { attempted: 0, succeeded: 0 }
  const messaging = getFirebaseMessaging()
  if (!messaging) return summary
  // Distinguished from a successful send on purpose. A player with no tokens
  // is the most common reason a push "doesn't arrive" — 90 of 102 players
  // were in that state — and silence made it indistinguishable from delivery.
  if (tokens.length === 0) {
    console.info('[FCM] no tokens for this recipient — nothing sent', { type: data.type })
    return summary
  }
  const admin = createAdminClient()

  const byPlatform = new Map<TokenPlatform, PushToken[]>()
  for (const t of tokens) {
    const platform = platformOf(t.platform)
    byPlatform.set(platform, [...(byPlatform.get(platform) ?? []), t])
  }

  for (const [platform, group] of Array.from(byPlatform.entries())) {
    for (let i = 0; i < group.length; i += 500) {
      const chunk = group.slice(i, i + 500)
      summary.attempted += chunk.length
      let res
      try {
        res = await messaging.sendEachForMulticast(buildMulticast(platform, chunk.map((t) => t.token), notification, data))
      } catch (err) {
        console.error('[FCM] multicast threw', { type: data.type, platform, err })
        continue
      }
      const staleIds: string[] = []
      // Every non-stale failure used to vanish here. A credentials error, a
      // quota rejection, a malformed payload — all silently discarded, which is
      // why "push never arrives" was indistinguishable from "push was never
      // attempted" and took a production DevTools session to diagnose.
      const otherErrors: string[] = []
      res.responses.forEach((r, idx) => {
        const code = r.error?.code
        if (r.success) return
        if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
          staleIds.push(chunk[idx].id)
        } else {
          otherErrors.push(code ?? 'unknown')
        }
      })

      const succeeded = res.responses.filter((r) => r.success).length
      summary.succeeded += succeeded
      console.info('[FCM] send complete', {
        type: data.type,
        platform,
        attempted: chunk.length,
        succeeded,
        stale: staleIds.length,
        failed: otherErrors.length,
      })
      if (otherErrors.length > 0) {
        console.error('[FCM] send failed for reasons other than a stale token', {
          type: data.type,
          platform,
          // Array.from rather than spreading the Set: the project's TS target
          // predates downlevelIteration.
          codes: Array.from(new Set(otherErrors)),
        })
      }

      if (staleIds.length > 0) await admin.from('fcm_tokens').delete().in('id', staleIds)
    }
  }
  return summary
}

export async function sendFCMToPlayer(
  playerId: string,
  notification: FCMNotification,
  data: Record<string, string>,
): Promise<void> {
  const messaging = getFirebaseMessaging()
  if (!messaging) return
  const admin = createAdminClient()
  const { data: tokens } = await admin.from('fcm_tokens').select('id, token, platform').eq('player_id', playerId)
  await sendToTokens(tokens ?? [], notification, data)
}

// All tokens, no pref filtering — callers that need per-player pref
// filtering at broadcast scale use broadcastPush (push.ts) instead, which
// does its own filtered query and calls sendToTokens directly.
export async function broadcastFCM(notification: FCMNotification, data: Record<string, string>): Promise<void> {
  const messaging = getFirebaseMessaging()
  if (!messaging) return
  const admin = createAdminClient()
  const { data: tokens } = await admin.from('fcm_tokens').select('id, token, platform')
  await sendToTokens(tokens ?? [], notification, data)
}
