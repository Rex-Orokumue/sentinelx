import { describe, it, expect } from 'vitest'
import { selectInvitees, MIN_SENTINEL_SCORE_FOR_INVITATION, type LeaderboardEntry } from './eligibility'

const board: LeaderboardEntry[] = [
  { playerId: 'p1', points: 100, sentinelScore: 80 },
  { playerId: 'p2', points: 90, sentinelScore: 30 }, // below floor
  { playerId: 'p3', points: 80, sentinelScore: 60 },
  { playerId: 'p4', points: 70, sentinelScore: 50 },
]

describe('selectInvitees', () => {
  it('excludes players below the Sentinel Score floor', () => {
    const result = selectInvitees(board, new Set(), 3)
    expect(result).not.toContain('p2')
  })

  it('takes the top N eligible players by points, descending', () => {
    const result = selectInvitees(board, new Set(), 2)
    expect(result).toEqual(['p1', 'p3'])
  })

  it('skips players already invited', () => {
    const result = selectInvitees(board, new Set(['p1']), 2)
    expect(result).toEqual(['p3', 'p4'])
  })

  it('returns an empty array when there are no open slots', () => {
    expect(selectInvitees(board, new Set(), 0)).toEqual([])
  })

  it('MIN_SENTINEL_SCORE_FOR_INVITATION is 40', () => {
    expect(MIN_SENTINEL_SCORE_FOR_INVITATION).toBe(40)
  })
})
