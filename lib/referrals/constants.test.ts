import { describe, it, expect } from 'vitest'
import { pickMilestone } from './constants'

describe('pickMilestone', () => {
  it('returns the matching milestone at an exact threshold', () => {
    expect(pickMilestone(1)).toEqual({ count: 1, achievementSlug: 'referral_first' })
    expect(pickMilestone(5)).toEqual({ count: 5, achievementSlug: 'referral_squad' })
    expect(pickMilestone(10)).toEqual({ count: 10, achievementSlug: 'referral_champion' })
    expect(pickMilestone(25)).toEqual({ count: 25, achievementSlug: 'referral_sentinel' })
    expect(pickMilestone(50)).toEqual({ count: 50, achievementSlug: 'referral_legend' })
  })

  it('returns null between thresholds', () => {
    expect(pickMilestone(2)).toBeNull()
    expect(pickMilestone(6)).toBeNull()
    expect(pickMilestone(49)).toBeNull()
  })

  it('returns null past the highest threshold', () => {
    expect(pickMilestone(51)).toBeNull()
    expect(pickMilestone(1000)).toBeNull()
  })

  it('returns null at zero', () => {
    expect(pickMilestone(0)).toBeNull()
  })
})
