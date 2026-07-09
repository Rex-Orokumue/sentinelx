import { describe, it, expect } from 'vitest'
import { matchEventsFor } from './events'

const base = {
  id: 'm1',
  player_a_id: 'A',
  player_b_id: 'B',
  score_a: 3,
  score_b: 1,
  status: 'completed',
}

describe('matchEventsFor', () => {
  it('gives both players match_completed and the winner win_no_dispute', () => {
    const events = matchEventsFor(base)
    expect(events).toHaveLength(3)
    expect(events.filter((e) => e.player_id === 'A')).toEqual([
      { player_id: 'A', match_id: 'm1', event_type: 'match_completed', points_delta: 2, note: null },
      { player_id: 'A', match_id: 'm1', event_type: 'win_no_dispute', points_delta: 1, note: null },
    ])
    expect(events.filter((e) => e.player_id === 'B')).toEqual([
      { player_id: 'B', match_id: 'm1', event_type: 'match_completed', points_delta: 2, note: null },
    ])
  })

  it('awards win_no_dispute to player B when B wins', () => {
    const events = matchEventsFor({ ...base, score_a: 0, score_b: 2 })
    const wins = events.filter((e) => e.event_type === 'win_no_dispute')
    expect(wins).toHaveLength(1)
    expect(wins[0].player_id).toBe('B')
  })

  it('gives no win bonus on a draw', () => {
    const events = matchEventsFor({ ...base, score_a: 1, score_b: 1 })
    expect(events).toHaveLength(2)
    expect(events.every((e) => e.event_type === 'match_completed')).toBe(true)
  })

  it('returns nothing for a non-completed match', () => {
    expect(matchEventsFor({ ...base, status: 'scheduled' })).toEqual([])
    expect(matchEventsFor({ ...base, status: 'disputed' })).toEqual([])
  })

  it('returns nothing for a bye or missing scores', () => {
    expect(matchEventsFor({ ...base, status: 'bye', player_b_id: null, score_a: null, score_b: null })).toEqual([])
    expect(matchEventsFor({ ...base, score_b: null })).toEqual([])
  })
})
