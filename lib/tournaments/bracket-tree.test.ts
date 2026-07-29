import { describe, it, expect } from 'vitest'
import { projectBracketRounds, buildBracketDisplay } from './bracket-tree'
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

const ids = (round: { groups: (BracketMatch | null)[][] }) =>
  round.groups.map((g) => g.map((m) => m?.id ?? null))

describe('projectBracketRounds', () => {
  it('projects the full shape for 16 qualifiers (8 groups x top 2)', () => {
    expect(projectBracketRounds(16)).toEqual([
      { round: 'round_of_16', label: 'Round of 16', matchCount: 8 },
      { round: 'quarter_final', label: 'Quarter-finals', matchCount: 4 },
      { round: 'semi_final', label: 'Semi-finals', matchCount: 2 },
      { round: 'final', label: 'Final', matchCount: 1 },
    ])
  })

  it('rounds a non-power-of-two field up to the next bracket size', () => {
    expect(projectBracketRounds(6).map((r) => r.round)).toEqual([
      'quarter_final',
      'semi_final',
      'final',
    ])
  })

  it('projects a single final for two qualifiers, and nothing below that', () => {
    expect(projectBracketRounds(2)).toEqual([{ round: 'final', label: 'Final', matchCount: 1 }])
    expect(projectBracketRounds(1)).toEqual([])
    expect(projectBracketRounds(0)).toEqual([])
  })
})

describe('buildBracketDisplay', () => {
  it('draws the whole chart as empty slots before any knockout match exists', () => {
    const display = buildBracketDisplay([], projectBracketRounds(16))
    expect(display.map((r) => r.round)).toEqual([
      'round_of_16',
      'quarter_final',
      'semi_final',
      'final',
    ])
    // 8 first-round matches = 4 groups of 2, all empty.
    expect(display[0].groups).toHaveLength(4)
    expect(display[0].groups.every((g) => g.length === 2 && g.every((s) => s === null))).toBe(true)
    expect(display[3].groups).toEqual([[null]])
  })

  it('fills the generated round and leaves later rounds as empty slots', () => {
    const quarters = [
      match('q1', 'a', 'b'),
      match('q2', 'c', 'd'),
      match('q3', 'e', 'f'),
      match('q4', 'g', 'h'),
    ]
    const display = buildBracketDisplay(
      [{ round: 'quarter_final', label: 'Quarter-finals', matches: quarters }],
      projectBracketRounds(8),
    )
    expect(display.map((r) => r.round)).toEqual(['quarter_final', 'semi_final', 'final'])
    // All four played quarter-finals are on the chart...
    expect(display[0].groups.flat().filter(Boolean)).toHaveLength(4)
    // ...and the rounds they feed are drawn but still empty.
    expect(display[1].groups.flat().every((s) => s === null)).toBe(true)
    expect(display[2].groups).toEqual([[null]])
  })

  it('pairs feeders by player once the following round exists', () => {
    const quarters = [
      match('q1', 'a', 'b'),
      match('q2', 'c', 'd'),
      match('q3', 'e', 'f'),
      match('q4', 'g', 'h'),
    ]
    // Semis deliberately out of quarter-final order: s1 takes q3/q4's winners.
    const semis = [match('s1', 'e', 'g'), match('s2', 'a', 'c')]

    const display = buildBracketDisplay(
      [
        { round: 'quarter_final', label: 'Quarter-finals', matches: quarters },
        { round: 'semi_final', label: 'Semi-finals', matches: semis },
      ],
      projectBracketRounds(8),
    )
    expect(ids(display[0])).toEqual([
      ['q3', 'q4'],
      ['q1', 'q2'],
    ])
    expect(ids(display[1])).toEqual([['s1', 's2']])
  })

  it('leaves the partner slot empty when a player advanced via a bye', () => {
    const quarters = [match('q1', 'a', 'b')]
    const semis = [match('s1', 'a', 'z')] // 'z' had a bye — no quarter-final
    const display = buildBracketDisplay(
      [
        { round: 'quarter_final', label: 'Quarter-finals', matches: quarters },
        { round: 'semi_final', label: 'Semi-finals', matches: semis },
      ],
      [],
    )
    expect(ids(display[0])).toEqual([['q1', null]])
  })

  it('keeps a match nobody advanced out of on the chart (double forfeit)', () => {
    const quarters = [match('q1', 'a', 'b'), match('q2', 'c', 'd')]
    const semis = [match('s1', 'a', 'z')]
    const display = buildBracketDisplay(
      [
        { round: 'quarter_final', label: 'Quarter-finals', matches: quarters },
        { round: 'semi_final', label: 'Semi-finals', matches: semis },
      ],
      [],
    )
    const present = display[0].groups.flat().filter(Boolean).map((m) => m!.id)
    expect(present).toContain('q1')
    expect(present).toContain('q2')
  })

  it('never assigns the same feeder to two slots', () => {
    const quarters = [match('q1', 'a', 'b'), match('q2', 'c', 'd')]
    const semis = [match('s1', 'a', 'c'), match('s2', 'a', 'd')] // malformed
    const display = buildBracketDisplay(
      [
        { round: 'quarter_final', label: 'Quarter-finals', matches: quarters },
        { round: 'semi_final', label: 'Semi-finals', matches: semis },
      ],
      projectBracketRounds(8),
    )
    const flat = display[0].groups.flat().filter(Boolean).map((m) => m!.id)
    expect(flat).toHaveLength(new Set(flat).size)
  })

  it('falls back to the actual rounds when there is nothing to project', () => {
    const display = buildBracketDisplay(
      [{ round: 'final', label: 'Final', matches: [match('f', 'a', 'b')] }],
      [],
    )
    expect(display.map((r) => r.round)).toEqual(['final'])
    expect(ids(display[0])).toEqual([['f']])
  })

  it('returns nothing when there is neither a projection nor a match', () => {
    expect(buildBracketDisplay([], [])).toEqual([])
  })
})
