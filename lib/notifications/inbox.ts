import { createAdminClient } from '@/lib/supabase/admin'

export type NotificationType =
  | 'listing_approved'
  | 'listing_removed'
  | 'listing_deleted'
  | 'listing_sold'
  | 'withdrawal_paid'
  | 'withdrawal_rejected'
  | 'result_confirmed'
  | 'referral_credited'
  | 'friend_request'
  | 'wallet_credited'
  | 'fixture_assigned'
  | 'player_disqualified'
  | 'noshow_needs_decision'
  | 'buy_request_in_progress'
  | 'buy_request_fulfilled'
  | 'buy_request_closed'
  | 'masters_invitation'
  | 'champions_cup_invitation'
  | 'invitation_accepted'
  | 'invitation_expired_cascade'
  | 'tier_upgraded'
  | 'achievement_unlocked'
  | 'prize_credited'
  | 'tournament_announced'
  | 'new_announcement'
  | 'post_comment'
  | 'post_reaction'
  | 'wager_settled'
  | 'bracket_released'
  | 'match_reminder'
  | 'withdrawal_pending'
  | 'exchange_listing_pending'
  | 'result_needs_review'
  | 'result_disputed'
  | 'result_no_submission'

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

// Bulk in-app insert for broadcast-scale events (tournament_announced,
// new_announcement). Chunked at 500 rows/insert — same batch size as the
// FCM multicast limit in fcm.ts, no deep reason they need to match, just
// convenient symmetry.
export async function broadcastInApp(input: {
  type: NotificationType
  title: string
  body: string
  link?: string
}): Promise<void> {
  try {
    const admin = createAdminClient()
    const { data: players } = await admin.from('profiles').select('id')
    const ids = (players ?? []).map((p) => p.id as string)
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500)
      await admin.from('player_notifications').insert(
        chunk.map((playerId) => ({
          player_id: playerId,
          type: input.type,
          title: input.title,
          body: input.body,
          link: input.link ?? null,
        })),
      )
    }
  } catch (err) {
    console.error('[inbox] broadcastInApp failed (non-blocking)', { type: input.type, err })
  }
}
