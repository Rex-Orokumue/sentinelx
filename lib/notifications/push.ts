import { createAdminClient } from '@/lib/supabase/admin'
import { sendFCMToPlayer, sendToTokens, type FCMNotification } from './fcm'
import { isMuted } from './mutes'
import { deferNotification } from './defer'
import { renderNotification, pushTypeFor, type NotificationInput } from './copy'
import type { PushNotificationType } from './push-types'
import { toLocale, translatorFor, type Translate } from './locale'
import type { Locale } from '@/i18n/locales'

// Tier 2 (FCM) entry point — mirrors notify()/notifyInApp()'s best-effort
// contract: never throws into the caller.
//
// The real work goes through deferNotification, which registers it with the
// platform so it survives the response. That is deliberately done HERE rather
// than at each call site: nearly every caller writes `void pushToPlayer(...)`
// because a push must not block the action that triggered it, and a bare
// floating promise is exactly what Vercel discards when it freezes the
// instance (see defer.ts for the production trace). Owning the handoff at the
// entry point means no call site can get it wrong, including future ones.
//
// Callers pass the EVENT, not finished words: the copy is rendered here, in
// the recipient's language. See copy.ts.
export function pushToPlayer(
  playerId: string,
  input: NotificationInput,
  data: Record<string, string>,
  opts?: { postId?: string | null },
): Promise<void> {
  return deferNotification(sendPushToPlayer(playerId, input, data, opts))
}

async function pushTranslator(locale: Locale): Promise<Translate> {
  return translatorFor(locale, 'notifications.push')
}

async function sendPushToPlayer(
  playerId: string,
  input: NotificationInput,
  data: Record<string, string>,
  // Present for anything tied to a community post, so a muted thread stops
  // every notification about it whatever the type.
  opts?: { postId?: string | null },
): Promise<void> {
  const type = pushTypeFor(input)
  try {
    const admin = createAdminClient()
    // `locale` rides along with the prefs read that was already happening.
    const { data: profile } = await admin
      .from('profiles')
      .select('notification_prefs, locale')
      .eq('id', playerId)
      .maybeSingle()
    const push = (profile?.notification_prefs as { push?: Record<string, boolean> } | null)?.push
    if (push?.[type] === false) return

    // Temporary mutes (migration 082). Deliberately only silences the push —
    // the in-app bell still records it, because muting means "stop
    // interrupting me", not "hide this from me".
    const { data: mutes } = await admin
      .from('notification_mutes')
      .select('notification_type, post_id, muted_until')
      .eq('player_id', playerId)
      .gt('muted_until', new Date().toISOString())
    if (isMuted(mutes ?? [], { type, postId: opts?.postId }, new Date())) return

    const notification = renderNotification(input, await pushTranslator(toLocale(profile?.locale)))
    await sendFCMToPlayer(playerId, notification, { ...data, type })
  } catch (err) {
    console.error('[push] pushToPlayer failed (non-blocking)', { playerId, type, err })
  }
}

// Broadcast variant for tournament_announced / new_announcement — filters
// per-player prefs itself (unlike broadcastFCM in fcm.ts, which sends to
// every token unconditionally) since a broadcast still has to respect each
// recipient's individual opt-out.
export function broadcastPush(
  input: Extract<NotificationInput, { type: 'tournament_announced' | 'new_announcement' }>,
  data: Record<string, string>,
): Promise<void> {
  return deferNotification(sendBroadcastPush(input, data))
}

async function sendBroadcastPush(
  input: Extract<NotificationInput, { type: 'tournament_announced' | 'new_announcement' }>,
  data: Record<string, string>,
): Promise<void> {
  const type = pushTypeFor(input)
  try {
    const admin = createAdminClient()
    const { data: rows } = await admin
      .from('fcm_tokens')
      .select('id, token, profiles!inner(notification_prefs, locale)')

    // A broadcast cannot be rendered once: it goes to everyone, and everyone
    // gets their own language. Group the eligible tokens by locale and send one
    // batch per locale — today that is two batches, and it costs one extra FCM
    // call per additional language in use rather than one per recipient.
    const byLocale = new Map<Locale, { id: string; token: string }[]>()
    for (const r of rows ?? []) {
      const profile = r.profiles as {
        notification_prefs?: { push?: Record<string, boolean> }
        locale?: string | null
      } | null
      if (profile?.notification_prefs?.push?.[type] === false) continue
      const locale = toLocale(profile?.locale)
      const bucket = byLocale.get(locale) ?? []
      bucket.push({ id: r.id as string, token: r.token as string })
      byLocale.set(locale, bucket)
    }

    for (const [locale, tokens] of Array.from(byLocale.entries())) {
      if (tokens.length === 0) continue
      const notification = renderNotification(input, await pushTranslator(locale))
      await sendToTokens(tokens, notification, { ...data, type })
    }
  } catch (err) {
    console.error('[push] broadcastPush failed (non-blocking)', { type, err })
  }
}

// Escape hatch for staff alerts ONLY.
//
// notifyStaff() in lib/admin/staff.ts fans one already-composed payload out to
// every admin, and its callers build that payload themselves. Those messages are
// operational, addressed to the handful of people running the platform, and are
// not part of the player-facing catalog. Rather than smuggle a `{ title, body }`
// member into NotificationInput — where it would be the obvious way to skip
// translation for anything — the exception is named for what it is.
//
// Do not reach for this from player-facing code. Add a NotificationInput member.
export function pushPrerendered(
  playerId: string,
  type: PushNotificationType,
  notification: FCMNotification,
  data: Record<string, string>,
): Promise<void> {
  return deferNotification(sendPrerendered(playerId, type, notification, data))
}

async function sendPrerendered(
  playerId: string,
  type: PushNotificationType,
  notification: FCMNotification,
  data: Record<string, string>,
): Promise<void> {
  try {
    const admin = createAdminClient()
    const { data: profile } = await admin
      .from('profiles')
      .select('notification_prefs')
      .eq('id', playerId)
      .maybeSingle()
    const push = (profile?.notification_prefs as { push?: Record<string, boolean> } | null)?.push
    if (push?.[type] === false) return
    await sendFCMToPlayer(playerId, notification, { ...data, type })
  } catch (err) {
    console.error('[push] pushPrerendered failed (non-blocking)', { playerId, type, err })
  }
}
