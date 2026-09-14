import { describe, it, expect } from 'vitest'
import { longestWinStreakByPlayer, type StreakMatch } from './streak'

const m = (a: string, b: string, sa: number, sb: number, at: string): StreakMatch => ({
  status: 'completed',
  score_a: sa,
  score_b: sb,
  player_a_id: a,
  player_b_id: b,
  completed_at: at,
})

describe('longestWinStreakByPlayer', () => {
  it('is empty with no matches', () => {
    expect(longestWinStreakByPlayer([]).size).toBe(0)
  })

  it('counts a run of consecutive wins', () => {
    const map = longestWinStreakByPlayer([
      m('x', 'y', 1, 0, '2026-01-01'),
      m('x', 'z', 2, 0, '2026-01-02'),
      m('x', 'w', 3, 0, '2026-01-03'),
    ])
    expect(map.get('x')).toBe(3)
  })

  it('breaks the run on a loss and keeps the longest', () => {
    const map = longestWinStreakByPlayer([
      m('x', 'y', 1, 0, '2026-01-01'),
      m('x', 'z', 2, 0, '2026-01-02'),
      m('x', 'w', 0, 1, '2026-01-03'), // loss
      m('x', 'v', 1, 0, '2026-01-04'),
    ])
    expect(map.get('x')).toBe(2)
  })

  it('breaks the run on a draw', () => {
    const map = longestWinStreakByPlayer([
      m('x', 'y', 1, 0, '2026-01-01'),
      m('x', 'z', 1, 1, '2026-01-02'), // draw
      m('x', 'w', 1, 0, '2026-01-03'),
    ])
    expect(map.get('x')).toBe(1)
  })

  it('counts wins from either side of the fixture', () => {
    const map = longestWinStreakByPlayer([
      m('y', 'x', 0, 1, '2026-01-01'),
      m('x', 'z', 5, 0, '2026-01-02'),
    ])
    expect(map.get('x')).toBe(2)
  })

  it('orders by completion time, not array order', () => {
    const map = longestWinStreakByPlayer([
      m('x', 'w', 1, 0, '2026-01-04'),
      m('x', 'y', 1, 0, '2026-01-01'),
      m('x', 'z', 0, 1, '2026-01-02'), // loss between them
    ])
    expect(map.get('x')).toBe(1)
  })

  it('tracks each player independently', () => {
    const map = longestWinStreakByPlayer([
      m('x', 'y', 1, 0, '2026-01-01'),
      m('x', 'y', 1, 0, '2026-01-02'),
      m('y', 'z', 1, 0, '2026-01-03'),
    ])
    expect(map.get('x')).toBe(2)
    expect(map.get('y')).toBe(1)
  })
})

const teamM = (over: Partial<StreakMatch>): StreakMatch => ({
  status: 'completed',
  score_a: 1,
  score_b: 0,
  player_a_id: null,
  player_b_id: null,
  team_a_id: 'sq1',
  team_b_id: 'sq2',
  team_a_roster: ['p1', 'p2'],
  team_b_roster: ['p3', 'p4'],
  completed_at: '2026-01-01',
  ...over,
})

describe('longestWinStreakByPlayer with team matches', () => {
  it('credits every roster member of the winning squad with the streak', () => {
    const map = longestWinStreakByPlayer([
      teamM({ completed_at: '2026-01-01' }),
      teamM({ completed_at: '2026-01-02' }),
    ])
    expect(map.get('p1')).toBe(2)
    expect(map.get('p2')).toBe(2)
    // A player who never wins gets no entry at all — matches this
    // function's existing solo-match contract (best only ever gets set on
    // a new personal-best streak, so 0 never gets written).
    expect(map.get('p3')).toBeUndefined()
  })

  it('breaks a roster member\'s streak on their squad losing', () => {
    const map = longestWinStreakByPlayer([
      teamM({ completed_at: '2026-01-01' }),
      teamM({ completed_at: '2026-01-02', score_a: 0, score_b: 1 }),
    ])
    expect(map.get('p1')).toBe(1)
  })
})
