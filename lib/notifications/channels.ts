import type { PushNotificationType } from './push-types'

// Android fixes a channel's importance and sound at creation, so a change needs a new id (matches_v2),
// never an edit to one players already have. The app creates exactly these five at startup.
export const ANDROID_CHANNEL_IDS = ['matches_v1', 'social_v1', 'messages_v1', 'money_v1', 'admin_v1'] as const
export type AndroidChannelId = (typeof ANDROID_CHANNEL_IDS)[number]

// Record<PushNotificationType, …> makes the compiler enforce that a new push type gets a channel.
export const CHANNEL_FOR_TYPE: Record<PushNotificationType, AndroidChannelId> = {
  match_reminder: 'matches_v1',
  match_assigned: 'matches_v1',
  bracket_released: 'matches_v1',
  result_confirmed: 'matches_v1',
  result_submitted: 'matches_v1',
  wager_settled: 'matches_v1',
  tournament_announced: 'matches_v1',
  post_comment: 'social_v1',
  post_reaction: 'social_v1',
  status_from_friend: 'social_v1',
  status_viewed: 'social_v1',
  status_removed: 'social_v1',
  new_follower: 'social_v1',
  achievement_unlocked: 'social_v1',
  challenge_completed: 'social_v1',
  new_announcement: 'social_v1',
  direct_message: 'messages_v1',
  prize_credited: 'money_v1',
  referral_converted: 'money_v1',
  // Staff-bound: only ever sent via notifyStaff or to staff ids (noshow-actions.ts).
  withdrawal_pending: 'admin_v1',
  exchange_listing_pending: 'admin_v1',
  result_needs_review: 'admin_v1',
  result_disputed: 'admin_v1',
  result_no_submission: 'admin_v1',
  noshow_needs_decision: 'admin_v1',
}

export function channelFor(type: string | undefined): AndroidChannelId | undefined {
  return type && Object.prototype.hasOwnProperty.call(CHANNEL_FOR_TYPE, type)
    ? CHANNEL_FOR_TYPE[type as PushNotificationType]
    : undefined
}
