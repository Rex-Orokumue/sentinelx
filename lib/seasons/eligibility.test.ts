import { describe, it, expect } from 'vitest'
import { selectInvitees, MIN_SX_SCORE_FOR_INVITATION, type LeaderboardEntry } from './eligibility'

const board: LeaderboardEntry[] = [
  { playerId: 'p1', points: 100, sxScore: 800 },
  { playerId: 'p2', points: 90, sxScore: 300 }, // below floor
  { playerId: 'p3', points: 80, sxScore: 600 },
  { playerId: 'p4', points: 70, sxScore: 500 },
]

describe('selectInvitees', () => {
  it('excludes players below the SX Score floor', () => {
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

  it('MIN_SX_SCORE_FOR_INVITATION is 400', () => {
    expect(MIN_SX_SCORE_FOR_INVITATION).toBe(400)
  })
})
