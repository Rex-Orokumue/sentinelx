import { describe, it, expect } from 'vitest'
import type { PushNotificationType } from './push-types'

// Compile-time-only check made runtime-visible: every key in migration
// 062's notification_prefs.push default must have a matching union member.
// If this list and the union ever drift, this test's literal array will
// fail to satisfy the type and the build breaks — that's the point.
describe('PushNotificationType', () => {
  it('covers all 13 push pref keys from migration 062', () => {
    const keys: PushNotificationType[] = [
      'match_reminder', 'result_confirmed', 'achievement_unlocked',
      'challenge_completed', 'new_announcement', 'tournament_announced',
      'wager_settled', 'referral_converted', 'post_comment',
      'post_reaction', 'bracket_released', 'match_assigned', 'prize_credited',
    ]
    expect(keys).toHaveLength(13)
  })
})
