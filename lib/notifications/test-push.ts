'use server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendToTokens } from './fcm'
import { DEVICE_TOKEN_COOKIE } from './device-cookie'

export type TestPushResult =
  | { ok: true }
  | { ok: false; reason: 'not-logged-in' | 'no-device-token' | 'not-configured' | 'send-failed' }

// Sends a push to the ONE device this is invoked from, on demand.
//
// Exists because diagnosing "push doesn't arrive" otherwise needs two
// accounts, a backgrounded tab and a guess about which of a dozen layers
// failed — token registration, preferences, recipient resolution, FCM
// transport, the service worker, or the OS. This isolates the last two: if the
// button reports sent and nothing appears, the server side is proven and the
// problem is the device.
export async function sendTestPush(): Promise<TestPushResult> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, reason: 'not-logged-in' }

  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return { ok: false, reason: 'not-configured' }
  }

  // The cookie identifies this browser specifically, so the test cannot
  // succeed on a different device and mislead.
  const deviceToken = cookies().get(DEVICE_TOKEN_COOKIE)?.value
  if (!deviceToken) return { ok: false, reason: 'no-device-token' }

  const admin = createAdminClient()
  const { data: row } = await admin
    .from('fcm_tokens')
    .select('id, token')
    .eq('player_id', user.id)
    .eq('token', deviceToken)
    .maybeSingle()
  if (!row) return { ok: false, reason: 'no-device-token' }

  try {
    await sendToTokens(
      [{ id: row.id, token: row.token }],
      { title: 'SentinelX test', body: 'Push notifications are working on this device 🎮' },
      { url: '/dashboard/settings', type: 'result_confirmed' },
    )
    return { ok: true }
  } catch (err) {
    console.error('[FCM] test push threw', err)
    return { ok: false, reason: 'send-failed' }
  }
}
