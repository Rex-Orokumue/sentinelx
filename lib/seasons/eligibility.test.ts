import { describe, it, expect } from 'vitest'
import { selectInvitees, planInvitations, MIN_SX_SCORE_FOR_INVITATION, type LeaderboardEntry } from './eligibility'

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

describe('selectInvitees tie-break', () => {
  it('decides a points tie by SX Score, not by input order', () => {
    const tied: LeaderboardEntry[] = [
      { playerId: 'low', points: 25, sxScore: 830 },
      { playerId: 'high', points: 25, sxScore: 1000 },
    ]
    expect(selectInvitees(tied, new Set(), 1)).toEqual(['high'])
  })
})

describe('planInvitations', () => {
  const lb: LeaderboardEntry[] = [
    { playerId: 'a', points: 100, sxScore: 900 },
    { playerId: 'b', points: 90, sxScore: 900 },
    { playerId: 'c', points: 80, sxScore: 900 },
    { playerId: 'd', points: 70, sxScore: 900 },
    { playerId: 'e', points: 60, sxScore: 900 },
  ]

  it('never re-offers pending, accepted or declined players, even with includeExpired', () => {
    const inv = [
      { playerId: 'a', status: 'pending' },
      { playerId: 'b', status: 'accepted' },
      { playerId: 'c', status: 'declined' },
    ]
    expect(planInvitations(lb, inv, 5, { includeExpired: true })).toEqual({ invite: ['d', 'e'], reinvite: [] })
  })

  it('skips expired players by default', () => {
    expect(planInvitations(lb, [{ playerId: 'a', status: 'expired' }], 2)).toEqual({ invite: ['b', 'c'], reinvite: [] })
  })

  it('with includeExpired, ranks expired and never-invited players together and fills strictly by rank', () => {
    const inv = [
      { playerId: 'a', status: 'expired' },
      { playerId: 'c', status: 'expired' },
      { playerId: 'e', status: 'expired' },
    ]
    // slots=3 -> a, b, c by rank: a and c are re-invites, b is new; e (lowest) is held back as reserve.
    expect(planInvitations(lb, inv, 3, { includeExpired: true })).toEqual({ invite: ['b'], reinvite: ['a', 'c'] })
  })

  it('still applies the SX floor to expired players', () => {
    const low = [{ playerId: 'x', points: 500, sxScore: MIN_SX_SCORE_FOR_INVITATION - 1 }, ...lb]
    const out = planInvitations(low, [{ playerId: 'x', status: 'expired' }], 2, { includeExpired: true })
    expect(out.reinvite).toEqual([])
    expect(out.invite).toEqual(['a', 'b'])
  })

  it('returns nothing when no slots are open', () => {
    expect(planInvitations(lb, [], 0)).toEqual({ invite: [], reinvite: [] })
  })
})
