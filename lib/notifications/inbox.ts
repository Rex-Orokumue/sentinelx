import { createAdminClient } from '@/lib/supabase/admin'

export type NotificationType =
  | 'listing_approved'
  | 'listing_removed'
  | 'withdrawal_paid'
  | 'withdrawal_rejected'
  | 'result_confirmed'
  | 'referral_credited'
  | 'friend_request'
  | 'wallet_credited'

// Best-effort — NEVER throws into the caller's primary action, mirroring
// lib/notifications/notify.ts's WhatsApp helper. A failed in-app notification
// insert must never break the withdrawal/result/listing action it's attached to.
export async function notifyInApp(input: {
  playerId: string
  type: NotificationType
  title: string
  body: string
  link?: string
}): Promise<void> {
  try {
    const admin = createAdminClient()
    await admin.from('player_notifications').insert({
      player_id: input.playerId,
      type: input.type,
      title: input.title,
      body: input.body,
      link: input.link ?? null,
    })
  } catch {
    // best-effort — swallow so the caller's action is never affected
  }
}
