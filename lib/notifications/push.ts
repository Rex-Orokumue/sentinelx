import { createAdminClient } from '@/lib/supabase/admin'
import { sendFCMToPlayer, sendToTokens, type FCMNotification } from './fcm'
import type { PushNotificationType } from './push-types'

// Tier 2 (FCM) entry point — mirrors notify()/notifyInApp()'s best-effort
// contract: never throws into the caller. Checks
// notification_prefs.push[type] first; the key defaults to true when
// absent, matching the seeded defaults in migration 062.
export async function pushToPlayer(
  playerId: string,
  type: PushNotificationType,
  notification: FCMNotification,
  data: Record<string, string>,
): Promise<void> {
  try {
    const admin = createAdminClient()
    const { data: profile } = await admin.from('profiles').select('notification_prefs').eq('id', playerId).maybeSingle()
    const push = (profile?.notification_prefs as { push?: Record<string, boolean> } | null)?.push
    if (push?.[type] === false) return
    await sendFCMToPlayer(playerId, notification, { ...data, type })
  } catch (err) {
    console.error('[push] pushToPlayer failed (non-blocking)', { playerId, type, err })
  }
}

// Broadcast variant for tournament_announced / new_announcement — filters
// per-player prefs itself (unlike broadcastFCM in fcm.ts, which sends to
// every token unconditionally) since a broadcast still has to respect each
// recipient's individual opt-out.
export async function broadcastPush(
  type: Extract<PushNotificationType, 'tournament_announced' | 'new_announcement'>,
  notification: FCMNotification,
  data: Record<string, string>,
): Promise<void> {
  try {
    const admin = createAdminClient()
    const { data: rows } = await admin
      .from('fcm_tokens')
      .select('id, token, profiles!inner(notification_prefs)')
    const eligible = (rows ?? [])
      .filter((r) => {
        const profile = r.profiles as { notification_prefs?: { push?: Record<string, boolean> } } | null
        return profile?.notification_prefs?.push?.[type] !== false
      })
      .map((r) => ({ id: r.id as string, token: r.token as string }))
    await sendToTokens(eligible, notification, { ...data, type })
  } catch (err) {
    console.error('[push] broadcastPush failed (non-blocking)', { type, err })
  }
}
