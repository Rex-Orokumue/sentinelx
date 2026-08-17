import { createAdminClient } from '@/lib/supabase/admin'
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app'
import { getMessaging, type Messaging } from 'firebase-admin/messaging'

export interface FCMNotification {
  title: string
  body: string
}

let cachedMessaging: Messaging | null | undefined // undefined = not attempted, null = unavailable

// Dormant until all three server credentials are set — same contract as
// sendWhatsApp() in termii.ts for TERMII_API_KEY. NOTE: this deliberately
// does NOT use the legacy fcm.googleapis.com/fcm/send + "server key"
// endpoint the original design doc specified — Google decommissioned that
// endpoint in June 2024. firebase-admin + a service account is the current
// supported path.
function getFirebaseMessaging(): Messaging | null {
  if (cachedMessaging !== undefined) return cachedMessaging
  const projectId = process.env.FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_PRIVATE_KEY
  if (!projectId || !clientEmail || !privateKey) {
    console.warn('[FCM] Firebase server credentials not set — push skipped')
    cachedMessaging = null
    return null
  }
  const app: App = getApps()[0] ?? initializeApp({
    credential: cert({ projectId, clientEmail, privateKey: privateKey.replace(/\\n/g, '\n') }),
  })
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
  if (!messaging || tokens.length === 0) return
  const admin = createAdminClient()

  for (let i = 0; i < tokens.length; i += 500) {
    const chunk = tokens.slice(i, i + 500)
    const res = await messaging.sendEachForMulticast({
      tokens: chunk.map((t) => t.token),
      notification,
      data,
      webpush: { fcmOptions: { link: data.url } },
    })
    const staleIds: string[] = []
    res.responses.forEach((r, idx) => {
      const code = r.error?.code
      if (!r.success && (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token')) {
        staleIds.push(chunk[idx].id)
      }
    })
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
