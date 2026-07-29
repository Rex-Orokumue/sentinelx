import { describe, it, expect } from 'vitest'
import { buildBracketTree } from './bracket-tree'
import type { BracketMatch } from './bracket'

function match(id: string, aId: string, bId: string): BracketMatch {
  return {
    id,
    round: 'quarter_final',
    group_id: null,
    groupName: null,
    status: 'completed',
    score_a: 1,
    score_b: 0,
    scheduled_at: null,
    is_full_day: true,
    playerA: { id: aId, name: aId || 'TBD' },
    playerB: { id: bId, name: bId || 'TBD' },
  }
}

describe('buildBracketTree', () => {
  it('returns nothing for no rounds', () => {
    expect(buildBracketTree([])).toEqual([])
  })

  it('gives each match of a lone round its own group', () => {
    const tree = buildBracketTree([
      { round: 'final', label: 'Final', matches: [match('f', 'p1', 'p2')] },
    ])
    expect(tree).toHaveLength(1)
    expect(tree[0].groups).toEqual([[match('f', 'p1', 'p2')]])
  })

  it('orders an earlier round so each feeder pair sits opposite the match it feeds', () => {
    // Semis: s1 = w(q3) vs w(q4), s2 = w(q1) vs w(q2) — deliberately not in
    // quarter-final order, so a naive index-based pairing would get it wrong.
    const quarters = [
      match('q1', 'a', 'b'),
      match('q2', 'c', 'd'),
      match('q3', 'e', 'f'),
      match('q4', 'g', 'h'),
    ]
    const semis = [match('s1', 'e', 'g'), match('s2', 'a', 'c')]

    const tree = buildBracketTree([
      { round: 'quarter_final', label: 'Quarter-finals', matches: quarters },
      { round: 'semi_final', label: 'Semi-finals', matches: semis },
    ])

    expect(tree.map((r) => r.round)).toEqual(['quarter_final', 'semi_final'])
    // Group 0 feeds s1, group 1 feeds s2 — following the semis' order.
    expect(tree[0].groups.map((g) => g.map((m) => m.id))).toEqual([
      ['q3', 'q4'],
      ['q1', 'q2'],
    ])
    expect(tree[1].groups.map((g) => g.map((m) => m.id))).toEqual([['s1'], ['s2']])
  })

  it('gives a slot a single feeder when the opponent arrived via an earlier bye', () => {
    const quarters = [match('q1', 'a', 'b')]
    // 'z' never played a quarter-final — they had a bye.
    const semis = [match('s1', 'a', 'z')]

    const tree = buildBracketTree([
      { round: 'quarter_final', label: 'Quarter-finals', matches: quarters },
      { round: 'semi_final', label: 'Semi-finals', matches: semis },
    ])
    expect(tree[0].groups.map((g) => g.map((m) => m.id))).toEqual([['q1']])
  })

  it('still places a match nobody advanced out of (double forfeit)', () => {
    const quarters = [match('q1', 'a', 'b'), match('q2', 'c', 'd')]
    // Only q1's winner advanced; q2 was forfeited by both players.
    const semis = [match('s1', 'a', 'z')]

    const tree = buildBracketTree([
      { round: 'quarter_final', label: 'Quarter-finals', matches: quarters },
      { round: 'semi_final', label: 'Semi-finals', matches: semis },
    ])
    const ids = tree[0].groups.map((g) => g.map((m) => m.id))
    expect(ids).toContainEqual(['q1'])
    expect(ids).toContainEqual(['q2'])
    expect(tree[0].groups.flat()).toHaveLength(2)
  })

  it('never assigns the same feeder to two slots', () => {
    const quarters = [match('q1', 'a', 'b'), match('q2', 'c', 'd')]
    // Malformed data: both semis claim 'a' as a participant.
    const semis = [match('s1', 'a', 'c'), match('s2', 'a', 'd')]

    const tree = buildBracketTree([
      { round: 'quarter_final', label: 'Quarter-finals', matches: quarters },
      { round: 'semi_final', label: 'Semi-finals', matches: semis },
    ])
    const flat = tree[0].groups.flat().map((m) => m.id)
    expect(flat).toHaveLength(new Set(flat).size)
  })

  it('links a three-round tree end to end', () => {
    const quarters = [
      match('q1', 'a', 'b'),
      match('q2', 'c', 'd'),
      match('q3', 'e', 'f'),
      match('q4', 'g', 'h'),
    ]
    const semis = [match('s1', 'a', 'c'), match('s2', 'e', 'g')]
    const final = [match('f1', 'a', 'e')]

    const tree = buildBracketTree([
      { round: 'quarter_final', label: 'Quarter-finals', matches: quarters },
      { round: 'semi_final', label: 'Semi-finals', matches: semis },
      { round: 'final', label: 'Final', matches: final },
    ])

    expect(tree[2].groups.map((g) => g.map((m) => m.id))).toEqual([['f1']])
    expect(tree[1].groups.map((g) => g.map((m) => m.id))).toEqual([['s1', 's2']])
    expect(tree[0].groups.map((g) => g.map((m) => m.id))).toEqual([
      ['q1', 'q2'],
      ['q3', 'q4'],
    ])
  })
})
