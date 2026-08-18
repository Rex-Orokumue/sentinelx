// The 13 keys under profiles.notification_prefs.push (migration 062's
// default JSONB). Kept as its own file (not inside push.ts) so both
// push.ts and any settings-UI code that needs the full key list can import
// the type without pulling in fcm.ts's firebase-admin dependency.
export type PushNotificationType =
  | 'match_reminder'
  | 'result_confirmed'
  | 'achievement_unlocked'
  | 'challenge_completed'
  | 'new_announcement'
  | 'tournament_announced'
  | 'wager_settled'
  | 'referral_converted'
  | 'post_comment'
  | 'post_reaction'
  | 'bracket_released'
  | 'match_assigned'
  | 'prize_credited'
  | 'noshow_needs_decision'
  | 'withdrawal_pending'
  | 'exchange_listing_pending'
  | 'result_needs_review'
  | 'result_disputed'
  | 'result_no_submission'
