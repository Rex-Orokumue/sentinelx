// The keys under profiles.notification_prefs.push, plus a few push-only
// types that carry no pref key. Kept as its own file (not inside push.ts) so
// both push.ts and any settings-UI code that needs the full key list can
// import the type without pulling in fcm.ts's firebase-admin dependency.
//
// 15 of these are real pref keys. 'status_removed' is the exception: it is a
// moderation notice that is always delivered, so it appears here only for
// pushToPlayer's parameter type and has no notification_prefs.push entry
// (push?.['status_removed'] is undefined, never === false, so it always sends).
export type PushNotificationType =
  | 'match_reminder'
  | 'result_confirmed'
  | 'result_submitted'
  | 'achievement_unlocked'
  | 'challenge_completed'
  | 'new_announcement'
  | 'tournament_announced'
  | 'wager_settled'
  | 'referral_converted'
  | 'post_comment'
  | 'post_reaction'
  | 'status_from_friend'
  | 'status_viewed'
  | 'status_removed'
  | 'bracket_released'
  | 'match_assigned'
  | 'prize_credited'
  | 'noshow_needs_decision'
  | 'withdrawal_pending'
  | 'exchange_listing_pending'
  | 'result_needs_review'
  | 'result_disputed'
  | 'result_no_submission'
