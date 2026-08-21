import { describe, it, expect } from 'vitest'
import { computeQuestStatus } from './quest-status'

describe('computeQuestStatus', () => {
  it('is all-false for a brand new player', () => {
    const status = computeQuestStatus({ hasUsername: false, hasAvatar: false, hasPaidRegistration: false, totalMatches: 0 })
    expect(status).toEqual({
      profileComplete: false,
      firstTournamentEntered: false,
      firstMatchCompleted: false,
      allComplete: false,
    })
  })

  it('profileComplete requires both username and avatar', () => {
    expect(computeQuestStatus({ hasUsername: true, hasAvatar: false, hasPaidRegistration: false, totalMatches: 0 }).profileComplete).toBe(false)
    expect(computeQuestStatus({ hasUsername: false, hasAvatar: true, hasPaidRegistration: false, totalMatches: 0 }).profileComplete).toBe(false)
    expect(computeQuestStatus({ hasUsername: true, hasAvatar: true, hasPaidRegistration: false, totalMatches: 0 }).profileComplete).toBe(true)
  })

  it('firstTournamentEntered mirrors hasPaidRegistration', () => {
    expect(computeQuestStatus({ hasUsername: false, hasAvatar: false, hasPaidRegistration: true, totalMatches: 0 }).firstTournamentEntered).toBe(true)
    expect(computeQuestStatus({ hasUsername: false, hasAvatar: false, hasPaidRegistration: false, totalMatches: 0 }).firstTournamentEntered).toBe(false)
  })

  it('firstMatchCompleted is true once totalMatches is at least 1', () => {
    expect(computeQuestStatus({ hasUsername: false, hasAvatar: false, hasPaidRegistration: false, totalMatches: 0 }).firstMatchCompleted).toBe(false)
    expect(computeQuestStatus({ hasUsername: false, hasAvatar: false, hasPaidRegistration: false, totalMatches: 1 }).firstMatchCompleted).toBe(true)
    expect(computeQuestStatus({ hasUsername: false, hasAvatar: false, hasPaidRegistration: false, totalMatches: 5 }).firstMatchCompleted).toBe(true)
  })

  it('allComplete is true only when all three steps are done', () => {
    const status = computeQuestStatus({ hasUsername: true, hasAvatar: true, hasPaidRegistration: true, totalMatches: 1 })
    expect(status.allComplete).toBe(true)
  })

  it('allComplete is false if any single step is missing', () => {
    expect(computeQuestStatus({ hasUsername: false, hasAvatar: true, hasPaidRegistration: true, totalMatches: 1 }).allComplete).toBe(false)
    expect(computeQuestStatus({ hasUsername: true, hasAvatar: true, hasPaidRegistration: false, totalMatches: 1 }).allComplete).toBe(false)
    expect(computeQuestStatus({ hasUsername: true, hasAvatar: true, hasPaidRegistration: true, totalMatches: 0 }).allComplete).toBe(false)
  })
})
