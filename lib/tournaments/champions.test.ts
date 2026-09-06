import { describe, it, expect } from 'vitest'
import { headToHeadWinner, type H2HMatch } from './champions'

const m = (a: string, b: string, sa: number, sb: number): H2HMatch => ({
  playerAId: a, playerBId: b, scoreA: sa, scoreB: sb, status: 'completed',
})

describe('headToHeadWinner', () => {
  it('gives it to whoever won the meeting', () => {
    expect(headToHeadWinner('x', 'y', [m('x', 'y', 2, 1)])).toBe('x')
    expect(headToHeadWinner('x', 'y', [m('x', 'y', 1, 2)])).toBe('y')
  })

  it('reads the fixture from either side', () => {
    expect(headToHeadWinner('x', 'y', [m('y', 'x', 3, 0)])).toBe('y')
  })

  it('aggregates multiple meetings on points', () => {
    // x won one, y won one, and the third was drawn -> level on points,
    // separated below by goal difference.
    expect(headToHeadWinner('x', 'y', [m('x', 'y', 3, 0), m('y', 'x', 1, 0), m('x', 'y', 2, 2)])).toBe('x')
  })

  it('falls to head-to-head goal difference when points are level', () => {
    expect(headToHeadWinner('x', 'y', [m('x', 'y', 3, 0), m('y', 'x', 1, 0)])).toBe('x')
  })

  it('returns null when they are completely level', () => {
    expect(headToHeadWinner('x', 'y', [m('x', 'y', 1, 1)])).toBeNull()
    expect(headToHeadWinner('x', 'y', [m('x', 'y', 2, 0), m('y', 'x', 2, 0)])).toBeNull()
  })

  it('returns null when they never met', () => {
    expect(headToHeadWinner('x', 'y', [m('x', 'z', 5, 0)])).toBeNull()
  })

  it('ignores matches that are not completed or have no score', () => {
    expect(headToHeadWinner('x', 'y', [{ ...m('x', 'y', 3, 0), status: 'scheduled' }])).toBeNull()
    expect(headToHeadWinner('x', 'y', [{ ...m('x', 'y', 0, 0), scoreA: null }])).toBeNull()
  })
})
