import type { createAdminClient } from '@/lib/supabase/admin'
import { sendToTokens, type PushToken } from './fcm'

type Admin = ReturnType<typeof createAdminClient>

// Shared with the web "send test notification" button (test-push.ts) so both say the same thing.
export const TEST_PUSH_NOTIFICATION = { title: 'SentinelX test', body: 'Push notifications are working on this device 🎮' }
// result_confirmed is a real type with a channel, so an android test exercises the same channel path as real traffic.
export const TEST_PUSH_DATA = { url: '/dashboard/settings', type: 'result_confirmed' }

// The mobile test button: every token the caller owns, through the real sender (so it exercises the platform
// split). Never reports success unless FCM accepted at least one message — "sent" with nothing delivered is the
// exact false reassurance this button exists to remove.
export async function sendTestPushToPlayer(admin: Admin, userId: string): Promise<'ok' | 'no_device'> {
  const { data } = await admin.from('fcm_tokens').select('id, token, platform').eq('player_id', userId)
  const tokens = (data ?? []) as PushToken[]
  if (tokens.length === 0) return 'no_device'
  const summary = await sendToTokens(tokens, TEST_PUSH_NOTIFICATION, TEST_PUSH_DATA)
  if (summary.succeeded === 0) {
    throw new Error(`test push delivered to 0 of ${summary.attempted} tokens`)
  }
  return 'ok'
}
