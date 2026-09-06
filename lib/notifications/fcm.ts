import { createAdminClient } from '@/lib/supabase/admin'
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app'
import { getMessaging, type Messaging } from 'firebase-admin/messaging'

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

// Shared by sendFCMToPlayer, broadcastFCM and broadcastPush (push.ts) so
// stale-token cleanup (FCM reporting a token as unregistered/invalid) lives
// in exactly one place. Batches in groups of 500 — the FCM multicast limit.
export async function sendToTokens(
  tokens: { id: string; token: string }[],
  notification: FCMNotification,
  data: Record<string, string>,
): Promise<void> {
  const messaging = getFirebaseMessaging()
  if (!messaging) return
  // Distinguished from a successful send on purpose. A player with no tokens
  // is the most common reason a push "doesn't arrive" — 90 of 102 players
  // were in that state — and silence made it indistinguishable from delivery.
  if (tokens.length === 0) {
    console.info('[FCM] no tokens for this recipient — nothing sent', { type: data.type })
    return
  }
  const admin = createAdminClient()
  // title/body travel inside `data`, never as a top-level `notification`
  // field — a `notification` payload makes the browser auto-display the
  // push itself, on top of the display our own onBackgroundMessage/
  // onMessage handlers (sw.js, useFCM.ts) already trigger, producing a
  // duplicate notification. Data-only leaves exactly one code path in
  // control of showNotification().
  const payloadData = { ...data, title: notification.title, body: notification.body }

  for (let i = 0; i < tokens.length; i += 500) {
    const chunk = tokens.slice(i, i + 500)
    const res = await messaging.sendEachForMulticast({
      tokens: chunk.map((t) => t.token),
      data: payloadData,
      webpush: { fcmOptions: { link: data.url } },
    })
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
    console.info('[FCM] send complete', {
      type: data.type,
      attempted: chunk.length,
      succeeded,
      stale: staleIds.length,
      failed: otherErrors.length,
    })
    if (otherErrors.length > 0) {
      console.error('[FCM] send failed for reasons other than a stale token', {
        type: data.type,
        // Array.from rather than spreading the Set: the project's TS target
        // predates downlevelIteration.
        codes: Array.from(new Set(otherErrors)),
      })
    }

    if (staleIds.length > 0) await admin.from('fcm_tokens').delete().in('id', staleIds)
  }
}

export async function sendFCMToPlayer(
  playerId: string,
  notification: FCMNotification,
  data: Record<string, string>,
): Promise<void> {
  const messaging = getFirebaseMessaging()
  if (!messaging) return
  const admin = createAdminClient()
  const { data: tokens } = await admin.from('fcm_tokens').select('id, token').eq('player_id', playerId)
  await sendToTokens(tokens ?? [], notification, data)
}

// All tokens, no pref filtering — callers that need per-player pref
// filtering at broadcast scale use broadcastPush (push.ts) instead, which
// does its own filtered query and calls sendToTokens directly.
export async function broadcastFCM(notification: FCMNotification, data: Record<string, string>): Promise<void> {
  const messaging = getFirebaseMessaging()
  if (!messaging) return
  const admin = createAdminClient()
  const { data: tokens } = await admin.from('fcm_tokens').select('id, token')
  await sendToTokens(tokens ?? [], notification, data)
}
