import { describe, it, expect } from 'vitest'
import {
  defaultAssignmentFirstRound,
  defaultAssignmentNextRound,
  shapeOf,
  validateAssignment,
  computePendingKnockoutRound,
  computeRearrangeableKnockoutRound,
} from './knockout-pairing'
import type { BracketMatch } from './bracket'

describe('defaultAssignmentFirstRound', () => {
  it('pairs 8 participants into 4 matches, no byes', () => {
    const a = defaultAssignmentFirstRound(['1', '2', '3', '4', '5', '6', '7', '8'])
    expect(a.byePlayerIds).toEqual([])
    expect(a.matchPairs).toEqual([
      ['1', '8'],
      ['2', '7'],
      ['3', '6'],
      ['4', '5'],
    ])
  })
  it('gives the top seeds byes when the count is not a power of two (12 -> 4 byes + 4 matches)', () => {
    const a = defaultAssignmentFirstRound(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'])
    expect(a.byePlayerIds).toEqual(['1', '2', '3', '4'])
    expect(a.matchPairs).toEqual([
      ['5', '12'],
      ['6', '11'],
      ['7', '10'],
      ['8', '9'],
    ])
  })
})

describe('defaultAssignmentNextRound', () => {
  it('interleaves byes with match-winners then pairs (4 byes + 4 winners)', () => {
    const a = defaultAssignmentNextRound(['b1', 'b2', 'b3', 'b4'], ['w1', 'w2', 'w3', 'w4'])
    expect(a.byePlayerIds).toEqual([])
    expect(a.matchPairs).toEqual([
      ['b1', 'w1'],
      ['b2', 'w2'],
      ['b3', 'w3'],
      ['b4', 'w4'],
    ])
  })
  it('leaves the last player out as a bye when the advancer count is odd', () => {
    const a = defaultAssignmentNextRound(['b1'], ['w1', 'w2'])
    expect(a.matchPairs).toEqual([['b1', 'w1']])
    expect(a.byePlayerIds).toEqual(['w2'])
  })
  it('handles no byes (later rounds)', () => {
    const a = defaultAssignmentNextRound([], ['w1', 'w2', 'w3', 'w4'])
    expect(a).toEqual({ byePlayerIds: [], matchPairs: [['w1', 'w2'], ['w3', 'w4']] })
  })
})

describe('shapeOf', () => {
  it('counts slots', () => {
    expect(shapeOf({ byePlayerIds: ['x'], matchPairs: [['a', 'b'], ['c', 'd']] })).toEqual({
      byeCount: 1,
      matchCount: 2,
    })
  })
})

describe('validateAssignment', () => {
  const truth = ['a', 'b', 'c', 'd']
  const shape = { byeCount: 0, matchCount: 2 }

  it('accepts a valid permutation', () => {
    expect(
      validateAssignment(truth, shape, { byePlayerIds: [], matchPairs: [['a', 'c'], ['b', 'd']] }),
    ).toEqual({ ok: true })
  })
  it('rejects a duplicated player', () => {
    const r = validateAssignment(truth, shape, { byePlayerIds: [], matchPairs: [['a', 'a'], ['b', 'd']] })
    expect(r.ok).toBe(false)
  })
  it('rejects an unknown player', () => {
    const r = validateAssignment(truth, shape, { byePlayerIds: [], matchPairs: [['a', 'z'], ['b', 'd']] })
    expect(r.ok).toBe(false)
  })
  it('rejects a missing player', () => {
    const r = validateAssignment(truth, shape, { byePlayerIds: [], matchPairs: [['a', 'b'], ['c', '']] })
    expect(r.ok).toBe(false)
  })
  it('rejects the wrong bye count', () => {
    const r = validateAssignment(truth, { byeCount: 1, matchCount: 2 }, {
      byePlayerIds: [],
      matchPairs: [['a', 'b'], ['c', 'd']],
    })
    expect(r.ok).toBe(false)
  })
})

function bm(over: Partial<BracketMatch>): BracketMatch {
  return {
    id: 'm',
    round: 'round_of_16',
    group_id: null,
    groupName: null,
    status: 'completed',
    score_a: 1,
    score_b: 0,
    scheduled_at: null,
    is_full_day: true,
    playerA: { id: 'a', name: 'A' },
    playerB: { id: 'b', name: 'B' },
    ...over,
  }
}

describe('computePendingKnockoutRound', () => {
  it('returns null when the flag is off', () => {
    expect(
      computePendingKnockoutRound({
        manualPairingEnabled: false,
        hasGroups: true,
        groupStageComplete: true,
        standings: [],
        knockoutRounds: [],
      }),
    ).toBeNull()
  })

  it('proposes the first knockout round from group advancers once the group stage is done', () => {
    const standings = [
      {
        groupName: 'Group A',
        rows: [
          { playerId: 'a1', name: 'A1', advancing: true },
          { playerId: 'a2', name: 'A2', advancing: true },
          { playerId: 'a3', name: 'A3', advancing: false },
        ],
      },
      {
        groupName: 'Group B',
        rows: [
          { playerId: 'b1', name: 'B1', advancing: true },
          { playerId: 'b2', name: 'B2', advancing: true },
        ],
      },
    ]
    const p = computePendingKnockoutRound({
      manualPairingEnabled: true,
      hasGroups: true,
      groupStageComplete: true,
      standings,
      knockoutRounds: [],
    })
    expect(p?.round).toBe('semi_final')
    expect(p?.participants.map((x) => x.id)).toEqual(['a1', 'b1', 'a2', 'b2'])
    expect(p?.shape).toEqual({ byeCount: 0, matchCount: 2 })
    expect(p?.defaultAssignment.matchPairs).toEqual([
      ['a1', 'b2'],
      ['b1', 'a2'],
    ])
  })

  it('waits for the group stage to finish', () => {
    expect(
      computePendingKnockoutRound({
        manualPairingEnabled: true,
        hasGroups: true,
        groupStageComplete: false,
        standings: [
          {
            groupName: 'A',
            rows: [
              { playerId: 'a1', name: 'A1', advancing: true },
              { playerId: 'a2', name: 'A2', advancing: true },
            ],
          },
        ],
        knockoutRounds: [],
      }),
    ).toBeNull()
  })

  it('proposes the next round once the current round is fully resolved', () => {
    const qf = [
      bm({ id: 'q1', round: 'quarter_final', playerA: { id: 'w1', name: 'W1' }, playerB: { id: 'l1', name: 'L1' }, score_a: 2, score_b: 0 }),
      bm({ id: 'q2', round: 'quarter_final', playerA: { id: 'l2', name: 'L2' }, playerB: { id: 'w2', name: 'W2' }, score_a: 0, score_b: 1 }),
      bm({ id: 'q3', round: 'quarter_final', playerA: { id: 'w3', name: 'W3' }, playerB: { id: 'l3', name: 'L3' }, score_a: 3, score_b: 1 }),
      bm({ id: 'q4', round: 'quarter_final', playerA: { id: 'w4', name: 'W4' }, playerB: { id: 'l4', name: 'L4' }, score_a: 5, score_b: 2 }),
    ]
    const p = computePendingKnockoutRound({
      manualPairingEnabled: true,
      hasGroups: true,
      groupStageComplete: true,
      standings: [],
      knockoutRounds: [{ round: 'quarter_final', matches: qf }],
    })
    expect(p?.round).toBe('semi_final')
    expect(p?.participants.map((x) => x.id).sort()).toEqual(['w1', 'w2', 'w3', 'w4'])
    expect(p?.shape).toEqual({ byeCount: 0, matchCount: 2 })
  })

  it('returns null when the next round already exists', () => {
    const qf = [bm({ id: 'q1', round: 'quarter_final', score_a: 1, score_b: 0 })]
    const sf = [bm({ id: 's1', round: 'semi_final', status: 'scheduled', score_a: null, score_b: null })]
    expect(
      computePendingKnockoutRound({
        manualPairingEnabled: true,
        hasGroups: true,
        groupStageComplete: true,
        standings: [],
        knockoutRounds: [
          { round: 'quarter_final', matches: qf },
          { round: 'semi_final', matches: sf },
        ],
      }),
    ).toBeNull()
  })

  it('returns null when the current round is not resolved', () => {
    const qf = [bm({ id: 'q1', round: 'quarter_final', status: 'scheduled', score_a: null, score_b: null })]
    expect(
      computePendingKnockoutRound({
        manualPairingEnabled: true,
        hasGroups: true,
        groupStageComplete: true,
        standings: [],
        knockoutRounds: [{ round: 'quarter_final', matches: qf }],
      }),
    ).toBeNull()
  })

  it('returns null after the final', () => {
    const f = [bm({ id: 'f1', round: 'final', score_a: 2, score_b: 1 })]
    expect(
      computePendingKnockoutRound({
        manualPairingEnabled: true,
        hasGroups: true,
        groupStageComplete: true,
        standings: [],
        knockoutRounds: [{ round: 'final', matches: f }],
      }),
    ).toBeNull()
  })
})

describe('computeRearrangeableKnockoutRound', () => {
  it('offers the most advanced all-unplayed knockout round', () => {
    const qf = [
      bm({
        id: 'q1',
        round: 'quarter_final',
        status: 'scheduled',
        score_a: null,
        score_b: null,
        playerA: { id: 'p1', name: 'P1' },
        playerB: { id: 'p2', name: 'P2' },
      }),
      bm({
        id: 'q2',
        round: 'quarter_final',
        status: 'scheduled',
        score_a: null,
        score_b: null,
        playerA: { id: 'p3', name: 'P3' },
        playerB: { id: 'p4', name: 'P4' },
      }),
    ]
    const r = computeRearrangeableKnockoutRound({ knockoutRounds: [{ round: 'quarter_final', matches: qf }] })
    expect(r?.round).toBe('quarter_final')
    expect(r?.participants.map((x) => x.id).sort()).toEqual(['p1', 'p2', 'p3', 'p4'])
    expect(r?.currentAssignment.matchPairs).toEqual([
      ['p1', 'p2'],
      ['p3', 'p4'],
    ])
    expect(r?.matchIdByPairIndex).toEqual(['q1', 'q2'])
  })

  it('returns null when any match in the round has been played', () => {
    const qf = [
      bm({ id: 'q1', round: 'quarter_final', status: 'completed', score_a: 1, score_b: 0 }),
      bm({ id: 'q2', round: 'quarter_final', status: 'scheduled', score_a: null, score_b: null }),
    ]
    expect(computeRearrangeableKnockoutRound({ knockoutRounds: [{ round: 'quarter_final', matches: qf }] })).toBeNull()
  })

  it('returns null when there are no knockout rounds', () => {
    expect(computeRearrangeableKnockoutRound({ knockoutRounds: [] })).toBeNull()
  })
})
