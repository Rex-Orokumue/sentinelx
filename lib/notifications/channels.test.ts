import { describe, it, expect } from 'vitest'
import { ANDROID_CHANNEL_IDS, CHANNEL_FOR_TYPE, channelFor } from './channels'

// Keep in sync with the app's channel list (the mobile plan asserts the same five ids).
const ALL_TYPES = [
  'match_reminder', 'result_confirmed', 'result_submitted', 'achievement_unlocked', 'challenge_completed', 'new_announcement',
  'tournament_announced', 'wager_settled', 'referral_converted', 'post_comment', 'post_reaction', 'status_from_friend',
  'status_viewed', 'status_removed', 'bracket_released', 'match_assigned', 'prize_credited', 'new_follower', 'direct_message',
  'noshow_needs_decision', 'withdrawal_pending', 'exchange_listing_pending', 'result_needs_review', 'result_disputed', 'result_no_submission', 'chat_budget_alert',
]

describe('CHANNEL_FOR_TYPE', () => {
  it('maps all 26 push types exactly once, to a known channel', () => {
    expect(Object.keys(CHANNEL_FOR_TYPE).sort()).toEqual([...ALL_TYPES].sort())
    for (const c of Object.values(CHANNEL_FOR_TYPE)) expect(ANDROID_CHANNEL_IDS).toContain(c)
  })
  it('uses every channel at least once', () => {
    expect(new Set(Object.values(CHANNEL_FOR_TYPE))).toEqual(new Set(ANDROID_CHANNEL_IDS))
  })
  it('staff-bound types are admin_v1; the opponent notice stays on matches', () => {
    for (const t of ['noshow_needs_decision', 'result_no_submission', 'withdrawal_pending', 'chat_budget_alert', 'exchange_listing_pending', 'result_needs_review', 'result_disputed'])
      expect(CHANNEL_FOR_TYPE[t as keyof typeof CHANNEL_FOR_TYPE]).toBe('admin_v1')
    expect(CHANNEL_FOR_TYPE.result_submitted).toBe('matches_v1')
  })
  it('channelFor is undefined for an unknown type', () => {
    expect(channelFor('nope')).toBeUndefined()
    expect(channelFor(undefined)).toBeUndefined()
    expect(channelFor('toString')).toBeUndefined()
    expect(channelFor('direct_message')).toBe('messages_v1')
  })
})
