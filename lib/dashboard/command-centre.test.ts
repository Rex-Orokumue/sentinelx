import { describe, it, expect } from 'vitest'
import { winRatePercent, xpToNextTierLabel, streakMilestonePreview, seasonQualifyProgress } from './command-centre'

describe('winRatePercent', () => {
  it('rounds to the nearest whole percent', () => {
    expect(winRatePercent(3, 4)).toBe(75)
  })
  it('is 0 for zero matches', () => {
    expect(winRatePercent(0, 0)).toBe(0)
  })
})

describe('xpToNextTierLabel', () => {
  it('reports XP remaining to the next tier', () => {
    expect(xpToNextTierLabel(4380)).toBe('620 XP to Elite')
  })
  it('reports MAX at Legend', () => {
    expect(xpToNextTierLabel(60000)).toBe('MAX — LEGEND')
  })
})

describe('streakMilestonePreview', () => {
  it('previews +50 coins on day 6 (tomorrow is day 7)', () => {
    expect(streakMilestonePreview(6)).toBe('+50 coins tomorrow')
  })
  it('previews +200 coins on day 29 (tomorrow is day 30)', () => {
    expect(streakMilestonePreview(29)).toBe('+200 coins tomorrow')
  })
  it('is null off-milestone', () => {
    expect(streakMilestonePreview(3)).toBeNull()
  })
})

describe('seasonQualifyProgress', () => {
  it('reports points needed when outside the top 16', () => {
    expect(seasonQualifyProgress(20, 340, 500)).toEqual({ qualified: false, pointsNeeded: 160 })
  })
  it('reports qualified with no points needed inside the top 16', () => {
    expect(seasonQualifyProgress(12, 340, 500)).toEqual({ qualified: true, pointsNeeded: 0 })
  })
  it('treats a null rank as not qualified', () => {
    expect(seasonQualifyProgress(null, 0, 500)).toEqual({ qualified: false, pointsNeeded: 500 })
  })
})
